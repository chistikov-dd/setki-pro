use axum::{
    extract::{Path, State, WebSocketUpgrade, Request, Query},
    http::{StatusCode, HeaderMap},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
    middleware::{self, Next},
};
use axum::extract::ws::{WebSocket, Message};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, broadcast};
use std::collections::HashMap;
use tower_http::cors::CorsLayer;
use futures_util::{SinkExt, StreamExt};

// Тип для broadcast сообщений
type BroadcastTx = broadcast::Sender<String>;

// Rate Limiter для защиты от spam сообщений
struct RateLimiter {
    last_message: Instant,
    min_interval: Duration,
}

impl RateLimiter {
    fn new(min_interval_ms: u64) -> Self {
        Self {
            last_message: Instant::now() - Duration::from_secs(10),
            min_interval: Duration::from_millis(min_interval_ms),
        }
    }

    fn check(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.last_message) >= self.min_interval {
            self.last_message = now;
            true
        } else {
            false
        }
    }
}

// Shared state between handlers
#[derive(Clone)]
pub struct LocalServerState {
    pub db: Arc<SqlitePool>,
    // Broadcast каналы для каждого матча (match_id -> broadcast sender)
    pub match_channels: Arc<RwLock<HashMap<String, BroadcastTx>>>,
    // Broadcast канал для административных событий (подключения судей, отключения и т.д.)
    pub admin_events_channel: BroadcastTx,
    // Логгер для записи в файл
    pub logger: Arc<crate::logger::FileLogger>,
}

// Request/Response types
#[derive(Debug, Deserialize)]
pub struct LoginByPinRequest {
    pub pin_code: String,
    pub judge_name: Option<String>,
    pub table_number: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub user_id: i32,
    pub role: String,
    pub tournament_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct SyncMatchRequest {
    pub match_id: i32,
    pub data: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMatchScoreRequest {
    pub match_id: i32,
    pub red_score: i32,
    pub blue_score: i32,
    pub red_warnings: i32,
    pub blue_warnings: i32,
    pub status: String, // "scheduled", "in_progress", "completed", "cancelled"
    pub duration: Option<i32>, // Секунды
    pub winner_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMatchParticipantRequest {
    pub match_id: i32,
    pub participant_slot: u8, // 1 = participant1, 2 = participant2
    pub participant_id: Option<i32>,
    pub participant_name: Option<String>,
    pub club: Option<String>,
}

// Bracket editing requests
#[derive(Debug, Deserialize)]
pub struct SwapParticipantsRequest {
    pub bracket_id: i32,
    pub match1_id: i32,
    pub match1_slot: String,
    pub match2_id: i32,
    pub match2_slot: String,
    #[allow(dead_code)]
    pub judge_name: Option<String>,
    #[allow(dead_code)]
    pub admin_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTempParticipantRequest {
    pub temp_id: i32,
    pub bracket_id: i32,
    pub full_name: String,
    pub club_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReserveBracketRequest {
    pub bracket_id: i32,
    pub judge_name: String,
    pub user_id: i32,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseBracketRequest {
    pub bracket_id: i32,
    pub judge_name: String,
}

// Middleware для логирования всех входящих запросов
async fn logging_middleware(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req.headers().clone();

    println!("[LOCAL SERVER] ========== INCOMING REQUEST ==========");
    println!("[LOCAL SERVER] Method: {}", method);
    println!("[LOCAL SERVER] URI: {}", uri);
    println!("[LOCAL SERVER] Headers: {:?}", headers);

    let response = next.run(req).await;

    println!("[LOCAL SERVER] Response status: {}", response.status());
    println!("[LOCAL SERVER] ========== REQUEST COMPLETED ==========");

    response
}

// Auth middleware - проверяет наличие валидного PIN-кода или токена в заголовках
async fn auth_middleware(
    State(state): State<LocalServerState>,
    headers: HeaderMap,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let uri = req.uri().path();

    // Пропускаем публичные endpoints (auth, health)
    if uri.starts_with("/api/v1/auth/")
        || uri.starts_with("/api/v1/desktop/auth/")
        || uri == "/health" {
        return Ok(next.run(req).await);
    }

    // Проверяем заголовок Authorization
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    state.logger.info(&format!("[AUTH MIDDLEWARE] Request to: {}", uri));
    let auth_preview = if auth_header.is_empty() {
        "(empty)".to_string()
    } else {
        format!("{}...", &auth_header[..auth_header.len().min(20)])
    };
    state.logger.info(&format!("[AUTH MIDDLEWARE] Authorization header: {}", auth_preview));

    // Извлекаем токен (формат: "Bearer <token>" или просто "<token>")
    let token = if auth_header.starts_with("Bearer ") {
        &auth_header[7..]
    } else {
        auth_header
    };

    if token.is_empty() {
        state.logger.error(&format!("[AUTH MIDDLEWARE] Missing Authorization header for {}", uri));
        return Err(StatusCode::UNAUTHORIZED);
    }

    state.logger.info(&format!("[AUTH MIDDLEWARE] Extracted token: {}...", &token[..token.len().min(10)]));

    // ИСПРАВЛЕНО: Проверяем токен в БД (таблица auth для админа, judge_auth для судей)
    state.logger.info("[AUTH MIDDLEWARE] Checking token in database...");
    let is_valid = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM (
            SELECT token FROM auth WHERE token = ?
            UNION ALL
            SELECT token FROM judge_auth WHERE token = ?
         )"
    )
    .bind(token)
    .bind(token)
    .fetch_one(&*state.db)
    .await
    .unwrap_or(0);

    state.logger.info(&format!("[AUTH MIDDLEWARE] Token validation result: {}", if is_valid > 0 { "VALID" } else { "INVALID" }));

    if is_valid == 0 {
        state.logger.error(&format!("[AUTH MIDDLEWARE] Invalid token for {}", uri));
        return Err(StatusCode::UNAUTHORIZED);
    }

    state.logger.info(&format!("[AUTH MIDDLEWARE] Token valid, allowing request to {}", uri));

    println!("[AUTH] ✅ Авторизация успешна для {}", uri);

    // Добавляем токен в extensions для использования в handlers
    req.extensions_mut().insert(token.to_string());

    Ok(next.run(req).await)
}

// Start the local HTTP/WebSocket server
pub async fn start_server(
    db: Arc<SqlitePool>,
    port: u16,
    shutdown_rx: tokio::sync::oneshot::Receiver<()>,
    logger: Arc<crate::logger::FileLogger>,
) -> Result<(), anyhow::Error> {
    // Создаём broadcast канал для административных событий (capacity 100)
    let (admin_tx, _) = broadcast::channel::<String>(100);

    logger.info("========== LOCAL SERVER STARTING ==========");
    logger.info(&format!("Port: {}", port));

    let state = LocalServerState {
        db,
        match_channels: Arc::new(RwLock::new(HashMap::new())),
        admin_events_channel: admin_tx,
        logger: Arc::clone(&logger),
    };

    let app = Router::new()
        // Auth endpoints
        .route("/api/v1/auth/pin", post(login_by_pin_handler))
        .route("/api/v1/desktop/auth/pin-auth", post(login_by_pin_handler)) // Для совместимости с desktop клиентом

        // Desktop endpoints (compatible with existing API)
        .route("/api/v1/desktop/brackets/tournament/:id", get(get_tournament_brackets_handler))
        .route("/api/v1/desktop/brackets/:bracket_id/matches", get(get_bracket_matches_handler))
        .route("/api/v1/desktop/sync/matches", post(sync_matches_handler))
        .route("/api/v1/desktop/matches/update", post(update_match_score_handler))
        .route("/api/v1/desktop/matches/participant", post(update_match_participant_handler))

        // Bracket editing endpoints
        .route("/api/v1/desktop/matches/swap", post(swap_bracket_participants_handler))
        .route("/api/v1/desktop/temp-participants", post(create_temp_participant_handler))
        .route("/api/v1/desktop/bracket-assignments/:tournament_id", get(get_bracket_assignments_handler))
        .route("/api/v1/desktop/brackets/reserve", post(reserve_bracket_handler))
        .route("/api/v1/desktop/brackets/release", post(release_bracket_handler))

        // Применяем auth_middleware ко всем HTTP endpoints
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))

        // WebSocket endpoints (БЕЗ auth_middleware - у них своя проверка токена через query params)
        .route("/api/v1/ws/matches/:match_id", get(websocket_handler))
        .route("/api/v1/ws/admin/events", get(admin_websocket_handler))

        // Health check (публичный endpoint)
        .route("/health", get(health_handler))

        .layer(middleware::from_fn(logging_middleware))
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    println!("Local server listening on {}", addr);

    // Graceful shutdown: сервер слушает одновременно и входящие соединения, и shutdown signal
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            // Ждём сигнала shutdown
            let _ = shutdown_rx.await;
            println!("Local server received shutdown signal, stopping gracefully...");
        })
        .await?;

    println!("Local server stopped");

    Ok(())
}

// Health check endpoint with monitoring info
async fn health_handler(State(state): State<LocalServerState>) -> impl IntoResponse {
    let channels = state.match_channels.read().await;
    let active_matches = channels.len();
    let total_connections: usize = channels.values()
        .map(|tx| tx.receiver_count())
        .sum();

    Json(serde_json::json!({
        "status": "ok",
        "server": "SETKI Local Server",
        "version": "1.0.0",
        "uptime_seconds": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        "monitoring": {
            "active_matches": active_matches,
            "websocket_connections": total_connections,
        }
    }))
}

// Login by PIN handler
async fn login_by_pin_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<LoginByPinRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    println!("[LOCAL SERVER] ========== login_by_pin_handler START ==========");
    println!("[LOCAL SERVER] Received request:");
    println!("[LOCAL SERVER]   pin_code: {}", payload.pin_code);
    println!("[LOCAL SERVER]   judge_name: {:?}", payload.judge_name);
    println!("[LOCAL SERVER]   table_number: {:?}", payload.table_number);

    // Check if PIN exists in cached_pins table
    println!("[LOCAL SERVER] Querying cached_pins table...");
    let record = sqlx::query_as::<_, (i32, String)>(
        "SELECT tournament_id, tournament_name FROM cached_pins WHERE pin_code = ?"
    )
    .bind(&payload.pin_code)
    .fetch_optional(&*state.db)
    .await?;

    println!("[LOCAL SERVER] Database query completed");

    match record {
        Some((tournament_id, tournament_name)) => {
            state.logger.info("PIN FOUND in database!");
            state.logger.info(&format!("  tournament_id: {}", tournament_id));
            state.logger.info(&format!("  tournament_name: {}", tournament_name));

            // Generate a simple token (in local mode, security is less critical)
            let token = format!("local_token_{}", uuid::Uuid::new_v4());
            state.logger.info(&format!("Generated token: {}", token));

            // КРИТИЧЕСКИ ВАЖНО: Сохранить токен в БД админа для auth middleware
            state.logger.info("Saving judge token to database...");
            let judge_name = payload.judge_name.clone().unwrap_or_else(|| "Unknown".to_string());
            let table_number = payload.table_number.unwrap_or(0);

            sqlx::query(
                "INSERT OR REPLACE INTO judge_auth (pin_code, token, judge_name, table_number, tournament_id, created_at)
                 VALUES (?, ?, ?, ?, ?, datetime('now'))"
            )
            .bind(&payload.pin_code)
            .bind(&token)
            .bind(&judge_name)
            .bind(table_number)
            .bind(tournament_id)
            .execute(&*state.db)
            .await?;

            state.logger.info("Token saved to judge_auth table");

            // Если переданы имя и номер стола - отправляем событие админу
            if payload.judge_name.is_some() && payload.table_number.is_some() {
                let event = serde_json::json!({
                    "type": "judge_connected",
                    "tournament_id": tournament_id,
                    "judge_name": payload.judge_name,
                    "table_number": payload.table_number,
                    "user_id": 0, // Временный ID для offline судьи
                    "timestamp": chrono::Utc::now().to_rfc3339()
                });

                // Broadcast событие всем подключенным админам (игнорируем ошибки если нет слушателей)
                let _ = state.admin_events_channel.send(event.to_string());
                state.logger.info(&format!("Admin event sent: Judge {} connected at table {}",
                    payload.judge_name.as_ref().unwrap(),
                    payload.table_number.unwrap()));
            }

            state.logger.info("Returning SUCCESS response");
            state.logger.info("========== login_by_pin_handler SUCCESS ==========");
            Ok(Json(AuthResponse {
                access_token: token,
                user_id: 0, // Временный ID для offline судьи
                role: "referee".to_string(),
                tournament_id: Some(tournament_id),
            }))
        }
        None => {
            println!("[LOCAL SERVER] PIN NOT FOUND in database!");
            println!("[LOCAL SERVER] ========== login_by_pin_handler FAILED ==========");
            Err(AppError::Unauthorized("Invalid PIN code".to_string()))
        }
    }
}

// Get bracket matches handler (отдельный endpoint для получения матчей конкретной сетки)
async fn get_bracket_matches_handler(
    State(state): State<LocalServerState>,
    Path(bracket_id): Path<i32>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    println!("[LOCAL SERVER] ========== get_bracket_matches_handler START ==========");
    println!("[LOCAL SERVER] Bracket ID: {}", bracket_id);

    // Получить матчи для этой сетки
    let match_records = sqlx::query_as::<_, (String,)>(
        "SELECT data FROM matches_cache WHERE bracket_id = ?"
    )
    .bind(bracket_id)
    .fetch_all(&*state.db)
    .await?;

    println!("[LOCAL SERVER] Found {} matches for bracket {}", match_records.len(), bracket_id);

    // Парсить матчи в JSON
    let matches: Vec<serde_json::Value> = match_records
        .into_iter()
        .filter_map(|(data,)| serde_json::from_str(&data).ok())
        .collect();

    println!("[LOCAL SERVER] Returning {} matches to client", matches.len());
    println!("[LOCAL SERVER] ========== get_bracket_matches_handler END ==========");
    Ok(Json(matches))
}

// Get tournament brackets handler
async fn get_tournament_brackets_handler(
    State(state): State<LocalServerState>,
    Path(tournament_id): Path<i32>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    state.logger.info("========== get_tournament_brackets_handler START ==========");
    state.logger.info(&format!("Tournament ID: {}", tournament_id));

    // 1. Получить сетки
    state.logger.info("Querying brackets_cache table...");
    let bracket_records = sqlx::query_as::<_, (i32, String)>(
        "SELECT bracket_id, data FROM brackets_cache WHERE tournament_id = ?"
    )
    .bind(tournament_id)
    .fetch_all(&*state.db)
    .await?;

    state.logger.info(&format!("Found {} bracket records in cache", bracket_records.len()));

    // 2. Для каждой сетки получить матчи и добавить их
    let mut brackets_with_matches: Vec<serde_json::Value> = Vec::new();

    for (bracket_id, bracket_data) in bracket_records {
        match serde_json::from_str::<serde_json::Value>(&bracket_data) {
            Ok(mut bracket_json) => {
                state.logger.info(&format!("Processing bracket_id: {}", bracket_id));

                // Получить матчи для этой сетки
                let match_records = sqlx::query_as::<_, (String,)>(
                    "SELECT data FROM matches_cache WHERE bracket_id = ?"
                )
                .bind(bracket_id)
                .fetch_all(&*state.db)
                .await
                .unwrap_or_default();

                state.logger.info(&format!("Found {} matches for bracket {}", match_records.len(), bracket_id));

                // Парсить матчи в JSON
                let matches: Vec<serde_json::Value> = match_records
                    .into_iter()
                    .filter_map(|(data,)| serde_json::from_str(&data).ok())
                    .collect();

                // Добавить матчи в сетку
                if let Some(obj) = bracket_json.as_object_mut() {
                    obj.insert("matches".to_string(), serde_json::json!(matches));
                    state.logger.info(&format!("Added {} matches to bracket {}", matches.len(), bracket_id));
                }

                brackets_with_matches.push(bracket_json);
            }
            Err(e) => {
                state.logger.error(&format!("Failed to parse bracket JSON: {}", e));
            }
        }
    }

    state.logger.info(&format!("Returning {} brackets with matches to client", brackets_with_matches.len()));
    state.logger.info("========== get_tournament_brackets_handler SUCCESS ==========");
    Ok(Json(brackets_with_matches))
}

// Sync matches handler
async fn sync_matches_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<SyncMatchRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Update match in matches_cache
    sqlx::query(
        "INSERT OR REPLACE INTO matches_cache (match_id, bracket_id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(payload.match_id)
    .bind(payload.data.get("bracket_id").and_then(|v| v.as_i64()).unwrap_or(0))
    .bind(payload.data.to_string())
    .execute(&*state.db)
    .await?;

    // Broadcast update to all WebSocket clients for this match
    let channels = state.match_channels.read().await;
    if let Some(tx) = channels.get(&payload.match_id.to_string()) {
        // Создаём сообщение для broadcast
        let ws_message = serde_json::json!({
            "type": "sync_update",
            "match_id": payload.match_id,
            "data": payload.data,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });

        // Отправляем всем подключенным клиентам (игнорируем ошибки если нет слушателей)
        let _ = tx.send(ws_message.to_string());
    }

    Ok(Json(serde_json::json!({
        "status": "synced",
        "match_id": payload.match_id
    })))
}

// Update match score handler (real-time updates)
async fn update_match_score_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<UpdateMatchScoreRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // 1. Получить текущие данные матча и версию из БД (optimistic locking)
    let current_data: Option<(String, i64)> = sqlx::query_as(
        "SELECT data, version FROM matches_cache WHERE match_id = ?"
    )
    .bind(payload.match_id)
    .fetch_optional(&*state.db)
    .await?;

    let (mut match_data, version) = if let Some((data_str, ver)) = current_data {
        (serde_json::from_str(&data_str).unwrap_or(serde_json::json!({})), ver)
    } else {
        // Матч не найден - это ошибка, так как админ должен был скачать турнир
        println!("[LOCAL SERVER] ERROR: Match {} not found in cache", payload.match_id);
        return Err(AppError::BadRequest(format!("Match {} not found", payload.match_id)));
    };

    // 2. Обновить поля
    match_data["red_score"] = serde_json::json!(payload.red_score);
    match_data["blue_score"] = serde_json::json!(payload.blue_score);
    match_data["red_warnings"] = serde_json::json!(payload.red_warnings);
    match_data["blue_warnings"] = serde_json::json!(payload.blue_warnings);
    match_data["status"] = serde_json::json!(payload.status);

    if let Some(duration) = payload.duration {
        match_data["duration"] = serde_json::json!(duration);
    }

    if let Some(winner_id) = payload.winner_id {
        match_data["winner_id"] = serde_json::json!(winner_id);
    }

    // 3. Сохранить в БД с optimistic locking (обновить только если version совпадает)
    let _bracket_id = match_data.get("bracket_id").and_then(|v| v.as_i64()).unwrap_or(0);
    let rows_affected = sqlx::query(
        "UPDATE matches_cache
         SET data = ?, version = version + 1, updated_at = datetime('now')
         WHERE match_id = ? AND version = ?"
    )
    .bind(match_data.to_string())
    .bind(payload.match_id)
    .bind(version)
    .execute(&*state.db)
    .await?
    .rows_affected();

    // Если rows_affected = 0, значит версия изменилась (конкурентное обновление)
    if rows_affected == 0 {
        println!("[LOCAL SERVER] WARNING: Optimistic lock failed for match_id={}, version={}", payload.match_id, version);
        return Err(AppError::Conflict("Match was updated by another judge, please retry".to_string()));
    }

    // 4. Broadcast через WebSocket всем подключенным судьям
    let channels = state.match_channels.read().await;
    if let Some(tx) = channels.get(&payload.match_id.to_string()) {
        let ws_message = serde_json::json!({
            "type": "score_update",
            "match_id": payload.match_id,
            "red_score": payload.red_score,
            "blue_score": payload.blue_score,
            "red_warnings": payload.red_warnings,
            "blue_warnings": payload.blue_warnings,
            "status": payload.status,
            "duration": payload.duration,
            "winner_id": payload.winner_id,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });

        let _ = tx.send(ws_message.to_string());
    }

    Ok(Json(serde_json::json!({
        "status": "updated",
        "match_id": payload.match_id,
        "red_score": payload.red_score,
        "blue_score": payload.blue_score
    })))
}

// Update match participant handler (for winner advancement)
async fn update_match_participant_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<UpdateMatchParticipantRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== update_match_participant_handler START ==========");
    println!("[LOCAL SERVER] match_id: {}, slot: {}, participant_id: {:?}, name: {:?}",
        payload.match_id, payload.participant_slot, payload.participant_id, payload.participant_name);

    // 1. Получить текущие данные матча и версию (optimistic locking)
    let current_data: Option<(String, i64)> = sqlx::query_as(
        "SELECT data, version FROM matches_cache WHERE match_id = ?"
    )
    .bind(payload.match_id)
    .fetch_optional(&*state.db)
    .await?;

    // 2. Обновить данные участника
    let (mut match_data, version) = if let Some((data_str, ver)) = current_data {
        (serde_json::from_str(&data_str).unwrap_or(serde_json::json!({})), ver)
    } else {
        println!("[LOCAL SERVER] ERROR: Match {} not found in cache", payload.match_id);
        return Err(AppError::BadRequest(format!("Match {} not found", payload.match_id)));
    };

    // Обновить поля участника в зависимости от slot
    if payload.participant_slot == 1 {
        if let Some(id) = payload.participant_id {
            match_data["participant1_id"] = serde_json::json!(id);
        }
        if let Some(name) = &payload.participant_name {
            match_data["fighter1_name"] = serde_json::json!(name);
        }
        if let Some(club) = &payload.club {
            match_data["participant1_club"] = serde_json::json!(club);
        }
        println!("[LOCAL SERVER] Updated participant1: id={:?}, name={:?}",
            payload.participant_id, payload.participant_name);
    } else if payload.participant_slot == 2 {
        if let Some(id) = payload.participant_id {
            match_data["participant2_id"] = serde_json::json!(id);
        }
        if let Some(name) = &payload.participant_name {
            match_data["fighter2_name"] = serde_json::json!(name);
        }
        if let Some(club) = &payload.club {
            match_data["participant2_club"] = serde_json::json!(club);
        }
        println!("[LOCAL SERVER] Updated participant2: id={:?}, name={:?}",
            payload.participant_id, payload.participant_name);
    } else {
        println!("[LOCAL SERVER] ERROR: Invalid participant_slot: {}", payload.participant_slot);
        return Err(AppError::BadRequest("Invalid participant_slot (must be 1 or 2)".to_string()));
    }

    // 3. Сохранить в БД с optimistic locking
    let _bracket_id = match_data.get("bracket_id").and_then(|v| v.as_i64()).unwrap_or(0);
    let rows_affected = sqlx::query(
        "UPDATE matches_cache
         SET data = ?, version = version + 1, updated_at = datetime('now')
         WHERE match_id = ? AND version = ?"
    )
    .bind(match_data.to_string())
    .bind(payload.match_id)
    .bind(version)
    .execute(&*state.db)
    .await?
    .rows_affected();

    // Если rows_affected = 0, значит версия изменилась (конкурентное обновление)
    if rows_affected == 0 {
        println!("[LOCAL SERVER] WARNING: Optimistic lock failed for match_id={}, version={}", payload.match_id, version);
        return Err(AppError::Conflict("Match was updated by another judge, please retry".to_string()));
    }

    println!("[LOCAL SERVER] Participant data saved to matches_cache (version incremented)");

    // 4. Broadcast через WebSocket
    let channels = state.match_channels.read().await;
    if let Some(tx) = channels.get(&payload.match_id.to_string()) {
        let ws_message = serde_json::json!({
            "type": "participant_update",
            "match_id": payload.match_id,
            "participant_slot": payload.participant_slot,
            "participant_id": payload.participant_id,
            "participant_name": payload.participant_name,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });

        let _ = tx.send(ws_message.to_string());
        println!("[LOCAL SERVER] Broadcast participant update to WebSocket subscribers");
    }

    println!("[LOCAL SERVER] ========== update_match_participant_handler SUCCESS ==========");
    Ok(Json(serde_json::json!({
        "status": "updated",
        "match_id": payload.match_id,
        "participant_slot": payload.participant_slot
    })))
}

// Bracket editing handlers
async fn swap_bracket_participants_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<SwapParticipantsRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== swap_bracket_participants_handler START ==========");
    println!("[LOCAL SERVER] bracket_id={}, match1_id={}, match1_slot={}, match2_id={}, match2_slot={}",
        payload.bracket_id, payload.match1_id, payload.match1_slot, payload.match2_id, payload.match2_slot);

    // НАЧАТЬ ТРАНЗАКЦИЮ для атомарности операций
    let mut tx = state.db.begin().await
        .map_err(|e| AppError::Internal(format!("Failed to start transaction: {}", e)))?;

    // Swap внутри одного матча
    if payload.match1_id == payload.match2_id {
        let match_data = sqlx::query("SELECT data FROM matches_cache WHERE match_id = ?")
            .bind(payload.match1_id)
            .fetch_one(&mut *tx)
            .await?;

        let data_str: String = sqlx::Row::get(&match_data, "data");
        let mut match_obj: serde_json::Value = serde_json::from_str(&data_str)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let slot1_value = match_obj.get(&payload.match1_slot).cloned().unwrap_or(serde_json::Value::Null);
        let slot2_value = match_obj.get(&payload.match2_slot).cloned().unwrap_or(serde_json::Value::Null);

        match_obj[&payload.match1_slot] = slot2_value;
        match_obj[&payload.match2_slot] = slot1_value;

        // Обновить legacy поля
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

        sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
            .bind(serde_json::to_string(&match_obj).unwrap())
            .bind(payload.match1_id)
            .execute(&mut *tx)
            .await?;

        // COMMIT транзакции
        tx.commit().await
            .map_err(|e| AppError::Internal(format!("Failed to commit transaction: {}", e)))?;

        println!("[LOCAL SERVER] ========== swap_bracket_participants_handler SUCCESS (same match) ==========");
        return Ok(Json(serde_json::json!({ "status": "ok" })));
    }

    // Swap между разными матчами
    let match1_data = sqlx::query("SELECT data FROM matches_cache WHERE match_id = ?")
        .bind(payload.match1_id)
        .fetch_one(&mut *tx)
        .await?;

    let match2_data = sqlx::query("SELECT data FROM matches_cache WHERE match_id = ?")
        .bind(payload.match2_id)
        .fetch_one(&mut *tx)
        .await?;

    let data1_str: String = sqlx::Row::get(&match1_data, "data");
    let data2_str: String = sqlx::Row::get(&match2_data, "data");

    let mut match1_obj: serde_json::Value = serde_json::from_str(&data1_str)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let mut match2_obj: serde_json::Value = serde_json::from_str(&data2_str)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Swap участников
    let slot1_value = match1_obj.get(&payload.match1_slot).cloned().unwrap_or(serde_json::Value::Null);
    let slot2_value = match2_obj.get(&payload.match2_slot).cloned().unwrap_or(serde_json::Value::Null);

    match1_obj[&payload.match1_slot] = slot2_value;
    match2_obj[&payload.match2_slot] = slot1_value;

    // Сохранить оба матча атомарно
    sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
        .bind(serde_json::to_string(&match1_obj).unwrap())
        .bind(payload.match1_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE matches_cache SET data = ?, updated_at = datetime('now') WHERE match_id = ?")
        .bind(serde_json::to_string(&match2_obj).unwrap())
        .bind(payload.match2_id)
        .execute(&mut *tx)
        .await?;

    // COMMIT транзакции (либо оба матча обновлены, либо ни один)
    tx.commit().await
        .map_err(|e| AppError::Internal(format!("Failed to commit transaction: {}", e)))?;

    println!("[LOCAL SERVER] ========== swap_bracket_participants_handler SUCCESS (different matches) ==========");
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn create_temp_participant_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<CreateTempParticipantRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== create_temp_participant_handler START ==========");
    println!("[LOCAL SERVER] temp_id={}, bracket_id={}, name={}",
        payload.temp_id, payload.bracket_id, payload.full_name);

    // Сохранить в таблицу temp_participants
    sqlx::query(
        "INSERT INTO temp_participants (temp_id, full_name, club_name, bracket_id, synced)
         VALUES (?, ?, ?, ?, 0)"
    )
    .bind(payload.temp_id)
    .bind(&payload.full_name)
    .bind(&payload.club_name)
    .bind(payload.bracket_id)
    .execute(&*state.db)
    .await?;

    println!("[LOCAL SERVER] ========== create_temp_participant_handler SUCCESS ==========");
    Ok(Json(serde_json::json!({ "status": "ok", "temp_id": payload.temp_id })))
}

// Reserve bracket handler - резервирование сетки судьей
async fn reserve_bracket_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<ReserveBracketRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== reserve_bracket_handler START ==========");
    println!("[LOCAL SERVER] bracket_id: {}, judge_name: {}, user_id: {}",
        payload.bracket_id, payload.judge_name, payload.user_id);

    // Проверить, что сетка свободна
    let existing = sqlx::query_as::<_, (String,)>(
        "SELECT judge_name FROM bracket_reservations WHERE bracket_id = ?"
    )
    .bind(payload.bracket_id)
    .fetch_optional(&*state.db)
    .await?;

    if let Some((existing_judge,)) = existing {
        if existing_judge != payload.judge_name {
            println!("[LOCAL SERVER] Сетка уже занята судьей: {}", existing_judge);
            return Err(AppError::Conflict(format!(
                "Сетка уже занята судьей: {}",
                existing_judge
            )));
        } else {
            println!("[LOCAL SERVER] Сетка уже зарезервирована текущим судьей");
            return Ok(Json(serde_json::json!({ "status": "ok", "message": "Already reserved" })));
        }
    }

    // Зарезервировать сетку
    sqlx::query(
        "INSERT INTO bracket_reservations (bracket_id, judge_name, user_id, reserved_at)
         VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(payload.bracket_id)
    .bind(&payload.judge_name)
    .bind(payload.user_id)
    .execute(&*state.db)
    .await?;

    // Получить номер стола судьи
    let table_number = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT tn.table_number FROM judge_sessions js
         INNER JOIN table_numbers tn ON js.judge_session_id = tn.judge_session_id
         WHERE js.judge_name = ?
         ORDER BY js.logged_in_at DESC
         LIMIT 1"
    )
    .bind(&payload.judge_name)
    .fetch_optional(&*state.db)
    .await?
    .flatten();

    // Broadcast событие "bracket_reserved" через admin_events_channel
    let event = serde_json::json!({
        "type": "bracket_reserved",
        "bracket_id": payload.bracket_id,
        "judge_name": payload.judge_name,
        "table_number": table_number,
        "user_id": payload.user_id,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    let _ = state.admin_events_channel.send(event.to_string());
    println!("[LOCAL SERVER] Broadcast event: bracket_reserved for bracket {} by {}",
        payload.bracket_id, payload.judge_name);

    println!("[LOCAL SERVER] ========== reserve_bracket_handler SUCCESS ==========");
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

// Release bracket handler - освобождение сетки
async fn release_bracket_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<ReleaseBracketRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== release_bracket_handler START ==========");
    println!("[LOCAL SERVER] bracket_id: {}, judge_name: {}",
        payload.bracket_id, payload.judge_name);

    // Получить номер стола перед удалением
    let table_number = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT tn.table_number FROM bracket_reservations br
         INNER JOIN judge_sessions js ON br.judge_name = js.judge_name
         INNER JOIN table_numbers tn ON js.judge_session_id = tn.judge_session_id
         WHERE br.bracket_id = ? AND br.judge_name = ?
         ORDER BY js.logged_in_at DESC
         LIMIT 1"
    )
    .bind(payload.bracket_id)
    .bind(&payload.judge_name)
    .fetch_optional(&*state.db)
    .await?
    .flatten();

    // Удалить резервирование
    let result = sqlx::query(
        "DELETE FROM bracket_reservations WHERE bracket_id = ? AND judge_name = ?"
    )
    .bind(payload.bracket_id)
    .bind(&payload.judge_name)
    .execute(&*state.db)
    .await?;

    if result.rows_affected() > 0 {
        // Broadcast событие "bracket_released" через admin_events_channel
        let event = serde_json::json!({
            "type": "bracket_released",
            "bracket_id": payload.bracket_id,
            "judge_name": payload.judge_name,
            "table_number": table_number,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });

        let _ = state.admin_events_channel.send(event.to_string());
        println!("[LOCAL SERVER] Broadcast event: bracket_released for bracket {} by {}",
            payload.bracket_id, payload.judge_name);

        println!("[LOCAL SERVER] ========== release_bracket_handler SUCCESS ==========");
        Ok(Json(serde_json::json!({ "status": "ok" })))
    } else {
        println!("[LOCAL SERVER] Резервирование не найдено");
        Ok(Json(serde_json::json!({ "status": "ok", "message": "Not reserved" })))
    }
}

// Bracket assignments handler - получить информацию о занятых столах
async fn get_bracket_assignments_handler(
    State(state): State<LocalServerState>,
    Path(tournament_id): Path<i32>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    println!("[LOCAL SERVER] ========== get_bracket_assignments_handler START ==========");
    println!("[LOCAL SERVER] Tournament ID: {}", tournament_id);

    // Получаем все резервирования с информацией о столах
    let assignments = sqlx::query_as::<_, (i32, i32, String)>(
        "SELECT
            br.bracket_id,
            tn.table_number,
            br.judge_name
         FROM bracket_reservations br
         INNER JOIN judge_sessions js ON br.judge_name = js.judge_name
         INNER JOIN table_numbers tn ON js.judge_session_id = tn.judge_session_id
         WHERE js.tournament_id = ?
         ORDER BY br.reserved_at DESC"
    )
    .bind(tournament_id)
    .fetch_all(&*state.db)
    .await?;

    let result: Vec<serde_json::Value> = assignments
        .into_iter()
        .map(|(bracket_id, table_number, judge_name)| {
            serde_json::json!({
                "bracket_id": bracket_id,
                "table_number": table_number,
                "judge_name": judge_name,
            })
        })
        .collect();

    println!("[LOCAL SERVER] Returning {} bracket assignments", result.len());
    println!("[LOCAL SERVER] ========== get_bracket_assignments_handler END ==========");
    Ok(Json(result))
}

// WebSocket query params
#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
    pin_code: Option<String>,
}

// WebSocket handler
async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<LocalServerState>,
    Path(match_id): Path<String>,
    Query(params): Query<WsQuery>,
) -> Response {
    // Проверка токена для авторизации
    let token = params.token.or(params.pin_code);

    if let Some(ref token_value) = token {
        // Проверяем токен в базе данных
        match sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM judge_auth WHERE token = ?"
        )
        .bind(token_value)
        .fetch_one(&*state.db)
        .await
        {
            Ok(count) if count > 0 => {
                println!("[WebSocket] Token valid for match {}", match_id);
                // Токен валиден - продолжаем
            }
            _ => {
                println!("[WebSocket] Invalid token for match {}", match_id);
                return (StatusCode::UNAUTHORIZED, "Invalid token").into_response();
            }
        }
    } else {
        println!("[WebSocket] No token provided for match {}", match_id);
        return (StatusCode::UNAUTHORIZED, "Token required").into_response();
    }

    ws.on_upgrade(move |socket| handle_socket(socket, state, match_id))
}

async fn handle_socket(socket: WebSocket, state: LocalServerState, match_id: String) {
    println!("[WebSocket] Client connected for match {}", match_id);

    // Получаем или создаём broadcast канал для этого матча
    let tx = {
        let mut channels = state.match_channels.write().await;
        channels
            .entry(match_id.clone())
            .or_insert_with(|| {
                println!("[WebSocket] Creating new broadcast channel for match {}", match_id);
                broadcast::channel::<String>(100).0
            })
            .clone()
    };

    // Подписываемся на broadcast канал
    let mut rx = tx.subscribe();

    // Разделяем WebSocket на sender и receiver
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Клонируем tx для использования в задаче чтения
    let broadcast_tx = tx.clone();
    let match_id_clone = match_id.clone();

    // Задача 1: Читаем из WebSocket и отправляем в broadcast
    let mut recv_task = tokio::spawn(async move {
        // Rate limiter: макс 10 сообщений в секунду (100ms между сообщениями)
        let mut rate_limiter = RateLimiter::new(100);

        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    // Проверка rate limit
                    if !rate_limiter.check() {
                        println!("[WebSocket] Rate limit exceeded for match {}, dropping message", match_id_clone);
                        continue;
                    }

                    println!("[WebSocket] Received message for match {}: {}", match_id_clone, text);

                    // Парсим сообщение и добавляем timestamp если его нет
                    if let Ok(mut json_msg) = serde_json::from_str::<serde_json::Value>(&text) {
                        if !json_msg.get("timestamp").is_some() {
                            json_msg["timestamp"] = serde_json::json!(chrono::Utc::now().to_rfc3339());
                        }

                        // Broadcast всем подключенным клиентам (включая отправителя)
                        let message_str = json_msg.to_string();
                        if let Err(e) = broadcast_tx.send(message_str) {
                            println!("[WebSocket] Failed to broadcast message: {}", e);
                        }
                    } else {
                        println!("[WebSocket] Failed to parse message as JSON");
                    }
                }
                Message::Close(_) => {
                    println!("[WebSocket] Client sent close message for match {}", match_id_clone);
                    break;
                }
                Message::Ping(_data) => {
                    // Axum автоматически отправляет Pong, но можем логировать
                    println!("[WebSocket] Received ping for match {}", match_id_clone);
                }
                _ => {
                    // Игнорируем другие типы сообщений (Pong, Binary)
                }
            }
        }
        println!("[WebSocket] Receive task ended for match {}", match_id_clone);
    });

    // Задача 2: Читаем из broadcast и отправляем в WebSocket
    let match_id_clone2 = match_id.clone();
    let (ping_tx, mut ping_rx) = tokio::sync::mpsc::channel::<Message>(10);

    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                // Получаем сообщения из broadcast канала
                Ok(msg) = rx.recv() => {
                    if let Err(e) = ws_sender.send(Message::Text(msg)).await {
                        println!("[WebSocket] Failed to send message to client: {}", e);
                        break;
                    }
                }
                // Получаем ping фреймы из ping_task
                Some(ping_msg) = ping_rx.recv() => {
                    if let Err(e) = ws_sender.send(ping_msg).await {
                        println!("[WebSocket] Failed to send ping to client: {}", e);
                        break;
                    }
                }
            }
        }
        println!("[WebSocket] Send task ended for match {}", match_id_clone2);
    });

    // Задача 3: Heartbeat пинги каждые 30 секунд
    let match_id_clone3 = match_id.clone();
    let mut ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
        interval.tick().await; // Пропускаем первый тик (он происходит сразу)

        loop {
            interval.tick().await;
            println!("[WebSocket] Sending heartbeat ping for match {}", match_id_clone3);

            // Отправляем ping через канал в send_task
            if let Err(e) = ping_tx.send(Message::Ping(vec![])).await {
                println!("[WebSocket] Failed to queue ping (client disconnected): {}", e);
                break;
            }
        }
        println!("[WebSocket] Ping task ended for match {}", match_id_clone3);
    });

    // Ждём завершения любой из задач (обычно это означает отключение)
    tokio::select! {
        _ = &mut recv_task => {
            // Прерываем остальные задачи
            send_task.abort();
            ping_task.abort();
        }
        _ = &mut send_task => {
            // Прерываем остальные задачи
            recv_task.abort();
            ping_task.abort();
        }
        _ = &mut ping_task => {
            // Прерываем остальные задачи
            recv_task.abort();
            send_task.abort();
        }
    }

    println!("[WebSocket] Client disconnected from match {}", match_id);

    // Проверяем количество подписчиков и удаляем канал если никого не осталось
    let subscribers_count = tx.receiver_count();
    if subscribers_count == 0 {
        let mut channels = state.match_channels.write().await;
        channels.remove(&match_id);
        println!("[WebSocket] Removed broadcast channel for match {} (no more subscribers)", match_id);
    } else {
        println!("[WebSocket] Match {} still has {} subscribers", match_id, subscribers_count);
    }
}

// Admin WebSocket handler для получения событий о подключении/отключении судей
async fn admin_websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<LocalServerState>,
    Query(params): Query<WsQuery>,
) -> Response {
    // Проверка токена для авторизации (аналогично websocket_handler)
    let token = params.token.or(params.pin_code);

    if let Some(ref token_value) = token {
        // Проверяем токен в базе данных
        match sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM judge_auth WHERE token = ?"
        )
        .bind(token_value)
        .fetch_one(&*state.db)
        .await
        {
            Ok(count) if count > 0 => {
                println!("[Admin WebSocket] Token valid, admin authorized");
            }
            _ => {
                println!("[Admin WebSocket] Invalid token");
                return (StatusCode::UNAUTHORIZED, "Invalid token").into_response();
            }
        }
    } else {
        println!("[Admin WebSocket] No token provided");
        return (StatusCode::UNAUTHORIZED, "Token required").into_response();
    }

    ws.on_upgrade(move |socket| handle_admin_socket(socket, state))
}

async fn handle_admin_socket(socket: WebSocket, state: LocalServerState) {
    println!("[Admin WebSocket] Admin connected to events stream");

    // Подписываемся на broadcast канал административных событий
    let mut rx = state.admin_events_channel.subscribe();

    // Разделяем WebSocket на sender и receiver
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Задача 1: Читаем из WebSocket (для ping/pong и close)
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Close(_) => {
                    println!("[Admin WebSocket] Admin sent close message");
                    break;
                }
                Message::Ping(_) => {
                    println!("[Admin WebSocket] Received ping");
                }
                _ => {
                    // Игнорируем остальные типы (Text, Binary, Pong)
                }
            }
        }
        println!("[Admin WebSocket] Receive task ended");
    });

    // Задача 2: Читаем из broadcast и отправляем в WebSocket
    let mut send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            // Отправляем событие админу
            if let Err(e) = ws_sender.send(Message::Text(event)).await {
                println!("[Admin WebSocket] Failed to send event to admin: {}", e);
                break;
            }
        }
        println!("[Admin WebSocket] Send task ended");
    });

    // Ждём завершения любой из задач (обычно это означает отключение)
    tokio::select! {
        _ = &mut recv_task => {
            send_task.abort();
        }
        _ = &mut send_task => {
            recv_task.abort();
        }
    }

    println!("[Admin WebSocket] Admin disconnected from events stream");
}

// Error handling
#[allow(dead_code)]
pub enum AppError {
    Database(sqlx::Error),
    Unauthorized(String),
    BadRequest(String),
    Conflict(String),
    Internal(String),
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::Database(err)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            AppError::Database(err) => {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", err))
            }
            AppError::Unauthorized(msg) => {
                (StatusCode::UNAUTHORIZED, msg)
            }
            AppError::BadRequest(msg) => {
                (StatusCode::BAD_REQUEST, msg)
            }
            AppError::Conflict(msg) => {
                (StatusCode::CONFLICT, msg)
            }
            AppError::Internal(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
        };

        let body = Json(serde_json::json!({
            "error": error_message
        }));

        (status, body).into_response()
    }
}
