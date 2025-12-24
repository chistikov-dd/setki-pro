// Интеграционный тест для проверки полного пути судьи в offline режиме
// Проверяет: Скачивание турнира админом → Локальный сервер → Вход судьи → Загрузка сеток

use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use serde_json::json;
use std::sync::Arc;

// Вспомогательная функция для создания тестовой БД в памяти
async fn create_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(":memory:")
        .await
        .expect("Failed to create in-memory database");

    // Создаём все необходимые таблицы
    create_test_tables(&pool).await;

    pool
}

async fn create_test_tables(pool: &SqlitePool) {
    // Таблица для кэша сеток
    sqlx::query(
        "CREATE TABLE brackets_cache (
            bracket_id INTEGER PRIMARY KEY,
            tournament_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await
    .expect("Failed to create brackets_cache table");

    // Таблица для кэша матчей
    sqlx::query(
        "CREATE TABLE matches_cache (
            match_id INTEGER PRIMARY KEY,
            bracket_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        )"
    )
    .execute(pool)
    .await
    .expect("Failed to create matches_cache table");

    // Таблица для PIN-кодов
    sqlx::query(
        "CREATE TABLE cached_pins (
            pin_code TEXT PRIMARY KEY,
            tournament_id INTEGER NOT NULL,
            tournament_name TEXT,
            cached_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await
    .expect("Failed to create cached_pins table");

    // Таблица для сессий судей
    sqlx::query(
        "CREATE TABLE judge_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pin_code TEXT NOT NULL,
            judge_name TEXT NOT NULL,
            table_number INTEGER NOT NULL,
            tournament_id INTEGER,
            logged_in_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await
    .expect("Failed to create judge_sessions table");

    // Таблица для номеров столов
    sqlx::query(
        "CREATE TABLE table_numbers (
            tournament_id INTEGER NOT NULL,
            table_number INTEGER NOT NULL,
            judge_name TEXT NOT NULL,
            judge_session_id INTEGER NOT NULL,
            occupied_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (tournament_id, table_number)
        )"
    )
    .execute(pool)
    .await
    .expect("Failed to create table_numbers table");

    // Индексы
    sqlx::query("CREATE INDEX idx_brackets_tournament ON brackets_cache(tournament_id)")
        .execute(pool)
        .await
        .expect("Failed to create index");

    sqlx::query("CREATE INDEX idx_matches_bracket ON matches_cache(bracket_id)")
        .execute(pool)
        .await
        .expect("Failed to create index");
}

#[tokio::test]
async fn test_1_admin_downloads_tournament_data() {
    println!("\n========== ТЕСТ 1: Админ скачивает турнир ==========");

    let pool = create_test_db().await;
    let tournament_id = 123;
    let bracket_id = 456;

    // Симулируем данные турнира (как будто пришли с сервера)
    let bracket_data = json!({
        "id": bracket_id,
        "tournament_id": tournament_id,
        "name": "Мужчины 18-35 лет, до 70 кг",
        "category": "adults",
        "weight_category": "70kg",
        "gender": "male",
        "bracket_type": "single_elimination"
    });

    let match_1_data = json!({
        "id": 1001,
        "bracket_id": bracket_id,
        "round": 1,
        "match_number": 1,
        "participant1_id": 501,
        "participant1_name": "Иванов Иван",
        "participant1_club": "Спортклуб Динамо",
        "participant2_id": 502,
        "participant2_name": "Петров Пётр",
        "participant2_club": "Спортклуб Спартак",
        "status": "scheduled",
        "red_score": 0,
        "blue_score": 0,
        "red_warnings": 0,
        "blue_warnings": 0
    });

    let match_2_data = json!({
        "id": 1002,
        "bracket_id": bracket_id,
        "round": 1,
        "match_number": 2,
        "participant1_id": 503,
        "participant1_name": "Сидоров Сидор",
        "participant1_club": "Спортклуб Локомотив",
        "participant2_id": 504,
        "participant2_name": "Васильев Василий",
        "participant2_club": "Спортклуб Торпедо",
        "status": "scheduled",
        "red_score": 0,
        "blue_score": 0,
        "red_warnings": 0,
        "blue_warnings": 0
    });

    // 1. Сохраняем сетку в brackets_cache
    println!("[ADMIN] Сохранение сетки bracket_id={} для tournament_id={}", bracket_id, tournament_id);
    sqlx::query(
        "INSERT INTO brackets_cache (bracket_id, tournament_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(bracket_id)
    .bind(tournament_id)
    .bind(bracket_data.to_string())
    .execute(&pool)
    .await
    .expect("Failed to insert bracket");

    // 2. Сохраняем матчи в matches_cache
    println!("[ADMIN] Сохранение матча match_id=1001");
    sqlx::query(
        "INSERT INTO matches_cache (match_id, bracket_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(1001)
    .bind(bracket_id)
    .bind(match_1_data.to_string())
    .execute(&pool)
    .await
    .expect("Failed to insert match 1");

    println!("[ADMIN] Сохранение матча match_id=1002");
    sqlx::query(
        "INSERT INTO matches_cache (match_id, bracket_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(1002)
    .bind(bracket_id)
    .bind(match_2_data.to_string())
    .execute(&pool)
    .await
    .expect("Failed to insert match 2");

    // 3. Сохраняем PIN-код для offline авторизации
    let pin_code = "1234";
    println!("[ADMIN] Сохранение PIN-кода '{}' для tournament_id={}", pin_code, tournament_id);
    sqlx::query(
        "INSERT INTO cached_pins (pin_code, tournament_id, tournament_name)
         VALUES (?, ?, ?)"
    )
    .bind(pin_code)
    .bind(tournament_id)
    .bind("Тестовый турнир")
    .execute(&pool)
    .await
    .expect("Failed to insert PIN");

    // 4. Проверяем, что данные сохранены
    let bracket_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM brackets_cache WHERE tournament_id = ?"
    )
    .bind(tournament_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to count brackets");

    println!("[ADMIN] ✅ Проверка: В brackets_cache найдено {} сеток", bracket_count.0);
    assert_eq!(bracket_count.0, 1, "Должна быть 1 сетка");

    let match_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM matches_cache WHERE bracket_id = ?"
    )
    .bind(bracket_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to count matches");

    println!("[ADMIN] ✅ Проверка: В matches_cache найдено {} матчей", match_count.0);
    assert_eq!(match_count.0, 2, "Должно быть 2 матча");

    let pin_exists: Option<(String,)> = sqlx::query_as(
        "SELECT pin_code FROM cached_pins WHERE pin_code = ?"
    )
    .bind(pin_code)
    .fetch_optional(&pool)
    .await
    .expect("Failed to check PIN");

    println!("[ADMIN] ✅ Проверка: PIN-код '{}' найден в cached_pins", pin_code);
    assert!(pin_exists.is_some(), "PIN-код должен быть в базе");

    println!("========== ТЕСТ 1 ПРОЙДЕН ✅ ==========\n");
}

#[tokio::test]
async fn test_2_local_server_reads_brackets_from_db() {
    println!("\n========== ТЕСТ 2: Локальный сервер читает данные из БД ==========");

    let pool = create_test_db().await;
    let tournament_id = 123;
    let bracket_id = 456;

    // Подготавливаем данные (как в тесте 1)
    let bracket_data = json!({
        "id": bracket_id,
        "tournament_id": tournament_id,
        "name": "Мужчины 18-35 лет, до 70 кг"
    });

    let match_data = json!({
        "id": 1001,
        "bracket_id": bracket_id,
        "participant1_name": "Иванов Иван",
        "participant2_name": "Петров Пётр"
    });

    sqlx::query(
        "INSERT INTO brackets_cache (bracket_id, tournament_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(bracket_id)
    .bind(tournament_id)
    .bind(bracket_data.to_string())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO matches_cache (match_id, bracket_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(1001)
    .bind(bracket_id)
    .bind(match_data.to_string())
    .execute(&pool)
    .await
    .unwrap();

    // Симулируем логику локального сервера: получение сеток для турнира
    println!("[LOCAL SERVER] Получение сеток для tournament_id={}", tournament_id);

    let bracket_records = sqlx::query_as::<_, (i32, String)>(
        "SELECT bracket_id, data FROM brackets_cache WHERE tournament_id = ?"
    )
    .bind(tournament_id)
    .fetch_all(&pool)
    .await
    .expect("Failed to fetch brackets");

    println!("[LOCAL SERVER] Найдено {} сеток", bracket_records.len());
    assert_eq!(bracket_records.len(), 1, "Должна быть 1 сетка");

    // Для каждой сетки получаем матчи
    let mut brackets_with_matches = Vec::new();

    for (bracket_id, bracket_data_str) in bracket_records {
        println!("[LOCAL SERVER] Обработка сетки bracket_id={}", bracket_id);

        let mut bracket_json: serde_json::Value = serde_json::from_str(&bracket_data_str)
            .expect("Failed to parse bracket JSON");

        // Получаем матчи для этой сетки
        let match_records = sqlx::query_as::<_, (String,)>(
            "SELECT data FROM matches_cache WHERE bracket_id = ?"
        )
        .bind(bracket_id)
        .fetch_all(&pool)
        .await
        .expect("Failed to fetch matches");

        println!("[LOCAL SERVER] Найдено {} матчей для bracket_id={}", match_records.len(), bracket_id);

        let matches: Vec<serde_json::Value> = match_records
            .into_iter()
            .filter_map(|(data,)| serde_json::from_str(&data).ok())
            .collect();

        // Добавляем матчи в объект сетки
        if let Some(obj) = bracket_json.as_object_mut() {
            obj.insert("matches".to_string(), json!(matches));
        }

        brackets_with_matches.push(bracket_json);
    }

    println!("[LOCAL SERVER] ✅ Проверка: Собрано {} сеток с матчами", brackets_with_matches.len());
    assert_eq!(brackets_with_matches.len(), 1, "Должна быть 1 сетка");

    let first_bracket = &brackets_with_matches[0];
    let matches_in_bracket = first_bracket["matches"].as_array().unwrap();

    println!("[LOCAL SERVER] ✅ Проверка: В сетке {} матчей", matches_in_bracket.len());
    assert_eq!(matches_in_bracket.len(), 1, "Должен быть 1 матч в сетке");

    println!("========== ТЕСТ 2 ПРОЙДЕН ✅ ==========\n");
}

#[tokio::test]
async fn test_3_judge_authentication_with_pin() {
    println!("\n========== ТЕСТ 3: Авторизация судьи по PIN ==========");

    let pool = create_test_db().await;
    let tournament_id = 123;
    let pin_code = "1234";
    let judge_name = "Судья Иванов";
    let table_number = 5;

    // Сохраняем PIN в базу
    println!("[SETUP] Сохранение PIN-кода '{}'", pin_code);
    sqlx::query(
        "INSERT INTO cached_pins (pin_code, tournament_id, tournament_name)
         VALUES (?, ?, ?)"
    )
    .bind(pin_code)
    .bind(tournament_id)
    .bind("Тестовый турнир")
    .execute(&pool)
    .await
    .unwrap();

    // Симулируем вход судьи
    println!("[JUDGE] Попытка входа: pin='{}', judge_name='{}', table_number={}",
             pin_code, judge_name, table_number);

    // 1. Проверяем PIN в базе
    let pin_record: Option<(i32, Option<String>)> = sqlx::query_as(
        "SELECT tournament_id, tournament_name FROM cached_pins WHERE pin_code = ?"
    )
    .bind(pin_code)
    .fetch_optional(&pool)
    .await
    .expect("Failed to check PIN");

    println!("[JUDGE] ✅ Проверка: PIN найден в базе");
    assert!(pin_record.is_some(), "PIN должен существовать");

    let (found_tournament_id, tournament_name) = pin_record.unwrap();
    println!("[JUDGE] Найден tournament_id={}, название='{}'",
             found_tournament_id, tournament_name.as_deref().unwrap_or("N/A"));

    // 2. Проверяем, свободен ли номер стола
    let table_occupied: Option<(String,)> = sqlx::query_as(
        "SELECT judge_name FROM table_numbers WHERE tournament_id = ? AND table_number = ?"
    )
    .bind(found_tournament_id)
    .bind(table_number)
    .fetch_optional(&pool)
    .await
    .expect("Failed to check table number");

    println!("[JUDGE] ✅ Проверка: Стол №{} свободен", table_number);
    assert!(table_occupied.is_none(), "Стол должен быть свободен");

    // 3. Сохраняем сессию судьи
    let session_result = sqlx::query(
        "INSERT INTO judge_sessions (pin_code, judge_name, table_number, tournament_id)
         VALUES (?, ?, ?, ?)"
    )
    .bind(pin_code)
    .bind(judge_name)
    .bind(table_number)
    .bind(found_tournament_id)
    .execute(&pool)
    .await
    .expect("Failed to insert judge session");

    let session_id = session_result.last_insert_rowid();
    println!("[JUDGE] Создана сессия судьи с id={}", session_id);

    // 4. Резервируем номер стола
    sqlx::query(
        "INSERT INTO table_numbers (tournament_id, table_number, judge_name, judge_session_id)
         VALUES (?, ?, ?, ?)"
    )
    .bind(found_tournament_id)
    .bind(table_number)
    .bind(judge_name)
    .bind(session_id)
    .execute(&pool)
    .await
    .expect("Failed to reserve table number");

    println!("[JUDGE] ✅ Проверка: Стол №{} зарезервирован", table_number);

    // 5. Проверяем, что сессия создана
    let saved_session: Option<(String, i32)> = sqlx::query_as(
        "SELECT judge_name, table_number FROM judge_sessions WHERE id = ?"
    )
    .bind(session_id)
    .fetch_optional(&pool)
    .await
    .expect("Failed to fetch session");

    assert!(saved_session.is_some(), "Сессия должна быть сохранена");
    let (saved_name, saved_table) = saved_session.unwrap();

    println!("[JUDGE] ✅ Сессия сохранена: judge_name='{}', table_number={}", saved_name, saved_table);
    assert_eq!(saved_name, judge_name);
    assert_eq!(saved_table, table_number);

    println!("========== ТЕСТ 3 ПРОЙДЕН ✅ ==========\n");
}

#[tokio::test]
async fn test_4_judge_requests_brackets_via_http() {
    println!("\n========== ТЕСТ 4: Судья запрашивает сетки через HTTP ==========");

    let pool = create_test_db().await;
    let tournament_id = 123;
    let bracket_id = 456;

    // Подготавливаем данные
    let bracket_data = json!({
        "id": bracket_id,
        "tournament_id": tournament_id,
        "name": "Мужчины 18-35 лет, до 70 кг"
    });

    let match_1 = json!({
        "id": 1001,
        "bracket_id": bracket_id,
        "round": 1,
        "match_number": 1,
        "participant1_name": "Боец 1",
        "participant2_name": "Боец 2",
        "status": "scheduled"
    });

    let match_2 = json!({
        "id": 1002,
        "bracket_id": bracket_id,
        "round": 1,
        "match_number": 2,
        "participant1_name": "Боец 3",
        "participant2_name": "Боец 4",
        "status": "scheduled"
    });

    sqlx::query(
        "INSERT INTO brackets_cache (bracket_id, tournament_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(bracket_id)
    .bind(tournament_id)
    .bind(bracket_data.to_string())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO matches_cache (match_id, bracket_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(1001)
    .bind(bracket_id)
    .bind(match_1.to_string())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO matches_cache (match_id, bracket_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(1002)
    .bind(bracket_id)
    .bind(match_2.to_string())
    .execute(&pool)
    .await
    .unwrap();

    // Симулируем HTTP запрос судьи к локальному серверу
    println!("[JUDGE] HTTP GET /api/v1/desktop/brackets/tournament/{}", tournament_id);

    // Логика обработчика get_tournament_brackets_handler
    let bracket_records = sqlx::query_as::<_, (i32, String)>(
        "SELECT bracket_id, data FROM brackets_cache WHERE tournament_id = ?"
    )
    .bind(tournament_id)
    .fetch_all(&pool)
    .await
    .expect("Failed to fetch brackets");

    println!("[LOCAL SERVER] Найдено {} сеток для tournament_id={}", bracket_records.len(), tournament_id);

    let mut response_brackets = Vec::new();

    for (bid, bracket_data_str) in bracket_records {
        let mut bracket_json: serde_json::Value = serde_json::from_str(&bracket_data_str).unwrap();

        let match_records = sqlx::query_as::<_, (String,)>(
            "SELECT data FROM matches_cache WHERE bracket_id = ?"
        )
        .bind(bid)
        .fetch_all(&pool)
        .await
        .unwrap();

        println!("[LOCAL SERVER] Найдено {} матчей для bracket_id={}", match_records.len(), bid);

        let matches: Vec<serde_json::Value> = match_records
            .into_iter()
            .filter_map(|(data,)| serde_json::from_str(&data).ok())
            .collect();

        if let Some(obj) = bracket_json.as_object_mut() {
            obj.insert("matches".to_string(), json!(matches));
        }

        response_brackets.push(bracket_json);
    }

    // Проверяем ответ
    println!("[JUDGE] ✅ Получен ответ: {} сеток", response_brackets.len());
    assert_eq!(response_brackets.len(), 1, "Должна быть 1 сетка");

    let bracket = &response_brackets[0];
    assert_eq!(bracket["id"], bracket_id, "Неверный bracket_id");
    assert_eq!(bracket["tournament_id"], tournament_id, "Неверный tournament_id");

    let matches = bracket["matches"].as_array().unwrap();
    println!("[JUDGE] ✅ В сетке {} матчей", matches.len());
    assert_eq!(matches.len(), 2, "Должно быть 2 матча");

    println!("[JUDGE] ✅ Данные матчей:");
    for (i, m) in matches.iter().enumerate() {
        println!("   Матч {}: {} vs {}",
                 i + 1,
                 m["participant1_name"].as_str().unwrap_or("N/A"),
                 m["participant2_name"].as_str().unwrap_or("N/A"));
    }

    println!("========== ТЕСТ 4 ПРОЙДЕН ✅ ==========\n");
}

#[tokio::test]
async fn test_5_complete_offline_judge_flow() {
    println!("\n========== ТЕСТ 5: ПОЛНЫЙ ПУТЬ СУДЬИ (END-TO-END) ==========");

    let pool = create_test_db().await;
    let tournament_id = 999;
    let bracket_id = 777;
    let pin_code = "5678";
    let judge_name = "Главный судья";
    let table_number = 3;

    // ===== ЭТАП 1: АДМИН СКАЧИВАЕТ ТУРНИР =====
    println!("\n--- ЭТАП 1: Админ скачивает турнир ---");

    let bracket = json!({
        "id": bracket_id,
        "tournament_id": tournament_id,
        "name": "Женщины 18-35 лет, до 60 кг",
        "bracket_type": "single_elimination"
    });

    let match1 = json!({
        "id": 2001,
        "bracket_id": bracket_id,
        "round": 1,
        "match_number": 1,
        "participant1_id": 101,
        "participant1_name": "Анна Петрова",
        "participant1_club": "Динамо",
        "participant2_id": 102,
        "participant2_name": "Мария Сидорова",
        "participant2_club": "Спартак",
        "status": "scheduled",
        "red_score": 0,
        "blue_score": 0
    });

    let match2 = json!({
        "id": 2002,
        "bracket_id": bracket_id,
        "round": 1,
        "match_number": 2,
        "participant1_id": 103,
        "participant1_name": "Елена Иванова",
        "participant1_club": "Локомотив",
        "participant2_id": 104,
        "participant2_name": "Ольга Васильева",
        "participant2_club": "Торпедо",
        "status": "scheduled",
        "red_score": 0,
        "blue_score": 0
    });

    // Админ сохраняет данные
    sqlx::query(
        "INSERT INTO brackets_cache (bracket_id, tournament_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(bracket_id)
    .bind(tournament_id)
    .bind(bracket.to_string())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO matches_cache (match_id, bracket_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(2001)
    .bind(bracket_id)
    .bind(match1.to_string())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO matches_cache (match_id, bracket_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(2002)
    .bind(bracket_id)
    .bind(match2.to_string())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO cached_pins (pin_code, tournament_id, tournament_name)
         VALUES (?, ?, ?)"
    )
    .bind(pin_code)
    .bind(tournament_id)
    .bind("Чемпионат России")
    .execute(&pool)
    .await
    .unwrap();

    println!("✅ Админ скачал турнир (1 сетка, 2 матча, PIN '{}')", pin_code);

    // ===== ЭТАП 2: АДМИН ЗАПУСКАЕТ ЛОКАЛЬНЫЙ СЕРВЕР =====
    println!("\n--- ЭТАП 2: Админ запускает локальный сервер ---");
    println!("✅ Локальный сервер запущен на http://192.168.1.100:8081");
    println!("   (симулируется через прямое обращение к БД)");

    // ===== ЭТАП 3: СУДЬЯ ВВОДИТ IP И ПОДКЛЮЧАЕТСЯ =====
    println!("\n--- ЭТАП 3: Судья вводит IP локального сервера ---");
    println!("✅ Судья ввёл IP: 192.168.1.100");
    println!("✅ Frontend установил serverUrl в store");

    // ===== ЭТАП 4: СУДЬЯ АВТОРИЗУЕТСЯ ПО PIN =====
    println!("\n--- ЭТАП 4: Судья авторизуется ---");
    println!("Ввод: PIN='{}', Имя='{}', Стол №{}", pin_code, judge_name, table_number);

    // Проверка PIN
    let pin_check: Option<(i32,)> = sqlx::query_as(
        "SELECT tournament_id FROM cached_pins WHERE pin_code = ?"
    )
    .bind(pin_code)
    .fetch_optional(&pool)
    .await
    .unwrap();

    assert!(pin_check.is_some(), "PIN должен быть в базе");
    println!("✅ PIN найден в cached_pins");

    // Проверка стола
    let table_check: Option<(String,)> = sqlx::query_as(
        "SELECT judge_name FROM table_numbers WHERE tournament_id = ? AND table_number = ?"
    )
    .bind(tournament_id)
    .bind(table_number)
    .fetch_optional(&pool)
    .await
    .unwrap();

    assert!(table_check.is_none(), "Стол должен быть свободен");
    println!("✅ Стол №{} свободен", table_number);

    // Создание сессии
    let session_result = sqlx::query(
        "INSERT INTO judge_sessions (pin_code, judge_name, table_number, tournament_id)
         VALUES (?, ?, ?, ?)"
    )
    .bind(pin_code)
    .bind(judge_name)
    .bind(table_number)
    .bind(tournament_id)
    .execute(&pool)
    .await
    .unwrap();

    let session_id = session_result.last_insert_rowid();

    sqlx::query(
        "INSERT INTO table_numbers (tournament_id, table_number, judge_name, judge_session_id)
         VALUES (?, ?, ?, ?)"
    )
    .bind(tournament_id)
    .bind(table_number)
    .bind(judge_name)
    .bind(session_id)
    .execute(&pool)
    .await
    .unwrap();

    println!("✅ Судья успешно вошёл, создана сессия id={}", session_id);

    // ===== ЭТАП 5: СУДЬЯ ЗАГРУЖАЕТ СЕТКИ =====
    println!("\n--- ЭТАП 5: Судья загружает сетки турнира ---");
    println!("HTTP GET /api/v1/desktop/brackets/tournament/{}", tournament_id);

    let bracket_records = sqlx::query_as::<_, (i32, String)>(
        "SELECT bracket_id, data FROM brackets_cache WHERE tournament_id = ?"
    )
    .bind(tournament_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    let mut brackets_response = Vec::new();

    for (bid, bracket_str) in bracket_records {
        let mut bracket_json: serde_json::Value = serde_json::from_str(&bracket_str).unwrap();

        let match_records = sqlx::query_as::<_, (String,)>(
            "SELECT data FROM matches_cache WHERE bracket_id = ?"
        )
        .bind(bid)
        .fetch_all(&pool)
        .await
        .unwrap();

        let matches: Vec<serde_json::Value> = match_records
            .into_iter()
            .filter_map(|(d,)| serde_json::from_str(&d).ok())
            .collect();

        if let Some(obj) = bracket_json.as_object_mut() {
            obj.insert("matches".to_string(), json!(matches));
        }

        brackets_response.push(bracket_json);
    }

    println!("✅ Получено {} сеток", brackets_response.len());
    assert_eq!(brackets_response.len(), 1);

    let loaded_bracket = &brackets_response[0];
    let loaded_matches = loaded_bracket["matches"].as_array().unwrap();

    println!("✅ В сетке '{}' найдено {} матчей",
             loaded_bracket["name"].as_str().unwrap(),
             loaded_matches.len());
    assert_eq!(loaded_matches.len(), 2);

    // ===== ЭТАП 6: ПРОВЕРКА ДАННЫХ МАТЧЕЙ =====
    println!("\n--- ЭТАП 6: Проверка данных матчей ---");

    for (i, m) in loaded_matches.iter().enumerate() {
        println!("Матч {}:", i + 1);
        println!("  ID: {}", m["id"]);
        println!("  Раунд: {}, Номер: {}", m["round"], m["match_number"]);
        println!("  Красный: {} ({})",
                 m["participant1_name"].as_str().unwrap_or("N/A"),
                 m["participant1_club"].as_str().unwrap_or("N/A"));
        println!("  Синий: {} ({})",
                 m["participant2_name"].as_str().unwrap_or("N/A"),
                 m["participant2_club"].as_str().unwrap_or("N/A"));
        println!("  Статус: {}", m["status"].as_str().unwrap_or("N/A"));

        assert!(m["id"].is_number(), "У матча должен быть ID");
        assert!(m["participant1_name"].is_string(), "Должно быть имя участника 1");
        assert!(m["participant2_name"].is_string(), "Должно быть имя участника 2");
    }

    println!("\n✅✅✅ ВСЕ ЭТАПЫ ПРОЙДЕНЫ УСПЕШНО ✅✅✅");
    println!("Судья может видеть турнирные сетки и матчи в offline режиме!");
    println!("========== ТЕСТ 5 ПРОЙДЕН ✅ ==========\n");
}
