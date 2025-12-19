mod api;
mod db;
mod local_server;

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
    // Shutdown channel для graceful остановки локального сервера
    local_server_shutdown_tx: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    // mDNS daemon для Service Discovery (используем std::sync::Mutex так как mdns-sd синхронный)
    mdns_daemon: Arc<StdMutex<Option<mdns_sd::ServiceDaemon>>>,
    mdns_service_fullname: Arc<StdMutex<Option<String>>>,
}

// Tauri Commands

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
    state: State<'_, AppState>,
) -> Result<AuthResponse, String> {
    let mut response = state.api_client
        .login_by_pin(
            pin_code.clone(),
            Some(judge_name.clone()),
            Some(table_number)
        )
        .await
        .map_err(|e| e.to_string())?;

    // Сохранить сессию судьи с именем и номером стола
    state.api_client
        .save_judge_session(&pin_code, &judge_name, table_number, response.tournament_id)
        .await
        .map_err(|e| e.to_string())?;

    // Добавить имя и номер стола в ответ
    response.judge_name = Some(judge_name);
    response.table_number = Some(table_number);

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
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    state.api_client
        .get_cached_brackets(tournament_id)
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

    if *is_running {
        return Err("Local server is already running".to_string());
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
    let local_ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());

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

    Ok(format!("http://{}:{}", local_ip, port))
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

    // 3. Даём серверу время на корректное завершение (1 секунда)
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

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

#[tauri::command]
async fn get_bracket_matches(
    bracket_id: i32,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    state.api_client
        .get_bracket_matches(bracket_id)
        .await
        .map_err(|e| e.to_string())
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

#[tauri::command]
async fn start_match(
    match_id: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.api_client
        .start_match(match_id)
        .await
        .map_err(|e| e.to_string())
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
    state.api_client
        .update_match_score(match_id, red_score, blue_score, red_warnings, blue_warnings, status)
        .await
        .map_err(|e| e.to_string())
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
    state.api_client
        .finish_match(match_id, winner_id, result_type, final_red_score, final_blue_score)
        .await
        .map_err(|e| e.to_string())
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

    // Трюк: подключаемся к публичному DNS, чтобы узнать свой локальный IP
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Получить путь к данным приложения
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data dir");

            // Убедиться что директория существует
            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data directory");

            // Инициализировать БД
            let pool = tauri::async_runtime::block_on(async {
                db::init_db(app_data_dir).await
                    .expect("Failed to initialize database")
            });

            // Создать API клиент
            let api_url = std::env::var("VITE_API_BASE_URL")
                .unwrap_or_else(|_| "https://setki.pro/api/v1".to_string());

            let db_pool = Arc::new(pool);
            let api_client = Arc::new(ApiClient::new(api_url, Arc::clone(&db_pool)));

            // Сохранить в state
            app.manage(AppState {
                api_client,
                db_pool,
                local_server_running: Arc::new(RwLock::new(false)),
                local_server_shutdown_tx: Arc::new(Mutex::new(None)),
                mdns_daemon: Arc::new(StdMutex::new(None)),
                mdns_service_fullname: Arc::new(StdMutex::new(None)),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login_admin,
            login_by_pin,
            release_table_number,
            download_tournament,
            get_cached_brackets,
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
            start_match,
            update_match_score,
            record_match_event,
            get_match_events,
            batch_update_match,
            undo_last_event,
            finish_match,
            get_available_monitors
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
