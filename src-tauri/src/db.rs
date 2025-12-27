use anyhow::Result;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::path::PathBuf;

// Инициализация базы данных
pub async fn init_db(app_data_dir: PathBuf) -> Result<SqlitePool> {
    let db_path = app_data_dir.join("setki.db");

    // Создать pool с автоматическим созданием файла
    // Увеличен pool с 5 до 30 для поддержки 20+ судей + polling + sync + резерв
    let pool = SqlitePoolOptions::new()
        .max_connections(30)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&db_path)
                .create_if_missing(true)
        )
        .await?;

    // Включить WAL mode для лучшей производительности при параллельных операциях
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;

    // Оптимизация производительности (меньше fsync, но безопасно для LAN режима)
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&pool)
        .await?;

    // Дополнительные оптимизации для работы на слабых компьютерах
    // temp_store = MEMORY: временные таблицы (сортировки, GROUP BY) в RAM вместо диска
    sqlx::query("PRAGMA temp_store = MEMORY")
        .execute(&pool)
        .await?;

    // cache_size = -32000: увеличить кэш до 32MB (по умолчанию ~2MB)
    // Ускоряет чтение при множественных подключениях (15-20 судей)
    sqlx::query("PRAGMA cache_size = -32000")
        .execute(&pool)
        .await?;

    // Создать таблицы
    create_tables(&pool).await?;

    Ok(pool)
}

// Создание таблиц
async fn create_tables(pool: &SqlitePool) -> Result<()> {
    // Таблица для хранения токена
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS auth (
            id INTEGER PRIMARY KEY,
            token TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    // Таблица для кэша сеток
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS brackets_cache (
            bracket_id INTEGER PRIMARY KEY,
            tournament_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    // Таблица для кэша поединков
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS matches_cache (
            match_id INTEGER PRIMARY KEY,
            bracket_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        )"
    )
    .execute(pool)
    .await?;

    // Добавить колонку version если её нет (для существующих БД)
    // PRAGMA table_info возвращает пустой результат если колонки нет
    let column_exists: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM pragma_table_info('matches_cache') WHERE name = 'version'"
    )
    .fetch_optional(pool)
    .await?;

    if let Some((count,)) = column_exists {
        if count == 0 {
            println!("[DB] Adding version column to matches_cache for optimistic locking");
            sqlx::query("ALTER TABLE matches_cache ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
                .execute(pool)
                .await?;
        }
    }

    // Очередь синхронизации
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            synced INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT
        )"
    )
    .execute(pool)
    .await?;

    // Индексы
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_brackets_tournament ON brackets_cache(tournament_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_matches_bracket ON matches_cache(bracket_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON sync_queue(synced)")
        .execute(pool)
        .await?;

    // Кэш PIN-кодов для offline авторизации судей
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS cached_pins (
            pin_code TEXT PRIMARY KEY,
            tournament_id INTEGER NOT NULL,
            tournament_name TEXT,
            cached_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cached_pins_tournament ON cached_pins(tournament_id)")
        .execute(pool)
        .await?;

    // Таблица для сессий судей (хранит имена)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS judge_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pin_code TEXT NOT NULL,
            judge_name TEXT NOT NULL,
            table_number INTEGER NOT NULL,
            tournament_id INTEGER,
            logged_in_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_judge_sessions_pin ON judge_sessions(pin_code)")
        .execute(pool)
        .await?;

    // Таблица для резервирования сеток (блокировка для других судей)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS bracket_reservations (
            bracket_id INTEGER PRIMARY KEY,
            tournament_id INTEGER NOT NULL,
            judge_name TEXT NOT NULL,
            table_number INTEGER NOT NULL,
            user_id INTEGER,
            reserved_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    // Миграция: добавить tournament_id и table_number если их нет
    let tournament_id_exists: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM pragma_table_info('bracket_reservations') WHERE name = 'tournament_id'"
    )
    .fetch_optional(pool)
    .await?;

    if let Some((count,)) = tournament_id_exists {
        if count == 0 {
            println!("[DB] Adding tournament_id and table_number columns to bracket_reservations");

            // Добавить tournament_id
            sqlx::query("ALTER TABLE bracket_reservations ADD COLUMN tournament_id INTEGER")
                .execute(pool)
                .await?;

            // Добавить table_number
            sqlx::query("ALTER TABLE bracket_reservations ADD COLUMN table_number INTEGER")
                .execute(pool)
                .await?;

            // Попытка заполнить tournament_id и table_number из judge_sessions
            sqlx::query(
                "UPDATE bracket_reservations
                 SET tournament_id = (
                     SELECT tournament_id FROM judge_sessions
                     WHERE judge_sessions.judge_name = bracket_reservations.judge_name
                     LIMIT 1
                 ),
                 table_number = (
                     SELECT table_number FROM judge_sessions
                     WHERE judge_sessions.judge_name = bracket_reservations.judge_name
                     LIMIT 1
                 )
                 WHERE tournament_id IS NULL"
            )
            .execute(pool)
            .await?;

            // Удалить резервации без tournament_id (не смогли заполнить)
            sqlx::query("DELETE FROM bracket_reservations WHERE tournament_id IS NULL OR table_number IS NULL")
                .execute(pool)
                .await?;
        }
    }

    // Добавить индекс по tournament_id для быстрого поиска
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_bracket_reservations_tournament ON bracket_reservations(tournament_id)")
        .execute(pool)
        .await?;

    // Таблица для истории событий поединка (для undo и аудита)
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
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events(match_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_match_events_timestamp ON match_events(timestamp)")
        .execute(pool)
        .await?;

    // Таблица для отслеживания занятых номеров столов
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS table_numbers (
            tournament_id INTEGER NOT NULL,
            table_number INTEGER NOT NULL,
            judge_name TEXT NOT NULL,
            judge_session_id INTEGER NOT NULL,
            occupied_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (tournament_id, table_number)
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_table_numbers_session ON table_numbers(judge_session_id)")
        .execute(pool)
        .await?;

    // Таблица для хранения credentials админа (для автоматического входа)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS admin_credentials (
            id INTEGER PRIMARY KEY,
            login TEXT NOT NULL,
            password TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    // Таблица для хранения токенов судей (отдельная запись для каждого судьи)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS judge_auth (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pin_code TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            judge_name TEXT NOT NULL,
            table_number INTEGER NOT NULL,
            tournament_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_judge_auth_tournament ON judge_auth(tournament_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_judge_auth_pin ON judge_auth(pin_code)")
        .execute(pool)
        .await?;

    // Таблица для кэширования списка турниров (для offline доступа)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS tournaments_cache (
            tournament_id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            cached_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    // Таблица для временных участников (добавленных вручную, без ID с сервера)
    // Используются отрицательные ID для отличия от реальных участников
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS temp_participants (
            temp_id INTEGER PRIMARY KEY,
            full_name TEXT NOT NULL,
            club_name TEXT,
            fighter_id INTEGER,
            final_weight REAL,
            bracket_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced INTEGER DEFAULT 0,
            server_id INTEGER,
            synced_at TEXT
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_temp_participants_bracket ON temp_participants(bracket_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_temp_participants_synced ON temp_participants(synced)")
        .execute(pool)
        .await?;

    // Таблица для хранения локальных изменений участников в сетках
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS bracket_participant_edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bracket_id INTEGER NOT NULL,
            match_id INTEGER NOT NULL,
            participant_slot TEXT NOT NULL,
            fighter_id INTEGER,
            fighter_name TEXT,
            club_name TEXT,
            weight REAL,
            operation_type TEXT NOT NULL,
            edited_by_judge TEXT,
            edited_by_admin INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced INTEGER DEFAULT 0,
            synced_at TEXT
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_bracket_edits_bracket ON bracket_participant_edits(bracket_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_bracket_edits_match ON bracket_participant_edits(match_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_bracket_edits_synced ON bracket_participant_edits(synced)")
        .execute(pool)
        .await?;

    Ok(())
}
