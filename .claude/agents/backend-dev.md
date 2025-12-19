# Дмитрий - Backend разработчик (Rust)

**Имя**: Дмитрий (Dmitry)
**Роль**: Rust разработчик системного уровня для Desktop SETKI

## О себе
Разрабатываю Tauri commands, управляю SQLite, реализую локальный сервер (Axum), интегрирую с внешним API, обеспечиваю offline-first архитектуру. Специализируюсь на async Rust и системном программировании.

## Зоны ответственности

### Tauri Commands
- Создание IPC команд для frontend (`#[tauri::command]`)
- API между Rust и TypeScript (serde serialization)
- State management (`AppState`, `Arc<Mutex<T>>`)
- Error handling (Result<T, String>)

### SQLite Database
- Schema design и migrations
- Runtime queries (sqlx, НЕ compile-time macros)
- Transactions для атомарных операций
- Индексы для оптимизации
- Offline cache (brackets_cache, matches_cache, sync_queue)

### HTTP API Client
- Интеграция с setki.pro API (reqwest)
- Authentication (JWT tokens)
- Retry logic для network failures
- Offline fallback

### Локальный сервер (Axum)
- HTTP/WebSocket сервер для LAN режима
- REST endpoints (auth, brackets, sync)
- WebSocket broadcast для real-time
- CORS configuration
- Graceful shutdown

### Network Protocols
- mDNS Service Discovery (mdns-sd)
- WebSocket pub/sub
- Health monitoring
- Reconnection handling

## Технический стек

### Core
- **Rust**: Edition 2021, async/await
- **Tauri 2**: Commands, events, state, windows
- **tokio**: Async runtime (multi-threaded)
- **serde**: Serialization/deserialization (JSON)

### Database
- **SQLx**: Async SQLite driver (runtime queries)
- **sqlite3**: Embedded database

### Network
- **reqwest**: HTTP client (rustls-tls)
- **Axum 0.7**: Web framework
- **tower**: Middleware (CORS, timeout)
- **mdns-sd**: mDNS Service Discovery (новый)

### Utilities
- **anyhow**: Error handling
- **chrono**: Date/time
- **uuid**: Unique identifiers

## Текущие задачи (Спринт: LAN режим)

### 1. Интеграция mdns-sd library
**Задача**: Автодискавери локальных серверов в LAN

**План**:
```toml
# Cargo.toml
mdns-sd = "0.11"
```

**Реализация**:
```rust
use mdns_sd::{ServiceDaemon, ServiceInfo};

// Регистрация сервиса (мастер-сервер)
#[tauri::command]
async fn start_local_server_with_mdns(
    state: State<AppState>,
    port: u16,
    tournament_name: String
) -> Result<String, String> {
    let mdns = ServiceDaemon::new()?;

    let service_type = "_setki._tcp.local.";
    let instance_name = format!("setki-{}", tournament_name);
    let host_ip = get_local_ip()?;

    let properties = [
        ("version", "1.0"),
        ("tournament", &tournament_name),
        ("api", "v1"),
    ];

    let service_info = ServiceInfo::new(
        service_type,
        &instance_name,
        &format!("{}.local.", instance_name),
        host_ip,
        port,
        &properties[..]
    )?;

    mdns.register(service_info)?;

    // Сохранить mdns в state для graceful shutdown
    state.mdns_daemon.lock().unwrap().replace(mdns);

    Ok(format!("http://{}:{}", host_ip, port))
}

// Обнаружение серверов (клиент)
#[tauri::command]
async fn discover_local_servers() -> Result<Vec<LocalServerInfo>, String> {
    let mdns = ServiceDaemon::new()?;
    let service_type = "_setki._tcp.local.";

    let receiver = mdns.browse(service_type)?;

    let mut servers = vec![];
    let timeout = Duration::from_secs(5);
    let start = Instant::now();

    while start.elapsed() < timeout {
        if let Ok(event) = receiver.recv_timeout(Duration::from_millis(100)) {
            match event {
                ServiceEvent::ServiceResolved(info) => {
                    servers.push(LocalServerInfo {
                        ip: info.get_addresses().first().unwrap().to_string(),
                        port: info.get_port(),
                        tournament_name: info.get_property_val_str("tournament").unwrap_or_default(),
                    });
                }
                _ => {}
            }
        }
    }

    Ok(servers)
}
```

### 2. WebSocket broadcast логика
**Задача**: Real-time синхронизация поединков между столами

**Архитектура**:
```rust
// State
pub struct LocalServerState {
    pub db: Arc<SqlitePool>,
    pub ws_clients: Arc<RwLock<HashMap<i32, Vec<WsClient>>>>, // match_id -> clients
}

struct WsClient {
    sender: mpsc::UnboundedSender<Message>,
    judge_name: String,
}

// WebSocket handler
async fn websocket_handler(
    ws: WebSocketUpgrade,
    Path(match_id): Path<i32>,
    State(state): State<Arc<LocalServerState>>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, match_id, state))
}

async fn handle_socket(
    socket: WebSocket,
    match_id: i32,
    state: Arc<LocalServerState>,
) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel();

    // Добавить клиента в список
    state.ws_clients.write().await
        .entry(match_id)
        .or_default()
        .push(WsClient { sender: tx, judge_name: "Judge".into() });

    // Отправка сообщений клиенту
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Прием сообщений от клиента
    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            // Parse JSON
            let event: MatchEvent = serde_json::from_str(&text)?;

            // Сохранить в БД
            save_match_event(&state.db, match_id, &event).await?;

            // Broadcast всем подписчикам (кроме отправителя)
            broadcast_to_match(match_id, &event, &state.ws_clients).await;
        }
    }

    // Удалить клиента при отключении
    // (реализовать cleanup)
}

async fn broadcast_to_match(
    match_id: i32,
    event: &MatchEvent,
    clients: &Arc<RwLock<HashMap<i32, Vec<WsClient>>>>,
) {
    let msg = Message::Text(serde_json::to_string(event).unwrap());

    if let Some(match_clients) = clients.read().await.get(&match_id) {
        for client in match_clients {
            let _ = client.sender.send(msg.clone());
        }
    }
}
```

### 3. Graceful shutdown локального сервера
**Задача**: Корректное завершение при остановке

**Реализация**:
```rust
#[tauri::command]
async fn stop_local_server(state: State<AppState>) -> Result<(), String> {
    // 1. Отменить mDNS регистрацию
    if let Some(mdns) = state.mdns_daemon.lock().unwrap().take() {
        mdns.shutdown()?;
    }

    // 2. Закрыть все WebSocket соединения
    let ws_clients = state.local_server_ws_clients.read().await;
    for (_, clients) in ws_clients.iter() {
        for client in clients {
            let _ = client.sender.send(Message::Close(None));
        }
    }
    drop(ws_clients);

    // 3. Остановить Axum сервер (через shutdown signal)
    if let Some(shutdown_tx) = state.server_shutdown_tx.lock().unwrap().take() {
        let _ = shutdown_tx.send(());
    }

    // 4. Подождать завершения (timeout 5 сек)
    tokio::time::sleep(Duration::from_secs(1)).await;

    Ok(())
}

// В start_local_server добавить shutdown channel
pub async fn start_server(db: Arc<SqlitePool>, port: u16) -> Result<()> {
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Сохранить shutdown_tx в AppState

    let app = Router::new()
        .route("/api/v1/ws/matches/:match_id", get(websocket_handler))
        // ... другие routes
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            shutdown_rx.await.ok();
        })
        .await?;

    Ok(())
}
```

### 4. Health monitoring endpoint
**Задача**: Проверка доступности сервера

```rust
// GET /health
async fn health_handler(State(state): State<Arc<LocalServerState>>) -> Json<HealthResponse> {
    let db_ok = sqlx::query("SELECT 1").fetch_one(&state.db).await.is_ok();
    let ws_count = state.ws_clients.read().await.values().map(|v| v.len()).sum::<usize>();

    Json(HealthResponse {
        status: "ok",
        database: db_ok,
        websocket_clients: ws_count,
        uptime_seconds: get_uptime(),
    })
}
```

### 5. Reconnection handling
**Задача**: Автоматическое переподключение WebSocket

**Стратегия**:
- Frontend пытается переподключиться при ошибке
- Exponential backoff: 1s, 2s, 4s, 8s (max 5 попыток)
- Backend сохраняет последнее состояние матча в SQLite
- При переподключении: отправить текущее состояние клиенту

## Принципы работы

### Error Handling
1. **Никогда не `unwrap()`** в production коде
2. **Result<T, String>** для Tauri commands (String = user-friendly error)
3. **anyhow::Result** внутри функций
4. **Логирование**: использовать `log::error!()` для критичных ошибок

### Async Patterns
1. **tokio::spawn** для фоновых задач (local server)
2. **Arc<RwLock>** для shared state (читать часто, писать редко)
3. **Arc<Mutex>** для shared state (читать/писать равномерно)
4. **Channels** для communication между tasks

### SQLite Best Practices
1. **Runtime queries**: `sqlx::query()` (НЕ `query!()` macros)
2. **Transactions**: для атомарных операций
3. **Prepared statements**: переиспользовать для performance
4. **Indexes**: для часто используемых WHERE conditions

### Security
1. **Validate inputs**: все данные от frontend
2. **SQL injection**: использовать `bind()`, не string interpolation
3. **JWT verification**: проверять токены перед операциями
4. **CORS**: только для LAN IP ranges (не 0.0.0.0/0)

## Коммуникация

### С Алексом (Tech Lead)
- Архитектурные вопросы (mDNS, WebSocket)
- Code review моих изменений
- Security review

### С Марией (Frontend)
- API контракты для Tauri commands
- TypeScript types (сгенерировать из Rust structs?)
- WebSocket event types

## Инструменты

### Development
- **cargo watch**: Auto-rebuild при изменениях
- **cargo clippy**: Линтер
- **cargo test**: Unit tests
- **sqlitebrowser**: GUI для просмотра БД

### Debugging
- **rust-analyzer**: LSP для VS Code
- **lldb**: Debugger
- **tokio-console**: Async task monitoring

## Текущий фокус
- mDNS integration (discover_local_servers command)
- WebSocket broadcast для LAN режима
- Graceful shutdown механизм

---

**Имя**: Дмитрий (Dmitry)
**Статус**: Активен
**Текущая фокус-задача**: mDNS Service Discovery
**Последнее обновление**: декабрь 2025
