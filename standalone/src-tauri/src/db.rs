use anyhow::Result;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::path::PathBuf;

// Инициализация базы данных (адаптировано из основного проекта desktop_setki/src-tauri/src/db.rs,
// схема урезана: оставлены только таблицы, нужные для полностью офлайн однопользовательского режима)
pub async fn init_db(app_data_dir: PathBuf) -> Result<SqlitePool> {
    let db_path = app_data_dir.join("setki.db");

    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&db_path)
                .create_if_missing(true),
        )
        .await?;

    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;

    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&pool)
        .await?;

    sqlx::query("PRAGMA temp_store = MEMORY")
        .execute(&pool)
        .await?;

    sqlx::query("PRAGMA cache_size = -32000")
        .execute(&pool)
        .await?;

    create_tables(&pool).await?;

    Ok(pool)
}

pub async fn create_tables(pool: &SqlitePool) -> Result<()> {
    // Сетки (плоская схема, как в основном проекте)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS brackets_cache (
            bracket_id INTEGER PRIMARY KEY,
            tournament_id INTEGER NOT NULL,
            category_id INTEGER,
            category_name TEXT,
            weight_min REAL,
            weight_max REAL,
            gender TEXT,
            sport_id INTEGER,
            sport_name TEXT,
            bracket_type TEXT,
            total_rounds INTEGER,
            status TEXT NOT NULL DEFAULT 'not_started',
            is_published INTEGER NOT NULL DEFAULT 0,
            characteristics_schema TEXT,
            characteristic_filters TEXT,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    // Матчи (плоская схема; сразу со всеми колонками, включая те, что в основном проекте
    // появились через ALTER TABLE миграции — здесь схема с нуля)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS matches_cache (
            match_id INTEGER PRIMARY KEY,
            bracket_id INTEGER NOT NULL,
            tournament_id INTEGER,
            round_number INTEGER NOT NULL DEFAULT 1,
            match_number INTEGER NOT NULL DEFAULT 1,
            p1_id INTEGER,
            p1_fighter_id INTEGER,
            p1_name TEXT,
            p1_club TEXT,
            p2_id INTEGER,
            p2_fighter_id INTEGER,
            p2_name TEXT,
            p2_club TEXT,
            score_p1 INTEGER NOT NULL DEFAULT 0,
            score_p2 INTEGER NOT NULL DEFAULT 0,
            warnings_p1 INTEGER NOT NULL DEFAULT 0,
            warnings_p2 INTEGER NOT NULL DEFAULT 0,
            winner_id INTEGER,
            result_type TEXT,
            status TEXT NOT NULL DEFAULT 'scheduled',
            duration INTEGER,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        )",
    )
    .execute(pool)
    .await?;

    // История событий поединка (для undo)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS match_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            participant TEXT NOT NULL,
            points INTEGER,
            action_name TEXT,
            timestamp INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    // Метаданные загруженного турнира (для отображения имени/названия турнира в UI).
    // scoring_config хранит JSON конфигурации начисления баллов из исходного файла,
    // чтобы её можно было положить обратно при автосохранении (export_tournament_json)
    // без необходимости держать её только в памяти процесса.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS tournament_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            tournament_id INTEGER,
            tournament_name TEXT,
            judge_name TEXT,
            imported_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    // Миграция для баз, созданных до появления scoring_config (версии standalone <= 0.2.0):
    // CREATE TABLE IF NOT EXISTS не добавляет колонку в уже существующую таблицу на диске
    // пользователя, поэтому колонку нужно добавлять явно. Ошибка "duplicate column" (уже
    // есть в свежесозданных базах) ожидаема и игнорируется.
    let _ = sqlx::query("ALTER TABLE tournament_meta ADD COLUMN scoring_config TEXT")
        .execute(pool)
        .await;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_brackets_tournament ON brackets_cache(tournament_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_matches_bracket ON matches_cache(bracket_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events(match_id)")
        .execute(pool)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn memory_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        create_tables(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn creates_expected_tables() {
        let pool = memory_pool().await;
        let tables: Vec<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let names: Vec<String> = tables.into_iter().map(|(n,)| n).collect();

        assert!(names.contains(&"brackets_cache".to_string()));
        assert!(names.contains(&"matches_cache".to_string()));
        assert!(names.contains(&"match_events".to_string()));
        assert!(names.contains(&"tournament_meta".to_string()));

        // Гарантируем, что сетевые/резервационные таблицы НЕ создаются
        assert!(!names.contains(&"sync_queue".to_string()));
        assert!(!names.contains(&"table_numbers".to_string()));
        assert!(!names.contains(&"bracket_reservations".to_string()));
        assert!(!names.contains(&"judge_sessions".to_string()));
        assert!(!names.contains(&"auth".to_string()));
    }

    /// Регрессия: у пользователей, запустивших версию standalone <= 0.2.0, на диске уже
    /// лежит база с таблицей tournament_meta БЕЗ колонки scoring_config (CREATE TABLE
    /// IF NOT EXISTS её не добавляет). create_tables должна доводить такую старую базу
    /// до актуальной схемы через ALTER TABLE, а не падать при следующем запуске.
    #[tokio::test]
    async fn create_tables_migrates_pre_existing_tournament_meta_without_scoring_config() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        // Симулируем старую базу: tournament_meta уже существует, но без scoring_config.
        sqlx::query(
            "CREATE TABLE tournament_meta (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                tournament_id INTEGER,
                tournament_name TEXT,
                judge_name TEXT,
                imported_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        create_tables(&pool).await.unwrap();

        // Раньше это падало с "table tournament_meta has no column named scoring_config".
        sqlx::query("INSERT INTO tournament_meta (id, tournament_id, tournament_name, scoring_config) VALUES (1, 1, 'X', '{}')")
            .execute(&pool)
            .await
            .unwrap();
    }
}
