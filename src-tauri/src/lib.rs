mod api;
mod db;
mod local_server;
mod logger;

use api::{ApiClient, AuthResponse, TournamentBrief, TournamentSession};
use std::sync::Arc;
use tauri::{Manager, State, AppHandle};
use serde::{Deserialize, Serialize};

use tokio::sync::{RwLock, Mutex};
use std::sync::Mutex as StdMutex;

// State для ApiClient
struct AppState {
    api_client: Arc<ApiClient>,
    db_pool: Arc<sqlx::SqlitePool>,
    local_server_running: Arc<RwLock<bool>>,
    // URL текущего работающего локального сервера
    local_server_url: Arc<Mutex<Option<String>>>,
    // Shutdown channel для graceful остановки локального сервера
    local_server_shutdown_tx: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    // mDNS daemon для Service Discovery (используем std::sync::Mutex так как mdns-sd синхронный)
    mdns_daemon: Arc<StdMutex<Option<mdns_sd::ServiceDaemon>>>,
    mdns_service_fullname: Arc<StdMutex<Option<String>>>,
    // File logger для отладки
    logger: Arc<logger::FileLogger>,
}

// Tauri Commands

#[tauri::command]
async fn has_saved_auth(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.api_client
        .has_saved_auth()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_saved_credentials(
    state: State<'_, AppState>,
) -> Result<Option<(String, String, i32)>, String> {
    state.api_client
        .get_credentials()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_saved_judge_credentials(
    state: State<'_, AppState>,
) -> Result<Option<(String, String, i32, i32)>, String> {
    state.api_client
        .get_saved_judge_credentials()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn clear_saved_credentials(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .clear_credentials()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn login_admin(
    login: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<AuthResponse, String> {
    state.api_client
        .login_admin(login, password)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn login_by_pin(
    pin_code: String,
    judge_name: String,
    table_number: i32,
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<AuthResponse, String> {
    state.logger.info("========== LOGIN_BY_PIN START ==========");
    state.logger.info(&format!("[login_by_pin] pin_code: {}", pin_code));
    state.logger.info(&format!("[login_by_pin] judge_name: {}", judge_name));
    state.logger.info(&format!("[login_by_pin] table_number: {}", table_number));
    state.logger.info(&format!("[login_by_pin] server_url: {:?}", server_url));

    // Если передан server_url (режим local-client), создаём временный ApiClient с этим URL
    let api_client: Arc<ApiClient> = if let Some(url) = server_url.clone() {
        state.logger.info(&format!("[login_by_pin] Creating custom ApiClient with URL: {}", url));
        Arc::new(ApiClient::new(url, Arc::clone(&state.db_pool)))
    } else {
        state.logger.info("[login_by_pin] Using default API client (setki.pro)");
        Arc::clone(&state.api_client)
    };

    state.logger.info("[login_by_pin] Calling api_client.login_by_pin...");
    let mut response = match api_client
        .login_by_pin(
            pin_code.clone(),
            Some(judge_name.clone()),
            Some(table_number)
        )
        .await {
            Ok(resp) => {
                state.logger.info("[login_by_pin] API call SUCCESS");
                state.logger.info(&format!("[login_by_pin] Response: tournament_id={:?}, user_id={}, role={}",
                    resp.tournament_id, resp.user_id, resp.role));
                resp
            },
            Err(e) => {
                state.logger.error(&format!("[login_by_pin] API call FAILED: {}", e));
                return Err(e.to_string());
            }
        };

    state.logger.info("[login_by_pin] Saving judge session...");
    match api_client
        .save_judge_session(&pin_code, &judge_name, table_number, response.tournament_id, &response.access_token)
        .await {
            Ok(_) => state.logger.info("[login_by_pin] Judge session saved successfully"),
            Err(e) => {
                state.logger.error(&format!("[login_by_pin] Failed to save judge session: {}", e));
                return Err(e.to_string());
            }
        }

    // Добавить имя и номер стола в ответ
    response.judge_name = Some(judge_name);
    response.table_number = Some(table_number);

    state.logger.info("[login_by_pin] SUCCESS - returning response");
    state.logger.info("========== LOGIN_BY_PIN END ==========");
    Ok(response)
}

#[tauri::command]
async fn release_table_number(
    tournament_id: i32,
    table_number: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .release_table_number(tournament_id, table_number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn force_release_table(
    tournament_id: i32,
    table_number: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Принудительное освобождение стола (для админа)
    // Удаляет запись из table_numbers и judge_sessions
    let pool = &state.db_pool;

    sqlx::query(
        "DELETE FROM table_numbers WHERE tournament_id = ? AND table_number = ?"
    )
    .bind(tournament_id)
    .bind(table_number)
    .execute(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn clear_all_table_reservations(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    // Очистка всех резерваций столов для турнира
    let pool = &state.db_pool;

    let result = sqlx::query(
        "DELETE FROM table_numbers WHERE tournament_id = ?"
    )
    .bind(tournament_id)
    .execute(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    Ok(result.rows_affected() as i64)
}

#[tauri::command]
async fn download_tournament(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .download_tournament(tournament_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_cached_brackets(
    tournament_id: i32,
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    println!("[get_cached_brackets] tournament_id: {}, server_url: {:?}", tournament_id, server_url);

    // Если передан server_url, используем его для создания временного клиента
    if let Some(url) = server_url {
        println!("[get_cached_brackets] Using custom server URL: {}", url);
        let api_client = ApiClient::new(url, Arc::clone(&state.db_pool));
        api_client
            .get_cached_brackets(tournament_id)
            .await
            .map_err(|e| e.to_string())
    } else {
        println!("[get_cached_brackets] Using default API client");
        state.api_client
            .get_cached_brackets(tournament_id)
            .await
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn is_tournament_downloaded(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.api_client
        .is_tournament_downloaded(tournament_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_changes(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .sync_changes()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_to_local_server(
    server_url: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .sync_to_local_server(&server_url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_tournaments(
    state: State<'_, AppState>,
) -> Result<Vec<TournamentBrief>, String> {
    state.api_client
        .get_tournaments()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_tournament_details(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<TournamentSession, String> {
    state.api_client
        .get_tournament_details(tournament_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_tournament_tables(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    state.api_client
        .get_tournament_tables(tournament_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_local_server(
    state: State<'_, AppState>,
    port: Option<u16>,
    tournament_name: Option<String>,
) -> Result<String, String> {
    let mut is_running = state.local_server_running.write().await;

    // Если сервер уже запущен, вернуть текущий URL
    if *is_running {
        let current_url_guard = state.local_server_url.lock().await;
        if let Some(url) = current_url_guard.as_ref() {
            state.logger.info(&format!("[start_local_server] Server already running at: {}", url));
            return Ok(url.clone());
        }
    }

    // Если порт не указан, ищем свободный в диапазоне 8081-8091
    let port = if let Some(p) = port {
        // Проверяем, что указанный порт свободен
        if std::net::TcpListener::bind(format!("0.0.0.0:{}", p)).is_ok() {
            p
        } else {
            return Err(format!("Port {} is already in use", p));
        }
    } else {
        // Автоматический поиск свободного порта
        find_available_port(8081, 8091)
            .ok_or_else(|| "No available ports in range 8081-8091".to_string())?
    };
    let db_pool = Arc::clone(&state.db_pool);
    let local_ip = get_local_ip().unwrap_or_else(|| {
        state.logger.error("[start_local_server] Failed to detect local IP, using 127.0.0.1");
        "127.0.0.1".to_string()
    });

    state.logger.info(&format!("[start_local_server] Detected local IP: {}", local_ip));
    state.logger.info(&format!("[start_local_server] Starting server on port: {}", port));

    // mDNS Service Discovery: регистрируем сервис
    let mdns_result = register_mdns_service(
        &state,
        &local_ip,
        port,
        tournament_name.as_deref().unwrap_or("Турнир SETKI")
    );

    if let Err(e) = mdns_result {
        eprintln!("Failed to register mDNS service: {}", e);
        // Продолжаем работу без mDNS
    }

    // Создаём shutdown channel
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Сохраняем sender для использования в stop_local_server
    {
        let mut tx_guard = state.local_server_shutdown_tx.lock().await;
        *tx_guard = Some(shutdown_tx);
    }

    // Запустить сервер в фоновом режиме с graceful shutdown
    tokio::spawn(async move {
        if let Err(e) = local_server::start_server(db_pool, port, shutdown_rx).await {
            eprintln!("Local server error: {}", e);
        }
    });

    *is_running = true;

    let server_url = format!("http://{}:{}", local_ip, port);

    // Сохраняем URL сервера
    {
        let mut url_guard = state.local_server_url.lock().await;
        *url_guard = Some(server_url.clone());
    }

    state.logger.info(&format!("[start_local_server] Server started successfully at: {}", server_url));
    Ok(server_url)
}

#[tauri::command]
async fn stop_local_server(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut is_running = state.local_server_running.write().await;

    if !*is_running {
        return Err("Local server is not running".to_string());
    }

    // 1. Отменяем регистрацию mDNS сервиса
    unregister_mdns_service(&state);

    // 2. Graceful shutdown: отправляем сигнал через oneshot channel
    let mut shutdown_tx_guard = state.local_server_shutdown_tx.lock().await;
    if let Some(shutdown_tx) = shutdown_tx_guard.take() {
        if let Err(()) = shutdown_tx.send(()) {
            eprintln!("Failed to send shutdown signal (receiver dropped)");
        }
        println!("Shutdown signal sent to local server");
    }

    *is_running = false;

    // Очищаем URL сервера
    {
        let mut url_guard = state.local_server_url.lock().await;
        *url_guard = None;
    }

    // 3. Даём серверу время на корректное завершение (1 секунда)
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

    state.logger.info("[stop_local_server] Server stopped successfully");
    Ok(())
}

#[tauri::command]
async fn is_local_server_running(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let is_running = state.local_server_running.read().await;
    Ok(*is_running)
}

#[tauri::command]
async fn set_api_base_url(
    url: String,
) -> Result<(), String> {
    std::env::set_var("VITE_API_BASE_URL", url);
    Ok(())
}

#[tauri::command]
async fn check_cached_pin(
    pin_code: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.api_client
        .check_cached_pin(&pin_code)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reserve_bracket(
    bracket_id: i32,
    judge_name: String,
    user_id: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .reserve_bracket(bracket_id, &judge_name, user_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn release_bracket(
    bracket_id: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .release_bracket(bracket_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_bracket_reservation(
    bracket_id: i32,
    state: State<'_, AppState>,
) -> Result<Option<(String, i32)>, String> {
    state.api_client
        .get_bracket_reservation(bracket_id)
        .await
        .map_err(|e| e.to_string())
}

/// Мигрировать матчи из старого формата (плоские поля) в новый (объекты участников)
async fn migrate_matches_to_new_format(
    matches: &mut Vec<serde_json::Value>,
    pool: &sqlx::SqlitePool,
) -> Result<(), String> {
    let mut updated_count = 0;

    for match_obj in matches.iter_mut() {
        let mut needs_update = false;

        // Мигрируем participant1 если это старый формат
        if !match_obj["participant1"].is_object() && match_obj["participant1_id"].is_number() {
            let participant1 = serde_json::json!({
                "id": match_obj["participant1_id"].clone(),
                "fighter_id": match_obj["participant1_id"].clone(),
                "full_name": match_obj["fighter1_name"].clone(),
                "club_name": match_obj["fighter1_club"].clone(),
                "final_weight": serde_json::Value::Null
            });
            match_obj["participant1"] = participant1;
            needs_update = true;
        }

        // Мигрируем participant2 если это старый формат
        if !match_obj["participant2"].is_object() && match_obj["participant2_id"].is_number() {
            let participant2 = serde_json::json!({
                "id": match_obj["participant2_id"].clone(),
                "fighter_id": match_obj["participant2_id"].clone(),
                "full_name": match_obj["fighter2_name"].clone(),
                "club_name": match_obj["fighter2_club"].clone(),
                "final_weight": serde_json::Value::Null
            });
            match_obj["participant2"] = participant2;
            needs_update = true;
        }

        // Сохраняем в БД если были изменения
        if needs_update {
            let match_id = match_obj["id"].as_i64().unwrap_or(0) as i32;
            sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
                .bind(serde_json::to_string(&match_obj).unwrap())
                .bind(match_id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            updated_count += 1;
        }
    }

    if updated_count > 0 {
        println!("[migrate_matches_to_new_format] Мигрировано {} матчей в новый формат", updated_count);
    }

    Ok(())
}

#[tauri::command]
async fn get_bracket_matches(
    bracket_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let pool = &state.db_pool;

    // Сначала пытаемся загрузить из кэша
    let cached_matches = sqlx::query(
        "SELECT match_id, data FROM matches_cache WHERE bracket_id = ? ORDER BY match_id"
    )
    .bind(bracket_id)
    .fetch_all(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    if !cached_matches.is_empty() {
        // Есть кэш - возвращаем его с миграцией в новый формат
        let mut matches: Vec<serde_json::Value> = cached_matches
            .iter()
            .filter_map(|row| {
                let data_str: String = sqlx::Row::get(row, "data");
                serde_json::from_str(&data_str).ok()
            })
            .collect();

        // Мигрируем все матчи из старого формата в новый (объекты участников)
        migrate_matches_to_new_format(&mut matches, pool).await?;

        Ok(matches)
    } else {
        println!("[get_bracket_matches] Кэш пуст, загружаем с сервера");
        // Нет кэша - загружаем с сервера
        state.api_client
            .get_bracket_matches(bracket_id)
            .await
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn clear_all_reservations(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .clear_all_reservations()
        .await
        .map_err(|e| e.to_string())
}

// ====== Команды для работы с поединками ======

#[derive(Serialize, Deserialize)]
struct ActiveJudgeSession {
    judge_name: String,
    table_number: i32,
    tournament_id: Option<i32>,
    bracket_id: Option<i32>,
    bracket_name: Option<String>,
    logged_in_at: String,
}

#[derive(Serialize, Deserialize)]
struct ActiveMatch {
    match_id: i32,
    bracket_id: i32,
    bracket_name: Option<String>,
    fighter1_name: Option<String>,
    fighter2_name: Option<String>,
    score_participant1: i32,
    score_participant2: i32,
    warnings_participant1: i32,
    warnings_participant2: i32,
    status: String,
    judge_name: Option<String>,
    table_number: Option<i32>,
}

#[tauri::command]
async fn get_active_judge_sessions(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<ActiveJudgeSession>, String> {
    // Получить всех судей, которые вошли в систему (из judge_sessions)
    // и объединить с bracket_reservations, чтобы узнать какую сетку они занимают
    let sessions = sqlx::query_as::<_, (String, i32, Option<i32>, Option<i32>, Option<String>, String)>(
        "SELECT
            js.judge_name,
            js.table_number,
            js.tournament_id,
            br.bracket_id,
            bc.data,
            js.logged_in_at
        FROM judge_sessions js
        LEFT JOIN bracket_reservations br ON js.judge_name = br.judge_name
        LEFT JOIN brackets_cache bc ON br.bracket_id = bc.bracket_id
        WHERE js.tournament_id = ?
        ORDER BY js.logged_in_at DESC"
    )
    .bind(tournament_id)
    .fetch_all(&*state.db_pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for (judge_name, table_number, tournament_id, bracket_id, bracket_data, logged_in_at) in sessions {
        // Извлечь имя сетки из JSON
        let bracket_name = bracket_data.and_then(|data| {
            serde_json::from_str::<serde_json::Value>(&data).ok()
                .and_then(|v| v.get("category_name").and_then(|n| n.as_str().map(String::from)))
        });

        result.push(ActiveJudgeSession {
            judge_name,
            table_number,
            tournament_id,
            bracket_id,
            bracket_name,
            logged_in_at,
        });
    }

    Ok(result)
}

#[tauri::command]
async fn get_active_matches(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<ActiveMatch>, String> {
    // Получить все матчи со статусом 'in_progress' из matches_cache
    // и объединить с brackets_cache и bracket_reservations для получения имен
    let matches = sqlx::query_as::<_, (String, String)>(
        "SELECT
            mc.data,
            bc.data
        FROM matches_cache mc
        INNER JOIN brackets_cache bc ON mc.bracket_id = bc.bracket_id
        WHERE bc.tournament_id = ?
        ORDER BY mc.updated_at DESC"
    )
    .bind(tournament_id)
    .fetch_all(&*state.db_pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for (match_data, bracket_data) in matches {
        if let (Ok(match_json), Ok(bracket_json)) = (
            serde_json::from_str::<serde_json::Value>(&match_data),
            serde_json::from_str::<serde_json::Value>(&bracket_data),
        ) {
            let status = match_json.get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("scheduled");

            // Фильтруем только in_progress
            if status != "in_progress" {
                continue;
            }

            let match_id = match_json.get("id").and_then(|i| i.as_i64()).unwrap_or(0) as i32;
            let bracket_id = match_json.get("bracket_id").and_then(|i| i.as_i64()).unwrap_or(0) as i32;

            let bracket_name = bracket_json.get("category_name")
                .and_then(|n| n.as_str())
                .map(String::from);

            let fighter1_name = match_json.get("fighter1_name")
                .and_then(|n| n.as_str())
                .map(String::from);
            let fighter2_name = match_json.get("fighter2_name")
                .and_then(|n| n.as_str())
                .map(String::from);

            let score_participant1 = match_json.get("score_participant1")
                .and_then(|s| s.as_i64())
                .unwrap_or(0) as i32;
            let score_participant2 = match_json.get("score_participant2")
                .and_then(|s| s.as_i64())
                .unwrap_or(0) as i32;

            let warnings_participant1 = match_json.get("warnings_participant1")
                .and_then(|w| w.as_i64())
                .unwrap_or(0) as i32;
            let warnings_participant2 = match_json.get("warnings_participant2")
                .and_then(|w| w.as_i64())
                .unwrap_or(0) as i32;

            // Получить имя судьи и номер стола через JOIN с judge_sessions
            let judge_info = sqlx::query_as::<_, (String, i32)>(
                "SELECT br.judge_name, js.table_number
                 FROM bracket_reservations br
                 INNER JOIN judge_sessions js ON br.judge_name = js.judge_name
                 WHERE br.bracket_id = ?
                 ORDER BY js.logged_in_at DESC
                 LIMIT 1"
            )
            .bind(bracket_id)
            .fetch_optional(&*state.db_pool)
            .await
            .ok()
            .flatten();

            let (judge_name, table_number) = match judge_info {
                Some((name, num)) => (Some(name), Some(num)),
                None => (None, None),
            };

            result.push(ActiveMatch {
                match_id,
                bracket_id,
                bracket_name,
                fighter1_name,
                fighter2_name,
                score_participant1,
                score_participant2,
                warnings_participant1,
                warnings_participant2,
                status: status.to_string(),
                judge_name,
                table_number,
            });
        }
    }

    Ok(result)
}

// Получить информацию о том, какие сетки заняты какими столами (bracket_id → table_number)
#[derive(Serialize)]
struct BracketTableAssignment {
    bracket_id: i32,
    table_number: i32,
    judge_name: String,
}

#[tauri::command]
async fn get_bracket_table_assignments(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<BracketTableAssignment>, String> {
    // Получить все резервирования сеток с JOIN к judge_sessions для получения table_number
    let assignments = sqlx::query_as::<_, (i32, i32, String)>(
        "SELECT
            br.bracket_id,
            js.table_number,
            br.judge_name
         FROM bracket_reservations br
         INNER JOIN judge_sessions js ON br.judge_name = js.judge_name
         WHERE js.tournament_id = ?
         ORDER BY br.reserved_at DESC"
    )
    .bind(tournament_id)
    .fetch_all(&*state.db_pool)
    .await
    .map_err(|e| e.to_string())?;

    let result = assignments
        .into_iter()
        .map(|(bracket_id, table_number, judge_name)| BracketTableAssignment {
            bracket_id,
            table_number,
            judge_name,
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn start_match(
    match_id: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = &state.db_pool;

    // Отправить на сервер
    state.api_client
        .start_match(match_id)
        .await
        .map_err(|e| e.to_string())?;

    // Обновить локальный кэш матча
    println!("[start_match] Обновление локального кэша для match_id={}", match_id);
    let match_data = sqlx::query("SELECT bracket_id, data FROM matches_cache WHERE match_id = ?")
        .bind(match_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    if let Some(row) = match_data {
        let bracket_id: i32 = sqlx::Row::get(&row, "bracket_id");
        let data_str: String = sqlx::Row::get(&row, "data");
        let mut match_obj: serde_json::Value = serde_json::from_str(&data_str)
            .map_err(|e| e.to_string())?;

        println!("[start_match] Найден матч в кэше, bracket_id={}, обновляем статус на 'in_progress'", bracket_id);

        // Обновить статус матча на in_progress
        match_obj["status"] = serde_json::json!("in_progress");

        // Сохранить обновленный матч
        sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
            .bind(serde_json::to_string(&match_obj).unwrap())
            .bind(match_id)
            .execute(pool.as_ref())
            .await
            .map_err(|e| e.to_string())?;

        println!("[start_match] Матч обновлен в кэше, вызываем update_bracket_status");

        // Пересчитать статус сетки
        update_bracket_status(bracket_id, pool).await?;
    } else {
        println!("[start_match] ВНИМАНИЕ: Матч {} не найден в локальном кэше", match_id);
    }

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

    // Отправить на сервер
    state.api_client
        .update_match_score(match_id, red_score, blue_score, red_warnings, blue_warnings, status.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Обновить локальный кэш матча
    let match_data = sqlx::query("SELECT bracket_id, data FROM matches_cache WHERE match_id = ?")
        .bind(match_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    if let Some(row) = match_data {
        let bracket_id: i32 = sqlx::Row::get(&row, "bracket_id");
        let data_str: String = sqlx::Row::get(&row, "data");
        let mut match_obj: serde_json::Value = serde_json::from_str(&data_str)
            .map_err(|e| e.to_string())?;

        // Обновить счет и статус
        match_obj["score_participant1"] = serde_json::json!(red_score);
        match_obj["score_participant2"] = serde_json::json!(blue_score);
        match_obj["warnings_participant1"] = serde_json::json!(red_warnings);
        match_obj["warnings_participant2"] = serde_json::json!(blue_warnings);
        match_obj["status"] = serde_json::json!(status);

        // Сохранить обновленный матч
        sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
            .bind(serde_json::to_string(&match_obj).unwrap())
            .bind(match_id)
            .execute(pool.as_ref())
            .await
            .map_err(|e| e.to_string())?;

        // Пересчитать статус сетки (если статус матча изменился)
        update_bracket_status(bracket_id, pool).await?;
    }

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
    state.api_client
        .record_match_event(match_id, event_type, participant, points, action_name, timestamp)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_match_events(
    match_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    state.api_client
        .get_match_events(match_id)
        .await
        .map_err(|e| e.to_string())
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
    state.api_client
        .batch_update_match(
            match_id,
            event_type,
            participant,
            points,
            action_name,
            timestamp,
            red_score,
            blue_score,
            red_warnings,
            blue_warnings,
            status,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn undo_last_event(
    match_id: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .undo_last_event(match_id)
        .await
        .map_err(|e| e.to_string())
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
    let pool = &state.db_pool;

    // Отправить на сервер
    state.api_client
        .finish_match(match_id, winner_id, result_type.clone(), final_red_score, final_blue_score)
        .await
        .map_err(|e| e.to_string())?;

    // Обновить локальный кэш матча
    println!("[finish_match] Обновление локального кэша для match_id={}", match_id);
    let match_data = sqlx::query("SELECT bracket_id, data FROM matches_cache WHERE match_id = ?")
        .bind(match_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    if let Some(row) = match_data {
        let bracket_id: i32 = sqlx::Row::get(&row, "bracket_id");
        let data_str: String = sqlx::Row::get(&row, "data");
        let mut match_obj: serde_json::Value = serde_json::from_str(&data_str)
            .map_err(|e| e.to_string())?;

        println!("[finish_match] Найден матч в кэше, bracket_id={}", bracket_id);

        // Обновить статус матча
        match_obj["status"] = serde_json::json!("completed");
        match_obj["winner_id"] = serde_json::json!(winner_id);
        match_obj["result_type"] = serde_json::json!(result_type);
        // ВАЖНО: participant1 = BLUE, participant2 = RED
        match_obj["score_participant1"] = serde_json::json!(final_blue_score);
        match_obj["score_participant2"] = serde_json::json!(final_red_score);

        // Сохранить обновленный матч
        sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
            .bind(serde_json::to_string(&match_obj).unwrap())
            .bind(match_id)
            .execute(pool.as_ref())
            .await
            .map_err(|e| e.to_string())?;

        println!("[finish_match] Матч обновлен в кэше, вызываем update_bracket_status");

        // Пересчитать статус сетки
        update_bracket_status(bracket_id, pool).await?;
    } else {
        println!("[finish_match] ВНИМАНИЕ: Матч {} не найден в локальном кэше", match_id);
    }

    Ok(())
}

// Вспомогательная функция для пересчета статуса сетки
async fn update_bracket_status(bracket_id: i32, pool: &sqlx::SqlitePool) -> Result<(), String> {
    // Получить все матчи сетки
    let matches = sqlx::query("SELECT data FROM matches_cache WHERE bracket_id = ?")
        .bind(bracket_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    if matches.is_empty() {
        return Ok(());
    }

    // Подсчитать статусы матчей
    let mut total = 0;
    let mut completed = 0;
    let mut in_progress = 0;

    for row in &matches {
        let data_str: String = sqlx::Row::get(row, "data");
        if let Ok(match_obj) = serde_json::from_str::<serde_json::Value>(&data_str) {
            total += 1;
            if let Some(status) = match_obj.get("status").and_then(|s| s.as_str()) {
                match status {
                    "completed" => completed += 1,
                    "in_progress" => in_progress += 1,
                    _ => {}
                }
            }
        }
    }

    // Определить новый статус сетки
    let new_status = if completed == total {
        "completed"
    } else if in_progress > 0 || completed > 0 {
        "in_progress"
    } else {
        "not_started"
    };

    println!("[update_bracket_status] Bracket {}: {}/{} завершено, новый статус: {}",
        bracket_id, completed, total, new_status);

    // Обновить статус сетки в brackets_cache
    let bracket_data = sqlx::query("SELECT data FROM brackets_cache WHERE bracket_id = ?")
        .bind(bracket_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(row) = bracket_data {
        let data_str: String = sqlx::Row::get(&row, "data");
        let mut bracket_obj: serde_json::Value = serde_json::from_str(&data_str)
            .map_err(|e| e.to_string())?;

        bracket_obj["status"] = serde_json::json!(new_status);

        sqlx::query("UPDATE brackets_cache SET data = ?, updated_at = datetime('now') WHERE bracket_id = ?")
            .bind(serde_json::to_string(&bracket_obj).unwrap())
            .bind(bracket_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        println!("[update_bracket_status] Статус сетки {} обновлен на '{}'", bracket_id, new_status);
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
struct MonitorInfo {
    name: Option<String>,
    position_x: i32,
    position_y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
}

#[tauri::command]
async fn get_available_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app.available_monitors()
        .map_err(|e| format!("Failed to get monitors: {}", e))?;

    let primary_monitor = app.primary_monitor()
        .map_err(|e| format!("Failed to get primary monitor: {}", e))?;

    let primary_name = primary_monitor.as_ref().and_then(|m| m.name());

    let monitor_list: Vec<MonitorInfo> = monitors.iter().map(|monitor| {
        let is_primary = monitor.name() == primary_name;
        MonitorInfo {
            name: monitor.name().cloned(),
            position_x: monitor.position().x,
            position_y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            is_primary,
        }
    }).collect();

    Ok(monitor_list)
}

// ====== mDNS Service Discovery ======

/// Регистрирует локальный сервер в mDNS для автообнаружения
fn register_mdns_service(
    state: &State<'_, AppState>,
    host_ip: &str,
    port: u16,
    tournament_name: &str,
) -> Result<(), String> {
    use mdns_sd::{ServiceDaemon, ServiceInfo};

    // Создаём mDNS daemon
    let mdns = ServiceDaemon::new().map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;

    // Параметры сервиса
    let service_type = "_setki._tcp.local.";
    let instance_name = format!("setki-{}", tournament_name.replace(' ', "-"));
    let host_name = format!("{}.local.", instance_name);

    // Создаём ServiceInfo
    let service_info = ServiceInfo::new(
        service_type,
        &instance_name,
        &host_name,
        host_ip,
        port,
        None // properties (можно добавить версию API и т.д.)
    ).map_err(|e| format!("Failed to create ServiceInfo: {}", e))?;

    let fullname = service_info.get_fullname().to_string();

    // Регистрируем сервис
    mdns.register(service_info)
        .map_err(|e| format!("Failed to register mDNS service: {}", e))?;

    println!("mDNS service registered: {} at {}:{}", fullname, host_ip, port);

    // Сохраняем daemon и fullname в state
    {
        let mut daemon_guard = state.mdns_daemon.lock().unwrap();
        *daemon_guard = Some(mdns);
    }
    {
        let mut fullname_guard = state.mdns_service_fullname.lock().unwrap();
        *fullname_guard = Some(fullname);
    }

    Ok(())
}

/// Отменяет регистрацию mDNS сервиса
fn unregister_mdns_service(state: &State<'_, AppState>) {
    let fullname = {
        let fullname_guard = state.mdns_service_fullname.lock().unwrap();
        fullname_guard.clone()
    };

    if let Some(fullname) = fullname {
        let mut daemon_guard = state.mdns_daemon.lock().unwrap();
        if let Some(mdns) = daemon_guard.as_ref() {
            if let Err(e) = mdns.unregister(&fullname) {
                eprintln!("Failed to unregister mDNS service: {}", e);
            } else {
                println!("mDNS service unregistered: {}", fullname);
            }
        }
        *daemon_guard = None;
    }

    let mut fullname_guard = state.mdns_service_fullname.lock().unwrap();
    *fullname_guard = None;
}

/// Получить статус локального сервера (health check)
#[tauri::command]
async fn get_local_server_health(server_url: String) -> Result<serde_json::Value, String> {
    let health_url = format!("{}/health", server_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let response = client.get(&health_url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned error: {}", response.status()));
    }

    let health: serde_json::Value = response.json()
        .await
        .map_err(|e| format!("Failed to parse health response: {}", e))?;

    Ok(health)
}

/// Ищет доступные SETKI серверы в локальной сети через mDNS
#[tauri::command]
async fn discover_local_servers() -> Result<Vec<serde_json::Value>, String> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};
    use std::time::Duration;

    let mdns = ServiceDaemon::new().map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;

    let service_type = "_setki._tcp.local.";
    let receiver = mdns.browse(service_type)
        .map_err(|e| format!("Failed to browse mDNS services: {}", e))?;

    let mut servers = Vec::new();
    let timeout = Duration::from_secs(3);

    // Собираем события в течение 3 секунд
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if let Ok(event) = receiver.recv_timeout(Duration::from_millis(100)) {
            match event {
                ServiceEvent::ServiceResolved(info) => {
                    let addresses: Vec<String> = info.get_addresses()
                        .iter()
                        .map(|addr| addr.to_string())
                        .collect();

                    servers.push(serde_json::json!({
                        "name": info.get_fullname(),
                        "host": info.get_hostname(),
                        "port": info.get_port(),
                        "addresses": addresses,
                    }));

                    println!("Discovered SETKI server: {} at {}:{}",
                        info.get_fullname(),
                        addresses.join(", "),
                        info.get_port()
                    );
                }
                _ => {}
            }
        }
    }

    // Останавливаем browse и shutdown daemon
    mdns.shutdown().ok();

    Ok(servers)
}

// Получить локальный IP адрес
fn get_local_ip() -> Option<String> {
    use std::net::UdpSocket;

    // Попытка 1: Подключаемся к публичному DNS (работает только с интернетом)
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                let ip = addr.ip().to_string();
                if !ip.starts_with("127.") {
                    println!("[get_local_ip] Found IP via public DNS: {}", ip);
                    return Some(ip);
                }
            }
        }
    }

    println!("[get_local_ip] Public DNS method failed, trying local network gateway...");

    // Попытка 2: Подключаемся к локальному шлюзу (192.168.1.1 - типичный роутер)
    // Работает БЕЗ интернета, только с роутером!
    for gateway in &["192.168.1.1:80", "192.168.0.1:80", "10.0.0.1:80", "172.16.0.1:80"] {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            if socket.connect(gateway).is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    let ip = addr.ip().to_string();
                    if !ip.starts_with("127.") {
                        println!("[get_local_ip] Found IP via gateway {}: {}", gateway, ip);
                        return Some(ip);
                    }
                }
            }
        }
    }

    println!("[get_local_ip] All methods failed, returning None");
    None
}

// Найти свободный порт в диапазоне
fn find_available_port(start_port: u16, end_port: u16) -> Option<u16> {
    use std::net::TcpListener;

    for port in start_port..=end_port {
        // Пытаемся забиндить порт
        if TcpListener::bind(format!("0.0.0.0:{}", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

// ============================================
// РЕДАКТИРОВАНИЕ СЕТОК
// ============================================

#[derive(Serialize, Deserialize, Debug)]
struct ParticipantEditRequest {
    bracket_id: i32,
    match_id: i32,
    participant_slot: String, // "participant1" или "participant2"
    fighter_id: Option<i32>,
    fighter_name: Option<String>,
    club_name: Option<String>,
    weight: Option<f64>,
    operation_type: String, // "add", "update", "remove", "swap"
}

// Создать временного участника (с отрицательным ID)
#[tauri::command]
async fn create_temp_participant(
    bracket_id: i32,
    full_name: String,
    club_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<i32, String> {
    let pool = &state.db_pool;

    // Генерировать уникальный отрицательный ID (timestamp в миллисекундах с минусом)
    let temp_id = -(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i32);

    println!("[create_temp_participant] Creating temp participant with ID: {}, name: {}", temp_id, full_name);

    // Сохранить в таблицу temp_participants
    sqlx::query(
        "INSERT INTO temp_participants (temp_id, full_name, club_name, bracket_id, synced)
         VALUES (?, ?, ?, ?, 0)"
    )
    .bind(temp_id)
    .bind(&full_name)
    .bind(&club_name)
    .bind(bracket_id)
    .execute(&**pool)
    .await
    .map_err(|e| e.to_string())?;

    println!("[create_temp_participant] Temp participant created successfully");

    Ok(temp_id)
}

#[tauri::command]
async fn update_bracket_participant(
    request: ParticipantEditRequest,
    judge_name: Option<String>,
    admin_id: Option<i32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = &state.db_pool;

    // Проверка прав доступа: должен быть либо судья, либо админ
    if judge_name.is_none() && admin_id.is_none() {
        return Err("Требуется авторизация".to_string());
    }

    // Если это судья, проверить что он работает с зарезервированной за ним сеткой
    if let Some(ref judge) = judge_name {
        let reservation = sqlx::query(
            "SELECT judge_name FROM bracket_reservations WHERE bracket_id = ?"
        )
        .bind(request.bracket_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

        if let Some(row) = reservation {
            let reserved_by: String = sqlx::Row::get(&row, "judge_name");
            if &reserved_by != judge {
                return Err(format!("Сетка зарезервирована другим судьёй: {}", reserved_by));
            }
        } else if admin_id.is_none() {
            // Судья может редактировать только зарезервированную сетку
            return Err("Сначала выберите сетку для работы".to_string());
        }
    }

    // Обновить кэш матчей
    println!("[update_bracket_participant] Обновление match_id={}, bracket_id={}, slot={}, operation={}",
        request.match_id, request.bracket_id, request.participant_slot, request.operation_type);

    let match_data = sqlx::query(
        "SELECT data FROM matches_cache WHERE match_id = ?"
    )
    .bind(request.match_id)
    .fetch_optional(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = match_data {
        println!("[update_bracket_participant] Найден матч в кэше");
        let data_str: String = sqlx::Row::get(&row, "data");
        let mut match_obj: serde_json::Value = serde_json::from_str(&data_str)
            .map_err(|e| e.to_string())?;

        // Обновить данные участника
        match request.operation_type.as_str() {
            "add" | "update" => {
                let participant = serde_json::json!({
                    "id": request.fighter_id,
                    "fighter_id": request.fighter_id,
                    "full_name": request.fighter_name,
                    "club_name": request.club_name,
                    "final_weight": request.weight,
                });
                match_obj[&request.participant_slot] = participant;

                // Также обновить fighter1_name/fighter2_name для совместимости с BracketSelection
                if request.participant_slot == "participant1" {
                    match_obj["fighter1_name"] = serde_json::json!(request.fighter_name);
                    match_obj["participant1_id"] = serde_json::json!(request.fighter_id);
                    if let Some(ref club) = request.club_name {
                        match_obj["fighter1_club"] = serde_json::json!(club);
                    }
                } else {
                    match_obj["fighter2_name"] = serde_json::json!(request.fighter_name);
                    match_obj["participant2_id"] = serde_json::json!(request.fighter_id);
                    if let Some(ref club) = request.club_name {
                        match_obj["fighter2_club"] = serde_json::json!(club);
                    }
                }
            },
            "remove" => {
                // Обнулить данные участника
                match_obj[&request.participant_slot] = serde_json::Value::Null;

                // Также обнулить все связанные поля для совместимости с BracketSelection
                if request.participant_slot == "participant1" {
                    match_obj["participant1_id"] = serde_json::Value::Null;
                    match_obj["fighter1_name"] = serde_json::Value::Null;
                    match_obj["fighter1_club"] = serde_json::Value::Null;
                } else {
                    match_obj["participant2_id"] = serde_json::Value::Null;
                    match_obj["fighter2_name"] = serde_json::Value::Null;
                    match_obj["fighter2_club"] = serde_json::Value::Null;
                }
            },
            _ => return Err("Неизвестная операция".to_string()),
        }

        // Сохранить обновленный матч
        let updated_data = serde_json::to_string(&match_obj)
            .map_err(|e| e.to_string())?;

        println!("[update_bracket_participant] Обновленные данные матча: {}", updated_data);

        let result = sqlx::query(
            "UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?"
        )
        .bind(&updated_data)
        .bind(request.match_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

        println!("[update_bracket_participant] Обновлено строк: {}", result.rows_affected());
    } else {
        println!("[update_bracket_participant] ОШИБКА: Матч не найден в кэше");
        return Err("Матч не найден в кэше".to_string());
    }

    // Записать изменение в таблицу редактирований
    sqlx::query(
        "INSERT INTO bracket_participant_edits
        (bracket_id, match_id, participant_slot, fighter_id, fighter_name, club_name, weight, operation_type, edited_by_judge, edited_by_admin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(request.bracket_id)
    .bind(request.match_id)
    .bind(&request.participant_slot)
    .bind(request.fighter_id)
    .bind(&request.fighter_name)
    .bind(&request.club_name)
    .bind(request.weight)
    .bind(&request.operation_type)
    .bind(judge_name)
    .bind(admin_id)
    .execute(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    // Добавить в очередь синхронизации
    let sync_data = serde_json::json!({
        "type": "bracket_edit",
        "bracket_id": request.bracket_id,
        "match_id": request.match_id,
        "participant_slot": request.participant_slot,
        "fighter_id": request.fighter_id,
        "fighter_name": request.fighter_name,
        "club_name": request.club_name,
        "weight": request.weight,
        "operation_type": request.operation_type,
    });

    sqlx::query(
        "INSERT INTO sync_queue (match_id, data, synced) VALUES (?, ?, 0)"
    )
    .bind(request.match_id)
    .bind(serde_json::to_string(&sync_data).unwrap())
    .execute(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
struct SwapParticipantsRequest {
    bracket_id: i32,
    match1_id: i32,
    match1_slot: String,
    match2_id: i32,
    match2_slot: String,
}

#[tauri::command]
async fn swap_bracket_participants(
    request: SwapParticipantsRequest,
    judge_name: Option<String>,
    admin_id: Option<i32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[swap_bracket_participants] START - bracket_id={}, match1_id={}, match1_slot={}, match2_id={}, match2_slot={}",
             request.bracket_id, request.match1_id, request.match1_slot, request.match2_id, request.match2_slot);
    println!("  judge_name={:?}, admin_id={:?}", judge_name, admin_id);

    let pool = &state.db_pool;

    // Проверка прав доступа
    if judge_name.is_none() && admin_id.is_none() {
        return Err("Требуется авторизация".to_string());
    }

    // ВАЖНО: Если swap внутри одного матча, обрабатываем отдельно
    if request.match1_id == request.match2_id {
        println!("[swap_bracket_participants] Swap within same match");
        let match_data = sqlx::query("SELECT data FROM matches_cache WHERE match_id = ?")
            .bind(request.match1_id)
            .fetch_one(pool.as_ref())
            .await
            .map_err(|e| e.to_string())?;

        let data_str: String = sqlx::Row::get(&match_data, "data");
        let mut match_obj: serde_json::Value = serde_json::from_str(&data_str)
            .map_err(|e| e.to_string())?;

        // После миграции все участники - объекты, просто свапаем их
        let slot1_value = match_obj.get(&request.match1_slot).cloned().unwrap_or(serde_json::Value::Null);
        let slot2_value = match_obj.get(&request.match2_slot).cloned().unwrap_or(serde_json::Value::Null);

        // Swap
        match_obj[&request.match1_slot] = slot2_value;
        match_obj[&request.match2_slot] = slot1_value;

        // Обновить legacy поля для совместимости
        if !match_obj["participant1"].is_null() && match_obj["participant1"].is_object() {
            match_obj["fighter1_name"] = match_obj["participant1"]["full_name"].clone();
            match_obj["participant1_id"] = match_obj["participant1"]["fighter_id"].clone();
            match_obj["fighter1_club"] = match_obj["participant1"]["club_name"].clone();
        } else {
            match_obj["fighter1_name"] = serde_json::Value::Null;
            match_obj["participant1_id"] = serde_json::Value::Null;
            match_obj["fighter1_club"] = serde_json::Value::Null;
        }

        if !match_obj["participant2"].is_null() && match_obj["participant2"].is_object() {
            match_obj["fighter2_name"] = match_obj["participant2"]["full_name"].clone();
            match_obj["participant2_id"] = match_obj["participant2"]["fighter_id"].clone();
            match_obj["fighter2_club"] = match_obj["participant2"]["club_name"].clone();
        } else {
            match_obj["fighter2_name"] = serde_json::Value::Null;
            match_obj["participant2_id"] = serde_json::Value::Null;
            match_obj["fighter2_club"] = serde_json::Value::Null;
        }

        // Сохранить
        sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
            .bind(serde_json::to_string(&match_obj).unwrap())
            .bind(request.match1_id)
            .execute(pool.as_ref())
            .await
            .map_err(|e| e.to_string())?;

        // Записать в историю изменений
        sqlx::query(
            "INSERT INTO bracket_participant_edits
            (bracket_id, match_id, participant_slot, operation_type, edited_by_judge, edited_by_admin)
            VALUES (?, ?, ?, 'swap_within_match', ?, ?)"
        )
        .bind(request.bracket_id)
        .bind(request.match1_id)
        .bind(format!("{} <-> {}", request.match1_slot, request.match2_slot))
        .bind(&judge_name)
        .bind(admin_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

        println!("[swap_bracket_participants] SUCCESS - swap within match completed");
        return Ok(());
    }

    // Swap между разными матчами
    let match1_data = sqlx::query("SELECT data FROM matches_cache WHERE match_id = ?")
        .bind(request.match1_id)
        .fetch_one(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    let match2_data = sqlx::query("SELECT data FROM matches_cache WHERE match_id = ?")
        .bind(request.match2_id)
        .fetch_one(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    let data1_str: String = sqlx::Row::get(&match1_data, "data");
    let data2_str: String = sqlx::Row::get(&match2_data, "data");

    let mut match1_obj: serde_json::Value = serde_json::from_str(&data1_str)
        .map_err(|e| e.to_string())?;
    let mut match2_obj: serde_json::Value = serde_json::from_str(&data2_str)
        .map_err(|e| e.to_string())?;

    // После миграции все участники - объекты, просто свапаем их
    let match1_value = match1_obj.get(&request.match1_slot).cloned().unwrap_or(serde_json::Value::Null);
    let match2_value = match2_obj.get(&request.match2_slot).cloned().unwrap_or(serde_json::Value::Null);

    // Swap
    match1_obj[&request.match1_slot] = match2_value;
    match2_obj[&request.match2_slot] = match1_value;

    // Обновить legacy поля для совместимости
    // Для match1
    if request.match1_slot == "participant1" {
        if !match1_obj["participant1"].is_null() && match1_obj["participant1"].is_object() {
            match1_obj["fighter1_name"] = match1_obj["participant1"]["full_name"].clone();
            match1_obj["participant1_id"] = match1_obj["participant1"]["fighter_id"].clone();
            match1_obj["fighter1_club"] = match1_obj["participant1"]["club_name"].clone();
        } else {
            match1_obj["fighter1_name"] = serde_json::Value::Null;
            match1_obj["participant1_id"] = serde_json::Value::Null;
            match1_obj["fighter1_club"] = serde_json::Value::Null;
        }
    } else {
        if !match1_obj["participant2"].is_null() && match1_obj["participant2"].is_object() {
            match1_obj["fighter2_name"] = match1_obj["participant2"]["full_name"].clone();
            match1_obj["participant2_id"] = match1_obj["participant2"]["fighter_id"].clone();
            match1_obj["fighter2_club"] = match1_obj["participant2"]["club_name"].clone();
        } else {
            match1_obj["fighter2_name"] = serde_json::Value::Null;
            match1_obj["participant2_id"] = serde_json::Value::Null;
            match1_obj["fighter2_club"] = serde_json::Value::Null;
        }
    }

    // Для match2
    if request.match2_slot == "participant1" {
        if !match2_obj["participant1"].is_null() && match2_obj["participant1"].is_object() {
            match2_obj["fighter1_name"] = match2_obj["participant1"]["full_name"].clone();
            match2_obj["participant1_id"] = match2_obj["participant1"]["fighter_id"].clone();
            match2_obj["fighter1_club"] = match2_obj["participant1"]["club_name"].clone();
        } else {
            match2_obj["fighter1_name"] = serde_json::Value::Null;
            match2_obj["participant1_id"] = serde_json::Value::Null;
            match2_obj["fighter1_club"] = serde_json::Value::Null;
        }
    } else {
        if !match2_obj["participant2"].is_null() && match2_obj["participant2"].is_object() {
            match2_obj["fighter2_name"] = match2_obj["participant2"]["full_name"].clone();
            match2_obj["participant2_id"] = match2_obj["participant2"]["fighter_id"].clone();
            match2_obj["fighter2_club"] = match2_obj["participant2"]["club_name"].clone();
        } else {
            match2_obj["fighter2_name"] = serde_json::Value::Null;
            match2_obj["participant2_id"] = serde_json::Value::Null;
            match2_obj["fighter2_club"] = serde_json::Value::Null;
        }
    }

    // Сохранить
    println!("[swap_bracket_participants] Saving match1 to database...");
    let match1_json = serde_json::to_string(&match1_obj).unwrap();
    println!("  match1 JSON length: {} bytes", match1_json.len());
    sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
        .bind(match1_json)
        .bind(request.match1_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;
    println!("  match1 saved successfully");

    println!("[swap_bracket_participants] Saving match2 to database...");
    let match2_json = serde_json::to_string(&match2_obj).unwrap();
    println!("  match2 JSON length: {} bytes", match2_json.len());
    sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
        .bind(match2_json)
        .bind(request.match2_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;
    println!("  match2 saved successfully");

    // Записать в историю изменений
    println!("[swap_bracket_participants] Recording edit history...");
    sqlx::query(
        "INSERT INTO bracket_participant_edits
        (bracket_id, match_id, participant_slot, operation_type, edited_by_judge, edited_by_admin)
        VALUES (?, ?, ?, 'swap', ?, ?)"
    )
    .bind(request.bracket_id)
    .bind(request.match1_id)
    .bind(format!("{} <-> match{}/{}", request.match1_slot, request.match2_id, request.match2_slot))
    .bind(&judge_name)
    .bind(admin_id)
    .execute(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    println!("[swap_bracket_participants] SUCCESS - swap completed");
    Ok(())
}

#[tauri::command]
async fn get_bracket_edit_history(
    bracket_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let pool = &state.db_pool;

    let rows = sqlx::query(
        "SELECT * FROM bracket_participant_edits
        WHERE bracket_id = ?
        ORDER BY created_at DESC
        LIMIT 50"
    )
    .bind(bracket_id)
    .fetch_all(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    let history: Vec<serde_json::Value> = rows.iter().map(|row| {
        serde_json::json!({
            "id": sqlx::Row::get::<i32, _>(row, "id"),
            "match_id": sqlx::Row::get::<i32, _>(row, "match_id"),
            "participant_slot": sqlx::Row::get::<String, _>(row, "participant_slot"),
            "fighter_name": sqlx::Row::get::<Option<String>, _>(row, "fighter_name"),
            "operation_type": sqlx::Row::get::<String, _>(row, "operation_type"),
            "edited_by_judge": sqlx::Row::get::<Option<String>, _>(row, "edited_by_judge"),
            "edited_by_admin": sqlx::Row::get::<Option<i32>, _>(row, "edited_by_admin"),
            "created_at": sqlx::Row::get::<String, _>(row, "created_at"),
        })
    }).collect();

    Ok(history)
}

// ============================================
// КЭШИРОВАНИЕ
// ============================================

#[tauri::command]
async fn clear_tournament_cache(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = &state.db_pool;

    // Удалить все сетки и матчи этого турнира из кеша
    // Сначала удаляем матчи
    sqlx::query(
        "DELETE FROM matches_cache
        WHERE bracket_id IN (
            SELECT bracket_id FROM brackets_cache WHERE tournament_id = ?
        )"
    )
    .bind(tournament_id)
    .execute(pool.as_ref())
    .await
    .map_err(|e| format!("Ошибка удаления матчей из кеша: {}", e))?;

    // Затем удаляем сетки
    sqlx::query("DELETE FROM brackets_cache WHERE tournament_id = ?")
        .bind(tournament_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| format!("Ошибка удаления сеток из кеша: {}", e))?;

    // Очищаем очередь синхронизации для удаленных матчей
    // sync_queue содержит match_id, поэтому удаляем записи для несуществующих матчей
    sqlx::query(
        "DELETE FROM sync_queue
        WHERE match_id NOT IN (SELECT match_id FROM matches_cache)"
    )
    .execute(pool.as_ref())
    .await
    .map_err(|e| format!("Ошибка очистки очереди синхронизации: {}", e))?;

    state.logger.info(&format!("Кэш турнира {} успешно очищен", tournament_id));

    Ok(())
}

// ============================================
// СИНХРОНИЗАЦИЯ - ПРОВЕРКА СОСТОЯНИЯ
// ============================================

/// Проверить наличие несинхронизированных данных
/// Возвращает количество записей в sync_queue с synced=0
#[tauri::command]
async fn check_unsynced_count(state: State<'_, AppState>) -> Result<i32, String> {
    let pool = &state.db_pool;

    let result = sqlx::query_as::<_, (i32,)>(
        "SELECT COUNT(*) FROM sync_queue WHERE synced = 0"
    )
    .fetch_one(pool.as_ref())
    .await
    .map_err(|e| format!("Ошибка проверки sync_queue: {}", e))?;

    Ok(result.0)
}

// ============================================
// ЛОГИРОВАНИЕ
// ============================================

#[tauri::command]
fn log_to_file(
    level: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    match level.as_str() {
        "info" => state.logger.info(&message),
        "debug" => state.logger.debug(&message),
        "warn" => state.logger.warn(&message),
        "error" => state.logger.error(&message),
        _ => state.logger.info(&message),
    }
    Ok(())
}

/// Очистка синхронизированных записей из sync_queue
/// Удаляет записи старше 7 дней, которые уже успешно синхронизированы с сервером
#[tauri::command]
async fn cleanup_sync_queue(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let pool = &state.db_pool;

    println!("[cleanup_sync_queue] Starting cleanup of old synced records");

    // Удаляем записи где synced = 1 (синхронизированы) и старше 7 дней
    let result = sqlx::query(
        "DELETE FROM sync_queue
         WHERE synced = 1
           AND synced_at IS NOT NULL
           AND synced_at < datetime('now', '-7 days')"
    )
    .execute(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    let deleted_count = result.rows_affected() as usize;
    println!("[cleanup_sync_queue] Deleted {} old synced records", deleted_count);

    Ok(deleted_count)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Портативный режим: ~/.setki-keeper/data
            // Работает для всех платформ и форматов (AppImage, .exe, etc.)
            let home_dir = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .expect("Failed to get home directory");

            let app_data_dir = std::path::PathBuf::from(home_dir)
                .join(".setki-keeper")
                .join("data");

            // Убедиться что директория существует
            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data directory");

            // Инициализировать файловый логгер
            let log_path = app_data_dir.join("setki.log");
            let file_logger = Arc::new(
                logger::FileLogger::new(log_path)
                    .expect("Failed to initialize logger")
            );

            file_logger.info("=== SETKI.PRO KEEPER STARTED ===");

            // Инициализировать БД
            let pool = tauri::async_runtime::block_on(async {
                db::init_db(app_data_dir).await
                    .expect("Failed to initialize database")
            });

            file_logger.info("Database initialized");

            // Создать API клиент
            let api_url = std::env::var("VITE_API_BASE_URL")
                .unwrap_or_else(|_| "https://setki.pro/api/v1".to_string());

            file_logger.info(&format!("API client creating: {}", api_url));

            let db_pool = Arc::new(pool);
            let api_client = Arc::new(ApiClient::new(api_url, Arc::clone(&db_pool)));

            file_logger.info("API client created");

            // Сохранить в state
            let app_state = AppState {
                api_client,
                db_pool: Arc::clone(&db_pool),
                local_server_running: Arc::new(RwLock::new(false)),
                local_server_url: Arc::new(Mutex::new(None)),
                local_server_shutdown_tx: Arc::new(Mutex::new(None)),
                mdns_daemon: Arc::new(StdMutex::new(None)),
                mdns_service_fullname: Arc::new(StdMutex::new(None)),
                logger: file_logger.clone(),
            };

            app.manage(app_state);

            // ПРИМЕЧАНИЕ: Фоновая очистка sync_queue отключена, чтобы избежать database locked
            // Используйте ручной вызов cleanup_sync_queue() когда нужно
            file_logger.info("Application initialized successfully");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            has_saved_auth,
            get_saved_credentials,
            get_saved_judge_credentials,
            clear_saved_credentials,
            login_admin,
            login_by_pin,
            release_table_number,
            force_release_table,
            clear_all_table_reservations,
            download_tournament,
            get_cached_brackets,
            is_tournament_downloaded,
            sync_changes,
            sync_to_local_server,
            get_tournaments,
            get_tournament_details,
            get_tournament_tables,
            start_local_server,
            stop_local_server,
            is_local_server_running,
            get_local_server_health,
            discover_local_servers,
            set_api_base_url,
            check_cached_pin,
            reserve_bracket,
            release_bracket,
            get_bracket_reservation,
            get_bracket_matches,
            clear_all_reservations,
            get_active_judge_sessions,
            get_active_matches,
            get_bracket_table_assignments,
            start_match,
            update_match_score,
            record_match_event,
            get_match_events,
            batch_update_match,
            undo_last_event,
            finish_match,
            get_available_monitors,
            create_temp_participant,
            update_bracket_participant,
            swap_bracket_participants,
            get_bracket_edit_history,
            clear_tournament_cache,
            cleanup_sync_queue,
            check_unsynced_count,
            log_to_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
