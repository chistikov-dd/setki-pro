mod api;
mod db;
mod local_server;
mod logger;

use api::{ApiClient, AuthResponse, TournamentBrief, TournamentSession};
use std::sync::Arc;
use tauri::{Manager, State, AppHandle};
use serde::{Deserialize, Serialize};
use chrono::Utc;

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
async fn get_token(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    state.api_client
        .get_token()
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
    // Валидация: игнорируем пустые строки
    let api_client: Arc<ApiClient> = if let Some(url) = server_url.clone().filter(|s| !s.is_empty()) {
        state.logger.info(&format!("[login_by_pin] Creating custom ApiClient with URL: {}", url));
        Arc::new(ApiClient::new(url, Arc::clone(&state.db_pool), Arc::clone(&state.logger)))
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
async fn check_internet_connection() -> Result<bool, String> {
    // Проверка доступности setki.pro API с timeout 3 секунды
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    // Используем реальный API endpoint setki.pro (без авторизации)
    match client.get("https://setki.pro/api/v1/tournaments").send().await {
        Ok(response) => {
            // Даже если вернется 401 Unauthorized - это значит что сервер доступен
            Ok(response.status().as_u16() < 500)
        },
        Err(_) => Ok(false), // Нет интернета или сервер недоступен
    }
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
    state.logger.info("========== GET_CACHED_BRACKETS START ==========");
    state.logger.info(&format!("tournament_id: {}", tournament_id));
    state.logger.info(&format!("server_url: {:?}", server_url));

    // Если передан server_url, используем его для создания временного клиента
    // Валидация: игнорируем пустые строки
    if let Some(url) = server_url.filter(|s| !s.is_empty()) {
        state.logger.info(&format!("Using custom server URL: {}", url));
        let api_client = ApiClient::new(url.clone(), Arc::clone(&state.db_pool), Arc::clone(&state.logger));

        match api_client.get_cached_brackets(tournament_id).await {
            Ok(brackets) => {
                state.logger.info(&format!("SUCCESS: Received {} brackets", brackets.len()));
                state.logger.info("========== GET_CACHED_BRACKETS END ==========");
                Ok(brackets)
            }
            Err(e) => {
                state.logger.error(&format!("ERROR: {}", e));
                state.logger.error("========== GET_CACHED_BRACKETS END ==========");
                Err(e.to_string())
            }
        }
    } else {
        state.logger.info("Using default API client");

        match state.api_client.get_cached_brackets(tournament_id).await {
            Ok(brackets) => {
                state.logger.info(&format!("SUCCESS: Received {} brackets", brackets.len()));
                state.logger.info("========== GET_CACHED_BRACKETS END ==========");
                Ok(brackets)
            }
            Err(e) => {
                state.logger.error(&format!("ERROR: {}", e));
                state.logger.error("========== GET_CACHED_BRACKETS END ==========");
                Err(e.to_string())
            }
        }
    }
}

// Новая команда для админа - возвращает сетки с матчами
#[tauri::command]
async fn get_cached_brackets_with_matches(
    tournament_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    state.logger.info("========== GET_CACHED_BRACKETS_WITH_MATCHES START ==========");
    state.logger.info(&format!("tournament_id: {}", tournament_id));

    // Читаем из локального кэша с матчами
    let bracket_records = sqlx::query_as::<_, (i32, String)>(
        "SELECT bracket_id, data FROM brackets_cache WHERE tournament_id = ?"
    )
    .bind(tournament_id)
    .fetch_all(&*state.db_pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut brackets: Vec<serde_json::Value> = Vec::new();

    for (bracket_id, bracket_data) in bracket_records {
        if let Ok(mut bracket) = serde_json::from_str::<serde_json::Value>(&bracket_data) {
            // Загружаем матчи для этой сетки
            let match_records = sqlx::query_as::<_, (String,)>(
                "SELECT data FROM matches_cache WHERE bracket_id = ?"
            )
            .bind(bracket_id)
            .fetch_all(&*state.db_pool)
            .await
            .map_err(|e| e.to_string())?;

            let matches: Vec<serde_json::Value> = match_records
                .into_iter()
                .filter_map(|r| serde_json::from_str(&r.0).ok())
                .collect();

            // Добавляем matches в bracket
            if let Some(obj) = bracket.as_object_mut() {
                obj.insert("matches".to_string(), serde_json::json!(matches));
            }

            brackets.push(bracket);
        }
    }

    state.logger.info(&format!("SUCCESS: Received {} brackets with matches", brackets.len()));
    state.logger.info("========== GET_CACHED_BRACKETS_WITH_MATCHES END ==========");
    Ok(brackets)
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
    let logger_clone = Arc::clone(&state.logger);
    tokio::spawn(async move {
        if let Err(e) = local_server::start_server(db_pool, port, shutdown_rx, logger_clone).await {
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
async fn get_local_server_url(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let url_guard = state.local_server_url.lock().await;
    Ok(url_guard.clone())
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
    tournament_id: i32,
    judge_name: String,
    table_number: i32,
    user_id: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[reserve_bracket] START: bracket_id={}, tournament_id={}, judge_name={}, table_number={}, user_id={}",
        bracket_id, tournament_id, judge_name, table_number, user_id);

    let result = state.api_client
        .reserve_bracket(bracket_id, tournament_id, &judge_name, table_number, user_id)
        .await
        .map_err(|e| {
            println!("[reserve_bracket] ERROR: {}", e);
            e.to_string()
        });

    if result.is_ok() {
        println!("[reserve_bracket] SUCCESS");
    }

    result
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
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    state.logger.info("========== GET_BRACKET_MATCHES START ==========");
    state.logger.info(&format!("bracket_id: {}", bracket_id));
    state.logger.info(&format!("server_url: {:?}", server_url));

    let pool = &state.db_pool;

    // Если передан server_url, используем его для создания временного клиента
    if let Some(url) = server_url.filter(|s| !s.is_empty()) {
        state.logger.info(&format!("Using custom server URL: {}", url));
        let api_client = ApiClient::new(url.clone(), Arc::clone(&state.db_pool), Arc::clone(&state.logger));

        match api_client.get_bracket_matches(bracket_id).await {
            Ok(matches) => {
                state.logger.info(&format!("SUCCESS: Received {} matches from server", matches.len()));

                // НОВАЯ АРХИТЕКТУРА: Судья НЕ кэширует матчи в своей БД
                // Админ - единственный источник правды (single source of truth)
                // Преимущества: нет конфликтов версий, нет синхронизации, масштабируется на 15-20 столов
                state.logger.info("Judge mode: NOT caching matches (admin is single source of truth)");

                state.logger.info("========== GET_BRACKET_MATCHES END ==========");
                Ok(matches)
            }
            Err(e) => {
                state.logger.error(&format!("ERROR: {}", e));
                state.logger.error("========== GET_BRACKET_MATCHES END ==========");
                Err(e.to_string())
            }
        }
    } else {
        // Иначе пытаемся загрузить из локального кэша
        state.logger.info("Loading from local cache...");
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

            state.logger.info(&format!("Returning {} matches from local cache", matches.len()));
            state.logger.info("========== GET_BRACKET_MATCHES END ==========");
            Ok(matches)
        } else {
            state.logger.info("Cache is empty, loading from default server");
            // Нет кэша - загружаем с сервера
            match state.api_client.get_bracket_matches(bracket_id).await {
                Ok(matches) => {
                    state.logger.info(&format!("SUCCESS: Received {} matches from server", matches.len()));
                    state.logger.info("========== GET_BRACKET_MATCHES END ==========");
                    Ok(matches)
                }
                Err(e) => {
                    state.logger.error(&format!("ERROR: {}", e));
                    state.logger.error("========== GET_BRACKET_MATCHES END ==========");
                    Err(e.to_string())
                }
            }
        }
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

#[tauri::command]
async fn release_judge_brackets(
    judge_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .release_judge_brackets(&judge_name)
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
#[derive(Serialize, Deserialize)]
struct BracketTableAssignment {
    bracket_id: i32,
    table_number: i32,
    judge_name: String,
}

#[tauri::command]
async fn get_bracket_table_assignments(
    tournament_id: i32,
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BracketTableAssignment>, String> {
    // Если есть server_url (local-client режим) - запросить с локального сервера
    if let Some(url) = server_url {
        println!("[get_bracket_table_assignments] Запрос к локальному серверу: {}", url);

        // Получаем токен для авторизации
        let token = state.api_client.get_token().await
            .map_err(|e| format!("Ошибка получения токена: {}", e))?
            .ok_or_else(|| "Токен не найден (требуется авторизация)".to_string())?;

        let client = reqwest::Client::new();
        let endpoint = format!("{}/api/v1/desktop/bracket-assignments/{}", url, tournament_id);

        let response = client.get(&endpoint)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Ошибка запроса к локальному серверу: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Локальный сервер вернул ошибку: {}", response.status()));
        }

        let assignments: Vec<BracketTableAssignment> = response.json()
            .await
            .map_err(|e| format!("Ошибка парсинга ответа: {}", e))?;

        println!("[get_bracket_table_assignments] Получено {} резерваций с локального сервера", assignments.len());
        return Ok(assignments);
    }

    // Иначе читаем из локальной БД (online или local-server режимы)
    println!("[get_bracket_table_assignments] Чтение из локальной БД");
    let assignments = sqlx::query_as::<_, (i32, i32, String)>(
        "SELECT
            ba.bracket_id,
            ba.table_number,
            ba.judge_name
         FROM bracket_assignments ba
         WHERE ba.tournament_id = ? AND ba.status = 'active'
         ORDER BY ba.reserved_at DESC"
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

// Получить сетки, зарезервированные за судьей (для таба "Мои сетки")
#[tauri::command]
async fn get_my_bracket_assignments(
    tournament_id: i32,
    table_number: i32,
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    println!("[get_my_bracket_assignments] tournament_id={}, table_number={}, server_url={:?}",
        tournament_id, table_number, server_url);

    // Если есть server_url (local-client режим) - запросить с локального сервера
    if let Some(url) = server_url.filter(|s| !s.is_empty()) {
        println!("[get_my_bracket_assignments] Запрос к локальному серверу: {}", url);

        let token = state.api_client.get_token().await
            .map_err(|e| format!("Ошибка получения токена: {}", e))?
            .ok_or_else(|| "Токен не найден".to_string())?;

        println!("[get_my_bracket_assignments] Токен найден: {}...", &token[..token.len().min(10)]);

        let client = reqwest::Client::new();
        // server_url УЖЕ содержит /api/v1, не добавляем его повторно
        let endpoint = format!("{}/desktop/my-bracket-assignments/{}/{}",
            url, tournament_id, table_number);

        println!("[get_my_bracket_assignments] Endpoint: {}", endpoint);

        let response = client.get(&endpoint)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Ошибка запроса: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Сервер вернул ошибку: {}", response.status()));
        }

        let brackets: Vec<serde_json::Value> = response.json()
            .await
            .map_err(|e| format!("Ошибка парсинга: {}", e))?;

        println!("[get_my_bracket_assignments] Получено {} сеток с сервера", brackets.len());
        return Ok(brackets);
    }

    // Иначе читаем из локальной БД (админ режим)
    println!("[get_my_bracket_assignments] Чтение из локальной БД");
    let pool = &state.db_pool;

    // Получить список bracket_id зарезервированных за этим столом
    let bracket_ids: Vec<i32> = sqlx::query_scalar(
        "SELECT ba.bracket_id
         FROM bracket_assignments ba
         WHERE ba.tournament_id = ? AND ba.table_number = ? AND ba.status = 'active'
         ORDER BY ba.reserved_at DESC"
    )
    .bind(tournament_id)
    .bind(table_number)
    .fetch_all(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    if bracket_ids.is_empty() {
        println!("[get_my_bracket_assignments] Нет зарезервированных сеток");
        return Ok(vec![]);
    }

    println!("[get_my_bracket_assignments] Найдено {} зарезервированных сеток", bracket_ids.len());

    // Получить данные сеток из кэша
    let mut brackets = Vec::new();
    for bracket_id in bracket_ids {
        let bracket_data: Option<String> = sqlx::query_scalar(
            "SELECT data FROM brackets_cache WHERE bracket_id = ?"
        )
        .bind(bracket_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

        if let Some(data_str) = bracket_data {
            let bracket: serde_json::Value = serde_json::from_str(&data_str)
                .map_err(|e| e.to_string())?;
            brackets.push(bracket);
        }
    }

    Ok(brackets)
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

    // НОВАЯ АРХИТЕКТУРА: Обновляем локальный кэш ТОЛЬКО если матч есть в БД (админ режим)
    // Судья в local-client режиме НЕ кэширует матчи
    let match_data = sqlx::query("SELECT bracket_id, data FROM matches_cache WHERE match_id = ?")
        .bind(match_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    if let Some(row) = match_data {
        // Админ режим: обновляем локальный кэш
        let bracket_id: i32 = sqlx::Row::get(&row, "bracket_id");
        let data_str: String = sqlx::Row::get(&row, "data");
        let mut match_obj: serde_json::Value = serde_json::from_str(&data_str)
            .map_err(|e| e.to_string())?;

        println!("[start_match] Admin mode: updating local cache for match {}", match_id);

        // Обновить статус матча на in_progress
        match_obj["status"] = serde_json::json!("in_progress");

        // Сохранить обновленный матч
        sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
            .bind(serde_json::to_string(&match_obj).unwrap())
            .bind(match_id)
            .execute(pool.as_ref())
            .await
            .map_err(|e| e.to_string())?;

        // Пересчитать статус сетки
        update_bracket_status(bracket_id, pool).await?;
    } else {
        // Судья режим: матча нет в локальном кэше - это нормально
        println!("[start_match] Judge mode: match {} not in local cache (admin is source of truth)", match_id);
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

    // НОВАЯ АРХИТЕКТУРА: Обновляем локальный кэш ТОЛЬКО если матч есть в БД (админ режим)
    // Судья в local-client режиме НЕ кэширует матчи
    let match_data = sqlx::query("SELECT bracket_id, data FROM matches_cache WHERE match_id = ?")
        .bind(match_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    if let Some(row) = match_data {
        // Админ режим: обновляем локальный кэш
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
    } else {
        // Судья режим: матча нет в локальном кэше - это нормально
        println!("[update_match_score] Judge mode: match {} not in local cache (admin is source of truth)", match_id);
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
    server_url: Option<String>, // НОВЫЙ ПАРАМЕТР для local-client режима
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    state.logger.info("========== BATCH_UPDATE_MATCH START ==========");
    state.logger.info(&format!("match_id: {}", match_id));
    state.logger.info(&format!("event_type: {}, participant: {}", event_type, participant));
    state.logger.info(&format!("points: {:?}, action_name: {:?}", points, action_name));
    state.logger.info(&format!("scores: red={}, blue={}", red_score, blue_score));
    state.logger.info(&format!("warnings: red={}, blue={}", red_warnings, blue_warnings));
    state.logger.info(&format!("status: {}", status));
    state.logger.info(&format!("server_url: {:?}", server_url));

    // НОВАЯ АРХИТЕКТУРА: Админ = единственный источник правды
    // Судья НЕ кэширует данные, только отправляет на сервер админа

    if let Some(url) = server_url {
        // Судья в local-client режиме: ТОЛЬКО отправка на сервер админа
        state.logger.info(&format!("Judge mode: Sending to admin server: {}", url));

        // КРИТИЧНО: Получаем токен для авторизации
        let token = state.api_client.get_token().await
            .map_err(|e| format!("Ошибка получения токена: {}", e))?
            .ok_or_else(|| "Токен не найден (требуется авторизация)".to_string())?;

        let client = reqwest::Client::new();
        let payload = serde_json::json!({
            "match_id": match_id,
            "red_score": red_score,
            "blue_score": blue_score,
            "red_warnings": red_warnings,
            "blue_warnings": blue_warnings,
            "status": status,
        });

        let endpoint = format!("{}/api/v1/desktop/matches/update", url);
        state.logger.info(&format!("Endpoint: {}", endpoint));

        // Retry 3 раза с задержкой 500ms
        for attempt in 0..3 {
            state.logger.info(&format!("HTTP POST attempt {} of 3", attempt + 1));
            match client.post(&endpoint)
                .header("Authorization", format!("Bearer {}", token))
                .json(&payload)
                .send().await {
                Ok(resp) if resp.status().is_success() => {
                    state.logger.info("✅ Successfully sent to admin server");
                    // Возвращаем пустой массив событий (у судьи нет локальных событий)
                    state.logger.info("========== BATCH_UPDATE_MATCH END ==========");
                    return Ok(vec![]);
                }
                Ok(resp) => {
                    let status_code = resp.status();
                    let error_text = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
                    state.logger.error(&format!("Admin server error: {} - {}", status_code, error_text));
                    if attempt == 2 {
                        return Err(format!("Не удалось обновить данные на сервере админа: {}", error_text));
                    }
                }
                Err(e) => {
                    state.logger.error(&format!("Network error (attempt {}): {}", attempt + 1, e));
                    if attempt == 2 {
                        return Err(format!("Ошибка соединения с сервером админа: {}", e));
                    }
                }
            }

            // Задержка перед retry
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        // Не должны сюда попасть, но на всякий случай
        return Err("Не удалось отправить данные на сервер админа".to_string());
    } else {
        // Админ или online режим: сохраняем локально
        state.logger.info("Admin/online mode: Saving to local DB...");
        let events = state.api_client
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
                status.clone(),
            )
            .await
            .map_err(|e| e.to_string())?;
        state.logger.info(&format!("Saved {} events", events.len()));
        state.logger.info("========== BATCH_UPDATE_MATCH END ==========");
        return Ok(events);
    }
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
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = &state.db_pool;

    // Создать ApiClient (временный для custom server_url или глобальный)
    let api_client: Arc<ApiClient> = if let Some(url) = server_url.clone().filter(|s| !s.is_empty()) {
        state.logger.info(&format!("[finish_match] Creating custom ApiClient with URL: {}", url));
        Arc::new(ApiClient::new(url, Arc::clone(&state.db_pool), Arc::clone(&state.logger)))
    } else {
        state.logger.info("[finish_match] Using default API client (setki.pro)");
        Arc::clone(&state.api_client)
    };

    // Отправить на сервер (api_client.finish_match уже обновляет matches_cache)
    api_client
        .finish_match(match_id, winner_id, result_type.clone(), final_red_score, final_blue_score)
        .await
        .map_err(|e| e.to_string())?;

    // Пересчитать статус сетки (после того как api_client обновил матч)
    println!("[finish_match] Получение bracket_id для пересчета статуса сетки");
    let bracket_id: Option<i32> = sqlx::query_scalar(
        "SELECT bracket_id FROM matches_cache WHERE match_id = ?"
    )
        .bind(match_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    if let Some(bracket_id) = bracket_id {
        println!("[finish_match] Пересчет статуса сетки bracket_id={}", bracket_id);
        update_bracket_status(bracket_id, pool).await?;
    } else {
        println!("[finish_match] ВНИМАНИЕ: Матч {} не найден в локальном кэше", match_id);
    }

    Ok(())
}

// Отменить завершённый матч (откатить результаты)
#[tauri::command]
async fn undo_finished_match(
    match_id: i32,
    pin_code: String,
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = &state.db_pool;

    state.logger.info(&format!("[undo_finished_match] START - match_id: {}, pin_code: {}, server_url: {:?}",
        match_id, pin_code, server_url));

    // Создать ApiClient (временный для custom server_url или глобальный)
    let api_client: Arc<ApiClient> = if let Some(url) = server_url.clone().filter(|s| !s.is_empty()) {
        state.logger.info(&format!("[undo_finished_match] Creating custom ApiClient with URL: {}", url));
        Arc::new(ApiClient::new(url.clone(), Arc::clone(&state.db_pool), Arc::clone(&state.logger)))
    } else {
        state.logger.info("[undo_finished_match] Using default API client (setki.pro)");
        Arc::clone(&state.api_client)
    };

    // Проверяем режим работы: local-client должен отправлять на сервер админа
    let is_local_server = server_url.as_ref()
        .map(|url| {
            url.contains("192.168.") || url.contains("10.0.") ||
            url.contains("localhost") || url.contains("127.0.0.1") ||
            url.contains("172.")
        })
        .unwrap_or(false);

    if is_local_server {
        state.logger.info(&format!("[undo_finished_match] Local client mode detected - sending to admin server"));

        // Отправляем запрос на локальный сервер админа
        return api_client
            .undo_match_on_local_server(
                server_url.as_ref().unwrap(),
                match_id
            )
            .await
            .map_err(|e| e.to_string());
    }

    state.logger.info("[undo_finished_match] Online/local-server mode - processing locally");

    // 1. Проверить права: судья может отменять только матчи своей сетки
    state.logger.info("[undo_finished_match] Checking judge permissions...");

    // Получить bracket_id матча
    let bracket_id: Option<i32> = sqlx::query_scalar(
        "SELECT bracket_id FROM matches_cache WHERE match_id = ?"
    )
        .bind(match_id)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| {
            state.logger.error(&format!("[undo_finished_match] Failed to get bracket_id: {}", e));
            e.to_string()
        })?;

    let bracket_id = bracket_id.ok_or_else(|| {
        state.logger.error("[undo_finished_match] Match not found in cache");
        "Матч не найден в локальном кэше".to_string()
    })?;

    state.logger.info(&format!("[undo_finished_match] Match belongs to bracket_id: {}", bracket_id));

    // Проверить что судья с этим PIN работает с этой сеткой
    let reservation_exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM bracket_reservations br
         INNER JOIN judge_sessions js ON br.judge_name = js.judge_name
         WHERE br.bracket_id = ? AND js.pin_code = ?"
    )
        .bind(bracket_id)
        .bind(&pin_code)
        .fetch_one(pool.as_ref())
        .await
        .map_err(|e| {
            state.logger.error(&format!("[undo_finished_match] Failed to check permissions: {}", e));
            e.to_string()
        })?;

    if !reservation_exists {
        state.logger.error("[undo_finished_match] Permission denied - judge not assigned to this bracket");
        return Err("У вас нет прав для отмены этого матча. Только судья, работающий с данной сеткой, может отменить матч.".to_string());
    }

    state.logger.info("[undo_finished_match] Permissions OK, proceeding with undo...");

    // 2. Получить текущие данные матча
    let match_data_str: String = sqlx::query_scalar(
        "SELECT data FROM matches_cache WHERE match_id = ?"
    )
        .bind(match_id)
        .fetch_one(pool.as_ref())
        .await
        .map_err(|e| {
            state.logger.error(&format!("[undo_finished_match] Failed to get match data: {}", e));
            e.to_string()
        })?;

    let mut match_data: serde_json::Value = serde_json::from_str(&match_data_str)
        .map_err(|e| {
            state.logger.error(&format!("[undo_finished_match] Failed to parse match data: {}", e));
            e.to_string()
        })?;

    state.logger.info(&format!("[undo_finished_match] Current match data parsed successfully"));

    // Проверить что матч завершён
    let status = match_data.get("status").and_then(|s| s.as_str()).unwrap_or("");
    if status != "completed" {
        state.logger.error(&format!("[undo_finished_match] Match is not completed, status: {}", status));
        return Err("Можно отменять только завершённые матчи".to_string());
    }

    // 3. Сохранить winner_id и данные о продвижении для отката
    let winner_id = match_data.get("winner_id").and_then(|w| w.as_i64()).map(|w| w as i32);
    let current_round = match_data.get("round").and_then(|r| r.as_i64()).unwrap_or(1) as i32;
    let current_match_number = match_data.get("match_number").and_then(|n| n.as_i64()).unwrap_or(1) as i32;

    state.logger.info(&format!("[undo_finished_match] Match info - winner_id: {:?}, round: {}, match_number: {}",
        winner_id, current_round, current_match_number));

    // 4. Откатить данные матча (счёт, статус, winner, время)
    match_data["status"] = serde_json::json!("scheduled");
    match_data["score_participant1"] = serde_json::json!(0);
    match_data["score_participant2"] = serde_json::json!(0);
    match_data["warnings_participant1"] = serde_json::json!(0);
    match_data["warnings_participant2"] = serde_json::json!(0);
    match_data["winner_id"] = serde_json::json!(null);
    match_data["result_type"] = serde_json::json!(null);
    match_data["started_at"] = serde_json::json!(null);
    match_data["finished_at"] = serde_json::json!(null);
    match_data["duration_seconds"] = serde_json::json!(null);

    state.logger.info("[undo_finished_match] Match data reset to initial state");

    // 5. Обновить матч в БД
    let updated_data = serde_json::to_string(&match_data).map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?"
    )
        .bind(&updated_data)
        .bind(match_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| {
            state.logger.error(&format!("[undo_finished_match] Failed to update match in cache: {}", e));
            e.to_string()
        })?;

    state.logger.info("[undo_finished_match] Match updated in cache successfully");

    // 6. Откатить продвижение в следующий раунд (если был победитель)
    if let Some(_winner) = winner_id {
        let next_round = current_round + 1;
        let next_match_number = (current_match_number + 1) / 2;

        state.logger.info(&format!("[undo_finished_match] Reverting winner advancement - next_round: {}, next_match_number: {}",
            next_round, next_match_number));

        // Найти следующий матч
        let next_match: Option<(i32, String)> = sqlx::query_as(
            "SELECT match_id, data FROM matches_cache
             WHERE bracket_id = ? AND round = ? AND match_number = ?"
        )
            .bind(bracket_id)
            .bind(next_round)
            .bind(next_match_number)
            .fetch_optional(pool.as_ref())
            .await
            .map_err(|e| {
                state.logger.error(&format!("[undo_finished_match] Failed to find next match: {}", e));
                e.to_string()
            })?;

        if let Some((next_match_id, next_match_data_str)) = next_match {
            state.logger.info(&format!("[undo_finished_match] Found next match: {}", next_match_id));

            let mut next_match_data: serde_json::Value = serde_json::from_str(&next_match_data_str)
                .map_err(|e| e.to_string())?;

            // Определить какой слот занял победитель (нечётные номера → participant1, чётные → participant2)
            let target_slot = if current_match_number % 2 == 1 { "participant1" } else { "participant2" };

            state.logger.info(&format!("[undo_finished_match] Removing winner from slot: {}", target_slot));

            // Проверить формат данных (NEW или OLD)
            if next_match_data.get(target_slot).and_then(|p| p.as_object()).is_some() {
                // NEW format - объект участника
                next_match_data[target_slot] = serde_json::json!(null);
            } else {
                // OLD format - отдельные поля
                let id_field = format!("{}_id", target_slot);
                let name_field = format!("{}_name", target_slot);
                let club_field = format!("{}_club", target_slot);

                next_match_data[id_field] = serde_json::json!(null);
                next_match_data[name_field] = serde_json::json!(null);
                next_match_data[club_field] = serde_json::json!(null);
            }

            // Обновить следующий матч
            let updated_next_data = serde_json::to_string(&next_match_data).map_err(|e| e.to_string())?;

            sqlx::query(
                "UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?"
            )
                .bind(&updated_next_data)
                .bind(next_match_id)
                .execute(pool.as_ref())
                .await
                .map_err(|e| {
                    state.logger.error(&format!("[undo_finished_match] Failed to update next match: {}", e));
                    e.to_string()
                })?;

            state.logger.info(&format!("[undo_finished_match] Winner removed from next match {} successfully", next_match_id));
        } else {
            state.logger.info("[undo_finished_match] No next match found (possibly final match)");
        }
    }

    // 7. Очистить историю событий матча
    sqlx::query(
        "DELETE FROM match_events WHERE match_id = ?"
    )
        .bind(match_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| {
            state.logger.error(&format!("[undo_finished_match] Failed to delete match events: {}", e));
            e.to_string()
        })?;

    state.logger.info("[undo_finished_match] Match events cleared successfully");

    // 8. Добавить в очередь синхронизации
    let sync_data = serde_json::json!({
        "match_id": match_id,
        "action": "undo",
        "timestamp": Utc::now().to_rfc3339(),
    });

    sqlx::query(
        "INSERT INTO sync_queue (match_id, data, synced, created_at)
         VALUES (?, ?, 0, datetime('now'))"
    )
        .bind(match_id)
        .bind(sync_data.to_string())
        .execute(pool.as_ref())
        .await
        .map_err(|e| {
            state.logger.error(&format!("[undo_finished_match] Failed to add to sync queue: {}", e));
            e.to_string()
        })?;

    state.logger.info("[undo_finished_match] Added to sync queue");

    // 9. Пересчитать статус сетки
    update_bracket_status(bracket_id, pool).await?;

    state.logger.info(&format!("[undo_finished_match] SUCCESS - match {} has been reverted", match_id));

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
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<i32, String> {
    state.logger.info("========== CREATE_TEMP_PARTICIPANT START ==========");
    state.logger.info(&format!("bracket_id: {}", bracket_id));
    state.logger.info(&format!("full_name: {}", full_name));
    state.logger.info(&format!("club_name: {:?}", club_name));
    state.logger.info(&format!("server_url: {:?}", server_url));

    let pool = &state.db_pool;

    // Генерировать уникальный отрицательный ID
    // Используем микросекунды для большей уникальности, берём только младшие 31 бит
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_micros() as i64;
    let mut temp_id = -((timestamp & 0x7FFFFFFF) as i32);

    // Если ID уже существует, добавляем к нему случайное смещение и проверяем снова
    let mut attempts = 0;
    let final_temp_id = loop {
        let check_exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM temp_participants WHERE temp_id = ?"
        )
        .bind(temp_id)
        .fetch_one(&**pool)
        .await
        .map_err(|e| e.to_string())?;

        if check_exists == 0 {
            break temp_id;
        }

        // ID уже существует, генерируем новый с случайным смещением
        attempts += 1;
        if attempts > 100 {
            // Защита от бесконечного цикла
            return Err(format!("Не удалось сгенерировать уникальный temp_id после 100 попыток"));
        }

        let offset = (rand::random::<u32>() % 10000) as i32;
        temp_id = temp_id - offset - 1; // -1 чтобы гарантировать изменение
        state.logger.info(&format!("temp_id уже существует, попытка {}: новый ID = {}", attempts, temp_id));
        // Продолжаем цикл для проверки нового temp_id
    };

    state.logger.info(&format!("Generated final_temp_id: {} (attempts: {})", final_temp_id, attempts));

    // Если указан server_url, отправить данные на локальный сервер админа
    if let Some(url) = server_url.filter(|s| !s.is_empty()) {
        state.logger.info(&format!("Sending to local server: {}", url));

        // Получаем токен для авторизации
        let token = state.api_client.get_token().await
            .map_err(|e| format!("Ошибка получения токена: {}", e))?
            .ok_or_else(|| "Токен не найден (требуется авторизация)".to_string())?;

        // Нормализовать URL
        let base_url = url.trim_end_matches('/').trim_end_matches("/api/v1");
        let api_url = format!("{}/api/v1/desktop/temp-participants", base_url);

        state.logger.info(&format!("Full API URL: {}", api_url));

        let client = reqwest::Client::new();
        let response = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({
                "temp_id": final_temp_id,
                "bracket_id": bracket_id,
                "full_name": full_name,
                "club_name": club_name,
            }))
            .send()
            .await
            .map_err(|e| format!("Ошибка HTTP запроса: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            println!("[create_temp_participant] HTTP error: {} - {}", status, error_text);
            return Err(format!("Ошибка сервера: {} - {}", status, error_text));
        }

        println!("[create_temp_participant] Успешно отправлено на сервер админа");

        // Также сохранить в локальную БД судьи (write-through cache)
        println!("[create_temp_participant] Сохранение в локальный кэш судьи");
    }

    println!("[create_temp_participant] Creating temp participant with ID: {}, name: {}", final_temp_id, full_name);

    // Сохранить в таблицу temp_participants
    // Используем INSERT OR REPLACE чтобы избежать конфликтов при повторном создании
    sqlx::query(
        "INSERT OR REPLACE INTO temp_participants (temp_id, full_name, club_name, bracket_id, synced)
         VALUES (?, ?, ?, ?, 0)"
    )
    .bind(final_temp_id)
    .bind(&full_name)
    .bind(&club_name)
    .bind(bracket_id)
    .execute(&**pool)
    .await
    .map_err(|e| e.to_string())?;

    println!("[create_temp_participant] Temp participant created successfully");

    Ok(final_temp_id)
}

#[tauri::command]
async fn update_bracket_participant(
    request: ParticipantEditRequest,
    judge_name: Option<String>,
    admin_id: Option<i32>,
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[update_bracket_participant] START - bracket_id={}, match_id={}, slot={}, server_url={:?}",
        request.bracket_id, request.match_id, request.participant_slot, server_url);

    let pool = &state.db_pool;

    // Проверка прав доступа: должен быть либо судья, либо админ
    if judge_name.is_none() && admin_id.is_none() {
        return Err("Требуется авторизация".to_string());
    }

    // Если указан server_url, отправить данные на локальный сервер админа
    if let Some(url) = server_url.filter(|s| !s.is_empty()) {
        println!("[update_bracket_participant] Отправка на локальный сервер: {}", url);

        // Получаем токен для авторизации
        let token = state.api_client.get_token().await
            .map_err(|e| format!("Ошибка получения токена: {}", e))?
            .ok_or_else(|| "Токен не найден (требуется авторизация)".to_string())?;

        // Нормализовать URL (убрать /api/v1 если есть)
        let base_url = url.trim_end_matches('/').trim_end_matches("/api/v1");
        let api_url = format!("{}/api/v1/desktop/matches/participant", base_url);

        println!("[update_bracket_participant] Full API URL: {}", api_url);

        let client = reqwest::Client::new();
        let response = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({
                "bracket_id": request.bracket_id,
                "match_id": request.match_id,
                "participant_slot": request.participant_slot,
                "fighter_id": request.fighter_id,
                "fighter_name": request.fighter_name,
                "club_name": request.club_name,
                "weight": request.weight,
                "operation_type": request.operation_type,
                "judge_name": judge_name,
                "admin_id": admin_id,
            }))
            .send()
            .await
            .map_err(|e| format!("Ошибка HTTP запроса: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            println!("[update_bracket_participant] HTTP error: {} - {}", status, error_text);
            return Err(format!("Ошибка сервера: {} - {}", status, error_text));
        }

        println!("[update_bracket_participant] Успешно отправлено на сервер админа");

        // ВАЖНО: Данные обновлены на сервере админа, локальный кэш судьи НЕ обновляем
        // Судья получит актуальные данные при следующем запросе getBracketMatches
        println!("[update_bracket_participant] Операция завершена успешно (локальный сервер)");

        // Записать изменение в таблицу редактирований для истории
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
        .bind(&judge_name)
        .bind(admin_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

        return Ok(()); // Выходим здесь, не обновляя локальный кэш
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
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.logger.info("========== SWAP_BRACKET_PARTICIPANTS START ==========");
    state.logger.info(&format!("bracket_id: {}", request.bracket_id));
    state.logger.info(&format!("match1_id: {}, match1_slot: {}", request.match1_id, request.match1_slot));
    state.logger.info(&format!("match2_id: {}, match2_slot: {}", request.match2_id, request.match2_slot));
    state.logger.info(&format!("judge_name: {:?}, admin_id: {:?}", judge_name, admin_id));
    state.logger.info(&format!("server_url: {:?}", server_url));

    let pool = &state.db_pool;

    // Проверка прав доступа
    if judge_name.is_none() && admin_id.is_none() {
        state.logger.error("Access denied: no judge_name or admin_id");
        return Err("Требуется авторизация".to_string());
    }

    // Если указан server_url, отправить данные на локальный сервер админа
    if let Some(url) = server_url.filter(|s| !s.is_empty()) {
        state.logger.info(&format!("Sending to local server: {}", url));

        // Получаем токен для авторизации
        let token = state.api_client.get_token().await
            .map_err(|e| format!("Ошибка получения токена: {}", e))?
            .ok_or_else(|| "Токен не найден (требуется авторизация)".to_string())?;

        // Нормализовать URL (убрать /api/v1 если есть)
        let base_url = url.trim_end_matches('/').trim_end_matches("/api/v1");
        let api_url = format!("{}/api/v1/desktop/matches/swap", base_url);

        state.logger.info(&format!("Full API URL: {}", api_url));

        let client = reqwest::Client::new();
        let response = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({
                "bracket_id": request.bracket_id,
                "match1_id": request.match1_id,
                "match1_slot": request.match1_slot,
                "match2_id": request.match2_id,
                "match2_slot": request.match2_slot,
                "judge_name": judge_name,
                "admin_id": admin_id,
            }))
            .send()
            .await
            .map_err(|e| format!("Ошибка HTTP запроса: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            println!("[swap_bracket_participants] HTTP error: {} - {}", status, error_text);
            return Err(format!("Ошибка сервера: {} - {}", status, error_text));
        }

        println!("[swap_bracket_participants] Успешно отправлено на сервер админа");

        // ВАЖНО: Данные обновлены на сервере админа, локальный кэш судьи НЕ обновляем
        // Судья получит актуальные данные при следующем запросе getBracketMatches
        println!("[swap_bracket_participants] Операция завершена успешно (локальный сервер)");

        // Записать изменение в таблицу редактирований для истории
        sqlx::query(
            "INSERT INTO bracket_participant_edits
            (bracket_id, match_id, participant_slot, operation_type, edited_by_judge, edited_by_admin)
            VALUES (?, ?, ?, 'swap', ?, ?), (?, ?, ?, 'swap', ?, ?)"
        )
        .bind(request.bracket_id)
        .bind(request.match1_id)
        .bind(&request.match1_slot)
        .bind(&judge_name)
        .bind(admin_id)
        .bind(request.bracket_id)
        .bind(request.match2_id)
        .bind(&request.match2_slot)
        .bind(&judge_name)
        .bind(admin_id)
        .execute(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

        return Ok(()); // Выходим здесь, не обновляя локальный кэш
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
// СОЗДАНИЕ ПУСТОЙ СЕТКИ
// ============================================

#[tauri::command]
async fn create_empty_bracket(
    tournament_id: i32,
    bracket_name: String,
    participant_count: i32,
    sport_id: i32,
    gender: String,
    characteristic_values: String,
    min_age: Option<i32>,
    max_age: Option<i32>,
    min_weight: Option<i32>,
    max_weight: Option<i32>,
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<i32, String> {
    state.logger.info("========== CREATE_EMPTY_BRACKET START ==========");
    state.logger.info(&format!("tournament_id: {}", tournament_id));
    state.logger.info(&format!("bracket_name: {}", bracket_name));
    state.logger.info(&format!("participant_count: {}", participant_count));
    state.logger.info(&format!("sport_id: {}", sport_id));
    state.logger.info(&format!("gender: {}", gender));
    state.logger.info(&format!("characteristic_values: {}", characteristic_values));
    state.logger.info(&format!("server_url: {:?}", server_url));

    // Валидация: participant_count должен быть степенью 2
    if participant_count < 2 || (participant_count & (participant_count - 1)) != 0 {
        return Err("Количество участников должно быть степенью 2 (2, 4, 8, 16, 32, 64)".to_string());
    }

    // Если передан server_url, отправляем запрос на локальный сервер
    if let Some(ref url) = server_url {
        if !url.is_empty() {
            state.logger.info("Creating bracket on local server...");

            let token = state.api_client.get_token().await.map_err(|e| e.to_string())?
                .ok_or_else(|| "Не авторизован".to_string())?;

            let request_body = serde_json::json!({
                "tournament_id": tournament_id,
                "bracket_name": bracket_name,
                "participant_count": participant_count,
                "sport_id": sport_id,
                "gender": gender,
                "characteristic_values": characteristic_values,
                "min_age": min_age,
                "max_age": max_age,
                "min_weight": min_weight,
                "max_weight": max_weight,
            });

            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/api/v1/desktop/brackets/create", url))
                .bearer_auth(&token)
                .json(&request_body)
                .send()
                .await
                .map_err(|e| format!("HTTP request failed: {}", e))?;

            if response.status().is_success() {
                let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
                let bracket_id = result["bracket_id"].as_i64()
                    .ok_or_else(|| "Invalid response format".to_string())? as i32;

                state.logger.info(&format!("Bracket created on server with ID: {}", bracket_id));
                state.logger.info("========== CREATE_EMPTY_BRACKET END ==========");
                return Ok(bracket_id);
            } else {
                let error = response.text().await.unwrap_or_default();
                state.logger.error(&format!("Server error: {}", error));
                return Err(format!("Ошибка сервера: {}", error));
            }
        }
    }

    // Offline режим - создаем локально
    state.logger.info("Creating bracket locally (offline mode)...");
    let pool = &state.db_pool;

    // Генерация уникального ID для сетки (отрицательный ID для локальных сеток)
    // Используем только младшие 31 бит timestamp для избежания переполнения i32
    let timestamp = Utc::now().timestamp_millis();
    let bracket_id = -((timestamp & 0x7FFFFFFF) as i32);

    // Создать JSON для bracket
    let bracket_data = serde_json::json!({
        "id": bracket_id,
        "category_id": null,
        "category_name": bracket_name,
        "bracket_type": "single_elimination",
        "total_rounds": (participant_count as f64).log2() as i32,
        "current_round": 1,
        "status": "not_started",
        "is_published": true,
        "sport_id": sport_id,
        "gender": gender,
        "min_age": min_age,
        "max_age": max_age,
        "min_weight": min_weight,
        "max_weight": max_weight,
    });

    // Сохранить сетку в brackets_cache
    sqlx::query(
        "INSERT INTO brackets_cache (bracket_id, tournament_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(bracket_id)
    .bind(tournament_id)
    .bind(serde_json::to_string(&bracket_data).unwrap())
    .execute(pool.as_ref())
    .await
    .map_err(|e| e.to_string())?;

    state.logger.info(&format!("Bracket created with ID: {}", bracket_id));

    // Генерация пустых матчей для турнирной сетки
    let total_rounds = (participant_count as f64).log2() as i32;
    let timestamp_for_matches = Utc::now().timestamp_millis();
    let mut match_id_counter = -((timestamp_for_matches & 0x7FFFFFFF) as i32);

    for round in 1..=total_rounds {
        let matches_in_round = participant_count / (2_i32.pow(round as u32));

        for match_num in 1..=matches_in_round {
            match_id_counter -= 1;

            let match_data = serde_json::json!({
                "id": match_id_counter,
                "bracket_id": bracket_id,
                "round_number": round,
                "match_number": match_num,
                "participant1": null,
                "participant2": null,
                "participant1_id": null,
                "participant2_id": null,
                "fighter1_name": null,
                "fighter2_name": null,
                "fighter1_club": null,
                "fighter2_club": null,
                "winner_id": null,
                "status": "scheduled",
                "score_participant1": 0,
                "score_participant2": 0,
                "warnings_participant1": 0,
                "warnings_participant2": 0,
                "result_type": null,
            });

            // Сохранить матч в matches_cache
            sqlx::query(
                "INSERT INTO matches_cache (match_id, bracket_id, data, updated_at, version)
                 VALUES (?, ?, ?, datetime('now'), 1)"
            )
            .bind(match_id_counter)
            .bind(bracket_id)
            .bind(serde_json::to_string(&match_data).unwrap())
            .execute(pool.as_ref())
            .await
            .map_err(|e| e.to_string())?;
        }

        state.logger.info(&format!("Round {} created with {} matches", round, matches_in_round));
    }

    state.logger.info("========== CREATE_EMPTY_BRACKET END ==========");
    Ok(bracket_id)
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
// СЛЕДУЮЩИЙ МАТЧ
// ============================================

/// Получить следующий незавершенный матч в сетке после текущего матча
/// Возвращает None если следующий матч не найден или участники еще не определены
#[tauri::command]
async fn get_next_match_in_bracket(
    bracket_id: i32,
    current_match_id: i32,
    server_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    state.logger.info(&format!(
        "[get_next_match_in_bracket] bracket_id={}, current_match_id={}",
        bracket_id, current_match_id
    ));

    // Получаем все матчи сетки
    let matches = if let Some(url) = server_url.filter(|s| !s.is_empty()) {
        // Загружаем с локального сервера
        let api_client = ApiClient::new(url.clone(), Arc::clone(&state.db_pool), Arc::clone(&state.logger));
        api_client.get_bracket_matches(bracket_id).await
            .map_err(|e| e.to_string())?
    } else {
        // Загружаем из кэша или основного сервера
        let pool = &state.db_pool;
        let cached_matches = sqlx::query(
            "SELECT match_id, data FROM matches_cache WHERE bracket_id = ? ORDER BY match_id"
        )
        .bind(bracket_id)
        .fetch_all(pool.as_ref())
        .await
        .map_err(|e| e.to_string())?;

        if !cached_matches.is_empty() {
            cached_matches
                .iter()
                .filter_map(|row| {
                    let data_str: String = sqlx::Row::get(row, "data");
                    serde_json::from_str(&data_str).ok()
                })
                .collect()
        } else {
            state.api_client.get_bracket_matches(bracket_id).await
                .map_err(|e| e.to_string())?
        }
    };

    // Находим текущий матч
    let current_match = matches.iter().find(|m| {
        m.get("id").and_then(|id| id.as_i64()) == Some(current_match_id as i64)
    });

    if current_match.is_none() {
        state.logger.warn("[get_next_match_in_bracket] Current match not found");
        return Ok(None);
    }

    let current_match = current_match.unwrap();
    let current_round = current_match.get("round_number")
        .and_then(|r| r.as_i64())
        .unwrap_or(0) as i32;
    let current_match_number = current_match.get("match_number")
        .and_then(|m| m.as_i64())
        .unwrap_or(0) as i32;

    state.logger.info(&format!(
        "[get_next_match_in_bracket] Current match: round={}, match_number={}",
        current_round, current_match_number
    ));

    // Ищем следующий незавершенный матч в той же сетке
    // Сортируем по раунду и номеру матча
    let next_match = matches.iter()
        .filter(|m| {
            let status = m.get("status").and_then(|s| s.as_str()).unwrap_or("");
            let round = m.get("round_number").and_then(|r| r.as_i64()).unwrap_or(0) as i32;
            let match_number = m.get("match_number").and_then(|m| m.as_i64()).unwrap_or(0) as i32;
            let match_id = m.get("id").and_then(|id| id.as_i64()).unwrap_or(0) as i32;

            // Следующий матч = не завершенный И (следующий раунд ИЛИ больший номер в том же раунде)
            match_id != current_match_id
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

    if let Some(ref next) = next_match {
        let next_id = next.get("id").and_then(|id| id.as_i64()).unwrap_or(0);
        let next_round = next.get("round_number").and_then(|r| r.as_i64()).unwrap_or(0);
        let next_match_num = next.get("match_number").and_then(|m| m.as_i64()).unwrap_or(0);

        state.logger.info(&format!(
            "[get_next_match_in_bracket] Found next match: id={}, round={}, match_number={}",
            next_id, next_round, next_match_num
        ));
    } else {
        state.logger.info("[get_next_match_in_bracket] No next match found");
    }

    Ok(next_match)
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
            // НОВОЕ: Поддержка SETKI_DATA_DIR для множественных профилей тестирования
            let app_data_dir = if let Ok(custom_dir) = std::env::var("SETKI_DATA_DIR") {
                // Используем кастомную директорию из переменной окружения
                let custom_path = std::path::PathBuf::from(custom_dir).join("data");
                println!("🔧 [PROFILE] Using custom data directory: {:?}", custom_path);
                custom_path
            } else {
                // Стандартная директория
                let home_dir = std::env::var("HOME")
                    .or_else(|_| std::env::var("USERPROFILE"))
                    .expect("Failed to get home directory");

                std::path::PathBuf::from(home_dir)
                    .join(".setki-keeper")
                    .join("data")
            };

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
            let logger_arc = Arc::new(file_logger.clone());
            let api_client = Arc::new(ApiClient::new(api_url, Arc::clone(&db_pool), Arc::clone(&logger_arc)));

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
            get_token,
            get_saved_credentials,
            get_saved_judge_credentials,
            clear_saved_credentials,
            login_admin,
            login_by_pin,
            release_table_number,
            force_release_table,
            clear_all_table_reservations,
            check_internet_connection,
            download_tournament,
            get_cached_brackets,
            get_cached_brackets_with_matches,
            is_tournament_downloaded,
            sync_changes,
            sync_to_local_server,
            get_tournaments,
            get_tournament_details,
            get_tournament_tables,
            start_local_server,
            stop_local_server,
            is_local_server_running,
            get_local_server_url,
            get_local_server_health,
            discover_local_servers,
            set_api_base_url,
            check_cached_pin,
            reserve_bracket,
            release_bracket,
            get_bracket_reservation,
            get_bracket_matches,
            get_next_match_in_bracket,
            clear_all_reservations,
            release_judge_brackets,
            get_active_judge_sessions,
            get_active_matches,
            get_bracket_table_assignments,
            get_my_bracket_assignments,
            start_match,
            update_match_score,
            record_match_event,
            get_match_events,
            batch_update_match,
            undo_last_event,
            finish_match,
            undo_finished_match,
            get_available_monitors,
            create_temp_participant,
            update_bracket_participant,
            swap_bracket_participants,
            get_bracket_edit_history,
            create_empty_bracket,
            clear_tournament_cache,
            cleanup_sync_queue,
            check_unsynced_count,
            log_to_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
