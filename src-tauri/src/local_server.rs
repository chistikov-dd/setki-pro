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
    // Директория с документами секретаря (~/.setki-keeper/data/docs)
    pub docs_base_dir: std::path::PathBuf,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judge_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_number: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct LogoutJudgeRequest {
    pub tournament_id: i32,
    pub table_number: i32,
    pub judge_name: String,
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
    pub result_type: Option<String>, // "points", "submission", "disqualification"
}

#[derive(Debug, Deserialize)]
pub struct UndoMatchRequest {
    pub match_id: i32,
}

// DEPRECATED: используется только старым handler
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct UpdateMatchParticipantRequest {
    pub match_id: i32,
    pub participant_slot: u8, // 1 = participant1, 2 = participant2
    pub participant_id: Option<i32>,
    pub participant_name: Option<String>,
    pub club: Option<String>,
}

// Вызов администратора
#[derive(Debug, Deserialize)]
pub struct CallAdminRequest {
    pub table_number: i32,
    pub judge_name: Option<String>,
    pub message: Option<String>,
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
    pub judge_name: Option<String>, // Для логирования (пока не используется)
    #[allow(dead_code)]
    pub admin_id: Option<i32>, // Для логирования (пока не используется)
}

#[derive(Debug, Deserialize)]
pub struct CreateTempParticipantRequest {
    pub temp_id: i32,
    pub bracket_id: i32,
    pub full_name: String,
    pub club_name: Option<String>,
}

// Request для редактирования участников судьями (добавление/удаление/обновление)
#[derive(Debug, Deserialize)]
pub struct UpdateBracketParticipantRequest {
    pub bracket_id: i32,
    pub match_id: i32,
    pub participant_slot: String, // "participant1" или "participant2"
    pub fighter_id: Option<i32>,
    pub fighter_name: Option<String>,
    pub club_name: Option<String>,
    #[allow(dead_code)]
    pub weight: Option<f64>, // Пока не используется, но может пригодиться в будущем
    pub operation_type: String, // "add", "update", "remove"
    #[allow(dead_code)]
    pub judge_name: Option<String>, // Для логирования (пока не используется)
    #[allow(dead_code)]
    pub admin_id: Option<i32>, // Для логирования (пока не используется)
}

#[derive(Debug, Deserialize)]
pub struct CreateEmptyBracketRequest {
    pub tournament_id: i32,
    pub bracket_name: String,
    pub participant_count: i32,
    pub sport_id: i32,
    pub gender: String,
    pub characteristic_values: String,
    pub min_age: Option<i32>,
    pub max_age: Option<i32>,
    pub min_weight: Option<i32>,
    pub max_weight: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct ReserveBracketRequest {
    pub bracket_id: i32,
    pub tournament_id: i32,
    pub judge_name: String,
    pub table_number: i32,
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

    // Пропускаем публичные endpoints (auth, health, websockets)
    if uri.starts_with("/api/v1/auth/")
        || uri.starts_with("/api/v1/desktop/auth/")
        || uri.starts_with("/api/v1/ws/")
        || uri.starts_with("/ws/")
        || uri == "/health" {
        return Ok(next.run(req).await);
    }

    // Проверяем заголовок Authorization
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    // Оптимизация: логирование только в debug режиме для производительности
    #[cfg(debug_assertions)]
    {
        state.logger.info(&format!("[AUTH MIDDLEWARE] Request to: {}", uri));
        let auth_preview = if auth_header.is_empty() {
            "(empty)"
        } else {
            &auth_header[..auth_header.len().min(20)]
        };
        state.logger.info(&format!("[AUTH MIDDLEWARE] Authorization header: {}...", auth_preview));
    }

    // Извлекаем токен (формат: "Bearer <token>" или просто "<token>")
    let token = if auth_header.starts_with("Bearer ") {
        &auth_header[7..]
    } else {
        auth_header
    };

    if token.is_empty() {
        #[cfg(debug_assertions)]
        state.logger.error(&format!("[AUTH MIDDLEWARE] Missing Authorization header for {}", uri));
        return Err(StatusCode::UNAUTHORIZED);
    }

    #[cfg(debug_assertions)]
    {
        state.logger.info(&format!("[AUTH MIDDLEWARE] Extracted token: {}...", &token[..token.len().min(10)]));
        state.logger.info("[AUTH MIDDLEWARE] Checking token in database...");
    }

    // FIX: Правильная обработка ошибок БД вместо unwrap_or
    let is_valid = match sqlx::query_scalar::<_, i64>(
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
    {
        Ok(count) => count > 0,
        Err(e) => {
            state.logger.error(&format!("[AUTH MIDDLEWARE] Database error during token validation: {:?}", e));
            // Возвращаем 500 Internal Server Error вместо молча отклоняя запрос
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    #[cfg(debug_assertions)]
    state.logger.info(&format!("[AUTH MIDDLEWARE] Token validation result: {}", if is_valid { "VALID" } else { "INVALID" }));

    if !is_valid {
        #[cfg(debug_assertions)]
        state.logger.error(&format!("[AUTH MIDDLEWARE] Invalid token for {}", uri));
        return Err(StatusCode::UNAUTHORIZED);
    }

    #[cfg(debug_assertions)]
    {
        state.logger.info(&format!("[AUTH MIDDLEWARE] Token valid, allowing request to {}", uri));
        println!("[AUTH] ✅ Авторизация успешна для {}", uri);
    }

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
    docs_base_dir: std::path::PathBuf,
) -> Result<(), anyhow::Error> {
    // Создаём broadcast канал для административных событий (capacity 500 для 20+ судей)
    let (admin_tx, _) = broadcast::channel::<String>(500);

    logger.info("========== LOCAL SERVER STARTING ==========");
    logger.info(&format!("Port: {}", port));

    let state = LocalServerState {
        db,
        match_channels: Arc::new(RwLock::new(HashMap::new())),
        admin_events_channel: admin_tx,
        logger: Arc::clone(&logger),
        docs_base_dir,
    };

    let app = Router::new()
        // Auth endpoints
        .route("/api/v1/auth/pin", post(login_by_pin_handler))
        .route("/api/v1/desktop/auth/pin-auth", post(login_by_pin_handler)) // Для совместимости с desktop клиентом
        .route("/api/v1/auth/logout", post(logout_judge_handler)) // Выход судьи

        // Desktop endpoints (compatible with existing API)
        .route("/api/v1/desktop/brackets/tournament/:id", get(get_tournament_brackets_handler))
        .route("/api/v1/desktop/brackets/:bracket_id/matches", get(get_bracket_matches_handler))
        .route("/api/v1/desktop/sync/matches", post(sync_matches_handler))
        .route("/api/v1/desktop/matches/update", post(update_match_score_handler))
        .route("/api/v1/desktop/matches/undo", post(undo_match_handler)) // Отмена завершённого матча
        .route("/api/v1/desktop/matches/cancel", post(cancel_match_handler)) // Отмена активного матча
        .route("/api/v1/desktop/call-admin", post(call_admin_handler)) // Вызов администратора
        .route("/api/v1/desktop/fighters/search", get(search_fighters_handler)) // Поиск спортсменов для автодополнения
        .route("/api/v1/desktop/matches/participant", post(update_bracket_participant_handler)) // Редактирование участников судьями

        // Bracket editing endpoints
        .route("/api/v1/desktop/matches/swap", post(swap_bracket_participants_handler))
        .route("/api/v1/desktop/temp-participants", post(create_temp_participant_handler))
        .route("/api/v1/desktop/bracket-assignments/:tournament_id", get(get_bracket_assignments_handler))
        .route("/api/v1/desktop/my-bracket-assignments/:tournament_id/:table_number", get(get_my_bracket_assignments_handler))
        .route("/api/v1/desktop/brackets/reserve", post(reserve_bracket_handler))
        .route("/api/v1/desktop/brackets/release", post(release_bracket_handler))
        .route("/api/v1/desktop/brackets/create", post(create_empty_bracket_handler))

        // Secretary endpoints (взвешивание)
        .route("/api/v1/secretary/participants", get(get_secretary_participants_handler))
        .route("/api/v1/secretary/participants/:fighter_id", get(get_secretary_participant_handler))
        .route("/api/v1/secretary/confirm", post(confirm_secretary_participant_handler))
        .route("/api/v1/secretary/stats", get(get_secretary_stats_handler))
        .route("/api/v1/secretary/docs/:tournament_id/:filename", get(get_secretary_doc_handler))

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

    // Production-grade TCP конфигурация для высокой нагрузки
    use std::net::SocketAddr;
    let socket_addr: SocketAddr = addr.parse()?;
    let socket = tokio::net::TcpSocket::new_v4()?;

    // Оптимизация 1: Разрешить быстрое переиспользование адреса (мгновенный перезапуск)
    socket.set_reuseaddr(true)?;

    // Оптимизация 2: Backlog 1024 (выдерживает burst 100+ одновременных подключений)
    socket.bind(socket_addr)?;
    let listener = socket.listen(1024)?;

    logger.info(&format!("✅ Local server listening on {} (backlog: 1024, SO_REUSEADDR: true)", addr));
    println!("Local server listening on {}", addr);

    // Graceful shutdown с production настройками
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>()
    )
    // Оптимизация 3: TCP_NODELAY для мгновенной отправки (latency ↓ в 2-4x)
    .tcp_nodelay(true)
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
                "INSERT INTO judge_auth (pin_code, token, judge_name, table_number, tournament_id, created_at)
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

            // Сохраняем сессию судьи в judge_sessions для мониторинга
            if payload.judge_name.is_some() && payload.table_number.is_some() {
                sqlx::query(
                    "INSERT INTO judge_sessions (pin_code, judge_name, table_number, tournament_id, logged_in_at)
                     VALUES (?, ?, ?, ?, datetime('now'))"
                )
                .bind(&payload.pin_code)
                .bind(&judge_name)
                .bind(table_number)
                .bind(tournament_id)
                .execute(&*state.db)
                .await?;

                state.logger.info("Judge session saved to judge_sessions table");
            }

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
                judge_name: payload.judge_name,
                table_number: payload.table_number,
            }))
        }
        None => {
            println!("[LOCAL SERVER] PIN NOT FOUND in database!");
            println!("[LOCAL SERVER] ========== login_by_pin_handler FAILED ==========");
            Err(AppError::Unauthorized("Invalid PIN code".to_string()))
        }
    }
}

// Logout judge handler - освобождает стол и удаляет сессию из БД
async fn logout_judge_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<LogoutJudgeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    #[cfg(debug_assertions)]
    {
        println!("[LOCAL SERVER] ========== logout_judge_handler START ==========");
        println!("[LOCAL SERVER] Judge logout request:");
        println!("[LOCAL SERVER]   tournament_id: {}", payload.tournament_id);
        println!("[LOCAL SERVER]   table_number: {}", payload.table_number);
        println!("[LOCAL SERVER]   judge_name: {}", payload.judge_name);
    }

    // Удаляем из table_numbers
    sqlx::query(
        "DELETE FROM table_numbers WHERE tournament_id = ? AND table_number = ?"
    )
    .bind(payload.tournament_id)
    .bind(payload.table_number)
    .execute(&*state.db)
    .await?;

    // Удаляем из judge_sessions и judge_auth одновременно (batch delete)
    sqlx::query(
        "DELETE FROM judge_sessions WHERE tournament_id = ? AND table_number = ?"
    )
    .bind(payload.tournament_id)
    .bind(payload.table_number)
    .execute(&*state.db)
    .await?;

    sqlx::query(
        "DELETE FROM judge_auth WHERE tournament_id = ? AND table_number = ?"
    )
    .bind(payload.tournament_id)
    .bind(payload.table_number)
    .execute(&*state.db)
    .await?;

    #[cfg(debug_assertions)]
    println!("[LOCAL SERVER] Deleted judge session and auth records");

    // Отправляем событие админу о отключении судьи
    let event = serde_json::json!({
        "type": "judge_disconnected",
        "tournament_id": payload.tournament_id,
        "judge_name": payload.judge_name,
        "table_number": payload.table_number,
        "user_id": 0,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    let _ = state.admin_events_channel.send(event.to_string());

    #[cfg(debug_assertions)]
    {
        println!("[LOCAL SERVER] Admin event sent: Judge {} disconnected from table {}",
                 payload.judge_name, payload.table_number);
        println!("[LOCAL SERVER] ========== logout_judge_handler SUCCESS ==========");
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

// Get bracket matches handler (отдельный endpoint для получения матчей конкретной сетки)
async fn get_bracket_matches_handler(
    State(state): State<LocalServerState>,
    Path(bracket_id): Path<i32>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    #[cfg(debug_assertions)]
    {
        println!("[LOCAL SERVER] ========== get_bracket_matches_handler START ==========");
        println!("[LOCAL SERVER] Bracket ID: {}", bracket_id);
    }

    // Получить матчи для этой сетки (плоская схема)
    let match_records = sqlx::query(
        "SELECT match_id, bracket_id, tournament_id, round_number, match_number,
                p1_id, p1_name, p1_club,
                p2_id, p2_name, p2_club,
                score_p1, score_p2, warnings_p1, warnings_p2,
                winner_id, result_type, status, version,
                COALESCE(p1_confirmed, 0) as p1_confirmed,
                COALESCE(p2_confirmed, 0) as p2_confirmed
         FROM matches_cache WHERE bracket_id = ?
         ORDER BY round_number, match_number"
    )
    .bind(bracket_id)
    .fetch_all(&*state.db)
    .await?;

    println!("[LOCAL SERVER] Found {} matches for bracket {}", match_records.len(), bracket_id);

    let matches: Vec<serde_json::Value> = match_records
        .iter()
        .map(|row| {
            use sqlx::Row;
            let match_id:    i32            = row.get("match_id");
            let b_id:        i32            = row.get("bracket_id");
            let t_id:        Option<i32>    = row.get("tournament_id");
            let round:       i32            = row.get("round_number");
            let match_num:   i32            = row.get("match_number");
            let p1_id:       Option<i32>    = row.get("p1_id");
            let p1_name:     Option<String> = row.get("p1_name");
            let p1_club:     Option<String> = row.get("p1_club");
            let p2_id:       Option<i32>    = row.get("p2_id");
            let p2_name:     Option<String> = row.get("p2_name");
            let p2_club:     Option<String> = row.get("p2_club");
            let score_p1:    i32            = row.get("score_p1");
            let score_p2:    i32            = row.get("score_p2");
            let warnings_p1: i32            = row.get("warnings_p1");
            let warnings_p2: i32            = row.get("warnings_p2");
            let winner_id:   Option<i32>    = row.get("winner_id");
            let result_type: Option<String> = row.get("result_type");
            let status:      String         = row.get("status");
            let duration:     Option<i32>    = row.try_get("duration").unwrap_or(None);
            let version:      i32            = row.get("version");
            let p1_confirmed: i32            = row.try_get("p1_confirmed").unwrap_or(0);
            let p2_confirmed: i32            = row.try_get("p2_confirmed").unwrap_or(0);

            println!("[LOCAL SERVER] Match {}: score_p1={}, score_p2={} (p1=blue, p2=red)",
                match_id, score_p1, score_p2);
            let participant1 = if p1_id.is_some() || p1_name.is_some() {
                serde_json::json!({ "id": p1_id, "fighter_id": p1_id, "full_name": p1_name, "club_name": p1_club, "is_confirmed": p1_confirmed != 0 })
            } else { serde_json::Value::Null };
            let participant2 = if p2_id.is_some() || p2_name.is_some() {
                serde_json::json!({ "id": p2_id, "fighter_id": p2_id, "full_name": p2_name, "club_name": p2_club, "is_confirmed": p2_confirmed != 0 })
            } else { serde_json::Value::Null };
            serde_json::json!({
                "id": match_id,
                "bracket_id": b_id,
                "tournament_id": t_id,
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
                "duration": duration,
                "version": version,
            })
        })
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

    // 1. Получить сетки (плоская схема)
    state.logger.info("Querying brackets_cache table...");
    let bracket_records = sqlx::query_as::<_, (i32, i32, Option<i32>, Option<String>,
        Option<f64>, Option<f64>, Option<String>, Option<i32>, Option<String>,
        Option<String>, Option<i32>, String, i32, Option<String>, Option<String>)>(
        "SELECT bracket_id, tournament_id, category_id, category_name,
                weight_min, weight_max, gender, sport_id, sport_name,
                bracket_type, total_rounds, status, is_published,
                characteristics_schema, characteristic_filters
         FROM brackets_cache WHERE tournament_id = ?"
    )
    .bind(tournament_id)
    .fetch_all(&*state.db)
    .await?;

    state.logger.info(&format!("Found {} bracket records in cache", bracket_records.len()));

    let bracket_ids: Vec<i32> = bracket_records.iter().map(|(id, ..)| *id).collect();

    // 2. Получить ВСЕ матчи одним запросом
    state.logger.info(&format!("Fetching all matches for {} brackets...", bracket_ids.len()));

    let placeholders = bracket_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let query_str = format!(
        "SELECT match_id, bracket_id, tournament_id, round_number, match_number,
                p1_id, p1_name, p1_club, p2_id, p2_name, p2_club,
                score_p1, score_p2, warnings_p1, warnings_p2,
                winner_id, result_type, status, version
         FROM matches_cache WHERE bracket_id IN ({})
         ORDER BY bracket_id, round_number, match_number", placeholders
    );

    let mut q = sqlx::query(&query_str);
    for bid in &bracket_ids { q = q.bind(bid); }

    let all_matches = q.fetch_all(&*state.db).await.unwrap_or_default();
    state.logger.info(&format!("Fetched {} total matches", all_matches.len()));

    // 3. Группируем матчи по bracket_id в HashMap
    use std::collections::HashMap;
    use sqlx::Row as _;
    let mut matches_by_bracket: HashMap<i32, Vec<serde_json::Value>> = HashMap::new();

    for row in &all_matches {
        let match_id:    i32            = row.get("match_id");
        let b_id:        i32            = row.get("bracket_id");
        let t_id:        Option<i32>    = row.get("tournament_id");
        let round:       i32            = row.get("round_number");
        let match_num:   i32            = row.get("match_number");
        let p1_id:       Option<i32>    = row.get("p1_id");
        let p1_name:     Option<String> = row.get("p1_name");
        let p1_club:     Option<String> = row.get("p1_club");
        let p2_id:       Option<i32>    = row.get("p2_id");
        let p2_name:     Option<String> = row.get("p2_name");
        let p2_club:     Option<String> = row.get("p2_club");
        let score_p1:    i32            = row.get("score_p1");
        let score_p2:    i32            = row.get("score_p2");
        let warnings_p1: i32            = row.get("warnings_p1");
        let warnings_p2: i32            = row.get("warnings_p2");
        let winner_id:   Option<i32>    = row.get("winner_id");
        let result_type: Option<String> = row.get("result_type");
        let status:      String         = row.get("status");
        let version:     i32            = row.get("version");

        let participant1 = if p1_id.is_some() || p1_name.is_some() {
            serde_json::json!({ "id": p1_id, "fighter_id": p1_id, "full_name": p1_name, "club_name": p1_club })
        } else { serde_json::Value::Null };
        let participant2 = if p2_id.is_some() || p2_name.is_some() {
            serde_json::json!({ "id": p2_id, "fighter_id": p2_id, "full_name": p2_name, "club_name": p2_club })
        } else { serde_json::Value::Null };
        let match_json = serde_json::json!({
            "id": match_id,
            "bracket_id": b_id,
            "tournament_id": t_id,
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
        });
        matches_by_bracket.entry(b_id).or_insert_with(Vec::new).push(match_json);
    }

    state.logger.info(&format!("Grouped matches into {} brackets", matches_by_bracket.len()));

    // 4. Собираем финальный ответ
    let mut brackets_with_matches: Vec<serde_json::Value> = Vec::new();

    for (bracket_id, tournament_id_val, category_id, category_name,
         weight_min, weight_max, gender, sport_id, sport_name,
         bracket_type, total_rounds, status, is_published,
         characteristics_schema_str, characteristic_filters_str) in bracket_records
    {
        state.logger.info(&format!("Processing bracket_id: {}", bracket_id));

        let matches = matches_by_bracket.get(&bracket_id).cloned().unwrap_or_default();
        state.logger.info(&format!("Found {} matches for bracket {}", matches.len(), bracket_id));

        let characteristics_schema: serde_json::Value = characteristics_schema_str
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null);
        let characteristic_filters: serde_json::Value = characteristic_filters_str
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null);

        let bracket_json = serde_json::json!({
            "id": bracket_id,
            "bracket_id": bracket_id,
            "tournament_id": tournament_id_val,
            "category_id": category_id,
            "category_name": category_name,
            "weight_min": weight_min,
            "weight_max": weight_max,
            "gender": gender,
            "sport_id": sport_id,
            "sport_name": sport_name,
            "bracket_type": bracket_type,
            "total_rounds": total_rounds,
            "status": status,
            "is_published": is_published != 0,
            "characteristics_schema": characteristics_schema,
            "characteristic_filters": characteristic_filters,
            "matches": matches,
        });

        brackets_with_matches.push(bracket_json);
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
    let d = &payload.data;
    let bracket_id   = d.get("bracket_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let tournament_id = d.get("tournament_id").and_then(|v| v.as_i64()).map(|v| v as i32);
    let round_number = d.get("round_number").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
    let match_number = d.get("match_number").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
    let p1_id   = d.get("participant1").and_then(|p| p.get("id").or_else(|| p.get("fighter_id"))).and_then(|v| v.as_i64()).map(|v| v as i32);
    let p1_name = d.get("participant1").and_then(|p| p.get("full_name")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let p1_club = d.get("participant1").and_then(|p| p.get("club_name")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let p2_id   = d.get("participant2").and_then(|p| p.get("id").or_else(|| p.get("fighter_id"))).and_then(|v| v.as_i64()).map(|v| v as i32);
    let p2_name = d.get("participant2").and_then(|p| p.get("full_name")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let p2_club = d.get("participant2").and_then(|p| p.get("club_name")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let score_p1    = d.get("score_participant1").or_else(|| d.get("score_p1")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let score_p2    = d.get("score_participant2").or_else(|| d.get("score_p2")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let warnings_p1 = d.get("warnings_participant1").or_else(|| d.get("warnings_p1")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let warnings_p2 = d.get("warnings_participant2").or_else(|| d.get("warnings_p2")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let winner_id   = d.get("winner_id").and_then(|v| v.as_i64()).map(|v| v as i32);
    let result_type = d.get("result_type").and_then(|v| v.as_str()).map(|s| s.to_string());
    let status      = d.get("status").and_then(|v| v.as_str()).unwrap_or("scheduled").to_string();
    let duration    = d.get("duration").and_then(|v| v.as_i64()).map(|v| v as i32);

    // Обновить матч в matches_cache (плоская схема)
    sqlx::query(
        "INSERT OR REPLACE INTO matches_cache
         (match_id, bracket_id, tournament_id, round_number, match_number,
          p1_id, p1_name, p1_club, p2_id, p2_name, p2_club,
          score_p1, score_p2, warnings_p1, warnings_p2,
          winner_id, result_type, status, duration, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'),
                 COALESCE((SELECT version FROM matches_cache WHERE match_id = ?), 0) + 1)"
    )
    .bind(payload.match_id)
    .bind(bracket_id)
    .bind(tournament_id)
    .bind(round_number)
    .bind(match_number)
    .bind(p1_id)
    .bind(&p1_name)
    .bind(&p1_club)
    .bind(p2_id)
    .bind(&p2_name)
    .bind(&p2_club)
    .bind(score_p1)
    .bind(score_p2)
    .bind(warnings_p1)
    .bind(warnings_p2)
    .bind(winner_id)
    .bind(&result_type)
    .bind(&status)
    .bind(duration)
    .bind(payload.match_id)
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
    // 1. Получить текущую версию матча (optimistic locking)
    let current_version: Option<i64> = sqlx::query_scalar(
        "SELECT version FROM matches_cache WHERE match_id = ?"
    )
    .bind(payload.match_id)
    .fetch_optional(&*state.db)
    .await?;

    let version = if let Some(ver) = current_version {
        ver
    } else {
        println!("[LOCAL SERVER] ERROR: Match {} not found in cache", payload.match_id);
        return Err(AppError::BadRequest(format!("Match {} not found", payload.match_id)));
    };

    println!("[LOCAL SERVER] Updated match data: red={}, blue={}, red_warnings={}, blue_warnings={}",
        payload.red_score, payload.blue_score, payload.red_warnings, payload.blue_warnings);

    // 2. Сохранить в БД с optimistic locking (плоская схема)
    let rows_affected = sqlx::query(
        "UPDATE matches_cache
         SET score_p1 = ?, score_p2 = ?, warnings_p1 = ?, warnings_p2 = ?,
             status = ?, winner_id = ?, result_type = ?,
             duration = COALESCE(?, duration),
             version = version + 1, updated_at = datetime('now')
         WHERE match_id = ? AND version = ?"
    )
    .bind(payload.blue_score)
    .bind(payload.red_score)
    .bind(payload.blue_warnings)
    .bind(payload.red_warnings)
    .bind(&payload.status)
    .bind(payload.winner_id)
    .bind(&payload.result_type)
    .bind(payload.duration)
    .bind(payload.match_id)
    .bind(version)
    .execute(&*state.db)
    .await?
    .rows_affected();

    println!("[LOCAL SERVER] UPDATE rows_affected: {}", rows_affected);

    // Если rows_affected = 0, значит версия изменилась (конкурентное обновление)
    if rows_affected == 0 {
        println!("[LOCAL SERVER] WARNING: Optimistic lock failed for match_id={}, version={}", payload.match_id, version);
        return Err(AppError::Conflict("Match was updated by another judge, please retry".to_string()));
    }

    println!("[LOCAL SERVER] ✅ Match {} successfully updated in DB (version incremented)", payload.match_id);

    // 3.5. Обновить статус сетки на основе статусов матчей
    if let Err(e) = update_bracket_status_from_matches(&state.db, payload.match_id).await {
        println!("[LOCAL SERVER] WARNING: Failed to update bracket status: {:?}", e);
        // Не фейлим весь запрос - матч уже сохранен
    }

    // 3.6. Если матч завершен - продвинуть победителя в следующий матч
    if payload.status == "completed" {
        println!("[LOCAL SERVER] Match completed, checking for winner advancement...");

        if let Err(e) = advance_winner_to_next_match(
            &state.db,
            payload.match_id,
            payload.winner_id,
            payload.blue_score,
            payload.red_score,
        ).await {
            println!("[LOCAL SERVER] WARNING: Failed to advance winner: {}", e);
            // Не фейлим весь запрос - матч уже сохранен
        }
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
            "result_type": payload.result_type,
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

// Undo finished match handler - откатить завершённый матч
async fn undo_match_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<UndoMatchRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== undo_match_handler START ==========");
    println!("[LOCAL SERVER] match_id: {}", payload.match_id);

    // 1. Получить данные матча (плоская схема)
    let current_row: Option<(String, Option<i32>, i32, i32, i32)> = sqlx::query_as(
        "SELECT status, winner_id, bracket_id, round_number, match_number FROM matches_cache WHERE match_id = ?"
    )
    .bind(payload.match_id)
    .fetch_optional(&*state.db)
    .await?;

    let (status, winner_id, bracket_id, current_round, current_match_number) = if let Some(row) = current_row {
        row
    } else {
        println!("[LOCAL SERVER] ERROR: Match {} not found in cache", payload.match_id);
        return Err(AppError::BadRequest(format!("Match {} not found", payload.match_id)));
    };

    // 2. Проверить что матч завершён
    if status != "completed" {
        println!("[LOCAL SERVER] ERROR: Match {} is not completed (status: {})", payload.match_id, status);
        return Err(AppError::BadRequest("Can only undo completed matches".to_string()));
    }

    println!("[LOCAL SERVER] Match info - winner_id: {:?}, bracket: {}, round: {}, number: {}",
        winner_id, bracket_id, current_round, current_match_number);

    // 3. Откатить данные матча (плоские колонки)
    sqlx::query(
        "UPDATE matches_cache
         SET status = 'scheduled', score_p1 = 0, score_p2 = 0,
             warnings_p1 = 0, warnings_p2 = 0,
             winner_id = NULL, result_type = NULL,
             version = version + 1, updated_at = datetime('now')
         WHERE match_id = ?"
    )
    .bind(payload.match_id)
    .execute(&*state.db)
    .await?;

    println!("[LOCAL SERVER] ✅ Match {} successfully reverted in DB", payload.match_id);

    // 4. Откатить продвижение победителя в следующий раунд
    if let Some(winner_id_value) = winner_id {
        let next_round = current_round + 1;
        let next_match_number = (current_match_number + 1) / 2;

        println!("[LOCAL SERVER] Reverting winner advancement - next_round: {}, next_match_number: {}",
            next_round, next_match_number);

        // Найти следующий матч
        let next_match_id: Option<i32> = sqlx::query_scalar(
            "SELECT match_id FROM matches_cache
             WHERE bracket_id = ? AND round_number = ? AND match_number = ?"
        )
        .bind(bracket_id)
        .bind(next_round)
        .bind(next_match_number)
        .fetch_optional(&*state.db)
        .await?;

        if let Some(next_match_id) = next_match_id {
            println!("[LOCAL SERVER] Found next match: {}", next_match_id);

            // Определить, в каком слоте находится победитель (проверяем по ID из плоских колонок)
            let next_slots: Option<(Option<i32>, Option<i32>)> = sqlx::query_as(
                "SELECT p1_id, p2_id FROM matches_cache WHERE match_id = ?"
            )
            .bind(next_match_id)
            .fetch_optional(&*state.db)
            .await?;

            if let Some((next_p1_id, next_p2_id)) = next_slots {
                if next_p1_id == Some(winner_id_value) {
                    println!("[LOCAL SERVER] Removing winner (ID: {}) from p1 slot", winner_id_value);
                    sqlx::query(
                        "UPDATE matches_cache SET p1_id = NULL, p1_name = NULL, p1_club = NULL,
                         updated_at = datetime('now') WHERE match_id = ?"
                    )
                    .bind(next_match_id)
                    .execute(&*state.db)
                    .await?;
                } else if next_p2_id == Some(winner_id_value) {
                    println!("[LOCAL SERVER] Removing winner (ID: {}) from p2 slot", winner_id_value);
                    sqlx::query(
                        "UPDATE matches_cache SET p2_id = NULL, p2_name = NULL, p2_club = NULL,
                         updated_at = datetime('now') WHERE match_id = ?"
                    )
                    .bind(next_match_id)
                    .execute(&*state.db)
                    .await?;
                } else {
                    // Fallback: ID не совпал (временный участник) — определяем по формуле слота
                    println!("[LOCAL SERVER] ⚠️ Winner ID {} not found by ID in next match {} — using slot formula",
                        winner_id_value, next_match_id);
                    if current_match_number % 2 == 1 {
                        sqlx::query(
                            "UPDATE matches_cache SET p1_id = NULL, p1_name = NULL, p1_club = NULL,
                             updated_at = datetime('now') WHERE match_id = ?"
                        )
                        .bind(next_match_id)
                        .execute(&*state.db)
                        .await?;
                    } else {
                        sqlx::query(
                            "UPDATE matches_cache SET p2_id = NULL, p2_name = NULL, p2_club = NULL,
                             updated_at = datetime('now') WHERE match_id = ?"
                        )
                        .bind(next_match_id)
                        .execute(&*state.db)
                        .await?;
                    }
                }
            }

            println!("[LOCAL SERVER] ✅ Winner removed from next match {} successfully", next_match_id);
        } else {
            println!("[LOCAL SERVER] No next match found (possibly final match)");
        }
    }

    // 7. Очистить историю событий матча
    sqlx::query("DELETE FROM match_events WHERE match_id = ?")
        .bind(payload.match_id)
        .execute(&*state.db)
        .await?;

    println!("[LOCAL SERVER] Match events cleared successfully");

    // 8. Обновить статус сетки
    if let Err(e) = update_bracket_status_from_matches(&state.db, payload.match_id).await {
        println!("[LOCAL SERVER] WARNING: Failed to update bracket status: {:?}", e);
        // Не фейлим весь запрос - матч уже откачен
    }

    // 9. Broadcast через WebSocket
    let channels = state.match_channels.read().await;
    if let Some(tx) = channels.get(&payload.match_id.to_string()) {
        let ws_message = serde_json::json!({
            "type": "match_undone",
            "match_id": payload.match_id,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });

        let _ = tx.send(ws_message.to_string());
    }

    println!("[LOCAL SERVER] ========== undo_match_handler SUCCESS ==========");

    Ok(Json(serde_json::json!({
        "status": "undone",
        "match_id": payload.match_id
    })))
}

// Отмена активного или незавершённого матча (сброс счёта, статус → scheduled)
// Доступно для всех: судей и администраторов
async fn cancel_match_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<UndoMatchRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== cancel_match_handler START ==========");
    println!("[LOCAL SERVER] match_id: {}", payload.match_id);

    // 1. Получить данные матча
    let current_row: Option<(String, Option<i32>, i32, i32, i32)> = sqlx::query_as(
        "SELECT status, winner_id, bracket_id, round_number, match_number FROM matches_cache WHERE match_id = ?"
    )
    .bind(payload.match_id)
    .fetch_optional(&*state.db)
    .await?;

    let (status, winner_id, bracket_id, current_round, current_match_number) = if let Some(row) = current_row {
        row
    } else {
        println!("[LOCAL SERVER] ERROR: Match {} not found", payload.match_id);
        return Err(AppError::BadRequest(format!("Match {} not found", payload.match_id)));
    };

    println!("[LOCAL SERVER] Match status: {}, winner_id: {:?}", status, winner_id);

    // 2. Сбросить матч в начальное состояние
    sqlx::query(
        "UPDATE matches_cache
         SET status = 'scheduled', score_p1 = 0, score_p2 = 0,
             warnings_p1 = 0, warnings_p2 = 0,
             winner_id = NULL, result_type = NULL,
             version = version + 1, updated_at = datetime('now')
         WHERE match_id = ?"
    )
    .bind(payload.match_id)
    .execute(&*state.db)
    .await?;

    println!("[LOCAL SERVER] ✅ Match {} reset to scheduled", payload.match_id);

    // 3. Если был победитель — убрать его из следующего раунда
    let next_round = current_round + 1;
    let next_match_number = (current_match_number + 1) / 2;

    let next_match_id: Option<i32> = sqlx::query_scalar(
        "SELECT match_id FROM matches_cache
         WHERE bracket_id = ? AND round_number = ? AND match_number = ?"
    )
    .bind(bracket_id)
    .bind(next_round)
    .bind(next_match_number)
    .fetch_optional(&*state.db)
    .await?;

    if let Some(next_match_id) = next_match_id {
        println!("[LOCAL SERVER] Found next match: {}", next_match_id);

        // Определяем слот по позиции матча (нечётные → p1, чётные → p2)
        // Также проверяем по winner_id если он есть
        let next_slots: Option<(Option<i32>, Option<i32>)> = sqlx::query_as(
            "SELECT p1_id, p2_id FROM matches_cache WHERE match_id = ?"
        )
        .bind(next_match_id)
        .fetch_optional(&*state.db)
        .await?;

        if let Some((next_p1_id, next_p2_id)) = next_slots {
            let should_clear_p1 = if let Some(wid) = winner_id {
                // Если winner_id совпадает с p1 — очищаем p1
                next_p1_id == Some(wid)
            } else {
                // Нет winner_id — используем формулу по слоту
                current_match_number % 2 == 1
            };

            let should_clear_p2 = if let Some(wid) = winner_id {
                next_p2_id == Some(wid)
            } else {
                current_match_number % 2 == 0
            };

            if should_clear_p1 {
                sqlx::query(
                    "UPDATE matches_cache SET p1_id = NULL, p1_name = NULL, p1_club = NULL,
                     updated_at = datetime('now') WHERE match_id = ?"
                )
                .bind(next_match_id)
                .execute(&*state.db)
                .await?;
                println!("[LOCAL SERVER] Cleared p1 slot in next match {}", next_match_id);
            } else if should_clear_p2 {
                sqlx::query(
                    "UPDATE matches_cache SET p2_id = NULL, p2_name = NULL, p2_club = NULL,
                     updated_at = datetime('now') WHERE match_id = ?"
                )
                .bind(next_match_id)
                .execute(&*state.db)
                .await?;
                println!("[LOCAL SERVER] Cleared p2 slot in next match {}", next_match_id);
            }
        }
    } else {
        println!("[LOCAL SERVER] No next match found");
    }

    // 4. Очистить историю событий матча
    sqlx::query("DELETE FROM match_events WHERE match_id = ?")
        .bind(payload.match_id)
        .execute(&*state.db)
        .await?;

    // 5. Обновить статус сетки
    if let Err(e) = update_bracket_status_from_matches(&state.db, payload.match_id).await {
        println!("[LOCAL SERVER] WARNING: Failed to update bracket status: {:?}", e);
    }

    // 6. Broadcast через WebSocket
    let channels = state.match_channels.read().await;
    if let Some(tx) = channels.get(&payload.match_id.to_string()) {
        let ws_message = serde_json::json!({
            "type": "match_cancelled",
            "match_id": payload.match_id,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });
        let _ = tx.send(ws_message.to_string());
    }

    println!("[LOCAL SERVER] ========== cancel_match_handler SUCCESS ==========");

    Ok(Json(serde_json::json!({
        "status": "cancelled",
        "match_id": payload.match_id
    })))
}

// Update match participant handler (for winner advancement) - DEPRECATED, не используется
#[allow(dead_code)]
async fn update_match_participant_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<UpdateMatchParticipantRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== update_match_participant_handler START ==========");
    println!("[LOCAL SERVER] match_id: {}, slot: {}, participant_id: {:?}, name: {:?}",
        payload.match_id, payload.participant_slot, payload.participant_id, payload.participant_name);

    // 1. Проверить наличие матча и получить версию
    let current_version: Option<i64> = sqlx::query_scalar(
        "SELECT version FROM matches_cache WHERE match_id = ?"
    )
    .bind(payload.match_id)
    .fetch_optional(&*state.db)
    .await?;

    let version = if let Some(ver) = current_version {
        ver
    } else {
        println!("[LOCAL SERVER] ERROR: Match {} not found in cache", payload.match_id);
        return Err(AppError::BadRequest(format!("Match {} not found", payload.match_id)));
    };

    // 2. Обновить данные участника (плоская схема)
    let rows_affected = if payload.participant_slot == 1 {
        println!("[LOCAL SERVER] Updated participant1: id={:?}, name={:?}",
            payload.participant_id, payload.participant_name);
        sqlx::query(
            "UPDATE matches_cache
             SET p1_id = COALESCE(?, p1_id),
                 p1_name = COALESCE(?, p1_name),
                 p1_club = COALESCE(?, p1_club),
                 version = version + 1, updated_at = datetime('now')
             WHERE match_id = ? AND version = ?"
        )
        .bind(payload.participant_id)
        .bind(&payload.participant_name)
        .bind(&payload.club)
        .bind(payload.match_id)
        .bind(version)
        .execute(&*state.db)
        .await?
        .rows_affected()
    } else if payload.participant_slot == 2 {
        println!("[LOCAL SERVER] Updated participant2: id={:?}, name={:?}",
            payload.participant_id, payload.participant_name);
        sqlx::query(
            "UPDATE matches_cache
             SET p2_id = COALESCE(?, p2_id),
                 p2_name = COALESCE(?, p2_name),
                 p2_club = COALESCE(?, p2_club),
                 version = version + 1, updated_at = datetime('now')
             WHERE match_id = ? AND version = ?"
        )
        .bind(payload.participant_id)
        .bind(&payload.participant_name)
        .bind(&payload.club)
        .bind(payload.match_id)
        .bind(version)
        .execute(&*state.db)
        .await?
        .rows_affected()
    } else {
        println!("[LOCAL SERVER] ERROR: Invalid participant_slot: {}", payload.participant_slot);
        return Err(AppError::BadRequest("Invalid participant_slot (must be 1 or 2)".to_string()));
    };

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

    // Вспомогательная функция: читает p1_id, p1_name, p1_club, p2_id, p2_name, p2_club
    // Возвращает (p1_id, p1_name, p1_club, p2_id, p2_name, p2_club)
    type SlotData = (Option<i32>, Option<String>, Option<String>, Option<i32>, Option<String>, Option<String>);

    // Swap внутри одного матча
    if payload.match1_id == payload.match2_id {
        let row: SlotData = sqlx::query_as(
            "SELECT p1_id, p1_name, p1_club, p2_id, p2_name, p2_club
             FROM matches_cache WHERE match_id = ?"
        )
        .bind(payload.match1_id)
        .fetch_one(&mut *tx)
        .await?;

        let (p1_id, p1_name, p1_club, p2_id, p2_name, p2_club) = row;

        // Swap: participant1 ↔ participant2
        sqlx::query(
            "UPDATE matches_cache
             SET p1_id = ?, p1_name = ?, p1_club = ?,
                 p2_id = ?, p2_name = ?, p2_club = ?,
                 updated_at = datetime('now')
             WHERE match_id = ?"
        )
        .bind(p2_id)
        .bind(&p2_name)
        .bind(&p2_club)
        .bind(p1_id)
        .bind(&p1_name)
        .bind(&p1_club)
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
    let row1: SlotData = sqlx::query_as(
        "SELECT p1_id, p1_name, p1_club, p2_id, p2_name, p2_club
         FROM matches_cache WHERE match_id = ?"
    )
    .bind(payload.match1_id)
    .fetch_one(&mut *tx)
    .await?;

    let row2: SlotData = sqlx::query_as(
        "SELECT p1_id, p1_name, p1_club, p2_id, p2_name, p2_club
         FROM matches_cache WHERE match_id = ?"
    )
    .bind(payload.match2_id)
    .fetch_one(&mut *tx)
    .await?;

    let (m1_p1_id, m1_p1_name, m1_p1_club, m1_p2_id, m1_p2_name, m1_p2_club) = row1;
    let (m2_p1_id, m2_p1_name, m2_p1_club, m2_p2_id, m2_p2_name, m2_p2_club) = row2;

    println!("[LOCAL SERVER] Swapping: match1[{}] <-> match2[{}]", payload.match1_slot, payload.match2_slot);

    // Извлечь значение переставляемого слота из каждого матча
    let (slot1_id, slot1_name, slot1_club) = if payload.match1_slot == "participant1" {
        (m1_p1_id, m1_p1_name.clone(), m1_p1_club.clone())
    } else {
        (m1_p2_id, m1_p2_name.clone(), m1_p2_club.clone())
    };

    let (slot2_id, slot2_name, slot2_club) = if payload.match2_slot == "participant1" {
        (m2_p1_id, m2_p1_name.clone(), m2_p1_club.clone())
    } else {
        (m2_p2_id, m2_p2_name.clone(), m2_p2_club.clone())
    };

    // Записать slot2 в нужный слот match1
    if payload.match1_slot == "participant1" {
        sqlx::query(
            "UPDATE matches_cache
             SET p1_id = ?, p1_name = ?, p1_club = ?, updated_at = datetime('now')
             WHERE match_id = ?"
        )
        .bind(slot2_id)
        .bind(&slot2_name)
        .bind(&slot2_club)
        .bind(payload.match1_id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE matches_cache
             SET p2_id = ?, p2_name = ?, p2_club = ?, updated_at = datetime('now')
             WHERE match_id = ?"
        )
        .bind(slot2_id)
        .bind(&slot2_name)
        .bind(&slot2_club)
        .bind(payload.match1_id)
        .execute(&mut *tx)
        .await?;
    }

    // Записать slot1 в нужный слот match2
    if payload.match2_slot == "participant1" {
        sqlx::query(
            "UPDATE matches_cache
             SET p1_id = ?, p1_name = ?, p1_club = ?, updated_at = datetime('now')
             WHERE match_id = ?"
        )
        .bind(slot1_id)
        .bind(&slot1_name)
        .bind(&slot1_club)
        .bind(payload.match2_id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE matches_cache
             SET p2_id = ?, p2_name = ?, p2_club = ?, updated_at = datetime('now')
             WHERE match_id = ?"
        )
        .bind(slot1_id)
        .bind(&slot1_name)
        .bind(&slot1_club)
        .bind(payload.match2_id)
        .execute(&mut *tx)
        .await?;
    }

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

// Handler для редактирования участников судьями (добавление/удаление/обновление)
async fn update_bracket_participant_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<UpdateBracketParticipantRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== update_bracket_participant_handler START ==========");
    println!("[LOCAL SERVER] operation={}, bracket_id={}, match_id={}, slot={}, fighter_id={:?}, fighter_name={:?}",
        payload.operation_type, payload.bracket_id, payload.match_id,
        payload.participant_slot, payload.fighter_id, payload.fighter_name);

    // Проверить существование матча
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM matches_cache WHERE match_id = ?"
    )
    .bind(payload.match_id)
    .fetch_optional(&*state.db)
    .await?;

    if exists.is_none() {
        println!("[LOCAL SERVER] ERROR: Match {} not found in cache", payload.match_id);
        return Err(AppError::BadRequest(format!("Match {} not found", payload.match_id)));
    }

    // Валидация слота
    if payload.participant_slot != "participant1" && payload.participant_slot != "participant2" {
        println!("[LOCAL SERVER] ERROR: Invalid participant_slot: {}", payload.participant_slot);
        return Err(AppError::BadRequest("Invalid participant_slot (must be participant1 or participant2)".to_string()));
    }

    let is_p1 = payload.participant_slot == "participant1";

    // Обработка операций
    match payload.operation_type.as_str() {
        "add" | "update" => {
            if is_p1 {
                sqlx::query(
                    "UPDATE matches_cache
                     SET p1_id = COALESCE(?, p1_id),
                         p1_name = COALESCE(?, p1_name),
                         p1_club = COALESCE(?, p1_club),
                         updated_at = datetime('now')
                     WHERE match_id = ?"
                )
                .bind(payload.fighter_id)
                .bind(&payload.fighter_name)
                .bind(&payload.club_name)
                .bind(payload.match_id)
                .execute(&*state.db)
                .await?;
            } else {
                sqlx::query(
                    "UPDATE matches_cache
                     SET p2_id = COALESCE(?, p2_id),
                         p2_name = COALESCE(?, p2_name),
                         p2_club = COALESCE(?, p2_club),
                         updated_at = datetime('now')
                     WHERE match_id = ?"
                )
                .bind(payload.fighter_id)
                .bind(&payload.fighter_name)
                .bind(&payload.club_name)
                .bind(payload.match_id)
                .execute(&*state.db)
                .await?;
            }
            println!("[LOCAL SERVER] Updated {}: id={:?}, name={:?}, club={:?}",
                payload.participant_slot, payload.fighter_id, payload.fighter_name, payload.club_name);
        },
        "remove" => {
            if is_p1 {
                sqlx::query(
                    "UPDATE matches_cache
                     SET p1_id = NULL, p1_name = NULL, p1_club = NULL,
                         updated_at = datetime('now')
                     WHERE match_id = ?"
                )
                .bind(payload.match_id)
                .execute(&*state.db)
                .await?;
            } else {
                sqlx::query(
                    "UPDATE matches_cache
                     SET p2_id = NULL, p2_name = NULL, p2_club = NULL,
                         updated_at = datetime('now')
                     WHERE match_id = ?"
                )
                .bind(payload.match_id)
                .execute(&*state.db)
                .await?;
            }
            println!("[LOCAL SERVER] Removed {}", payload.participant_slot);
        },
        _ => {
            println!("[LOCAL SERVER] ERROR: Unknown operation_type: {}", payload.operation_type);
            return Err(AppError::BadRequest(format!("Unknown operation_type: {}", payload.operation_type)));
        }
    }

    println!("[LOCAL SERVER] Participant data saved to matches_cache");

    // Broadcast через WebSocket (если есть подключенные судьи к этому матчу)
    let channels = state.match_channels.read().await;
    if let Some(tx) = channels.get(&payload.match_id.to_string()) {
        let ws_message = serde_json::json!({
            "type": "participant_update",
            "match_id": payload.match_id,
            "participant_slot": payload.participant_slot,
            "operation": payload.operation_type,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });

        let _ = tx.send(ws_message.to_string());
        println!("[LOCAL SERVER] Broadcast participant update to WebSocket subscribers");
    }

    println!("[LOCAL SERVER] ========== update_bracket_participant_handler SUCCESS ==========");
    Ok(Json(serde_json::json!({
        "status": "updated",
        "match_id": payload.match_id,
        "operation": payload.operation_type
    })))
}

// Reserve bracket handler - резервирование сетки судьей
async fn reserve_bracket_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<ReserveBracketRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.logger.info("========== reserve_bracket_handler START ==========");
    state.logger.info(&format!("bracket_id: {}, tournament_id: {}, judge_name: {}, table_number: {}, user_id: {}",
        payload.bracket_id, payload.tournament_id, payload.judge_name, payload.table_number, payload.user_id));
    println!("[LOCAL SERVER] ========== reserve_bracket_handler START ==========");
    println!("[LOCAL SERVER] bracket_id: {}, tournament_id: {}, judge_name: {}, table_number: {}, user_id: {}",
        payload.bracket_id, payload.tournament_id, payload.judge_name, payload.table_number, payload.user_id);

    // Проверить, что сетка свободна
    let existing = sqlx::query_as::<_, (String, i32)>(
        "SELECT judge_name, table_number FROM bracket_assignments WHERE bracket_id = ? AND status = 'active'"
    )
    .bind(payload.bracket_id)
    .fetch_optional(&*state.db)
    .await?;

    if let Some((existing_judge, existing_table)) = existing {
        if existing_judge != payload.judge_name {
            println!("[LOCAL SERVER] Сетка уже занята: {} (стол №{})", existing_judge, existing_table);
            return Err(AppError::Conflict(format!(
                "Сетка уже занята: {} (стол №{})",
                existing_judge,
                existing_table
            )));
        } else {
            println!("[LOCAL SERVER] Сетка уже зарезервирована текущим судьей");
            return Ok(Json(serde_json::json!({ "status": "ok", "message": "Already reserved" })));
        }
    }

    // Зарезервировать сетку
    sqlx::query(
        "INSERT INTO bracket_assignments (bracket_id, tournament_id, judge_name, table_number, reserved_at, status)
         VALUES (?, ?, ?, ?, datetime('now'), 'active')
         ON CONFLICT(bracket_id, tournament_id) DO UPDATE SET
            judge_name = excluded.judge_name,
            table_number = excluded.table_number,
            reserved_at = datetime('now'),
            status = 'active'"
    )
    .bind(payload.bracket_id)
    .bind(payload.tournament_id)
    .bind(&payload.judge_name)
    .bind(payload.table_number)
    .execute(&*state.db)
    .await?;

    // Broadcast событие "bracket_reserved" через admin_events_channel
    let event = serde_json::json!({
        "type": "bracket_reserved",
        "bracket_id": payload.bracket_id,
        "tournament_id": payload.tournament_id,
        "judge_name": payload.judge_name,
        "table_number": payload.table_number,
        "user_id": payload.user_id,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    let _ = state.admin_events_channel.send(event.to_string());
    println!("[LOCAL SERVER] Broadcast event: bracket_reserved for bracket {} by {} (стол №{})",
        payload.bracket_id, payload.judge_name, payload.table_number);

    // Проверяем, сохранилось ли резервирование
    let verify_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM bracket_assignments WHERE bracket_id = ? AND tournament_id = ? AND status = 'active'"
    )
    .bind(payload.bracket_id)
    .bind(payload.tournament_id)
    .fetch_one(&*state.db)
    .await?;

    state.logger.info(&format!("Verification: {} active reservations for bracket {}", verify_count, payload.bracket_id));
    state.logger.info("========== reserve_bracket_handler SUCCESS ==========");
    println!("[LOCAL SERVER] Verification: {} active reservations for bracket {}", verify_count, payload.bracket_id);
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

    // Получить номер стола перед освобождением
    let table_number = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT table_number FROM bracket_assignments
         WHERE bracket_id = ? AND judge_name = ? AND status = 'active'"
    )
    .bind(payload.bracket_id)
    .bind(&payload.judge_name)
    .fetch_optional(&*state.db)
    .await?
    .flatten();

    // Обновить статус на 'released' вместо удаления
    let result = sqlx::query(
        "UPDATE bracket_assignments SET status = 'released' WHERE bracket_id = ? AND judge_name = ? AND status = 'active'"
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

// Create empty bracket handler - создание пустой сетки
async fn create_empty_bracket_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<CreateEmptyBracketRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] ========== create_empty_bracket_handler START ==========");
    println!("[LOCAL SERVER] tournament_id: {}, bracket_name: {}, participant_count: {}, sport_id: {}, gender: {}, characteristic_values: {}",
        payload.tournament_id, payload.bracket_name, payload.participant_count, payload.sport_id, payload.gender, payload.characteristic_values);
    println!("[LOCAL SERVER] min_age: {:?}, max_age: {:?}, min_weight: {:?}, max_weight: {:?}",
        payload.min_age, payload.max_age, payload.min_weight, payload.max_weight);

    // Валидация: participant_count должен быть степенью 2
    if payload.participant_count < 2 || (payload.participant_count & (payload.participant_count - 1)) != 0 {
        return Err(AppError::ValidationError("Количество участников должно быть степенью 2 (2, 4, 8, 16, 32, 64)".into()));
    }

    // Парсим characteristic_values из JSON строки (объект Record<string, string>)
    let characteristic_values_obj: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&payload.characteristic_values)
        .map_err(|e| AppError::ValidationError(format!("Invalid characteristic_values JSON: {}", e)))?;

    // Преобразуем объект в массив [{key, value}, ...] для соответствия формату characteristic_filters
    let characteristic_filters: Vec<serde_json::Value> = characteristic_values_obj
        .iter()
        .map(|(key, value)| {
            serde_json::json!({
                "key": key,
                "value": value.as_str().unwrap_or("")
            })
        })
        .collect();

    // Генерация уникального ID для сетки (отрицательный ID для локальных сеток)
    // Используем только младшие 31 бит timestamp для избежания переполнения i32
    let timestamp = chrono::Utc::now().timestamp_millis();
    let bracket_id = -((timestamp & 0x7FFFFFFF) as i32);

    // characteristics_schema не хранится в плоской схеме — пропускаем
    let characteristics_schema: Option<serde_json::Value> = None;

    // Создаем sport_name запросом (берем из существующей сетки)
    let sport_name: String = sqlx::query_scalar(
        "SELECT sport_name FROM brackets_cache
         WHERE tournament_id = ?
         LIMIT 1"
    )
    .bind(payload.tournament_id)
    .fetch_optional(&*state.db)
    .await?
    .flatten()
    .unwrap_or_else(|| "Unknown Sport".to_string());

    let total_rounds_calc = (payload.participant_count as f64).log2() as i32;
    let weight_min = payload.min_weight;
    let weight_max = payload.max_weight;

    // Сохранить сетку в brackets_cache (плоская схема)
    sqlx::query(
        "INSERT INTO brackets_cache
         (bracket_id, tournament_id, category_id, category_name,
          weight_min, weight_max, gender, sport_name, bracket_type,
          total_rounds, status, is_published, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'single_elimination', ?, 'not_started', 1, datetime('now'))"
    )
    .bind(bracket_id)
    .bind(payload.tournament_id)
    .bind(&payload.bracket_name)
    .bind(weight_min)
    .bind(weight_max)
    .bind(&payload.gender)
    .bind(&sport_name)
    .bind(total_rounds_calc)
    .execute(&*state.db)
    .await?;

    // Подавляем warning о неиспользуемых переменных
    let _ = characteristics_schema;
    let _ = characteristic_filters;

    println!("[LOCAL SERVER] Bracket created with ID: {}", bracket_id);

    // Генерация пустых матчей для турнирной сетки
    let timestamp_for_matches = chrono::Utc::now().timestamp_millis();
    let mut match_id_counter = -((timestamp_for_matches & 0x7FFFFFFF) as i32);

    for round in 1..=total_rounds_calc {
        let matches_in_round = payload.participant_count / (2_i32.pow(round as u32));

        for match_num in 1..=matches_in_round {
            match_id_counter -= 1;

            // Сохранить матч в matches_cache (плоская схема)
            sqlx::query(
                "INSERT INTO matches_cache
                 (match_id, bracket_id, tournament_id, round_number, match_number,
                  p1_id, p1_name, p1_club, p2_id, p2_name, p2_club,
                  score_p1, score_p2, warnings_p1, warnings_p2,
                  winner_id, result_type, status, updated_at, version)
                 VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, 'scheduled', datetime('now'), 1)"
            )
            .bind(match_id_counter)
            .bind(bracket_id)
            .bind(payload.tournament_id)
            .bind(round)
            .bind(match_num)
            .execute(&*state.db)
            .await?;
        }

        println!("[LOCAL SERVER] Round {} created with {} matches", round, matches_in_round);
    }

    println!("[LOCAL SERVER] ========== create_empty_bracket_handler SUCCESS ==========");
    Ok(Json(serde_json::json!({ "bracket_id": bracket_id })))
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
            ba.bracket_id,
            ba.table_number,
            ba.judge_name
         FROM bracket_assignments ba
         WHERE ba.tournament_id = ? AND ba.status = 'active'
         ORDER BY ba.reserved_at DESC"
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

// Получить сетки, зарезервированные за конкретным судейским столом
async fn get_my_bracket_assignments_handler(
    State(state): State<LocalServerState>,
    Path((tournament_id, table_number)): Path<(i32, i32)>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    println!("[LOCAL SERVER] ========== get_my_bracket_assignments_handler START ==========");
    println!("[LOCAL SERVER] Tournament ID: {}, Table Number: {}", tournament_id, table_number);

    // Получить список bracket_id зарезервированных за этим столом
    let bracket_ids: Vec<i32> = sqlx::query_scalar(
        "SELECT bracket_id
         FROM bracket_assignments
         WHERE tournament_id = ? AND table_number = ? AND status = 'active'
         ORDER BY reserved_at DESC"
    )
    .bind(tournament_id)
    .bind(table_number)
    .fetch_all(&*state.db)
    .await?;

    if bracket_ids.is_empty() {
        println!("[LOCAL SERVER] No brackets assigned to table {}", table_number);
        return Ok(Json(vec![]));
    }

    println!("[LOCAL SERVER] Found {} assigned brackets", bracket_ids.len());

    // Получить полные данные сеток из кэша (плоские поля)
    let mut brackets = Vec::new();
    for bid in bracket_ids {
        type BracketRow = (i32, i32, Option<i32>, Option<String>, Option<f64>, Option<f64>, Option<String>, Option<String>, Option<String>, Option<i32>, String, i32);
        let row: Option<BracketRow> = sqlx::query_as(
            "SELECT bracket_id, tournament_id, category_id, category_name,
                    weight_min, weight_max, gender, sport_name, bracket_type,
                    total_rounds, status, is_published
             FROM brackets_cache WHERE bracket_id = ?"
        )
        .bind(bid)
        .fetch_optional(&*state.db)
        .await?;

        if let Some((bracket_id, tournament_id, category_id, category_name,
                     weight_min, weight_max, gender, sport_name, bracket_type,
                     total_rounds, status, is_published)) = row
        {
            let bracket = serde_json::json!({
                "id": bracket_id,
                "tournament_id": tournament_id,
                "category_id": category_id,
                "category_name": category_name,
                "weight_min": weight_min,
                "weight_max": weight_max,
                "gender": gender,
                "sport_name": sport_name,
                "bracket_type": bracket_type,
                "total_rounds": total_rounds,
                "status": status,
                "is_published": is_published != 0,
            });
            brackets.push(bracket);
        } else {
            eprintln!("[LOCAL SERVER] Bracket {} not found in cache", bid);
        }
    }

    state.logger.info(&format!("Returning {} brackets with full data", brackets.len()));

    // Подробное логирование возвращаемых данных
    for (i, bracket) in brackets.iter().enumerate() {
        let bracket_info = format!("Bracket {}: id={}, category={}",
            i + 1,
            bracket.get("id").and_then(|v| v.as_i64()).unwrap_or(-1),
            bracket.get("category_name").and_then(|v| v.as_str()).unwrap_or("unknown")
        );
        state.logger.info(&bracket_info);
        println!("[LOCAL SERVER] {}", bracket_info);
    }

    state.logger.info("========== get_my_bracket_assignments_handler END ==========");
    println!("[LOCAL SERVER] Returning {} brackets with full data", brackets.len());
    println!("[LOCAL SERVER] ========== get_my_bracket_assignments_handler END ==========");
    Ok(Json(brackets))
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
                broadcast::channel::<String>(500).0
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
        // Rate limiter: макс 20 сообщений в секунду (50ms между сообщениями) для быстрых действий судьи
        let mut rate_limiter = RateLimiter::new(50);

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
// SECURITY NOTE: Токен не проверяется, т.к. локальный сервер работает только в доверенной LAN среде на турнире
// Любой в локальной сети может подключиться, но это не критично - данные не конфиденциальны
async fn admin_websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<LocalServerState>,
    Query(_params): Query<WsQuery>,
) -> Response {
    println!("[Admin WebSocket] Admin connecting to events stream (no auth required for local server)");
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
#[derive(Debug)]
#[allow(dead_code)]
pub enum AppError {
    Database(sqlx::Error),
    Unauthorized(String),
    BadRequest(String),
    Conflict(String),
    Internal(String),
    ValidationError(String),
    NotFound(String),
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
            AppError::ValidationError(msg) => {
                (StatusCode::BAD_REQUEST, msg)
            }
            AppError::NotFound(msg) => {
                (StatusCode::NOT_FOUND, msg)
            }
        };

        let body = Json(serde_json::json!({
            "error": error_message
        }));

        (status, body).into_response()
    }
}

// Вспомогательная функция для продвижения победителя в следующий матч
/// Обновляет статус сетки на основе статусов её матчей
async fn update_bracket_status_from_matches(
    db: &SqlitePool,
    match_id: i32,
) -> Result<(), AppError> {
    // 1. Получить bracket_id для этого матча
    let bracket_id: Option<(i32,)> = sqlx::query_as(
        "SELECT bracket_id FROM matches_cache WHERE match_id = ?"
    )
    .bind(match_id)
    .fetch_optional(db)
    .await?;

    let bracket_id = match bracket_id {
        Some((id,)) => id,
        None => return Ok(()), // Матч не найден в кэше - ничего не делаем
    };

    // 2. Получить статусы только тех матчей, где есть участники
    // (пустые матчи не учитываются при определении статуса сетки)
    let matches: Vec<(String,)> = sqlx::query_as(
        "SELECT status
         FROM matches_cache
         WHERE bracket_id = ?
         AND (p1_id IS NOT NULL OR p2_id IS NOT NULL)"
    )
    .bind(bracket_id)
    .fetch_all(db)
    .await?;

    if matches.is_empty() {
        return Ok(());
    }

    // 3. Определить статус сетки на основе статусов матчей
    let mut has_in_progress = false;
    let mut all_completed = true;

    for (status_str,) in matches {
        match status_str.as_str() {
            "in_progress" => {
                has_in_progress = true;
                all_completed = false;
            }
            "scheduled" => {
                all_completed = false;
            }
            "completed" => {
                // Ничего не делаем
            }
            _ => {
                all_completed = false;
            }
        }
    }

    // Логика определения статуса сетки:
    // - Если есть хотя бы один in_progress -> сетка in_progress
    // - Иначе если все completed -> сетка completed
    // - Иначе -> сетка not_started
    let bracket_status = if has_in_progress {
        "in_progress"
    } else if all_completed {
        "completed"
    } else {
        "not_started"
    };

    // 4. Обновить статус сетки в brackets_cache
    sqlx::query(
        "UPDATE brackets_cache
         SET status = ?,
             updated_at = datetime('now')
         WHERE bracket_id = ?"
    )
    .bind(bracket_status)
    .bind(bracket_id)
    .execute(db)
    .await?;

    println!(
        "[LOCAL SERVER] Updated bracket {} status to: {}",
        bracket_id, bracket_status
    );

    Ok(())
}

async fn advance_winner_to_next_match(
    db: &SqlitePool,
    match_id: i32,
    winner_id: Option<i32>,
    blue_score: i32,
    red_score: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("[advance_winner] START - match: {}, winner: {:?}", match_id, winner_id);

    // Получить информацию о текущем матче (плоские поля)
    let match_row: Option<(i32, i32, i32, Option<i32>, Option<String>, Option<String>, Option<i32>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT bracket_id, round_number, match_number,
                    p1_id, p1_name, p1_club,
                    p2_id, p2_name, p2_club
             FROM matches_cache WHERE match_id = ?"
        )
        .bind(match_id)
        .fetch_optional(db)
        .await?;

    let (bracket_id, current_round, current_match_number,
         p1_id, p1_name, p1_club, p2_id, p2_name, p2_club) = match match_row {
        Some(r) => r,
        None => return Ok(()),
    };

    println!("[advance_winner] Current match - round: {}, number: {}, bracket: {}",
             current_round, current_match_number, bracket_id);

    // Определить победителя (id, name, club)
    let winner_data: Option<(i32, Option<String>, Option<String>)> = if let Some(wid) = winner_id {
        // По winner_id
        if p1_id == Some(wid) {
            Some((wid, p1_name.clone(), p1_club.clone()))
        } else if p2_id == Some(wid) {
            Some((wid, p2_name.clone(), p2_club.clone()))
        } else {
            None
        }
    } else {
        // По счету
        if blue_score > red_score {
            p1_id.map(|id| (id, p1_name.clone(), p1_club.clone()))
        } else if red_score > blue_score {
            p2_id.map(|id| (id, p2_name.clone(), p2_club.clone()))
        } else {
            None // Ничья
        }
    };

    let (winner_fid, winner_name, winner_club) = match winner_data {
        Some(d) => d,
        None => {
            println!("[advance_winner] No winner (draw or missing data)");
            return Ok(());
        }
    };

    println!("[advance_winner] Winner: id={}, name={:?}", winner_fid, winner_name);

    // Вычислить следующий матч
    let next_round = current_round + 1;
    let next_match_number = current_match_number / 2;

    println!("[advance_winner] Next match - round: {}, number: {}, bracket: {}",
             next_round, next_match_number, bracket_id);

    // Найти следующий матч по плоским полям
    let next_row: Option<(i32, Option<i32>, Option<i32>)> = sqlx::query_as(
        "SELECT match_id, p1_id, p2_id
         FROM matches_cache
         WHERE bracket_id = ? AND round_number = ? AND match_number = ?"
    )
    .bind(bracket_id)
    .bind(next_round)
    .bind(next_match_number)
    .fetch_optional(db)
    .await?;

    if let Some((next_id, next_p1_id, next_p2_id)) = next_row {
        println!("[advance_winner] Found next match: {}, checking free slots...", next_id);

        // Проверяем, нет ли уже победителя в следующем матче
        if next_p1_id == Some(winner_fid) || next_p2_id == Some(winner_fid) {
            println!("[advance_winner] ⚠️ Winner already in next match {}, skipping", next_id);
            return Ok(());
        }

        // Выбираем первый свободный слот
        if next_p1_id.is_none() {
            println!("[advance_winner] Free slot: p1, advancing winner");
            sqlx::query(
                "UPDATE matches_cache
                 SET p1_id = ?, p1_name = ?, p1_club = ?, updated_at = datetime('now')
                 WHERE match_id = ?"
            )
            .bind(winner_fid)
            .bind(&winner_name)
            .bind(&winner_club)
            .bind(next_id)
            .execute(db)
            .await?;
            println!("[advance_winner] ✅ Winner advanced to match {} p1 slot", next_id);
        } else if next_p2_id.is_none() {
            println!("[advance_winner] Free slot: p2, advancing winner");
            sqlx::query(
                "UPDATE matches_cache
                 SET p2_id = ?, p2_name = ?, p2_club = ?, updated_at = datetime('now')
                 WHERE match_id = ?"
            )
            .bind(winner_fid)
            .bind(&winner_name)
            .bind(&winner_club)
            .bind(next_id)
            .execute(db)
            .await?;
            println!("[advance_winner] ✅ Winner advanced to match {} p2 slot", next_id);
        } else {
            println!("[advance_winner] ⚠️ Both slots occupied in match {}, cannot advance", next_id);
        }
    } else {
        println!("[advance_winner] No next match found (probably final)");
    }

    Ok(())
}

// Вызов администратора от судьи — отправляет событие в admin_events_channel
async fn call_admin_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<CallAdminRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    println!("[LOCAL SERVER] call_admin_handler - table_number: {}", payload.table_number);

    let event = serde_json::json!({
        "type": "admin_called",
        "table_number": payload.table_number,
        "judge_name": payload.judge_name,
        "message": payload.message,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    let _ = state.admin_events_channel.send(event.to_string());

    Ok(Json(serde_json::json!({ "status": "sent" })))
}

// ============================================================
// Secretary handlers (взвешивание)
// ============================================================

#[derive(Deserialize)]
struct SecretaryParticipantsQuery {
    tournament_id: i32,
    search: Option<String>,
}

async fn get_secretary_participants_handler(
    State(state): State<LocalServerState>,
    Query(params): Query<SecretaryParticipantsQuery>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    use sqlx::Row;

    let search = params.search.unwrap_or_default();
    let rows = if search.chars().count() >= 3 {
        let pattern = format!("%{}%", search.to_lowercase());
        sqlx::query(
            "SELECT fighter_id, full_name, club_name, birth_date, declared_weight,
                    entries_json, is_confirmed, confirmed_at
             FROM secretary_data_cache
             WHERE tournament_id = ? AND full_name_lower LIKE ?
             ORDER BY full_name
             LIMIT 50"
        )
        .bind(params.tournament_id)
        .bind(&pattern)
        .fetch_all(&*state.db)
        .await?
    } else {
        sqlx::query(
            "SELECT fighter_id, full_name, club_name, birth_date, declared_weight,
                    entries_json, is_confirmed, confirmed_at
             FROM secretary_data_cache
             WHERE tournament_id = ?
             ORDER BY full_name
             LIMIT 100"
        )
        .bind(params.tournament_id)
        .fetch_all(&*state.db)
        .await?
    };

    let result: Vec<serde_json::Value> = rows.iter().map(|row| {
        let entries_json: Option<String> = row.get("entries_json");
        let entries: serde_json::Value = entries_json
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!([]));

        serde_json::json!({
            "fighter_id": row.get::<i32, _>("fighter_id"),
            "full_name": row.get::<String, _>("full_name"),
            "club_name": row.get::<Option<String>, _>("club_name").unwrap_or_default(),
            "birth_date": row.get::<Option<String>, _>("birth_date").unwrap_or_default(),
            "declared_weight": row.get::<Option<f64>, _>("declared_weight"),
            "entries": entries,
            "is_confirmed": row.get::<i32, _>("is_confirmed") != 0,
            "confirmed_at": row.get::<Option<String>, _>("confirmed_at"),
        })
    }).collect();

    Ok(Json(result))
}

async fn get_secretary_participant_handler(
    State(state): State<LocalServerState>,
    Path(fighter_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    use sqlx::Row;

    let row = sqlx::query(
        "SELECT fighter_id, full_name, club_name, birth_date, declared_weight,
                entries_json, is_confirmed, confirmed_at
         FROM secretary_data_cache
         WHERE fighter_id = ?"
    )
    .bind(fighter_id)
    .fetch_optional(&*state.db)
    .await?;

    match row {
        None => Err(AppError::NotFound("Участник не найден".to_string())),
        Some(row) => {
            let entries_json: Option<String> = row.get("entries_json");
            let entries: serde_json::Value = entries_json
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::json!([]));

            Ok(Json(serde_json::json!({
                "fighter_id": row.get::<i32, _>("fighter_id"),
                "full_name": row.get::<String, _>("full_name"),
                "club_name": row.get::<Option<String>, _>("club_name").unwrap_or_default(),
                "birth_date": row.get::<Option<String>, _>("birth_date").unwrap_or_default(),
                "declared_weight": row.get::<Option<f64>, _>("declared_weight"),
                "entries": entries,
                "is_confirmed": row.get::<i32, _>("is_confirmed") != 0,
                "confirmed_at": row.get::<Option<String>, _>("confirmed_at"),
            })))
        }
    }
}

#[derive(Deserialize)]
struct ConfirmParticipantRequest {
    fighter_id: i32,
    tournament_id: i32,
}

async fn confirm_secretary_participant_handler(
    State(state): State<LocalServerState>,
    Json(payload): Json<ConfirmParticipantRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    sqlx::query(
        "UPDATE secretary_data_cache
         SET is_confirmed = 1, confirmed_at = datetime('now')
         WHERE fighter_id = ? AND tournament_id = ?"
    )
    .bind(payload.fighter_id)
    .bind(payload.tournament_id)
    .execute(&*state.db)
    .await?;

    // Обновить флаги is_confirmed в matches_cache чтобы судьи видели изменение
    sqlx::query(
        "UPDATE matches_cache SET p1_confirmed = 1
         WHERE p1_id = ? AND tournament_id = ?"
    )
    .bind(payload.fighter_id)
    .bind(payload.tournament_id)
    .execute(&*state.db)
    .await?;

    sqlx::query(
        "UPDATE matches_cache SET p2_confirmed = 1
         WHERE p2_id = ? AND tournament_id = ?"
    )
    .bind(payload.fighter_id)
    .bind(payload.tournament_id)
    .execute(&*state.db)
    .await?;

    // Отправить WebSocket-событие всем судьям через admin_events_channel
    let event = serde_json::json!({
        "type": "participant_confirmed",
        "fighter_id": payload.fighter_id,
        "tournament_id": payload.tournament_id,
    });
    let _ = state.admin_events_channel.send(event.to_string());

    Ok(Json(serde_json::json!({ "status": "confirmed" })))
}

#[derive(Deserialize)]
struct SecretaryStatsQuery {
    tournament_id: i32,
}

async fn get_secretary_stats_handler(
    State(state): State<LocalServerState>,
    Query(params): Query<SecretaryStatsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    use sqlx::Row;

    // Общий счётчик
    let totals: Option<(i64, i64)> = sqlx::query_as(
        "SELECT COUNT(*), SUM(CASE WHEN is_confirmed = 1 THEN 1 ELSE 0 END)
         FROM secretary_data_cache WHERE tournament_id = ?"
    )
    .bind(params.tournament_id)
    .fetch_optional(&*state.db)
    .await?;

    let (total, confirmed) = totals.unwrap_or((0, 0));

    // Счётчик по видам спорта (из entries_json)
    // Используем упрощённый подход: группируем по полю sport_name из entries_json
    // Так как SQLite не поддерживает JSON_EACH без расширений — агрегируем в Rust
    let rows = sqlx::query(
        "SELECT entries_json, is_confirmed
         FROM secretary_data_cache WHERE tournament_id = ? AND entries_json IS NOT NULL"
    )
    .bind(params.tournament_id)
    .fetch_all(&*state.db)
    .await?;

    // Считаем уникальных людей по виду спорта (не заявки)
    // Один человек с заявками в нескольких категориях одного спорта — считается 1 раз
    let mut sport_map: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();
    for row in &rows {
        let entries_json: Option<String> = row.get("entries_json");
        let is_confirmed: i32 = row.get("is_confirmed");
        if let Some(json_str) = entries_json {
            if let Ok(entries) = serde_json::from_str::<Vec<serde_json::Value>>(&json_str) {
                // Собираем уникальные виды спорта для этого участника
                let mut seen_sports: std::collections::HashSet<String> = std::collections::HashSet::new();
                for entry in entries {
                    if let Some(sport) = entry.get("sport_name").and_then(|v| v.as_str()) {
                        seen_sports.insert(sport.to_string());
                    }
                }
                // Добавляем участника в каждый уникальный вид спорта один раз
                for sport in seen_sports {
                    let counter = sport_map.entry(sport).or_insert((0, 0));
                    counter.0 += 1;
                    if is_confirmed != 0 {
                        counter.1 += 1;
                    }
                }
            }
        }
    }

    let by_sport: Vec<serde_json::Value> = sport_map.iter().map(|(sport, (t, c))| {
        serde_json::json!({
            "sport_name": sport,
            "total": t,
            "confirmed": c,
        })
    }).collect();

    Ok(Json(serde_json::json!({
        "total": total,
        "confirmed": confirmed,
        "by_sport": by_sport,
    })))
}

// Отдача файлов документов секретаря (скачанных Администратором)
async fn get_secretary_doc_handler(
    State(state): State<LocalServerState>,
    Path((tournament_id, filename)): Path<(i32, String)>,
) -> impl IntoResponse {
    use axum::http::{header, StatusCode};
    use axum::response::Response;
    use axum::body::Body;

    // Защита от path traversal
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::empty())
            .unwrap();
    }

    let file_path = state.docs_base_dir.join(tournament_id.to_string()).join(&filename);

    match std::fs::read(&file_path) {
        Ok(bytes) => {
            let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
            let content_type = match ext.as_str() {
                "pdf"  => "application/pdf",
                "jpg" | "jpeg" => "image/jpeg",
                "png"  => "image/png",
                "webp" => "image/webp",
                _      => "application/octet-stream",
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CACHE_CONTROL, "max-age=86400")
                .body(Body::from(bytes))
                .unwrap()
        }
        Err(_) => {
            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::empty())
                .unwrap()
        }
    }
}

// Поиск спортсменов из fighters_cache (для автодополнения у судей)
#[derive(Deserialize)]
struct SearchFightersQuery {
    q: String,
}

async fn search_fighters_handler(
    State(state): State<LocalServerState>,
    Query(params): Query<SearchFightersQuery>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    let query = params.q;
    if query.chars().count() < 3 {
        return Ok(Json(vec![]));
    }

    let pattern = format!("%{}%", query.to_lowercase());
    let rows = sqlx::query(
        "SELECT fighter_id, full_name, club_name, gender
         FROM fighters_cache
         WHERE full_name_lower LIKE ?
         ORDER BY full_name
         LIMIT 20"
    )
    .bind(&pattern)
    .fetch_all(&*state.db)
    .await?;

    use sqlx::Row;
    let result: Vec<serde_json::Value> = rows.iter().map(|row| {
        serde_json::json!({
            "id": row.get::<i32, _>("fighter_id"),
            "full_name": row.get::<String, _>("full_name"),
            "club_name": row.get::<Option<String>, _>("club_name"),
            "gender": row.get::<Option<String>, _>("gender"),
        })
    }).collect();

    Ok(Json(result))
}
