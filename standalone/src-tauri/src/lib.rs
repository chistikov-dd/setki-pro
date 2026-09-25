mod db;

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

struct AppState {
    db_pool: Arc<SqlitePool>,
    /// Путь к последнему открытому .json файлу турнира — используется для
    /// автосохранения изменений обратно на диск после каждой мутирующей команды.
    /// None до первой успешной загрузки файла (или если приложение только что
    /// запущено и файл ещё не открывали в этой сессии).
    tournament_file_path: Arc<Mutex<Option<PathBuf>>>,
}

// ============================================
// Вспомогательные функции
// ============================================

/// Преобразовать строку matches_cache в JSON в формате, совместимом с фронтендом
/// (participant1/participant2 объекты + плоские participant*_id/fighter*_name поля).
fn match_row_to_json(row: &sqlx::sqlite::SqliteRow) -> serde_json::Value {
    let match_id: i32 = row.get("match_id");
    let bracket_id: i32 = row.get("bracket_id");
    let tournament_id: Option<i32> = row.get("tournament_id");
    let round: i32 = row.get("round_number");
    let match_num: i32 = row.get("match_number");
    let p1_id: Option<i32> = row.get("p1_id");
    let p1_name: Option<String> = row.get("p1_name");
    let p1_club: Option<String> = row.get("p1_club");
    let p2_id: Option<i32> = row.get("p2_id");
    let p2_name: Option<String> = row.get("p2_name");
    let p2_club: Option<String> = row.get("p2_club");
    let score_p1: i32 = row.get("score_p1");
    let score_p2: i32 = row.get("score_p2");
    let warnings_p1: i32 = row.get("warnings_p1");
    let warnings_p2: i32 = row.get("warnings_p2");
    let winner_id: Option<i32> = row.get("winner_id");
    let result_type: Option<String> = row.get("result_type");
    let status: String = row.get("status");
    let version: i32 = row.get("version");

    let participant1 = if p1_id.is_some() || p1_name.is_some() {
        serde_json::json!({ "id": p1_id, "fighter_id": p1_id, "full_name": p1_name, "club_name": p1_club })
    } else {
        serde_json::Value::Null
    };
    let participant2 = if p2_id.is_some() || p2_name.is_some() {
        serde_json::json!({ "id": p2_id, "fighter_id": p2_id, "full_name": p2_name, "club_name": p2_club })
    } else {
        serde_json::Value::Null
    };

    serde_json::json!({
        "id": match_id,
        "bracket_id": bracket_id,
        "tournament_id": tournament_id,
        "round_number": round,
        "match_number": match_num,
        "participant1": participant1,
        "participant2": participant2,
        "participant1_id": p1_id,
        "fighter1_name": p1_name,
        "fighter1_club": p1_club,
        "participant2_id": p2_id,
        "fighter2_name": p2_name,
        "fighter2_club": p2_club,
        "score_participant1": score_p1,
        "score_participant2": score_p2,
        "warnings_participant1": warnings_p1,
        "warnings_participant2": warnings_p2,
        "winner_id": winner_id,
        "result_type": result_type,
        "status": status,
        "version": version,
    })
}

/// Пересчитать статус сетки на основе статусов её матчей.
async fn update_bracket_status(bracket_id: i32, pool: &SqlitePool) -> Result<(), String> {
    let statuses: Vec<(String,)> =
        sqlx::query_as("SELECT status FROM matches_cache WHERE bracket_id = ?")
            .bind(bracket_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    if statuses.is_empty() {
        return Ok(());
    }

    let total = statuses.len();
    let completed = statuses.iter().filter(|(s,)| s == "completed").count();
    let in_progress = statuses.iter().filter(|(s,)| s == "in_progress").count();

    let new_status = if completed == total {
        "completed"
    } else if in_progress > 0 || completed > 0 {
        "in_progress"
    } else {
        "not_started"
    };

    sqlx::query("UPDATE brackets_cache SET status = ?, updated_at = datetime('now') WHERE bracket_id = ?")
        .bind(new_status)
        .bind(bracket_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Вычислить номер следующего матча по единой (0-based) формуле.
/// Матчи 0,1 -> следующий 0; матчи 2,3 -> следующий 1 и т.д.
/// Это единственная используемая формула продвижения — как для finish_match, так и для undo.
fn next_match_number(current_match_number: i32) -> i32 {
    current_match_number / 2
}

// ============================================
// Команды: загрузка турнира из локального файла
// ============================================

#[derive(Serialize, Debug)]
struct LoadedTournamentFile {
    tournament: serde_json::Value,
    brackets: Vec<serde_json::Value>,
    scoring_config: serde_json::Value,
    judge_name: Option<String>,
}

fn default_scoring_config() -> serde_json::Value {
    serde_json::json!({
        "sport_id": 1,
        "actions": [
            {"name": "Тейкдаун", "points": 2, "color": "#3B82F6", "key": "1"},
            {"name": "Проход гарда", "points": 3, "color": "#10B981", "key": "2"},
            {"name": "Маунт", "points": 4, "color": "#F59E0B", "key": "3"},
            {"name": "Взятие спины", "points": 4, "color": "#EF4444", "key": "4"},
        ],
        "warnings": {
            "enabled": true,
            "max_count": 3
        }
    })
}

/// Распарсить сериализованный scoring_config (как хранится в tournament_meta.scoring_config)
/// в JSON-значение, откатываясь на дефолтную конфигурацию если строка отсутствует или
/// повреждена. Общая логика для export_tournament_json (автосохранение) и
/// get_tournament_meta (восстановление сессии после F5/Ctrl+R).
fn parse_scoring_config(text: Option<&str>) -> serde_json::Value {
    text.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .unwrap_or_else(default_scoring_config)
}

/// Прочитать и распарсить локальный JSON-файл турнира (тот же формат, что отдаёт
/// эндпоинт /desktop/tournaments/{id}/download в основном проекте), и сохранить
/// сетки+матчи в локальный SQLite кэш той же (урезанной) схемы.
#[tauri::command]
async fn load_tournament_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<LoadedTournamentFile, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Не удалось прочитать файл: {}", e))?;

    let result = load_tournament_json(&content, &state.db_pool).await?;

    // Запоминаем путь к файлу только после успешного парсинга — чтобы автосохранение
    // не начало перезаписывать файл, если загрузка провалилась на середине.
    {
        let mut guard = state.tournament_file_path.lock().map_err(|_| "Внутренняя ошибка блокировки".to_string())?;
        *guard = Some(PathBuf::from(&path));
    }

    Ok(result)
}

/// Основная логика парсинга JSON турнира и записи в SQLite — вынесена отдельно от
/// Tauri-команды, чтобы её можно было протестировать напрямую (без диалога выбора файла).
async fn load_tournament_json(content: &str, pool: &SqlitePool) -> Result<LoadedTournamentFile, String> {
    let data: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("Файл повреждён или не является корректным JSON турнира: {}", e))?;

    let brackets = data["brackets"]
        .as_array()
        .ok_or_else(|| "Неверный формат файла: отсутствует поле \"brackets\"".to_string())?;

    if brackets.is_empty() {
        return Err("Файл не содержит ни одной сетки".to_string());
    }

    let tournament_id = data
        .get("tournament")
        .and_then(|t| t.get("id"))
        .and_then(|v| v.as_i64())
        .or_else(|| data.get("id").and_then(|v| v.as_i64()))
        .unwrap_or(1) as i32;

    let tournament_name = data
        .get("tournament")
        .and_then(|t| t.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Турнир")
        .to_string();

    // Очищаем предыдущий кэш турнира перед загрузкой нового файла (однопользовательский режим —
    // в любой момент времени в приложении загружен только один турнир).
    sqlx::query("DELETE FROM matches_cache").execute(pool).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM brackets_cache").execute(pool).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM match_events").execute(pool).await.map_err(|e| e.to_string())?;

    for bracket in brackets {
        let bracket_id = bracket["id"]
            .as_i64()
            .ok_or_else(|| "У сетки отсутствует поле \"id\"".to_string())? as i32;

        let category_id = bracket["category_id"].as_i64().map(|v| v as i32);
        let category_name = bracket["category_name"].as_str().unwrap_or("").to_string();
        let weight_min = bracket["min_weight"].as_f64();
        let weight_max = bracket["max_weight"].as_f64();
        let gender = bracket["gender"].as_str().unwrap_or("").to_string();
        let sport_id = bracket["sport_id"].as_i64().map(|v| v as i32);
        let sport_name = bracket["sport_name"].as_str().unwrap_or("").to_string();
        let bracket_type = bracket["bracket_type"].as_str().unwrap_or("single_elimination").to_string();
        let total_rounds = bracket["total_rounds"].as_i64().map(|v| v as i32);
        let status = bracket["status"].as_str().unwrap_or("not_started").to_string();
        let is_published = if bracket["is_published"].as_bool().unwrap_or(false) { 1 } else { 0 };
        let characteristics_schema = if bracket["characteristics_schema"].is_null() {
            None
        } else {
            Some(bracket["characteristics_schema"].to_string())
        };
        let characteristic_filters = if bracket["characteristic_filters"].is_null() {
            None
        } else {
            Some(bracket["characteristic_filters"].to_string())
        };

        sqlx::query(
            "INSERT OR REPLACE INTO brackets_cache
             (bracket_id, tournament_id, category_id, category_name, weight_min, weight_max,
              gender, sport_id, sport_name, bracket_type, total_rounds, status, is_published,
              characteristics_schema, characteristic_filters, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(bracket_id)
        .bind(tournament_id)
        .bind(category_id)
        .bind(&category_name)
        .bind(weight_min)
        .bind(weight_max)
        .bind(&gender)
        .bind(sport_id)
        .bind(&sport_name)
        .bind(&bracket_type)
        .bind(total_rounds)
        .bind(&status)
        .bind(is_published)
        .bind(&characteristics_schema)
        .bind(&characteristic_filters)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        if let Some(matches) = bracket["matches"].as_array() {
            for match_data in matches.iter() {
                let match_id = match_data["id"]
                    .as_i64()
                    .ok_or_else(|| "У матча отсутствует поле \"id\"".to_string())? as i32;

                let (p1_id, p1_fighter_id, p1_name, p1_club) =
                    if let Some(p1) = match_data.get("participant1").filter(|v| v.is_object()) {
                        (
                            p1["id"].as_i64().map(|v| v as i32),
                            p1["fighter_id"].as_i64().map(|v| v as i32),
                            p1["full_name"].as_str().map(String::from),
                            p1["club_name"].as_str().map(String::from),
                        )
                    } else {
                        (
                            match_data["participant1_id"].as_i64().map(|v| v as i32),
                            match_data["fighter1_id"].as_i64().map(|v| v as i32),
                            match_data["fighter1_name"].as_str().map(String::from),
                            match_data["fighter1_club"].as_str().map(String::from),
                        )
                    };

                let (p2_id, p2_fighter_id, p2_name, p2_club) =
                    if let Some(p2) = match_data.get("participant2").filter(|v| v.is_object()) {
                        (
                            p2["id"].as_i64().map(|v| v as i32),
                            p2["fighter_id"].as_i64().map(|v| v as i32),
                            p2["full_name"].as_str().map(String::from),
                            p2["club_name"].as_str().map(String::from),
                        )
                    } else {
                        (
                            match_data["participant2_id"].as_i64().map(|v| v as i32),
                            match_data["fighter2_id"].as_i64().map(|v| v as i32),
                            match_data["fighter2_name"].as_str().map(String::from),
                            match_data["fighter2_club"].as_str().map(String::from),
                        )
                    };

                let round_number = match_data["round_number"].as_i64().unwrap_or(1) as i32;
                let match_number = match_data["match_number"].as_i64().unwrap_or(0) as i32;
                let score_p1 = match_data["score_participant1"].as_i64().unwrap_or(0) as i32;
                let score_p2 = match_data["score_participant2"].as_i64().unwrap_or(0) as i32;
                let winner_id = match_data["winner_id"].as_i64().map(|v| v as i32);
                let result_type = match_data["result_type"].as_str().map(String::from);
                let status = match_data["status"].as_str().unwrap_or("scheduled").to_string();

                sqlx::query(
                    "INSERT OR REPLACE INTO matches_cache
                     (match_id, bracket_id, tournament_id, round_number, match_number,
                      p1_id, p1_fighter_id, p1_name, p1_club,
                      p2_id, p2_fighter_id, p2_name, p2_club,
                      score_p1, score_p2, winner_id, result_type, status, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                )
                .bind(match_id)
                .bind(bracket_id)
                .bind(tournament_id)
                .bind(round_number)
                .bind(match_number)
                .bind(p1_id)
                .bind(p1_fighter_id)
                .bind(&p1_name)
                .bind(&p1_club)
                .bind(p2_id)
                .bind(p2_fighter_id)
                .bind(&p2_name)
                .bind(&p2_club)
                .bind(score_p1)
                .bind(score_p2)
                .bind(winner_id)
                .bind(&result_type)
                .bind(&status)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            }
        }
    }

    let scoring_config = if data.get("scoring_config").map(|v| !v.is_null()).unwrap_or(false) {
        data["scoring_config"].clone()
    } else {
        default_scoring_config()
    };
    let scoring_config_text = scoring_config.to_string();

    sqlx::query(
        "INSERT INTO tournament_meta (id, tournament_id, tournament_name, scoring_config, imported_at)
         VALUES (1, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET tournament_id = excluded.tournament_id,
                                        tournament_name = excluded.tournament_name,
                                        scoring_config = excluded.scoring_config,
                                        imported_at = datetime('now')",
    )
    .bind(tournament_id)
    .bind(&tournament_name)
    .bind(&scoring_config_text)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let tournament_json = serde_json::json!({
        "id": tournament_id,
        "title": tournament_name,
    });

    Ok(LoadedTournamentFile {
        tournament: tournament_json,
        brackets: brackets.clone(),
        scoring_config,
        judge_name: None,
    })
}

#[tauri::command]
async fn has_loaded_tournament(state: State<'_, AppState>) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM brackets_cache")
        .fetch_one(state.db_pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

#[derive(Serialize)]
struct TournamentMeta {
    tournament_id: Option<i32>,
    tournament_name: Option<String>,
    judge_name: Option<String>,
    /// Конфигурация начисления баллов (распарсенная из tournament_meta.scoring_config).
    /// Нужна для восстановления сессии после F5/Ctrl+R (перезагрузка webview без
    /// перезапуска процесса Tauri) — MatchScreen требует scoring_config, а при таком
    /// reload React-состояние обнуляется, но SQLite-кэш остаётся на диске/в памяти.
    /// Если в БД ничего нет — отдаём дефолтную конфигурацию (как и export_tournament_json).
    scoring_config: serde_json::Value,
}

#[tauri::command]
async fn get_tournament_meta(state: State<'_, AppState>) -> Result<Option<TournamentMeta>, String> {
    let row: Option<(Option<i32>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT tournament_id, tournament_name, judge_name, scoring_config FROM tournament_meta WHERE id = 1",
    )
    .fetch_optional(state.db_pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.map(|(tournament_id, tournament_name, judge_name, scoring_config_text)| {
        TournamentMeta {
            tournament_id,
            tournament_name,
            judge_name,
            scoring_config: parse_scoring_config(scoring_config_text.as_deref()),
        }
    }))
}

#[tauri::command]
async fn set_judge_name(judge_name: String, state: State<'_, AppState>) -> Result<(), String> {
    sqlx::query("UPDATE tournament_meta SET judge_name = ? WHERE id = 1")
        .bind(judge_name)
        .execute(state.db_pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================
// Команды: сетки и матчи
// ============================================

#[tauri::command]
async fn get_cached_brackets(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let pool = &state.db_pool;

    let rows = sqlx::query(
        "SELECT bracket_id, tournament_id, category_id, category_name, weight_min, weight_max,
                gender, sport_id, sport_name, bracket_type, total_rounds, status, is_published,
                characteristics_schema, characteristic_filters
         FROM brackets_cache ORDER BY category_name, bracket_id",
    )
    .fetch_all(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    let brackets: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let bracket_id: i32 = row.get("bracket_id");
            let category_id: Option<i32> = row.get("category_id");
            let category_name: Option<String> = row.get("category_name");
            let gender: Option<String> = row.get("gender");
            let sport_id: Option<i32> = row.get("sport_id");
            let sport_name: Option<String> = row.get("sport_name");
            let bracket_type: Option<String> = row.get("bracket_type");
            let total_rounds: Option<i32> = row.get("total_rounds");
            let status: String = row.get("status");
            let is_published: i32 = row.get("is_published");
            let weight_min: Option<f64> = row.get("weight_min");
            let weight_max: Option<f64> = row.get("weight_max");

            serde_json::json!({
                "id": bracket_id,
                "category_id": category_id,
                "category_name": category_name,
                "gender": gender,
                "sport_id": sport_id,
                "sport_name": sport_name,
                "bracket_type": bracket_type,
                "total_rounds": total_rounds,
                "status": status,
                "is_published": is_published != 0,
                "min_weight": weight_min,
                "max_weight": weight_max,
            })
        })
        .collect();

    Ok(brackets)
}

#[tauri::command]
async fn get_bracket_matches(
    bracket_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let pool = &state.db_pool;

    let rows = sqlx::query(
        "SELECT match_id, bracket_id, tournament_id, round_number, match_number,
                p1_id, p1_name, p1_club,
                p2_id, p2_name, p2_club,
                score_p1, score_p2, warnings_p1, warnings_p2,
                winner_id, result_type, status, version
         FROM matches_cache WHERE bracket_id = ?
         ORDER BY round_number, match_number",
    )
    .bind(bracket_id)
    .fetch_all(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(match_row_to_json).collect())
}

// ============================================
// Автосохранение: экспорт живого состояния SQLite обратно в JSON турнира
// ============================================

/// Собрать полный JSON турнира (в формате, который понимает `load_tournament_json`)
/// из ТЕКУЩЕГО состояния SQLite-кэша (brackets_cache + matches_cache) — то есть
/// с учётом всех изменений, сделанных пользователем (счёт, статусы, продвижение
/// победителей, правки участников). Используется для round-trip-безопасного
/// автосохранения на диск после каждой мутирующей команды.
async fn export_tournament_json(
    pool: &SqlitePool,
    tournament_id: i32,
    tournament_name: &str,
) -> Result<serde_json::Value, String> {
    let bracket_rows = sqlx::query(
        "SELECT bracket_id, category_id, category_name, weight_min, weight_max,
                gender, sport_id, sport_name, bracket_type, total_rounds, status, is_published,
                characteristics_schema, characteristic_filters
         FROM brackets_cache ORDER BY category_name, bracket_id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut brackets_json = Vec::with_capacity(bracket_rows.len());

    for row in &bracket_rows {
        let bracket_id: i32 = row.get("bracket_id");
        let category_id: Option<i32> = row.get("category_id");
        let category_name: Option<String> = row.get("category_name");
        let weight_min: Option<f64> = row.get("weight_min");
        let weight_max: Option<f64> = row.get("weight_max");
        let gender: Option<String> = row.get("gender");
        let sport_id: Option<i32> = row.get("sport_id");
        let sport_name: Option<String> = row.get("sport_name");
        let bracket_type: Option<String> = row.get("bracket_type");
        let total_rounds: Option<i32> = row.get("total_rounds");
        let status: String = row.get("status");
        let is_published: i32 = row.get("is_published");
        let characteristics_schema: Option<String> = row.get("characteristics_schema");
        let characteristic_filters: Option<String> = row.get("characteristic_filters");

        let characteristics_schema_value = characteristics_schema
            .as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .unwrap_or(serde_json::Value::Null);
        let characteristic_filters_value = characteristic_filters
            .as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .unwrap_or(serde_json::Value::Null);

        let match_rows = sqlx::query(
            "SELECT match_id, bracket_id, tournament_id, round_number, match_number,
                    p1_id, p1_name, p1_club,
                    p2_id, p2_name, p2_club,
                    score_p1, score_p2, warnings_p1, warnings_p2,
                    winner_id, result_type, status, version
             FROM matches_cache WHERE bracket_id = ?
             ORDER BY round_number, match_number",
        )
        .bind(bracket_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        let matches_json: Vec<serde_json::Value> = match_rows
            .iter()
            .map(|m| {
                let match_id: i32 = m.get("match_id");
                let round_number: i32 = m.get("round_number");
                let match_number: i32 = m.get("match_number");
                let p1_id: Option<i32> = m.get("p1_id");
                let p1_name: Option<String> = m.get("p1_name");
                let p1_club: Option<String> = m.get("p1_club");
                let p2_id: Option<i32> = m.get("p2_id");
                let p2_name: Option<String> = m.get("p2_name");
                let p2_club: Option<String> = m.get("p2_club");
                let score_p1: i32 = m.get("score_p1");
                let score_p2: i32 = m.get("score_p2");
                let winner_id: Option<i32> = m.get("winner_id");
                let result_type: Option<String> = m.get("result_type");
                let status: String = m.get("status");

                let participant1 = if p1_id.is_some() || p1_name.is_some() {
                    serde_json::json!({ "id": p1_id, "fighter_id": p1_id, "full_name": p1_name, "club_name": p1_club })
                } else {
                    serde_json::Value::Null
                };
                let participant2 = if p2_id.is_some() || p2_name.is_some() {
                    serde_json::json!({ "id": p2_id, "fighter_id": p2_id, "full_name": p2_name, "club_name": p2_club })
                } else {
                    serde_json::Value::Null
                };

                serde_json::json!({
                    "id": match_id,
                    "participant1": participant1,
                    "participant2": participant2,
                    "round_number": round_number,
                    "match_number": match_number,
                    "score_participant1": score_p1,
                    "score_participant2": score_p2,
                    "winner_id": winner_id,
                    "result_type": result_type,
                    "status": status,
                })
            })
            .collect();

        brackets_json.push(serde_json::json!({
            "id": bracket_id,
            "category_id": category_id,
            "category_name": category_name,
            "min_weight": weight_min,
            "max_weight": weight_max,
            "gender": gender,
            "sport_id": sport_id,
            "sport_name": sport_name,
            "bracket_type": bracket_type,
            "total_rounds": total_rounds,
            "status": status,
            "is_published": is_published != 0,
            "characteristics_schema": characteristics_schema_value,
            "characteristic_filters": characteristic_filters_value,
            "matches": matches_json,
        }));
    }

    let scoring_config_text: Option<String> =
        sqlx::query_scalar("SELECT scoring_config FROM tournament_meta WHERE id = 1")
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?
            .flatten();

    let scoring_config = parse_scoring_config(scoring_config_text.as_deref());

    Ok(serde_json::json!({
        "tournament": { "id": tournament_id, "name": tournament_name },
        "brackets": brackets_json,
        "scoring_config": scoring_config,
    }))
}

/// Записать текущее состояние турнира обратно в исходный .json файл на диске
/// (если он известен). Не паникует и не возвращает ошибку наружу пользователю —
/// автосохранение не должно ронять основную операцию (например, если файл был
/// удалён вручную); в этом случае ошибка просто логируется в stderr.
async fn autosave_tournament(pool: &SqlitePool, file_path: &Arc<Mutex<Option<PathBuf>>>) {
    let path = {
        let guard = match file_path.lock() {
            Ok(g) => g,
            Err(e) => {
                eprintln!("Автосохранение: не удалось получить блокировку пути к файлу: {}", e);
                return;
            }
        };
        guard.clone()
    };

    let Some(path) = path else {
        // Файл ещё не был открыт в этой сессии — автосохранение не применимо.
        return;
    };

    let meta: Option<(Option<i32>, Option<String>)> =
        match sqlx::query_as("SELECT tournament_id, tournament_name FROM tournament_meta WHERE id = 1")
            .fetch_optional(pool)
            .await
        {
            Ok(m) => m,
            Err(e) => {
                eprintln!("Автосохранение: не удалось прочитать tournament_meta: {}", e);
                return;
            }
        };

    let (tournament_id, tournament_name) = match meta {
        Some((id, name)) => (id.unwrap_or(1), name.unwrap_or_else(|| "Турнир".to_string())),
        None => (1, "Турнир".to_string()),
    };

    let json = match export_tournament_json(pool, tournament_id, &tournament_name).await {
        Ok(j) => j,
        Err(e) => {
            eprintln!("Автосохранение: не удалось собрать JSON турнира: {}", e);
            return;
        }
    };

    let pretty = match serde_json::to_string_pretty(&json) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Автосохранение: не удалось сериализовать JSON турнира: {}", e);
            return;
        }
    };

    if let Err(e) = std::fs::write(&path, pretty) {
        eprintln!("Автосохранение: не удалось записать файл {}: {}", path.display(), e);
    }
}

#[tauri::command]
async fn start_match(match_id: i32, state: State<'_, AppState>) -> Result<(), String> {
    let pool = &state.db_pool;

    let bracket_id: Option<i32> = sqlx::query_scalar("SELECT bracket_id FROM matches_cache WHERE match_id = ?")
        .bind(match_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    let bracket_id = bracket_id.ok_or_else(|| "Матч не найден".to_string())?;

    sqlx::query("UPDATE matches_cache SET status = 'in_progress', updated_at = datetime('now') WHERE match_id = ?")
        .bind(match_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    update_bracket_status(bracket_id, pool).await?;
    autosave_tournament(pool, &state.tournament_file_path).await;

    Ok(())
}

#[tauri::command]
async fn update_match_score(
    match_id: i32,
    red_score: i32,
    blue_score: i32,
    red_warnings: i32,
    blue_warnings: i32,
    status: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = &state.db_pool;

    let bracket_id: Option<i32> = sqlx::query_scalar("SELECT bracket_id FROM matches_cache WHERE match_id = ?")
        .bind(match_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    let bracket_id = bracket_id.ok_or_else(|| "Матч не найден".to_string())?;

    // ВАЖНО: red/blue соответствуют p2/p1 (participant2 = red, participant1 = blue) —
    // такое же соглашение используется во всём основном проекте.
    sqlx::query(
        "UPDATE matches_cache
         SET score_p2 = ?, score_p1 = ?, warnings_p2 = ?, warnings_p1 = ?,
             status = ?, updated_at = datetime('now')
         WHERE match_id = ?",
    )
    .bind(red_score)
    .bind(blue_score)
    .bind(red_warnings)
    .bind(blue_warnings)
    .bind(&status)
    .bind(match_id)
    .execute(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    update_bracket_status(bracket_id, pool).await?;
    autosave_tournament(pool, &state.tournament_file_path).await;

    Ok(())
}

#[tauri::command]
async fn record_match_event(
    match_id: i32,
    event_type: String,
    participant: String,
    points: Option<i32>,
    action_name: Option<String>,
    timestamp: i64,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let result = sqlx::query(
        "INSERT INTO match_events (match_id, event_type, participant, points, action_name, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(match_id)
    .bind(event_type)
    .bind(participant)
    .bind(points)
    .bind(action_name)
    .bind(timestamp)
    .execute(state.db_pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    Ok(result.last_insert_rowid())
}

#[tauri::command]
async fn get_match_events(match_id: i32, state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT id, match_id, event_type, participant, points, action_name, timestamp
         FROM match_events WHERE match_id = ? ORDER BY id ASC",
    )
    .bind(match_id)
    .fetch_all(state.db_pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    let events: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let id: i64 = row.get("id");
            let match_id: i32 = row.get("match_id");
            let event_type: String = row.get("event_type");
            let participant: String = row.get("participant");
            let points: Option<i32> = row.get("points");
            let action_name: Option<String> = row.get("action_name");
            let timestamp: i64 = row.get("timestamp");

            serde_json::json!({
                "id": id,
                "match_id": match_id,
                "event_type": event_type,
                "participant": participant,
                "points": points,
                "action_name": action_name,
                "timestamp": timestamp,
            })
        })
        .collect();

    Ok(events)
}

#[tauri::command]
async fn batch_update_match(
    match_id: i32,
    event_type: String,
    participant: String,
    points: Option<i32>,
    action_name: Option<String>,
    timestamp: i64,
    red_score: i32,
    blue_score: i32,
    red_warnings: i32,
    blue_warnings: i32,
    status: String,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let pool = &state.db_pool;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO match_events (match_id, event_type, participant, points, action_name, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(match_id)
    .bind(&event_type)
    .bind(&participant)
    .bind(points)
    .bind(&action_name)
    .bind(timestamp)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE matches_cache
         SET score_p2 = ?, score_p1 = ?, warnings_p2 = ?, warnings_p1 = ?,
             status = ?, updated_at = datetime('now')
         WHERE match_id = ?",
    )
    .bind(red_score)
    .bind(blue_score)
    .bind(red_warnings)
    .bind(blue_warnings)
    .bind(&status)
    .bind(match_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let rows = sqlx::query(
        "SELECT id, match_id, event_type, participant, points, action_name, timestamp
         FROM match_events WHERE match_id = ? ORDER BY id ASC",
    )
    .bind(match_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    let events: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let id: i64 = row.get("id");
            let event_type: String = row.get("event_type");
            let participant: String = row.get("participant");
            let points: Option<i32> = row.get("points");
            let action_name: Option<String> = row.get("action_name");
            let timestamp: i64 = row.get("timestamp");

            serde_json::json!({
                "id": id,
                "match_id": match_id,
                "event_type": event_type,
                "participant": participant,
                "points": points,
                "action_name": action_name,
                "timestamp": timestamp,
            })
        })
        .collect();

    autosave_tournament(pool, &state.tournament_file_path).await;

    Ok(events)
}

#[tauri::command]
async fn undo_last_event(match_id: i32, state: State<'_, AppState>) -> Result<(), String> {
    let pool = &state.db_pool;

    let last_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM match_events WHERE match_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(match_id)
    .fetch_optional(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    if let Some(id) = last_id {
        sqlx::query("DELETE FROM match_events WHERE id = ?")
            .bind(id)
            .execute(pool.as_ref())
            .await
            .map_err(|e| e.to_string())?;
    }

    autosave_tournament(pool, &state.tournament_file_path).await;

    Ok(())
}

#[tauri::command]
async fn cancel_match(match_id: i32, state: State<'_, AppState>) -> Result<(), String> {
    let pool = &state.db_pool;

    let match_row: Option<(String, Option<i32>, i32, i32, i32)> = sqlx::query_as(
        "SELECT status, winner_id, bracket_id, round_number, match_number FROM matches_cache WHERE match_id = ?",
    )
    .bind(match_id)
    .fetch_optional(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    let (_, winner_id, bracket_id, current_round, current_match_number) =
        match_row.ok_or_else(|| "Матч не найден".to_string())?;

    sqlx::query(
        "UPDATE matches_cache
         SET status = 'scheduled', score_p1 = 0, score_p2 = 0,
             warnings_p1 = 0, warnings_p2 = 0,
             winner_id = NULL, result_type = NULL,
             updated_at = datetime('now')
         WHERE match_id = ?",
    )
    .bind(match_id)
    .execute(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    if winner_id.is_some() {
        remove_winner_from_next_match(pool, bracket_id, current_round, current_match_number, winner_id).await?;
    }

    sqlx::query("DELETE FROM match_events WHERE match_id = ?")
        .bind(match_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    update_bracket_status(bracket_id, pool).await?;
    autosave_tournament(pool, &state.tournament_file_path).await;

    Ok(())
}

/// Найти следующий матч по единой формуле продвижения и удалить из него победителя
/// текущего матча — ищем ПО ID победителя тот слот (p1/p2), в котором он реально стоит,
/// а не угадываем по чётности номера матча. Это единая, согласованная логика undo/cancel.
async fn remove_winner_from_next_match(
    pool: &SqlitePool,
    bracket_id: i32,
    current_round: i32,
    current_match_number: i32,
    winner_id: Option<i32>,
) -> Result<(), String> {
    let next_round = current_round + 1;
    let next_match_num = next_match_number(current_match_number);

    let next_match_id: Option<i32> = sqlx::query_scalar(
        "SELECT match_id FROM matches_cache WHERE bracket_id = ? AND round_number = ? AND match_number = ?",
    )
    .bind(bracket_id)
    .bind(next_round)
    .bind(next_match_num)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some(next_id) = next_match_id else {
        return Ok(());
    };

    let next_slots: Option<(Option<i32>, Option<i32>)> =
        sqlx::query_as("SELECT p1_id, p2_id FROM matches_cache WHERE match_id = ?")
            .bind(next_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    let Some((next_p1_id, next_p2_id)) = next_slots else {
        return Ok(());
    };

    // Ищем, в каком слоте следующего матча реально стоит победитель — по ID.
    let clear_p1 = winner_id.is_some() && next_p1_id == winner_id;
    let clear_p2 = winner_id.is_some() && next_p2_id == winner_id;

    if clear_p1 {
        sqlx::query(
            "UPDATE matches_cache SET p1_id = NULL, p1_name = NULL, p1_club = NULL, updated_at = datetime('now') WHERE match_id = ?",
        )
        .bind(next_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    } else if clear_p2 {
        sqlx::query(
            "UPDATE matches_cache SET p2_id = NULL, p2_name = NULL, p2_club = NULL, updated_at = datetime('now') WHERE match_id = ?",
        )
        .bind(next_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    // Если победитель не найден ни в одном слоте (например, слот уже был перезаписан
    // другим продвижением) — ничего не делаем, чтобы не затронуть чужие данные.

    Ok(())
}

#[tauri::command]
async fn finish_match(
    match_id: i32,
    winner_id: Option<i32>,
    result_type: String,
    final_red_score: i32,
    final_blue_score: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    finish_match_core(&state.db_pool, match_id, winner_id, result_type, final_red_score, final_blue_score).await?;
    autosave_tournament(&state.db_pool, &state.tournament_file_path).await;
    Ok(())
}

async fn finish_match_core(
    pool: &SqlitePool,
    match_id: i32,
    winner_id: Option<i32>,
    result_type: String,
    final_red_score: i32,
    final_blue_score: i32,
) -> Result<(), String> {
    let match_row: Option<(i32, i32, i32, Option<i32>, Option<String>, Option<String>, Option<i32>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT round_number, match_number, bracket_id,
                    p1_id, p1_name, p1_club,
                    p2_id, p2_name, p2_club
             FROM matches_cache WHERE match_id = ?",
        )
        .bind(match_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    let (current_round, current_match_number, bracket_id, p1_id, p1_name, p1_club, p2_id, p2_name, p2_club) =
        match_row.ok_or_else(|| "Матч не найден".to_string())?;

    // Определить winner_id по счёту, если не передан явно.
    // ВАЖНО: red = participant2, blue = participant1 (как и во всём проекте).
    let final_winner_id = if winner_id.is_some() {
        winner_id
    } else if final_red_score > final_blue_score {
        p2_id
    } else if final_blue_score > final_red_score {
        p1_id
    } else {
        None
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let transaction_result: Result<Option<(i32, u8, Option<i32>, Option<String>, Option<String>)>, String> = async {
        sqlx::query(
            "UPDATE matches_cache
             SET status = 'completed',
                 winner_id = ?,
                 result_type = ?,
                 score_p1 = ?,
                 score_p2 = ?,
                 updated_at = datetime('now')
             WHERE match_id = ?",
        )
        .bind(final_winner_id)
        .bind(&result_type)
        .bind(final_blue_score)
        .bind(final_red_score)
        .bind(match_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        let Some(w) = final_winner_id else {
            return Ok(None);
        };

        let (w_id, w_name, w_club) = if p1_id == Some(w) {
            (p1_id, p1_name.clone(), p1_club.clone())
        } else if p2_id == Some(w) {
            (p2_id, p2_name.clone(), p2_club.clone())
        } else {
            // winner_id не совпал ни с одним участником — определяем по счёту как fallback
            if final_blue_score > final_red_score {
                (p1_id, p1_name.clone(), p1_club.clone())
            } else if final_red_score > final_blue_score {
                (p2_id, p2_name.clone(), p2_club.clone())
            } else {
                return Ok(None);
            }
        };

        // ЕДИНАЯ формула продвижения (0-based): next_match_number = current_match_number / 2
        let next_round = current_round + 1;
        let next_match_num = next_match_number(current_match_number);

        let next_match_id: Option<i32> = sqlx::query_scalar(
            "SELECT match_id FROM matches_cache WHERE bracket_id = ? AND round_number = ? AND match_number = ?",
        )
        .bind(bracket_id)
        .bind(next_round)
        .bind(next_match_num)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        let Some(next_match_id) = next_match_id else {
            return Ok(None);
        };

        let next_slots: Option<(Option<i32>, Option<i32>)> =
            sqlx::query_as("SELECT p1_id, p2_id FROM matches_cache WHERE match_id = ?")
                .bind(next_match_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;

        let (next_p1_id, next_p2_id) = next_slots.unwrap_or((None, None));

        // Уже продвинут ранее — избегаем дублирования (идемпотентность finish_match).
        if next_p1_id == w_id || next_p2_id == w_id {
            return Ok(None);
        }

        // Выбираем первый свободный слот.
        let target_slot: Option<u8> = if next_p1_id.is_none() {
            Some(1)
        } else if next_p2_id.is_none() {
            Some(2)
        } else {
            None
        };

        let Some(slot) = target_slot else {
            // Оба слота заняты — не можем продвинуть (некорректные данные сетки).
            return Ok(None);
        };

        if slot == 1 {
            sqlx::query(
                "UPDATE matches_cache SET p1_id = ?, p1_name = ?, p1_club = ?, updated_at = datetime('now') WHERE match_id = ?",
            )
            .bind(w_id)
            .bind(&w_name)
            .bind(&w_club)
            .bind(next_match_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        } else {
            sqlx::query(
                "UPDATE matches_cache SET p2_id = ?, p2_name = ?, p2_club = ?, updated_at = datetime('now') WHERE match_id = ?",
            )
            .bind(w_id)
            .bind(&w_name)
            .bind(&w_club)
            .bind(next_match_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }

        Ok(Some((next_match_id, slot, w_id, w_name, w_club)))
    }
    .await;

    match transaction_result {
        Ok(_) => {
            tx.commit().await.map_err(|e| e.to_string())?;
            update_bracket_status(bracket_id, pool).await?;
            Ok(())
        }
        Err(e) => {
            tx.rollback().await.ok();
            Err(e)
        }
    }
}

#[tauri::command]
async fn undo_finished_match(match_id: i32, state: State<'_, AppState>) -> Result<(), String> {
    undo_finished_match_core(&state.db_pool, match_id).await?;
    autosave_tournament(&state.db_pool, &state.tournament_file_path).await;
    Ok(())
}

async fn undo_finished_match_core(pool: &SqlitePool, match_id: i32) -> Result<(), String> {
    let match_row: Option<(String, Option<i32>, i32, i32, i32)> = sqlx::query_as(
        "SELECT status, winner_id, round_number, match_number, bracket_id FROM matches_cache WHERE match_id = ?",
    )
    .bind(match_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let (status, winner_id, current_round, current_match_number, bracket_id) =
        match_row.ok_or_else(|| "Матч не найден в кэше".to_string())?;

    if status != "completed" {
        return Err("Можно отменять только завершённые матчи".to_string());
    }

    sqlx::query(
        "UPDATE matches_cache
         SET status = 'scheduled', score_p1 = 0, score_p2 = 0,
             warnings_p1 = 0, warnings_p2 = 0,
             winner_id = NULL, result_type = NULL,
             updated_at = datetime('now')
         WHERE match_id = ?",
    )
    .bind(match_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    if winner_id.is_some() {
        // ЕДИНАЯ логика с finish_match/cancel_match: ищем слот победителя по ID,
        // а не угадываем по чётности match_number (как это ошибочно делал старый
        // undo_finished_match в основном проекте).
        remove_winner_from_next_match(pool, bracket_id, current_round, current_match_number, winner_id).await?;
    }

    sqlx::query("DELETE FROM match_events WHERE match_id = ?")
        .bind(match_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    update_bracket_status(bracket_id, pool).await?;

    Ok(())
}

#[tauri::command]
async fn get_next_match_in_bracket(
    bracket_id: i32,
    current_match_id: i32,
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    let pool = &state.db_pool;

    let rows = sqlx::query(
        "SELECT match_id, bracket_id, tournament_id, round_number, match_number,
                p1_id, p1_name, p1_club,
                p2_id, p2_name, p2_club,
                score_p1, score_p2, warnings_p1, warnings_p2,
                winner_id, result_type, status, version
         FROM matches_cache WHERE bracket_id = ?
         ORDER BY round_number, match_number",
    )
    .bind(bracket_id)
    .fetch_all(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    let matches: Vec<serde_json::Value> = rows.iter().map(match_row_to_json).collect();

    let current_match = matches
        .iter()
        .find(|m| m.get("id").and_then(|id| id.as_i64()) == Some(current_match_id as i64));

    let Some(current_match) = current_match else {
        return Ok(None);
    };

    let current_round = current_match.get("round_number").and_then(|r| r.as_i64()).unwrap_or(0) as i32;
    let current_match_number = current_match.get("match_number").and_then(|m| m.as_i64()).unwrap_or(0) as i32;

    let next_match = matches
        .iter()
        .filter(|m| {
            let status = m.get("status").and_then(|s| s.as_str()).unwrap_or("");
            let round = m.get("round_number").and_then(|r| r.as_i64()).unwrap_or(0) as i32;
            let match_number = m.get("match_number").and_then(|m| m.as_i64()).unwrap_or(0) as i32;
            let mid = m.get("id").and_then(|id| id.as_i64()).unwrap_or(0) as i32;

            mid != current_match_id
                && status != "completed"
                && status != "cancelled"
                && (round > current_round || (round == current_round && match_number > current_match_number))
        })
        .min_by_key(|m| {
            let round = m.get("round_number").and_then(|r| r.as_i64()).unwrap_or(0);
            let match_number = m.get("match_number").and_then(|m| m.as_i64()).unwrap_or(0);
            (round, match_number)
        })
        .cloned();

    Ok(next_match)
}

// ============================================
// Команды: редактирование участников сетки (offline, без ролей/истории)
// ============================================
//
// В standalone-версии нет ролей и нет отдельной таблицы истории правок
// (bracket_participant_edits из основного проекта) — единственное ограничение,
// как и в основном проекте, это то, что редактировать можно только матчи со
// статусом 'scheduled' (ещё не начатые). Все операции — простые UPDATE по
// matches_cache, синхронизация с сервером/сетью не нужна (её просто нет).

/// Установить или очистить участника в слоте (p1/p2) матча.
/// action = "set" — записать имя/клуб (fighter_id не из реальной базы,
/// поэтому p*_id/p*_fighter_id используют синтетический отрицательный id,
/// чтобы не путать с настоящими участниками турнира).
/// action = "clear" — сделать слот пустым (TBD).
#[tauri::command]
async fn edit_match_participant(
    match_id: i32,
    slot: i32,
    action: String,
    full_name: Option<String>,
    club_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    edit_match_participant_core(&state.db_pool, match_id, slot, &action, full_name, club_name).await?;
    autosave_tournament(&state.db_pool, &state.tournament_file_path).await;
    Ok(())
}

/// Синтетический id для вручную добавленных (не из исходного файла турнира)
/// участников — отрицательный, чтобы никогда не совпасть с реальным id.
fn synthetic_participant_id(match_id: i32, slot: i32) -> i32 {
    -(match_id * 10 + slot)
}

async fn edit_match_participant_core(
    pool: &SqlitePool,
    match_id: i32,
    slot: i32,
    action: &str,
    full_name: Option<String>,
    club_name: Option<String>,
) -> Result<(), String> {
    if slot != 1 && slot != 2 {
        return Err("Некорректный слот участника (ожидается 1 или 2)".to_string());
    }

    let status: Option<String> = sqlx::query_scalar("SELECT status FROM matches_cache WHERE match_id = ?")
        .bind(match_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    let status = status.ok_or_else(|| "Матч не найден".to_string())?;
    if status != "scheduled" {
        return Err("Редактировать можно только матчи, которые ещё не начались".to_string());
    }

    match action {
        "clear" => {
            let query = if slot == 1 {
                "UPDATE matches_cache SET p1_id = NULL, p1_fighter_id = NULL, p1_name = NULL, p1_club = NULL, updated_at = datetime('now') WHERE match_id = ?"
            } else {
                "UPDATE matches_cache SET p2_id = NULL, p2_fighter_id = NULL, p2_name = NULL, p2_club = NULL, updated_at = datetime('now') WHERE match_id = ?"
            };
            sqlx::query(query).bind(match_id).execute(pool).await.map_err(|e| e.to_string())?;
        }
        "set" => {
            let name = full_name
                .filter(|n| !n.trim().is_empty())
                .ok_or_else(|| "Укажите имя участника".to_string())?;
            let synthetic_id = synthetic_participant_id(match_id, slot);

            let query = if slot == 1 {
                "UPDATE matches_cache SET p1_id = ?, p1_fighter_id = ?, p1_name = ?, p1_club = ?, updated_at = datetime('now') WHERE match_id = ?"
            } else {
                "UPDATE matches_cache SET p2_id = ?, p2_fighter_id = ?, p2_name = ?, p2_club = ?, updated_at = datetime('now') WHERE match_id = ?"
            };
            sqlx::query(query)
                .bind(synthetic_id)
                .bind(synthetic_id)
                .bind(&name)
                .bind(&club_name)
                .bind(match_id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        other => return Err(format!("Неизвестное действие редактирования: {}", other)),
    }

    Ok(())
}

/// Поменять местами участников в двух слотах (может быть один и тот же матч
/// с разными слотами, либо два разных матча). Если целевой слот пуст —
/// фактически происходит перемещение, а не обмен.
#[tauri::command]
async fn swap_match_participants(
    match_id_a: i32,
    slot_a: i32,
    match_id_b: i32,
    slot_b: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    swap_match_participants_core(&state.db_pool, match_id_a, slot_a, match_id_b, slot_b).await?;
    autosave_tournament(&state.db_pool, &state.tournament_file_path).await;
    Ok(())
}

async fn swap_match_participants_core(
    pool: &SqlitePool,
    match_id_a: i32,
    slot_a: i32,
    match_id_b: i32,
    slot_b: i32,
) -> Result<(), String> {
    if (slot_a != 1 && slot_a != 2) || (slot_b != 1 && slot_b != 2) {
        return Err("Некорректный слот участника (ожидается 1 или 2)".to_string());
    }

    for match_id in [match_id_a, match_id_b] {
        let status: Option<String> = sqlx::query_scalar("SELECT status FROM matches_cache WHERE match_id = ?")
            .bind(match_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        let status = status.ok_or_else(|| "Матч не найден".to_string())?;
        if status != "scheduled" {
            return Err("Редактировать можно только матчи, которые ещё не начались".to_string());
        }
    }

    async fn get_slot(
        pool: &SqlitePool,
        match_id: i32,
        slot: i32,
    ) -> Result<(Option<i32>, Option<i32>, Option<String>, Option<String>), sqlx::Error> {
        let query = if slot == 1 {
            "SELECT p1_id, p1_fighter_id, p1_name, p1_club FROM matches_cache WHERE match_id = ?"
        } else {
            "SELECT p2_id, p2_fighter_id, p2_name, p2_club FROM matches_cache WHERE match_id = ?"
        };
        sqlx::query_as(query).bind(match_id).fetch_one(pool).await
    }

    async fn set_slot(
        pool: &SqlitePool,
        match_id: i32,
        slot: i32,
        data: (Option<i32>, Option<i32>, Option<String>, Option<String>),
    ) -> Result<(), sqlx::Error> {
        let query = if slot == 1 {
            "UPDATE matches_cache SET p1_id = ?, p1_fighter_id = ?, p1_name = ?, p1_club = ?, updated_at = datetime('now') WHERE match_id = ?"
        } else {
            "UPDATE matches_cache SET p2_id = ?, p2_fighter_id = ?, p2_name = ?, p2_club = ?, updated_at = datetime('now') WHERE match_id = ?"
        };
        sqlx::query(query)
            .bind(data.0)
            .bind(data.1)
            .bind(data.2)
            .bind(data.3)
            .bind(match_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    let a_data = get_slot(pool, match_id_a, slot_a).await.map_err(|e| e.to_string())?;
    let b_data = get_slot(pool, match_id_b, slot_b).await.map_err(|e| e.to_string())?;

    set_slot(pool, match_id_a, slot_a, b_data).await.map_err(|e| e.to_string())?;
    set_slot(pool, match_id_b, slot_b, a_data).await.map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================
// Утилиты окна / приложения
// ============================================

#[tauri::command]
async fn exit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");

            let db_pool = tauri::async_runtime::block_on(db::init_db(app_data_dir))
                .expect("Failed to initialize database");

            app.manage(AppState {
                db_pool: Arc::new(db_pool),
                tournament_file_path: Arc::new(Mutex::new(None)),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_tournament_file,
            has_loaded_tournament,
            get_tournament_meta,
            set_judge_name,
            get_cached_brackets,
            get_bracket_matches,
            start_match,
            update_match_score,
            record_match_event,
            get_match_events,
            batch_update_match,
            undo_last_event,
            finish_match,
            undo_finished_match,
            cancel_match,
            get_next_match_in_bracket,
            edit_match_participant,
            swap_match_participants,
            exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn memory_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        db::create_tables(&pool).await.unwrap();
        pool
    }

    fn sample_tournament_json() -> String {
        // 4-участника single elimination: раунд 1 — 2 матча (номера 0 и 1),
        // раунд 2 — финал (номер 0). Совпадает с форматом download_tournament.
        serde_json::json!({
            "tournament": { "id": 42, "name": "Тестовый турнир" },
            "brackets": [
                {
                    "id": 100,
                    "category_id": 1,
                    "category_name": "Мужчины до 70 кг",
                    "sport_id": 1,
                    "sport_name": "Грэпплинг",
                    "gender": "male",
                    "bracket_type": "single_elimination",
                    "total_rounds": 2,
                    "status": "not_started",
                    "is_published": true,
                    "matches": [
                        {
                            "id": 1001, "round_number": 1, "match_number": 0, "status": "scheduled",
                            "participant1": { "id": 1, "full_name": "Иванов Иван Иванович", "club_name": "Клуб А" },
                            "participant2": { "id": 2, "full_name": "Петров Пётр Петрович", "club_name": "Клуб Б" },
                            "score_participant1": 0, "score_participant2": 0
                        },
                        {
                            "id": 1002, "round_number": 1, "match_number": 1, "status": "scheduled",
                            "participant1": { "id": 3, "full_name": "Сидоров Сидор Сидорович", "club_name": "Клуб В" },
                            "participant2": { "id": 4, "full_name": "Кузнецов Кузьма Кузьмич", "club_name": "Клуб Г" },
                            "score_participant1": 0, "score_participant2": 0
                        },
                        {
                            "id": 1003, "round_number": 2, "match_number": 0, "status": "scheduled",
                            "score_participant1": 0, "score_participant2": 0
                        }
                    ]
                }
            ]
        })
        .to_string()
    }

    // ===== 1. Парсинг локального JSON-файла турнира =====

    #[tokio::test]
    async fn load_tournament_json_valid_file_populates_cache() {
        let pool = memory_pool().await;
        let json = sample_tournament_json();

        let result = load_tournament_json(&json, &pool).await.unwrap();

        assert_eq!(result.brackets.len(), 1);
        assert_eq!(result.tournament["id"], 42);

        let bracket_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM brackets_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(bracket_count, 1);

        let match_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM matches_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(match_count, 3);

        let (p1_name,): (Option<String>,) =
            sqlx::query_as("SELECT p1_name FROM matches_cache WHERE match_id = 1001")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(p1_name.as_deref(), Some("Иванов Иван Иванович"));
    }

    #[tokio::test]
    async fn load_tournament_json_invalid_json_returns_error_not_panic() {
        let pool = memory_pool().await;
        let result = load_tournament_json("{ this is not valid json ", &pool).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("JSON"));
    }

    #[tokio::test]
    async fn load_tournament_json_missing_brackets_field_returns_error() {
        let pool = memory_pool().await;
        let json = serde_json::json!({ "tournament": { "id": 1, "name": "X" } }).to_string();
        let result = load_tournament_json(&json, &pool).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("brackets"));
    }

    #[tokio::test]
    async fn load_tournament_json_empty_brackets_returns_error() {
        let pool = memory_pool().await;
        let json = serde_json::json!({ "tournament": { "id": 1, "name": "X" }, "brackets": [] }).to_string();
        let result = load_tournament_json(&json, &pool).await;
        assert!(result.is_err());
    }

    // ===== 2. Категории / фильтрация сеток (на уровне get_cached_brackets) =====

    #[tokio::test]
    async fn get_cached_brackets_returns_category_fields_for_grouping() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        let rows = sqlx::query(
            "SELECT bracket_id, category_id, category_name FROM brackets_cache",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(rows.len(), 1);
        let category_name: Option<String> = rows[0].get("category_name");
        assert_eq!(category_name.as_deref(), Some("Мужчины до 70 кг"));
    }

    // ===== 2b. parse_scoring_config / get_tournament_meta (восстановление сессии после F5) =====

    #[test]
    fn parse_scoring_config_returns_default_when_text_is_none() {
        let parsed = parse_scoring_config(None);
        assert_eq!(parsed, default_scoring_config());
    }

    #[test]
    fn parse_scoring_config_returns_default_when_text_is_invalid_json() {
        let parsed = parse_scoring_config(Some("not valid json"));
        assert_eq!(parsed, default_scoring_config());
    }

    #[test]
    fn parse_scoring_config_parses_valid_json() {
        let parsed = parse_scoring_config(Some(r#"{"sport_id": 7, "actions": [], "warnings": {"enabled": false, "max_count": 1}}"#));
        assert_eq!(parsed["sport_id"], 7);
        assert_eq!(parsed["warnings"]["enabled"], false);
    }

    /// Регрессия: после load_tournament_json (загрузка файла) tournament_meta должна
    /// содержать scoring_config, читаемый тем же способом, что использует команда
    /// get_tournament_meta — это то, что позволяет восстановить MatchScreen после
    /// F5/Ctrl+R (перезагрузка webview без перезапуска процесса Tauri), не имея под
    /// рукой исходного JSON-файла турнира.
    #[tokio::test]
    async fn tournament_meta_scoring_config_survives_load_and_is_parseable() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        let scoring_config_text: Option<String> =
            sqlx::query_scalar("SELECT scoring_config FROM tournament_meta WHERE id = 1")
                .fetch_optional(&pool)
                .await
                .unwrap()
                .flatten();

        let scoring_config = parse_scoring_config(scoring_config_text.as_deref());
        assert!(scoring_config.is_object());
        assert!(scoring_config["actions"].is_array());
    }

    // ===== 3. Матчи: старт, счёт, события, undo последнего события =====

    #[tokio::test]
    async fn start_match_sets_in_progress_and_updates_bracket_status() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        let bracket_id: i32 = sqlx::query_scalar("SELECT bracket_id FROM matches_cache WHERE match_id = 1001")
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE matches_cache SET status = 'in_progress', updated_at = datetime('now') WHERE match_id = 1001")
            .execute(&pool)
            .await
            .unwrap();
        update_bracket_status(bracket_id, &pool).await.unwrap();

        let (status,): (String,) = sqlx::query_as("SELECT status FROM matches_cache WHERE match_id = 1001")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "in_progress");

        let (bracket_status,): (String,) = sqlx::query_as("SELECT status FROM brackets_cache WHERE bracket_id = ?")
            .bind(bracket_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(bracket_status, "in_progress");
    }

    #[tokio::test]
    async fn batch_update_and_undo_last_event_roundtrip() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        // Записываем событие +2 очка синему (participant1) через ручной INSERT,
        // повторяя логику batch_update_match.
        sqlx::query(
            "INSERT INTO match_events (match_id, event_type, participant, points, action_name, timestamp)
             VALUES (1001, 'score', 'blue', 2, '+2', 1000)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE matches_cache SET score_p1 = 2 WHERE match_id = 1001")
            .execute(&pool)
            .await
            .unwrap();

        let events_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM match_events WHERE match_id = 1001")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(events_before, 1);

        // undo_last_event: удаляем последнее событие (та же логика, что в команде)
        let last_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM match_events WHERE match_id = 1001 ORDER BY id DESC LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM match_events WHERE id = ?")
            .bind(last_id.unwrap())
            .execute(&pool)
            .await
            .unwrap();

        let events_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM match_events WHERE match_id = 1001")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(events_after, 0);
    }

    // ===== 4. Автопродвижение победителя (finish_match) и undo =====

    #[tokio::test]
    async fn finish_match_advances_winner_to_next_match_slot1() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        // Матч 1001 (round=1, match_number=0): participant1 (id=1, blue) побеждает 5:2 (blue:red)
        finish_match_core(&pool, 1001, Some(1), "points".to_string(), 2, 5).await.unwrap();

        let (status, winner_id): (String, Option<i32>) =
            sqlx::query_as("SELECT status, winner_id FROM matches_cache WHERE match_id = 1001")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "completed");
        assert_eq!(winner_id, Some(1));

        // next_match_number(0) = 0 -> match 1003 (round 2, match_number 0), первый свободный слот p1
        let (next_p1_id, next_p1_name): (Option<i32>, Option<String>) =
            sqlx::query_as("SELECT p1_id, p1_name FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(next_p1_id, Some(1));
        assert_eq!(next_p1_name.as_deref(), Some("Иванов Иван Иванович"));
    }

    #[tokio::test]
    async fn finish_match_second_semifinal_winner_goes_to_slot2() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        // Матч 1001 завершается первым — победитель id=1 занимает p1 в финале.
        finish_match_core(&pool, 1001, Some(1), "points".to_string(), 2, 5).await.unwrap();
        // Матч 1002 (match_number=1): participant2 (id=4, red) побеждает.
        // next_match_number(1) = 0 -> тот же финал 1003, но p1 уже занят -> должен пойти в p2.
        finish_match_core(&pool, 1002, Some(4), "points".to_string(), 7, 3).await.unwrap();

        let (p1_id, p2_id): (Option<i32>, Option<i32>) =
            sqlx::query_as("SELECT p1_id, p2_id FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(p1_id, Some(1));
        assert_eq!(p2_id, Some(4));
    }

    #[tokio::test]
    async fn finish_match_is_idempotent_when_called_twice() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        finish_match_core(&pool, 1001, Some(1), "points".to_string(), 2, 5).await.unwrap();
        // Повторный вызов (например, повторный клик) не должен продвинуть участника ещё раз
        // или затронуть уже занятый слот.
        finish_match_core(&pool, 1001, Some(1), "points".to_string(), 2, 5).await.unwrap();

        let (p1_id, p2_id): (Option<i32>, Option<i32>) =
            sqlx::query_as("SELECT p1_id, p2_id FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(p1_id, Some(1));
        assert_eq!(p2_id, None);
    }

    #[tokio::test]
    async fn undo_finished_match_reverts_score_status_and_advancement() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        finish_match_core(&pool, 1001, Some(1), "points".to_string(), 2, 5).await.unwrap();

        // Убеждаемся, что продвижение произошло
        let (p1_id_before,): (Option<i32>,) =
            sqlx::query_as("SELECT p1_id FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(p1_id_before, Some(1));

        undo_finished_match_core(&pool, 1001).await.unwrap();

        let (status, winner_id, score_p1, score_p2): (String, Option<i32>, i32, i32) = sqlx::query_as(
            "SELECT status, winner_id, score_p1, score_p2 FROM matches_cache WHERE match_id = 1001",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(status, "scheduled");
        assert_eq!(winner_id, None);
        assert_eq!(score_p1, 0);
        assert_eq!(score_p2, 0);

        // Продвижение отменено: слот в финале должен снова стать пустым
        let (p1_id_after,): (Option<i32>,) =
            sqlx::query_as("SELECT p1_id FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(p1_id_after, None);
    }

    #[tokio::test]
    async fn undo_finished_match_uses_winner_id_not_parity_to_find_slot() {
        // Регрессионный тест на расхождение из основного проекта: старый undo_finished_match
        // в lib.rs определял слот для очистки по чётности match_number (нечётные -> p1,
        // чётные -> p2), что не совпадало с тем, куда реально помещает участника finish_match
        // (первый свободный слот). Здесь воспроизводим ситуацию, где чётность дала бы
        // неверный слот, и проверяем, что используется поиск по ID победителя.
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        // match_number=0 (чётный) побеждает первым -> попадает в p1 (как обычно).
        finish_match_core(&pool, 1001, Some(1), "points".to_string(), 2, 5).await.unwrap();
        // match_number=1 (нечётный) побеждает вторым -> т.к. p1 уже занят, реально попадает в p2,
        // хотя по старой (неверной) формуле "нечётный -> чистить p1" ожидалось бы иное.
        finish_match_core(&pool, 1002, Some(4), "points".to_string(), 7, 3).await.unwrap();

        // Отменяем именно матч 1002 (нечётный match_number). Корректная логика должна
        // очистить p2 (где реально стоит участник id=4), а не p1 (где стоит участник id=1
        // от другого матча).
        undo_finished_match_core(&pool, 1002).await.unwrap();

        let (p1_id, p2_id): (Option<i32>, Option<i32>) =
            sqlx::query_as("SELECT p1_id, p2_id FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool)
                .await
                .unwrap();

        // p1 (участник от матча 1001) должен остаться нетронутым
        assert_eq!(p1_id, Some(1), "undo матча 1002 не должен трогать участника из матча 1001");
        // p2 (участник от матча 1002) должен быть очищен
        assert_eq!(p2_id, None, "undo матча 1002 должен очищать именно слот p2, где стоял победитель");
    }

    #[tokio::test]
    async fn undo_finished_match_rejects_non_completed_match() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        let result = undo_finished_match_core(&pool, 1001).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("завершённые"));
    }

    #[tokio::test]
    async fn next_match_number_formula_is_zero_based_floor_division() {
        assert_eq!(next_match_number(0), 0);
        assert_eq!(next_match_number(1), 0);
        assert_eq!(next_match_number(2), 1);
        assert_eq!(next_match_number(3), 1);
        assert_eq!(next_match_number(4), 2);
    }

    // ===== 5. cancel_match также использует единую (по ID) логику очистки слота =====

    #[tokio::test]
    async fn cancel_match_removes_winner_from_next_match_by_id() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        finish_match_core(&pool, 1001, Some(1), "points".to_string(), 2, 5).await.unwrap();
        finish_match_core(&pool, 1002, Some(4), "points".to_string(), 7, 3).await.unwrap();

        // Отменяем (не "отменить результат", а полную отмену матча, как cancel_match) матч 1001
        let match_row: (String, Option<i32>, i32, i32, i32) = sqlx::query_as(
            "SELECT status, winner_id, bracket_id, round_number, match_number FROM matches_cache WHERE match_id = 1001",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let (_, winner_id, bracket_id, current_round, current_match_number) = match_row;

        sqlx::query(
            "UPDATE matches_cache SET status = 'scheduled', score_p1 = 0, score_p2 = 0, winner_id = NULL, result_type = NULL WHERE match_id = 1001",
        )
        .execute(&pool)
        .await
        .unwrap();
        remove_winner_from_next_match(&pool, bracket_id, current_round, current_match_number, winner_id)
            .await
            .unwrap();

        let (p1_id, p2_id): (Option<i32>, Option<i32>) =
            sqlx::query_as("SELECT p1_id, p2_id FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(p1_id, None, "участник матча 1001 должен быть убран из финала");
        assert_eq!(p2_id, Some(4), "участник матча 1002 должен остаться нетронутым");
    }

    // ===== 6. Редактирование участников сетки (offline, без ролей/истории) =====

    #[tokio::test]
    async fn edit_match_participant_set_fills_empty_slot() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        // Матч 1003 (финал) изначально без участников — заполняем слот 1.
        edit_match_participant_core(
            &pool,
            1003,
            1,
            "set",
            Some("Новый Участник".to_string()),
            Some("Клуб Х".to_string()),
        )
        .await
        .unwrap();

        let (p1_name, p1_club): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT p1_name, p1_club FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(p1_name.as_deref(), Some("Новый Участник"));
        assert_eq!(p1_club.as_deref(), Some("Клуб Х"));
    }

    #[tokio::test]
    async fn edit_match_participant_set_replaces_existing_slot() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        edit_match_participant_core(&pool, 1001, 1, "set", Some("Замена".to_string()), None)
            .await
            .unwrap();

        let (p1_id, p1_name): (Option<i32>, Option<String>) =
            sqlx::query_as("SELECT p1_id, p1_name FROM matches_cache WHERE match_id = 1001")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(p1_name.as_deref(), Some("Замена"));
        // Синтетический id должен отличаться от оригинального (1)
        assert_ne!(p1_id, Some(1));
    }

    #[tokio::test]
    async fn edit_match_participant_clear_empties_slot() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        edit_match_participant_core(&pool, 1001, 2, "clear", None, None).await.unwrap();

        let (p2_id, p2_name): (Option<i32>, Option<String>) =
            sqlx::query_as("SELECT p2_id, p2_name FROM matches_cache WHERE match_id = 1001")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(p2_id, None);
        assert_eq!(p2_name, None);
    }

    #[tokio::test]
    async fn edit_match_participant_rejects_non_scheduled_match() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        sqlx::query("UPDATE matches_cache SET status = 'in_progress' WHERE match_id = 1001")
            .execute(&pool)
            .await
            .unwrap();

        let result = edit_match_participant_core(&pool, 1001, 1, "clear", None, None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("не начались"));
    }

    #[tokio::test]
    async fn edit_match_participant_set_requires_non_empty_name() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        let result = edit_match_participant_core(&pool, 1003, 1, "set", Some("   ".to_string()), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn edit_match_participant_rejects_invalid_slot() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        let result = edit_match_participant_core(&pool, 1001, 3, "clear", None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn swap_match_participants_swaps_two_occupied_slots_across_matches() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        // 1001.p1 = Иванов (id 1), 1002.p1 = Сидоров (id 3)
        swap_match_participants_core(&pool, 1001, 1, 1002, 1).await.unwrap();

        let (m1001_p1_id, m1001_p1_name): (Option<i32>, Option<String>) =
            sqlx::query_as("SELECT p1_id, p1_name FROM matches_cache WHERE match_id = 1001")
                .fetch_one(&pool)
                .await
                .unwrap();
        let (m1002_p1_id, m1002_p1_name): (Option<i32>, Option<String>) =
            sqlx::query_as("SELECT p1_id, p1_name FROM matches_cache WHERE match_id = 1002")
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(m1001_p1_id, Some(3));
        assert_eq!(m1001_p1_name.as_deref(), Some("Сидоров Сидор Сидорович"));
        assert_eq!(m1002_p1_id, Some(1));
        assert_eq!(m1002_p1_name.as_deref(), Some("Иванов Иван Иванович"));
    }

    #[tokio::test]
    async fn swap_match_participants_moves_participant_into_empty_slot() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        // 1003.p1 пуст, 1001.p1 занят (Иванов) -> после swap 1001.p1 должен опустеть,
        // а 1003.p1 должен получить Иванова.
        swap_match_participants_core(&pool, 1001, 1, 1003, 1).await.unwrap();

        let (m1001_p1_id,): (Option<i32>,) =
            sqlx::query_as("SELECT p1_id FROM matches_cache WHERE match_id = 1001")
                .fetch_one(&pool)
                .await
                .unwrap();
        let (m1003_p1_id, m1003_p1_name): (Option<i32>, Option<String>) =
            sqlx::query_as("SELECT p1_id, p1_name FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(m1001_p1_id, None);
        assert_eq!(m1003_p1_id, Some(1));
        assert_eq!(m1003_p1_name.as_deref(), Some("Иванов Иван Иванович"));
    }

    #[tokio::test]
    async fn swap_match_participants_rejects_non_scheduled_match() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        sqlx::query("UPDATE matches_cache SET status = 'completed' WHERE match_id = 1001")
            .execute(&pool)
            .await
            .unwrap();

        let result = swap_match_participants_core(&pool, 1001, 1, 1002, 1).await;
        assert!(result.is_err());
    }

    // ===== 7. Автосохранение: export_tournament_json / round-trip =====

    #[tokio::test]
    async fn export_tournament_json_produces_expected_shape() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        let exported = export_tournament_json(&pool, 42, "Тестовый турнир").await.unwrap();

        assert_eq!(exported["tournament"]["id"], 42);
        assert_eq!(exported["tournament"]["name"], "Тестовый турнир");
        assert!(exported["scoring_config"].is_object());

        let brackets = exported["brackets"].as_array().unwrap();
        assert_eq!(brackets.len(), 1);

        let bracket = &brackets[0];
        assert_eq!(bracket["id"], 100);
        assert_eq!(bracket["category_name"], "Мужчины до 70 кг");
        assert_eq!(bracket["sport_name"], "Грэпплинг");
        assert_eq!(bracket["gender"], "male");
        assert_eq!(bracket["bracket_type"], "single_elimination");
        assert_eq!(bracket["is_published"], true);

        let matches = bracket["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 3);

        let match1001 = matches.iter().find(|m| m["id"] == 1001).unwrap();
        assert_eq!(match1001["participant1"]["full_name"], "Иванов Иван Иванович");
        assert_eq!(match1001["participant1"]["club_name"], "Клуб А");
        assert_eq!(match1001["participant2"]["full_name"], "Петров Пётр Петрович");
        assert_eq!(match1001["status"], "scheduled");

        // Финал изначально без участников — оба поля должны быть null, а не "объект с null-полями".
        let match1003 = matches.iter().find(|m| m["id"] == 1003).unwrap();
        assert!(match1003["participant1"].is_null());
        assert!(match1003["participant2"].is_null());
    }

    #[tokio::test]
    async fn export_tournament_json_with_no_brackets_does_not_fail() {
        let pool = memory_pool().await;
        // Ни одна сетка не загружена — brackets_cache пуста.
        let exported = export_tournament_json(&pool, 1, "Пустой турнир").await.unwrap();

        assert_eq!(exported["tournament"]["id"], 1);
        let brackets = exported["brackets"].as_array().unwrap();
        assert!(brackets.is_empty());
        // scoring_config должен быть дефолтным (в tournament_meta ничего нет)
        assert!(exported["scoring_config"].is_object());
    }

    #[tokio::test]
    async fn export_then_reimport_preserves_score_and_status_changes() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        // Меняем состояние турнира через существующие команды:
        // 1) стартуем и обновляем счёт матча 1001 напрямую (как update_match_score)
        sqlx::query(
            "UPDATE matches_cache SET status = 'in_progress', score_p1 = 3, score_p2 = 1, updated_at = datetime('now') WHERE match_id = 1001",
        )
        .execute(&pool)
        .await
        .unwrap();
        update_bracket_status(100, &pool).await.unwrap();

        // 2) завершаем матч 1001 с победителем participant1 (id=1) — с автопродвижением в финал
        // (final_red_score=1 -> score_p2, final_blue_score=5 -> score_p1)
        finish_match_core(&pool, 1001, Some(1), "points".to_string(), 1, 5).await.unwrap();

        // 3) редактируем участника в финале (слот 2, изначально пустой)
        edit_match_participant_core(&pool, 1003, 2, "set", Some("Запасной Игрок".to_string()), Some("Клуб Р".to_string()))
            .await
            .unwrap();

        // Экспортируем текущее состояние в JSON.
        let exported = export_tournament_json(&pool, 42, "Тестовый турнир").await.unwrap();
        let exported_text = serde_json::to_string_pretty(&exported).unwrap();

        // Реимпортируем в свежий пул (как будто открыли файл заново после перезапуска).
        let pool2 = memory_pool().await;
        let reloaded = load_tournament_json(&exported_text, &pool2).await.unwrap();

        assert_eq!(reloaded.tournament["id"], 42);
        assert_eq!(reloaded.brackets.len(), 1);

        // Проверяем, что счёт/статус/победитель/продвижение победителя сохранились.
        let (status, winner_id, score_p1, score_p2): (String, Option<i32>, i32, i32) = sqlx::query_as(
            "SELECT status, winner_id, score_p1, score_p2 FROM matches_cache WHERE match_id = 1001",
        )
        .fetch_one(&pool2)
        .await
        .unwrap();
        assert_eq!(status, "completed");
        assert_eq!(winner_id, Some(1));
        assert_eq!(score_p1, 5);
        assert_eq!(score_p2, 1);

        // Продвижение в финал сохранилось.
        let (final_p1_id, final_p1_name, final_p2_name): (Option<i32>, Option<String>, Option<String>) =
            sqlx::query_as("SELECT p1_id, p1_name, p2_name FROM matches_cache WHERE match_id = 1003")
                .fetch_one(&pool2)
                .await
                .unwrap();
        assert_eq!(final_p1_id, Some(1));
        assert_eq!(final_p1_name.as_deref(), Some("Иванов Иван Иванович"));
        // Ручная правка участника в финале тоже сохранилась.
        assert_eq!(final_p2_name.as_deref(), Some("Запасной Игрок"));

        // Статус сетки тоже актуален (in_progress, т.к. не все матчи завершены).
        let (bracket_status,): (String,) = sqlx::query_as("SELECT status FROM brackets_cache WHERE bracket_id = 100")
            .fetch_one(&pool2)
            .await
            .unwrap();
        assert_eq!(bracket_status, "in_progress");
    }

    #[tokio::test]
    async fn autosave_tournament_writes_file_when_path_is_known() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        let tmp_dir = std::env::temp_dir();
        let file_path = tmp_dir.join(format!("setki_autosave_test_{}.json", std::process::id()));
        let path_state: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(Some(file_path.clone())));

        autosave_tournament(&pool, &path_state).await;

        let written = std::fs::read_to_string(&file_path).expect("файл должен быть записан");
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(parsed["tournament"]["id"], 42);
        assert_eq!(parsed["brackets"].as_array().unwrap().len(), 1);

        std::fs::remove_file(&file_path).ok();
    }

    #[tokio::test]
    async fn autosave_tournament_does_nothing_when_path_is_unknown() {
        let pool = memory_pool().await;
        load_tournament_json(&sample_tournament_json(), &pool).await.unwrap();

        let path_state: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));

        // Не должно паниковать и не должно возвращать ошибку (autosave_tournament -> ()).
        autosave_tournament(&pool, &path_state).await;
    }
}
