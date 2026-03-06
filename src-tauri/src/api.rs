use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;
use crate::logger::FileLogger;

// Helper функция для определения локального сервера
fn is_local_url(url: &str) -> bool {
    if url.contains("192.168.") || url.contains("10.0.") || url.contains("localhost") || url.contains("127.0.0.1") {
        return true;
    }

    // Проверка диапазона 172.16-31.x.x
    if url.contains("172.") {
        // Извлекаем второй октет IP-адреса
        if let Some(start) = url.find("172.") {
            let rest = &url[start + 4..];
            if let Some(dot_pos) = rest.find('.') {
                if let Ok(second_octet) = rest[..dot_pos].parse::<u8>() {
                    return (16..=31).contains(&second_octet);
                }
            }
        }
    }

    false
}

// Типы данных для API
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthResponse {
    pub access_token: String,
    pub user_id: i32,
    pub role: String,
    pub tournament_id: Option<i32>,
    pub judge_name: Option<String>,
    pub table_number: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub login: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PinLoginRequest {
    pub pin_code: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentBrief {
    pub id: i32,
    pub name: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: String,
    pub image_url: Option<String>,
    pub organizer_id: i32,
    pub brackets_count: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentSession {
    pub id: i32,
    pub tournament_id: i32,
    pub pin_code: String,
    pub total_tables: i32,
    pub admin_user_id: i32,
    pub tournament: serde_json::Value,
    pub brackets: Vec<serde_json::Value>,
    pub scoring_config: serde_json::Value,
}

// Типы для работы с поединками
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MatchEvent {
    pub id: Option<i64>,
    pub match_id: i32,
    pub event_type: String,
    pub participant: String,
    pub points: Option<i32>,
    pub action_name: Option<String>,
    pub timestamp: i64,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateMatchScoreRequest {
    pub match_id: i32,
    pub red_score: i32,
    pub blue_score: i32,
    pub red_warnings: i32,
    pub blue_warnings: i32,
    pub status: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct FinishMatchRequest {
    pub match_id: i32,
    pub winner_id: Option<i32>,
    pub result_type: String,
    pub final_red_score: i32,
    pub final_blue_score: i32,
}

// API Client
pub struct ApiClient {
    client: Client,
    base_url: String,
    db: Arc<SqlitePool>,
    logger: Arc<FileLogger>,
}

impl ApiClient {
    pub fn new(base_url: String, db: Arc<SqlitePool>, logger: Arc<FileLogger>) -> Self {
        // Если base_url - локальный сервер и не содержит /api/v1, добавляем его
        let normalized_url = if is_local_url(&base_url) && !base_url.contains("/api/v1") {
            format!("{}/api/v1", base_url.trim_end_matches('/'))
        } else {
            base_url.clone()
        };

        logger.info(&format!("[ApiClient::new] Original base_url: {}", base_url));
        logger.info(&format!("[ApiClient::new] Normalized base_url: {}", normalized_url));
        logger.info(&format!("[ApiClient::new] is_local_url: {}", is_local_url(&base_url)));

        Self {
            client: Client::new(),
            base_url: normalized_url,
            db,
            logger,
        }
    }

    // Проверить, является ли текущий сервер локальным
    fn is_local_server(&self) -> bool {
        is_local_url(&self.base_url)
    }

    // Вход администратора
    pub async fn login_admin(&self, login: String, password: String) -> Result<AuthResponse> {
        let url = format!("{}/desktop/auth/login", self.base_url);
        let req = LoginRequest { login: login.clone(), password: password.clone() };

        let response = self.client
            .post(&url)
            .json(&req)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!("Ошибка авторизации: {}", response.status()));
        }

        let mut auth: AuthResponse = response.json().await?;
        auth.judge_name = None; // Админ не имеет judge_name

        // Сохранить токен админа в БД (id = 1)
        self.save_admin_token(&auth.access_token).await?;

        // Сохранить credentials для автоматического входа
        self.save_credentials(&login, &password, auth.user_id).await?;

        Ok(auth)
    }

    // Вход судьи по PIN (с fallback на offline)
    pub async fn login_by_pin(
        &self,
        pin_code: String,
        judge_name: Option<String>,
        table_number: Option<i32>,
    ) -> Result<AuthResponse> {
        let url = format!("{}/desktop/auth/pin-auth", self.base_url);

        self.logger.info("========== ApiClient::login_by_pin START ==========");
        self.logger.info(&format!("base_url: {}", self.base_url));
        self.logger.info(&format!("full URL: {}", url));
        self.logger.info(&format!("pin_code: {}", pin_code));
        self.logger.info(&format!("judge_name: {:?}", judge_name));
        self.logger.info(&format!("table_number: {:?}", table_number));

        // Если base_url - локальный сервер (содержит 192.168 или 10.0), отправляем judge_name и table_number
        let is_local_server = is_local_url(&self.base_url);

        self.logger.info(&format!("is_local_server: {}", is_local_server));

        #[derive(serde::Serialize, Debug)]
        struct LocalLoginRequest {
            pin_code: String,
            judge_name: Option<String>,
            table_number: Option<i32>,
        }

        // Попытка online авторизации
        self.logger.info("Sending HTTP request...");
        let online_result = if is_local_server {
            self.logger.info("Sending LOCAL SERVER request with judge_name and table_number");
            let request_body = LocalLoginRequest {
                pin_code: pin_code.clone(),
                judge_name: judge_name.clone(),
                table_number,
            };
            self.logger.info(&format!("Request body: {:?}", serde_json::to_string(&request_body).unwrap_or_default()));
            self.logger.info(&format!("POST URL: {}", url));

            // Для локального сервера отправляем расширенный запрос
            let result = self.client
                .post(&url)
                .json(&request_body)
                .send()
                .await;

            self.logger.info("HTTP send completed (local)");
            result
        } else {
            self.logger.info("Sending ONLINE request (setki.pro) with PIN only");
            let request_body = PinLoginRequest { pin_code: pin_code.clone() };
            self.logger.info(&format!("Request body: {:?}", serde_json::to_string(&request_body).unwrap_or_default()));
            self.logger.info(&format!("POST URL: {}", url));

            // Для setki.pro отправляем только PIN
            let result = self.client
                .post(&url)
                .json(&request_body)
                .send()
                .await;

            self.logger.info("HTTP send completed (online)");
            result
        };

        self.logger.info("HTTP request completed, checking response...");

        match online_result {
            Ok(response) if response.status().is_success() => {
                self.logger.info(&format!("HTTP SUCCESS - status: {}", response.status()));
                // Online успешно
                let auth: AuthResponse = response.json().await?;
                // Для локального сервера judge_name и table_number уже в ответе
                // Для онлайн-сервера их добавит Tauri command
                self.logger.info(&format!("Received auth response: user_id={}, role={}, tournament_id={:?}, judge_name={:?}, table_number={:?}",
                    auth.user_id, auth.role, auth.tournament_id, auth.judge_name, auth.table_number));
                self.logger.info("========== ApiClient::login_by_pin SUCCESS ==========");
                Ok(auth)
            },
            Ok(response) => {
                // HTTP запрос прошёл, но статус не успешный
                let status = response.status();
                let error_text = response.text().await.unwrap_or_else(|_| "No response body".to_string());
                self.logger.error(&format!("HTTP FAILED - status: {}, body: {}", status, error_text));
                self.logger.info("Falling back to offline mode...");
                self.login_by_pin_offline(pin_code).await
            },
            Err(e) => {
                // Ошибка сети (нет соединения)
                self.logger.error(&format!("HTTP ERROR - network error: {}", e));
                self.logger.info("Falling back to offline mode...");
                self.login_by_pin_offline(pin_code).await
            }
        }
    }

    // Offline вход по PIN (проверка из кэша)
    async fn login_by_pin_offline(&self, pin_code: String) -> Result<AuthResponse> {
        let record = sqlx::query_as::<_, (i32, String)>(
            "SELECT tournament_id, tournament_name FROM cached_pins WHERE pin_code = ?"
        )
        .bind(&pin_code)
        .fetch_optional(self.db.as_ref())
        .await?;

        match record {
            Some((tournament_id, _tournament_name)) => {
                // PIN найден в кэше - создаем временный токен
                let fake_token = format!("offline_pin_{}", pin_code);
                // Токен будет сохранен в save_judge_session с полными данными

                Ok(AuthResponse {
                    access_token: fake_token,
                    user_id: 0, // Временный ID для offline судьи
                    role: "referee".to_string(),
                    tournament_id: Some(tournament_id),
                    judge_name: None, // Имя будет добавлено через save_judge_session
                    table_number: None, // Номер стола будет добавлен через save_judge_session
                })
            },
            None => {
                Err(anyhow::anyhow!("PIN-код не найден. Требуется подключение к интернету для первого входа."))
            }
        }
    }

    // Сохранить сессию судьи (имя и номер стола) + токен
    pub async fn save_judge_session(&self, pin_code: &str, judge_name: &str, table_number: i32, tournament_id: Option<i32>, token: &str) -> Result<()> {
        self.logger.info("========== ApiClient::save_judge_session START ==========");
        self.logger.info(&format!("pin_code: {}", pin_code));
        self.logger.info(&format!("judge_name: {}", judge_name));
        self.logger.info(&format!("table_number: {}", table_number));
        self.logger.info(&format!("tournament_id: {:?}", tournament_id));
        self.logger.info(&format!("token: {}...", &token[..token.len().min(10)]));

        // 1. Проверить, что номер стола свободен
        if let Some(tid) = tournament_id {
            self.logger.info(&format!("Checking if table {} is free for tournament {}...", table_number, tid));
            let occupied = sqlx::query_as::<_, (i32,)>(
                "SELECT COUNT(*) FROM table_numbers WHERE tournament_id = ? AND table_number = ?"
            )
            .bind(tid)
            .bind(table_number)
            .fetch_one(self.db.as_ref())
            .await?;

            if occupied.0 > 0 {
                self.logger.error(&format!("Table {} is already occupied", table_number));
                return Err(anyhow::anyhow!("Номер стола {} уже занят", table_number));
            }
            self.logger.info(&format!("Table {} is free", table_number));
        }

        // 2. Сохранить токен судьи
        self.logger.info("Saving judge token...");
        self.save_judge_token(token, pin_code, judge_name, table_number, tournament_id).await?;
        self.logger.info("Judge token saved successfully");

        // 3. Сохранить сессию судьи
        self.logger.info("Inserting judge session into database...");
        let session_id = sqlx::query(
            "INSERT INTO judge_sessions (pin_code, judge_name, table_number, tournament_id, logged_in_at)
             VALUES (?, ?, ?, ?, datetime('now'))"
        )
        .bind(pin_code)
        .bind(judge_name)
        .bind(table_number)
        .bind(tournament_id)
        .execute(self.db.as_ref())
        .await?
        .last_insert_rowid();
        self.logger.info(&format!("Judge session created with id: {}", session_id));

        // 4. Зарезервировать номер стола
        if let Some(tid) = tournament_id {
            self.logger.info(&format!("Reserving table {} for tournament {}...", table_number, tid));
            sqlx::query(
                "INSERT INTO table_numbers (tournament_id, table_number, judge_name, judge_session_id, occupied_at)
                 VALUES (?, ?, ?, ?, datetime('now'))"
            )
            .bind(tid)
            .bind(table_number)
            .bind(judge_name)
            .bind(session_id)
            .execute(self.db.as_ref())
            .await?;
            self.logger.info(&format!("Table {} reserved successfully", table_number));
        }

        self.logger.info("========== ApiClient::save_judge_session SUCCESS ==========");
        Ok(())
    }

    // Освободить номер стола при выходе судьи
    pub async fn release_table_number(&self, tournament_id: i32, table_number: i32) -> Result<()> {
        // Удаляем из table_numbers
        sqlx::query(
            "DELETE FROM table_numbers WHERE tournament_id = ? AND table_number = ?"
        )
        .bind(tournament_id)
        .bind(table_number)
        .execute(self.db.as_ref())
        .await?;

        // Удаляем из judge_sessions (для мониторинга)
        sqlx::query(
            "DELETE FROM judge_sessions WHERE tournament_id = ? AND table_number = ?"
        )
        .bind(tournament_id)
        .bind(table_number)
        .execute(self.db.as_ref())
        .await?;

        Ok(())
    }

    // Проверить наличие кэшированного PIN
    pub async fn check_cached_pin(&self, pin_code: &str) -> Result<bool> {
        let record = sqlx::query_as::<_, (i32,)>(
            "SELECT COUNT(*) FROM cached_pins WHERE pin_code = ?"
        )
        .bind(pin_code)
        .fetch_one(self.db.as_ref())
        .await?;

        Ok(record.0 > 0)
    }

    // Сохранить PIN в кэш при скачивании турнира
    pub async fn cache_pin(&self, pin_code: &str, tournament_id: i32, tournament_name: &str) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO cached_pins (pin_code, tournament_id, tournament_name, cached_at)
             VALUES (?, ?, ?, datetime('now'))"
        )
        .bind(pin_code)
        .bind(tournament_id)
        .bind(tournament_name)
        .execute(self.db.as_ref())
        .await?;

        Ok(())
    }

    // Получить PIN из кэша по tournament_id
    pub async fn get_cached_pin(&self, tournament_id: i32) -> Result<String> {
        println!("[get_cached_pin] Поиск PIN для турнира {}", tournament_id);

        let record = sqlx::query_as::<_, (String,)>(
            "SELECT pin_code FROM cached_pins WHERE tournament_id = ?"
        )
        .bind(tournament_id)
        .fetch_optional(self.db.as_ref())
        .await?;

        match record {
            Some((pin,)) => {
                println!("[get_cached_pin] ✓ Найден PIN в кэше: {}", pin);
                Ok(pin)
            },
            None => {
                println!("[get_cached_pin] ✗ PIN не найден в кэше для турнира {}", tournament_id);
                Err(anyhow::anyhow!("PIN не найден в кэше для турнира {}", tournament_id))
            }
        }
    }

    // Сохранить токен админа в БД (id = 1)
    async fn save_admin_token(&self, token: &str) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO auth (id, token, created_at) VALUES (1, ?, datetime('now'))"
        )
        .bind(token)
        .execute(self.db.as_ref())
        .await?;

        Ok(())
    }

    // Сохранить токен судьи в БД (по pin_code)
    async fn save_judge_token(&self, token: &str, pin_code: &str, judge_name: &str, table_number: i32, tournament_id: Option<i32>) -> Result<()> {
        self.logger.info("========== save_judge_token START ==========");
        self.logger.info(&format!("pin_code: {}", pin_code));
        self.logger.info(&format!("token: {}...", &token[..token.len().min(10)]));
        self.logger.info(&format!("judge_name: {}", judge_name));
        self.logger.info(&format!("table_number: {}", table_number));
        self.logger.info(&format!("tournament_id: {:?}", tournament_id));

        // Удаляем старый токен судьи если он есть (по pin_code + judge_name + table_number)
        sqlx::query(
            "DELETE FROM judge_auth WHERE pin_code = ? AND judge_name = ? AND table_number = ?"
        )
        .bind(pin_code)
        .bind(judge_name)
        .bind(table_number)
        .execute(self.db.as_ref())
        .await?;

        // Вставляем новый токен
        sqlx::query(
            "INSERT INTO judge_auth (pin_code, token, judge_name, table_number, tournament_id, created_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))"
        )
        .bind(pin_code)
        .bind(token)
        .bind(judge_name)
        .bind(table_number)
        .bind(tournament_id)
        .execute(self.db.as_ref())
        .await?;

        self.logger.info("Token saved to judge_auth table successfully");
        self.logger.info("========== save_judge_token END ==========");
        Ok(())
    }

    // Получить сохранённый токен админа
    async fn get_admin_token(&self) -> Result<Option<String>> {
        let record = sqlx::query_as::<_, (String,)>("SELECT token FROM auth WHERE id = 1")
            .fetch_optional(self.db.as_ref())
            .await?;

        Ok(record.map(|r| r.0))
    }

    // Получить сохранённый токен судьи по pin_code
    #[allow(dead_code)]
    async fn get_judge_token(&self, pin_code: &str) -> Result<Option<String>> {
        let record = sqlx::query_as::<_, (String,)>("SELECT token FROM judge_auth WHERE pin_code = ?")
            .bind(pin_code)
            .fetch_optional(self.db.as_ref())
            .await?;

        Ok(record.map(|r| r.0))
    }

    // Получить все токены судей (для общей проверки авторизации)
    async fn get_any_judge_token(&self) -> Result<Option<String>> {
        let record = sqlx::query_as::<_, (String,)>("SELECT token FROM judge_auth LIMIT 1")
            .fetch_optional(self.db.as_ref())
            .await?;

        Ok(record.map(|r| r.0))
    }

    // Получить сохранённый токен (общий метод - проверяет сначала админа, потом любого судью)
    pub async fn get_token(&self) -> Result<Option<String>> {
        self.logger.info("========== get_token START ==========");

        // Сначала проверяем админа
        self.logger.info("Checking admin token...");
        if let Some(token) = self.get_admin_token().await? {
            self.logger.info(&format!("Found admin token: {}...", &token[..token.len().min(10)]));
            self.logger.info("========== get_token END (admin) ==========");
            return Ok(Some(token));
        }
        self.logger.info("No admin token found");

        // Потом любого судью
        self.logger.info("Checking judge token...");
        if let Some(token) = self.get_any_judge_token().await? {
            self.logger.info(&format!("Found judge token: {}...", &token[..token.len().min(10)]));
            self.logger.info("========== get_token END (judge) ==========");
            return Ok(Some(token));
        }
        self.logger.info("No judge token found");

        self.logger.error("No token found (neither admin nor judge)");
        self.logger.info("========== get_token END (none) ==========");
        Ok(None)
    }

    // Проверить, есть ли сохраненная авторизация
    pub async fn has_saved_auth(&self) -> Result<bool> {
        let token = self.get_token().await?;
        Ok(token.is_some())
    }

    // Сохранить credentials админа для автоматического входа
    async fn save_credentials(&self, login: &str, password: &str, user_id: i32) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO admin_credentials (id, login, password, user_id, updated_at)
             VALUES (1, ?, ?, ?, datetime('now'))"
        )
        .bind(login)
        .bind(password)
        .bind(user_id)
        .execute(self.db.as_ref())
        .await?;

        Ok(())
    }

    // Получить сохраненные credentials админа (login, password, user_id)
    pub async fn get_credentials(&self) -> Result<Option<(String, String, i32)>> {
        let record = sqlx::query_as::<_, (String, String, i32)>(
            "SELECT login, password, user_id FROM admin_credentials WHERE id = 1"
        )
        .fetch_optional(self.db.as_ref())
        .await?;

        Ok(record)
    }

    // Получить сохраненные данные последнего судьи (для автовхода)
    // Возвращает (pin_code, judge_name, table_number, tournament_id)
    pub async fn get_saved_judge_credentials(&self) -> Result<Option<(String, String, i32, i32)>> {
        let record = sqlx::query_as::<_, (String, String, i32, Option<i32>)>(
            "SELECT pin_code, judge_name, table_number, tournament_id
             FROM judge_auth
             ORDER BY created_at DESC
             LIMIT 1"
        )
        .fetch_optional(self.db.as_ref())
        .await?;

        // Преобразуем Option<i32> в i32 (если tournament_id NULL, используем 0)
        Ok(record.map(|(pin, name, table, tid)| (pin, name, table, tid.unwrap_or(0))))
    }

    // Очистить сохраненные credentials (при выходе)
    pub async fn clear_credentials(&self) -> Result<()> {
        // Удалить credentials админа
        sqlx::query("DELETE FROM admin_credentials WHERE id = 1")
            .execute(self.db.as_ref())
            .await?;

        // Удалить токен админа
        sqlx::query("DELETE FROM auth WHERE id = 1")
            .execute(self.db.as_ref())
            .await?;

        // Удалить все токены судей
        sqlx::query("DELETE FROM judge_auth")
            .execute(self.db.as_ref())
            .await?;

        Ok(())
    }

    // Скачать данные турнира для offline режима (батч-запрос)
    pub async fn download_tournament(&self, tournament_id: i32) -> Result<()> {
        let token = self.get_token().await?
            .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

        // Батч-запрос: получаем всё за один раз
        let url = format!("{}/desktop/tournaments/{}/download", self.base_url, tournament_id);
        println!("Загрузка турнира: {}", url);

        let response = self.client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await?;

        let status = response.status();
        println!("Статус ответа: {}", status);

        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Не удалось получить текст ошибки".to_string());
            println!("Текст ошибки: {}", error_text);
            return Err(anyhow::anyhow!("Ошибка загрузки данных: {} - {}", status, error_text));
        }

        let response_text = response.text().await?;
        println!("Размер ответа: {} байт", response_text.len());

        let data: serde_json::Value = serde_json::from_str(&response_text)
            .map_err(|e| anyhow::anyhow!("Ошибка парсинга JSON: {}. Первые 500 символов: {}", e, &response_text[..response_text.len().min(500)]))?;

        // DEBUG: Выводим структуру ответа для отладки
        println!("[downloadTournament] Структура ответа (ключи верхнего уровня): {:?}",
            data.as_object().map(|obj| obj.keys().collect::<Vec<_>>()));
        println!("[downloadTournament] pin_code на верхнем уровне: {:?}", data.get("pin_code"));
        println!("[downloadTournament] tournament.pin_code: {:?}",
            data.get("tournament").and_then(|t| t.get("pin_code")));

        // Извлекаем сетки с матчами
        let brackets = data["brackets"].as_array()
            .ok_or_else(|| anyhow::anyhow!("Неверный формат ответа"))?;

        // Сохраняем сетки и матчи (плоская схема)
        println!("[downloadTournament] Начинаем сохранение {} сеток", brackets.len());
        for bracket in brackets {
            let bracket_id = bracket["id"].as_i64().unwrap() as i32;
            println!("[downloadTournament] Обработка сетки ID: {}", bracket_id);

            // Извлекаем поля сетки
            let category_id = bracket["category_id"].as_i64().map(|v| v as i32);
            let category_name = bracket["category_name"].as_str().unwrap_or("").to_string();
            let weight_min = bracket["min_weight"].as_f64();
            let weight_max = bracket["max_weight"].as_f64();
            let gender = bracket["gender"].as_str().unwrap_or("").to_string();
            let sport_name = bracket["sport_name"].as_str().unwrap_or("").to_string();
            let bracket_type = bracket["bracket_type"].as_str().unwrap_or("single_elimination").to_string();
            let total_rounds = bracket["total_rounds"].as_i64().map(|v| v as i32);
            let status = bracket["status"].as_str().unwrap_or("not_started").to_string();
            let is_published = if bracket["is_published"].as_bool().unwrap_or(false) { 1 } else { 0 };

            sqlx::query(
                "INSERT OR REPLACE INTO brackets_cache
                 (bracket_id, tournament_id, category_id, category_name, weight_min, weight_max,
                  gender, sport_name, bracket_type, total_rounds, status, is_published, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
            )
            .bind(bracket_id)
            .bind(tournament_id)
            .bind(category_id)
            .bind(category_name)
            .bind(weight_min)
            .bind(weight_max)
            .bind(gender)
            .bind(sport_name)
            .bind(bracket_type)
            .bind(total_rounds)
            .bind(status)
            .bind(is_published)
            .execute(self.db.as_ref())
            .await?;

            // Сохранить все матчи этой сетки
            if let Some(matches) = bracket["matches"].as_array() {
                println!("[downloadTournament] Сетка {} содержит {} матчей", bracket_id, matches.len());
                for match_data in matches.iter() {
                    let match_id = match_data["id"].as_i64().unwrap_or(0) as i32;

                    // Извлекаем participant1 (поддержка нового и legacy форматов)
                    let (p1_id, p1_name, p1_club) = if let Some(p1) = match_data.get("participant1").filter(|v| v.is_object()) {
                        (
                            p1["id"].as_i64().map(|v| v as i32),
                            p1["full_name"].as_str().map(String::from),
                            p1["club_name"].as_str().map(String::from),
                        )
                    } else {
                        (
                            match_data["participant1_id"].as_i64().map(|v| v as i32),
                            match_data["fighter1_name"].as_str().map(String::from),
                            match_data["fighter1_club"].as_str().map(String::from),
                        )
                    };

                    // Извлекаем participant2
                    let (p2_id, p2_name, p2_club) = if let Some(p2) = match_data.get("participant2").filter(|v| v.is_object()) {
                        (
                            p2["id"].as_i64().map(|v| v as i32),
                            p2["full_name"].as_str().map(String::from),
                            p2["club_name"].as_str().map(String::from),
                        )
                    } else {
                        (
                            match_data["participant2_id"].as_i64().map(|v| v as i32),
                            match_data["fighter2_name"].as_str().map(String::from),
                            match_data["fighter2_club"].as_str().map(String::from),
                        )
                    };

                    let round_number = match_data["round_number"].as_i64().unwrap_or(1) as i32;
                    let match_number = match_data["match_number"].as_i64().unwrap_or(1) as i32;
                    let score_p1 = match_data["score_participant1"].as_i64().unwrap_or(0) as i32;
                    let score_p2 = match_data["score_participant2"].as_i64().unwrap_or(0) as i32;
                    let winner_id = match_data["winner_id"].as_i64().map(|v| v as i32);
                    let result_type = match_data["result_type"].as_str().map(String::from);
                    let status = match_data["status"].as_str().unwrap_or("scheduled").to_string();

                    sqlx::query(
                        "INSERT OR REPLACE INTO matches_cache
                         (match_id, bracket_id, tournament_id, round_number, match_number,
                          p1_id, p1_name, p1_club, p2_id, p2_name, p2_club,
                          score_p1, score_p2, winner_id, result_type, status, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
                    )
                    .bind(match_id)
                    .bind(bracket_id)
                    .bind(tournament_id)
                    .bind(round_number)
                    .bind(match_number)
                    .bind(p1_id)
                    .bind(p1_name)
                    .bind(p1_club)
                    .bind(p2_id)
                    .bind(p2_name)
                    .bind(p2_club)
                    .bind(score_p1)
                    .bind(score_p2)
                    .bind(winner_id)
                    .bind(result_type)
                    .bind(status)
                    .execute(self.db.as_ref())
                    .await?;
                }
                println!("[downloadTournament] Сохранено {} матчей для сетки {}", matches.len(), bracket_id);
            } else {
                println!("[downloadTournament] WARNING: Сетка {} не содержит матчей!", bracket_id);
            }
        }
        println!("[downloadTournament] Все сетки и матчи сохранены");

        // Кэшируем PIN-код (проверяем два возможных пути или генерируем локально)
        let pin_code = data.get("pin_code")
            .and_then(|v| v.as_str())
            .or_else(|| data.get("tournament").and_then(|t| t.get("pin_code")).and_then(|v| v.as_str()));

        let final_pin = if let Some(pin) = pin_code {
            println!("[downloadTournament] Найден PIN-код от сервера: {}", pin);
            pin.to_string()
        } else {
            // Генерируем локальный PIN-код: tournament_id + random 3 digits
            use rand::Rng;
            let mut rng = rand::thread_rng();
            let random_suffix: u32 = rng.gen_range(100..=999);
            let generated_pin = format!("{:03}{:03}", tournament_id % 1000, random_suffix);
            println!("[downloadTournament] WARNING: PIN-код не найден в ответе API");
            println!("[downloadTournament] Генерируем локальный PIN-код: {}", generated_pin);
            generated_pin
        };

        let tournament_name = data.get("tournament")
            .and_then(|t| t.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("Unknown");

        match self.cache_pin(&final_pin, tournament_id, tournament_name).await {
            Ok(_) => println!("[downloadTournament] ✓ PIN-код успешно сохранён в кэш"),
            Err(e) => println!("[downloadTournament] ✗ Ошибка сохранения PIN-кода: {}", e),
        }

        Ok(())
    }

    // Получить сетки из кэша (offline)
    pub async fn get_cached_brackets(&self, tournament_id: i32) -> Result<Vec<serde_json::Value>> {
        self.logger.info("========== ApiClient::get_cached_brackets START ==========");
        self.logger.info(&format!("tournament_id: {}", tournament_id));
        self.logger.info(&format!("base_url: {}", self.base_url));

        // Проверяем, это локальный сервер или setki.pro
        let is_local_server = is_local_url(&self.base_url);
        self.logger.info(&format!("is_local_server: {}", is_local_server));

        if is_local_server {
            // Делаем HTTP запрос к локальному серверу
            self.logger.info("Requesting from local server");

            self.logger.info("Getting auth token...");
            let token = match self.get_token().await {
                Ok(Some(t)) => {
                    self.logger.info(&format!("Token retrieved: {}...", &t[..t.len().min(10)]));
                    t
                }
                Ok(None) => {
                    self.logger.error("ERROR: No auth token found");
                    return Err(anyhow::anyhow!("Не авторизован"));
                }
                Err(e) => {
                    self.logger.error(&format!("ERROR getting token: {}", e));
                    return Err(e);
                }
            };

            let url = format!("{}/desktop/brackets/tournament/{}", self.base_url, tournament_id);
            self.logger.info(&format!("Full URL: {}", url));
            self.logger.info("Sending HTTP GET request with auth token...");

            let response = match self.client
                .get(&url)
                .bearer_auth(&token)
                .send()
                .await {
                    Ok(r) => r,
                    Err(e) => {
                        self.logger.error(&format!("HTTP request failed: {}", e));
                        return Err(anyhow::anyhow!("HTTP request failed: {}", e));
                    }
                };

            self.logger.info(&format!("HTTP response received, status: {}", response.status()));

            if response.status().is_success() {
                let brackets: Vec<serde_json::Value> = response.json().await?;
                self.logger.info(&format!("SUCCESS: Received {} brackets from local server", brackets.len()));
                self.logger.info("========== ApiClient::get_cached_brackets END ==========");
                Ok(brackets)
            } else {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                self.logger.error(&format!("Local server error {}: {}", status, error_text));
                self.logger.error("========== ApiClient::get_cached_brackets END ==========");
                Err(anyhow::anyhow!("Local server error {}: {}", status, error_text))
            }
        } else {
            // Читаем из локального кэша (offline режим для setki.pro)
            println!("[ApiClient::get_cached_brackets] Reading from local cache");
            let records = sqlx::query_as::<_, (i32, i32, Option<i32>, Option<String>, Option<f64>, Option<f64>, Option<String>, Option<String>, Option<String>, Option<i32>, String, i32)>(
                "SELECT bracket_id, tournament_id, category_id, category_name, weight_min, weight_max,
                        gender, sport_name, bracket_type, total_rounds, status, is_published
                 FROM brackets_cache WHERE tournament_id = ?"
            )
            .bind(tournament_id)
            .fetch_all(self.db.as_ref())
            .await?;

            let brackets: Vec<serde_json::Value> = records
                .into_iter()
                .map(|(bracket_id, tournament_id, category_id, category_name, weight_min, weight_max, gender, sport_name, bracket_type, total_rounds, status, is_published)| {
                    serde_json::json!({
                        "id": bracket_id,
                        "tournament_id": tournament_id,
                        "category_id": category_id,
                        "category_name": category_name,
                        "min_weight": weight_min,
                        "max_weight": weight_max,
                        "gender": gender,
                        "sport_name": sport_name,
                        "bracket_type": bracket_type,
                        "total_rounds": total_rounds,
                        "status": status,
                        "is_published": is_published == 1,
                    })
                })
                .collect();

            println!("[ApiClient::get_cached_brackets] Found {} brackets in local cache", brackets.len());
            Ok(brackets)
        }
    }

    // Проверить, загружен ли турнир в кэш
    pub async fn is_tournament_downloaded(&self, tournament_id: i32) -> Result<bool> {
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM brackets_cache WHERE tournament_id = ?"
        )
        .bind(tournament_id)
        .fetch_one(self.db.as_ref())
        .await?;

        Ok(count.0 > 0)
    }

    // Синхронизировать изменения с сервером
    pub async fn sync_changes(&self) -> Result<()> {
        let token = self.get_token().await?
            .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

        // Получить несинхронизированные изменения
        let records = sqlx::query_as::<_, (i64, i32, String)>(
            "SELECT id, match_id, data FROM sync_queue WHERE synced = 0"
        )
        .fetch_all(self.db.as_ref())
        .await?;

        for (id, _match_id, data) in records {
            // Проверить тип действия
            let data_json: serde_json::Value = serde_json::from_str(&data).unwrap_or(serde_json::json!({}));
            let action = data_json.get("action").and_then(|v| v.as_str());

            // TODO: Backend API не поддерживает синхронизацию продвижения участников и редактирований сеток
            // Нужно добавить отдельные endpoints на backend:
            // - /desktop/sync/participants для продвижения победителей
            // - /desktop/sync/bracket_edits для редактирования участников
            // Пока это критично только для online режима; в offline режиме всё работает через локальный сервер
            if action == Some("update_participant") {
                println!("[sync_changes] WARNING: Participant advancement sync not supported in online mode (requires backend API update)");
                println!("[sync_changes] Skipping sync for participant update, data: {}", data);
                // Пометить как synced чтобы не пытаться бесконечно
                sqlx::query(
                    "UPDATE sync_queue SET synced = 1, synced_at = datetime('now') WHERE id = ?"
                )
                .bind(id)
                .execute(self.db.as_ref())
                .await?;
                continue;
            }

            if data_json.get("type").and_then(|v| v.as_str()) == Some("bracket_edit") {
                println!("[sync_changes] WARNING: Bracket edit sync not supported in online mode (requires backend API update)");
                println!("[sync_changes] Skipping sync for bracket edit, data: {}", data);
                // Пометить как synced чтобы не пытаться бесконечно
                sqlx::query(
                    "UPDATE sync_queue SET synced = 1, synced_at = datetime('now') WHERE id = ?"
                )
                .bind(id)
                .execute(self.db.as_ref())
                .await?;
                continue;
            }

            let url = format!("{}/desktop/sync/matches", self.base_url);
            let response = self.client
                .post(&url)
                .bearer_auth(&token)
                .header("Content-Type", "application/json")
                .body(data.clone())
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    // Пометить как синхронизированное
                    sqlx::query(
                        "UPDATE sync_queue SET synced = 1, synced_at = datetime('now') WHERE id = ?"
                    )
                    .bind(id)
                    .execute(self.db.as_ref())
                    .await?;
                },
                _ => {
                    // Пропустить, попробуем позже
                    continue;
                }
            }
        }

        Ok(())
    }

    // Синхронизация с локальным сервером админа (для local-client режима)
    pub async fn sync_to_local_server(&self, server_url: &str) -> Result<()> {
        // Получить несинхронизированные изменения
        let records = sqlx::query_as::<_, (i64, i32, String)>(
            "SELECT id, match_id, data FROM sync_queue WHERE synced = 0"
        )
        .fetch_all(self.db.as_ref())
        .await?;

        for (id, _match_id, data) in records {
            // Парсим данные для отправки на локальный сервер
            let match_data: serde_json::Value = serde_json::from_str(&data)?;

            // server_url уже содержит /api/v1, не добавляем повторно
            let url = format!("{}/desktop/matches/update", server_url);
            let response = reqwest::Client::new()
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&serde_json::json!({
                    "match_id": match_data["match_id"],
                    "red_score": match_data["red_score"],
                    "blue_score": match_data["blue_score"],
                    "red_warnings": match_data.get("red_warnings").and_then(|v| v.as_i64()).unwrap_or(0),
                    "blue_warnings": match_data.get("blue_warnings").and_then(|v| v.as_i64()).unwrap_or(0),
                    "status": match_data["status"],
                    "duration": match_data.get("duration"),
                    "winner_id": match_data.get("winner_id"),
                }))
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    // Пометить как синхронизированное
                    sqlx::query(
                        "UPDATE sync_queue SET synced = 1, synced_at = datetime('now') WHERE id = ?"
                    )
                    .bind(id)
                    .execute(self.db.as_ref())
                    .await?;
                },
                _ => {
                    // Пропустить, попробуем позже
                    continue;
                }
            }
        }

        Ok(())
    }

    /// Отправить обновление участника на локальный сервер (для продвижения победителя)
    pub async fn update_match_participant_on_local_server(
        &self,
        server_url: &str,
        match_id: i32,
        participant_slot: u8, // 1 или 2
        participant_id: Option<i32>,
        participant_name: Option<String>,
        club: Option<String>,
    ) -> Result<()> {
        self.logger.info("========== update_match_participant_on_local_server START ==========");
        self.logger.info(&format!("server_url: {}", server_url));
        self.logger.info(&format!("match_id: {}", match_id));
        self.logger.info(&format!("participant_slot: {}", participant_slot));
        self.logger.info(&format!("participant_id: {:?}", participant_id));
        self.logger.info(&format!("participant_name: {:?}", participant_name));
        self.logger.info(&format!("club: {:?}", club));

        // server_url уже содержит /api/v1, не добавляем повторно
        let url = format!("{}/desktop/matches/participant", server_url);
        self.logger.info(&format!("Full URL: {}", url));

        // Retry логика: 5 попыток с экспоненциальной задержкой (1s, 2s, 4s, 8s, 16s)
        let max_retries = 5;
        for attempt in 0..max_retries {
            self.logger.info(&format!("Attempt {} of {}", attempt + 1, max_retries));

            let response = reqwest::Client::new()
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&serde_json::json!({
                    "match_id": match_id,
                    "participant_slot": participant_slot,
                    "participant_id": participant_id,
                    "participant_name": participant_name,
                    "club": club,
                }))
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    self.logger.info(&format!("SUCCESS on attempt {}", attempt + 1));
                    self.logger.info("========== update_match_participant_on_local_server END ==========");
                    return Ok(());
                },
                Ok(resp) => {
                    let status = resp.status();
                    self.logger.error(&format!("Failed with status {} on attempt {}", status, attempt + 1));
                    if attempt < max_retries - 1 {
                        let delay = std::time::Duration::from_millis(1000 * 2_u64.pow(attempt as u32));
                        self.logger.info(&format!("Retrying after {}ms...", delay.as_millis()));
                        tokio::time::sleep(delay).await;
                    }
                },
                Err(e) => {
                    self.logger.error(&format!("Network error on attempt {}: {}", attempt + 1, e));
                    if attempt < max_retries - 1 {
                        let delay = std::time::Duration::from_millis(1000 * 2_u64.pow(attempt as u32));
                        self.logger.info(&format!("Retrying after {}ms...", delay.as_millis()));
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        }

        // Все попытки исчерпаны
        self.logger.error(&format!("Failed to send participant update after {} retries", max_retries));
        self.logger.error("========== update_match_participant_on_local_server END ==========");
        Err(anyhow::anyhow!("Failed to send participant update to local server after {} retries", max_retries))
    }

    // Получить список турниров администратора (с fallback на offline)
    pub async fn get_tournaments(&self) -> Result<Vec<TournamentBrief>> {
        let token = self.get_token().await?
            .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

        let url = format!("{}/desktop/tournaments/my", self.base_url);
        let response = self.client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                let tournaments: Vec<TournamentBrief> = resp.json().await?;

                // Сохранить в кэш для offline доступа
                self.cache_tournaments(&tournaments).await.ok();

                Ok(tournaments)
            }
            _ => {
                // Fallback на offline кэш
                println!("[OFFLINE MODE] Загрузка турниров из кэша");
                self.get_cached_tournaments().await
            }
        }
    }

    // Сохранить турниры в кэш
    async fn cache_tournaments(&self, tournaments: &[TournamentBrief]) -> Result<()> {
        for tournament in tournaments {
            let tournament_json = serde_json::to_string(tournament)?;
            sqlx::query(
                "INSERT OR REPLACE INTO tournaments_cache (tournament_id, data, cached_at)
                 VALUES (?, ?, datetime('now'))"
            )
            .bind(tournament.id)
            .bind(tournament_json)
            .execute(self.db.as_ref())
            .await?;
        }
        Ok(())
    }

    // Получить турниры из кэша
    async fn get_cached_tournaments(&self) -> Result<Vec<TournamentBrief>> {
        let records = sqlx::query_as::<_, (String,)>(
            "SELECT data FROM tournaments_cache ORDER BY cached_at DESC"
        )
        .fetch_all(self.db.as_ref())
        .await?;

        let tournaments: Vec<TournamentBrief> = records
            .into_iter()
            .filter_map(|r| serde_json::from_str(&r.0).ok())
            .collect();

        if tournaments.is_empty() {
            return Err(anyhow::anyhow!("Нет турниров в кэше. Подключитесь к интернету для первой загрузки."));
        }

        Ok(tournaments)
    }

    // Получить детали турнира с конфигурацией
    pub async fn get_tournament_details(&self, tournament_id: i32) -> Result<TournamentSession> {
        let token = self.get_token().await?
            .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

        // Попытка получить детали турнира из API
        let details_url = format!("{}/desktop/tournaments/{}/details", self.base_url, tournament_id);
        let details_response = self.client
            .get(&details_url)
            .bearer_auth(&token)
            .send()
            .await;

        // Если API недоступен или возвращает ошибку, используем fallback
        let tournament_data: serde_json::Value = match details_response {
            Ok(resp) if resp.status().is_success() => {
                resp.json().await.unwrap_or_else(|_| serde_json::json!({
                    "id": tournament_id,
                    "name": "Турнир (offline)",
                    "start_date": "2024-01-01",
                    "status": "active"
                }))
            }
            _ => {
                // Fallback для offline режима
                println!("[OFFLINE MODE] Используем fallback данные для турнира {}", tournament_id);
                serde_json::json!({
                    "id": tournament_id,
                    "name": "Турнир (offline)",
                    "start_date": "2024-01-01",
                    "status": "active"
                })
            }
        };

        // Получить PIN турнира (с fallback на кэш)
        let pin_url = format!("{}/desktop/tournaments/{}/pin", self.base_url, tournament_id);
        let pin_response = self.client
            .get(&pin_url)
            .bearer_auth(&token)
            .send()
            .await;

        let pin_code = match pin_response {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(pin_data) = resp.json::<serde_json::Value>().await {
                    // Проверяем, есть ли PIN в ответе и не является ли он null
                    if let Some(pin_str) = pin_data.get("pin_code").and_then(|v| v.as_str()) {
                        // PIN найден в API - сохраняем в кэш
                        let tournament_name = tournament_data["name"].as_str().unwrap_or("Unknown");
                        self.cache_pin(pin_str, tournament_id, tournament_name).await.ok();
                        pin_str.to_string()
                    } else {
                        // PIN null или отсутствует - проверяем кэш
                        println!("[get_tournament_details] PIN не найден в API, проверяем кэш");
                        self.get_cached_pin(tournament_id).await.unwrap_or_else(|_| {
                            println!("[get_tournament_details] PIN не найден в кэше, возвращаем 000000");
                            "000000".to_string()
                        })
                    }
                } else {
                    // Ошибка парсинга - fallback на кэш
                    self.get_cached_pin(tournament_id).await.unwrap_or_else(|_| "000000".to_string())
                }
            }
            _ => {
                // Нет интернета - ищем в кэше
                println!("[OFFLINE MODE] Загрузка PIN из кэша для турнира {}", tournament_id);
                self.get_cached_pin(tournament_id).await.unwrap_or_else(|_| "000000".to_string())
            }
        };

        // Получить сетки турнира (сначала API, потом кэш)
        let brackets_url = format!("{}/desktop/brackets/tournament/{}", self.base_url, tournament_id);
        let brackets_response = self.client
            .get(&brackets_url)
            .bearer_auth(&token)
            .send()
            .await;

        let brackets = match brackets_response {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<Vec<serde_json::Value>>().await {
                    Ok(data) => data,
                    Err(_) => {
                        // Ошибка парсинга - fallback на кэш
                        println!("[OFFLINE MODE] Ошибка парсинга brackets, загрузка из кэша");
                        self.get_cached_brackets(tournament_id).await.unwrap_or_default()
                    }
                }
            }
            _ => {
                // Нет интернета - загружаем из кэша
                println!("[OFFLINE MODE] Загрузка brackets из кэша для турнира {}", tournament_id);
                self.get_cached_brackets(tournament_id).await.unwrap_or_default()
            }
        };

        // Получить scoring_config из tournament_data или использовать дефолтный
        let scoring_config = if !tournament_data["scoring_config"].is_null() {
            tournament_data["scoring_config"].clone()
        } else {
            // Дефолтный scoring_config для BJJ/Грэпплинга
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
        };

        // Сформировать TournamentSession
        let session = TournamentSession {
            id: tournament_id,
            tournament_id,
            pin_code,
            total_tables: 5, // TODO: получить из API
            admin_user_id: 1, // TODO: получить из токена
            tournament: tournament_data.clone(),
            brackets,
            scoring_config,
        };

        Ok(session)
    }

    // Получить столы турнира
    pub async fn get_tournament_tables(&self, tournament_id: i32) -> Result<Vec<serde_json::Value>> {
        let token = self.get_token().await?
            .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

        let url = format!("{}/desktop/tables/tournament/{}", self.base_url, tournament_id);
        let response = self.client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!("Ошибка загрузки столов: {}", response.status()));
        }

        let tables: Vec<serde_json::Value> = response.json().await?;
        Ok(tables)
    }

    // Зарезервировать сетку для судьи
    pub async fn reserve_bracket(
        &self,
        bracket_id: i32,
        tournament_id: i32,
        judge_name: &str,
        table_number: i32,
        user_id: i32
    ) -> Result<()> {
        println!("[ApiClient::reserve_bracket] START");
        println!("[ApiClient::reserve_bracket] bracket_id={}, tournament_id={}, judge_name={}, table_number={}, user_id={}",
            bracket_id, tournament_id, judge_name, table_number, user_id);
        println!("[ApiClient::reserve_bracket] base_url={}", self.base_url);
        println!("[ApiClient::reserve_bracket] is_local_server={}", self.is_local_server());

        // Если base_url это локальный сервер - отправить HTTP запрос
        if self.is_local_server() {
            println!("[ApiClient::reserve_bracket] Using local server mode");
            let token = self.get_token().await?
                .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

            // base_url уже содержит /api/v1, не добавляем повторно
            let url = format!("{}/desktop/brackets/reserve", self.base_url);
            let payload = serde_json::json!({
                "bracket_id": bracket_id,
                "tournament_id": tournament_id,
                "judge_name": judge_name,
                "table_number": table_number,
                "user_id": user_id,
            });

            println!("[ApiClient::reserve_bracket] Sending POST to: {}", url);
            println!("[ApiClient::reserve_bracket] Payload: {}", payload);

            let response = self.client
                .post(&url)
                .bearer_auth(&token)
                .json(&payload)
                .send()
                .await?;

            println!("[ApiClient::reserve_bracket] Response status: {}", response.status());

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
                println!("[ApiClient::reserve_bracket] ERROR: {}", error_text);
                return Err(anyhow::anyhow!("Ошибка резервирования сетки: {}", error_text));
            }

            println!("[ApiClient::reserve_bracket] SUCCESS - reservation saved on admin server");
            // Судья НЕ сохраняет локально - все данные только на сервере админа
            return Ok(());
        }

        // Онлайн режим или локальная БД
        println!("[ApiClient::reserve_bracket] Using local DB mode");

        // Проверить, не занята ли уже сетка
        let existing = sqlx::query_as::<_, (String, i32)>(
            "SELECT judge_name, table_number FROM bracket_assignments
             WHERE bracket_id = ? AND tournament_id = ? AND status = 'active'"
        )
        .bind(bracket_id)
        .bind(tournament_id)
        .fetch_optional(self.db.as_ref())
        .await?;

        println!("[ApiClient::reserve_bracket] Existing reservation: {:?}", existing);

        if let Some((existing_judge, existing_table)) = existing {
            // Если сетка уже занята этим же судьей, просто обновляем время
            if existing_judge == judge_name && existing_table == table_number {
                println!("[ApiClient::reserve_bracket] Updating existing reservation for same user");
                sqlx::query(
                    "UPDATE bracket_assignments SET reserved_at = datetime('now')
                     WHERE bracket_id = ? AND tournament_id = ?"
                )
                .bind(bracket_id)
                .bind(tournament_id)
                .execute(self.db.as_ref())
                .await?;
                println!("[ApiClient::reserve_bracket] SUCCESS (updated)");
                return Ok(());
            }

            // Иначе сетка занята другим судьей
            println!("[ApiClient::reserve_bracket] ERROR: Already reserved by another judge");
            return Err(anyhow::anyhow!(
                "Сетка уже занята: {} (стол №{})",
                existing_judge,
                existing_table
            ));
        }

        // Зарезервировать сетку
        println!("[ApiClient::reserve_bracket] Inserting new reservation");
        let result = sqlx::query(
            "INSERT INTO bracket_assignments (bracket_id, tournament_id, judge_name, table_number, reserved_at, status)
             VALUES (?, ?, ?, ?, datetime('now'), 'active')
             ON CONFLICT(bracket_id, tournament_id) DO UPDATE SET
                judge_name = excluded.judge_name,
                table_number = excluded.table_number,
                reserved_at = datetime('now'),
                status = 'active'"
        )
        .bind(bracket_id)
        .bind(tournament_id)
        .bind(judge_name)
        .bind(table_number)
        .execute(self.db.as_ref())
        .await;

        match result {
            Ok(_) => {
                println!("[ApiClient::reserve_bracket] SUCCESS (inserted)");
                Ok(())
            }
            Err(e) => {
                println!("[ApiClient::reserve_bracket] ERROR during insert: {}", e);
                Err(e.into())
            }
        }
    }

    // Освободить сетку (отменить резервирование)
    pub async fn release_bracket(&self, bracket_id: i32) -> Result<()> {
        // Если base_url это локальный сервер - отправить HTTP запрос
        if self.is_local_server() {
            let token = self.get_token().await?
                .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

            // Получить judge_name из резервирования
            let judge_name = sqlx::query_scalar::<_, Option<String>>(
                "SELECT judge_name FROM bracket_assignments WHERE bracket_id = ? AND status = 'active'"
            )
            .bind(bracket_id)
            .fetch_optional(self.db.as_ref())
            .await?
            .flatten();

            if let Some(name) = judge_name {
                // base_url уже содержит /api/v1, не добавляем повторно
                let url = format!("{}/desktop/brackets/release", self.base_url);
                let payload = serde_json::json!({
                    "bracket_id": bracket_id,
                    "judge_name": name,
                });

                let response = self.client
                    .post(&url)
                    .bearer_auth(&token)
                    .json(&payload)
                    .send()
                    .await?;

                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
                    return Err(anyhow::anyhow!("Ошибка освобождения сетки: {}", error_text));
                }
            }

            // Также обновить статус в локальной БД
            sqlx::query("UPDATE bracket_assignments SET status = 'released' WHERE bracket_id = ? AND status = 'active'")
                .bind(bracket_id)
                .execute(self.db.as_ref())
                .await?;

            return Ok(());
        }

        // Онлайн режим или локальная БД
        sqlx::query("UPDATE bracket_assignments SET status = 'released' WHERE bracket_id = ? AND status = 'active'")
            .bind(bracket_id)
            .execute(self.db.as_ref())
            .await?;

        Ok(())
    }

    // Очистить все резервирования (для отладки)
    pub async fn clear_all_reservations(&self) -> Result<()> {
        sqlx::query("UPDATE bracket_assignments SET status = 'released' WHERE status = 'active'")
            .execute(self.db.as_ref())
            .await?;

        Ok(())
    }

    // Освободить все резервации конкретного судьи
    pub async fn release_judge_brackets(&self, judge_name: &str) -> Result<()> {
        // Если base_url это локальный сервер - отправить HTTP запрос для каждой резервации
        if self.is_local_server() {
            let token = self.get_token().await?
                .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

            // Получить все резервации судьи
            let brackets = sqlx::query_scalar::<_, i32>(
                "SELECT bracket_id FROM bracket_assignments WHERE judge_name = ? AND status = 'active'"
            )
            .bind(judge_name)
            .fetch_all(self.db.as_ref())
            .await?;

            // Освободить каждую сетку через HTTP
            for bracket_id in brackets {
                let url = format!("{}/api/v1/desktop/brackets/release", self.base_url);
                let payload = serde_json::json!({
                    "bracket_id": bracket_id,
                    "judge_name": judge_name,
                });

                let _ = self.client
                    .post(&url)
                    .bearer_auth(&token)
                    .json(&payload)
                    .send()
                    .await;
                // Игнорируем ошибки, продолжаем освобождать остальные
            }
        }

        // Обновить статус всех резерваций судьи в локальной БД
        sqlx::query("UPDATE bracket_assignments SET status = 'released' WHERE judge_name = ? AND status = 'active'")
            .bind(judge_name)
            .execute(self.db.as_ref())
            .await?;

        Ok(())
    }

    // Получить информацию о резервировании сетки
    pub async fn get_bracket_reservation(&self, bracket_id: i32) -> Result<Option<(String, i32)>> {
        let result = sqlx::query_as::<_, (String, i32)>(
            "SELECT judge_name, table_number FROM bracket_assignments WHERE bracket_id = ? AND status = 'active'"
        )
        .bind(bracket_id)
        .fetch_optional(self.db.as_ref())
        .await?;

        Ok(result)
    }

    // Получить матчи сетки (из кэша или с локального сервера)
    pub async fn get_bracket_matches(&self, bracket_id: i32) -> Result<Vec<serde_json::Value>> {
        self.logger.info("========== ApiClient::get_bracket_matches START ==========");
        self.logger.info(&format!("bracket_id: {}", bracket_id));
        self.logger.info(&format!("base_url: {}", self.base_url));

        let is_local_server = is_local_url(&self.base_url);
        self.logger.info(&format!("is_local_server: {}", is_local_server));

        if is_local_server {
            // Делаем HTTP запрос к локальному серверу
            self.logger.info("Requesting from local server");

            self.logger.info("Getting auth token...");
            let token = match self.get_token().await {
                Ok(Some(t)) => {
                    self.logger.info(&format!("Token retrieved: {}...", &t[..t.len().min(10)]));
                    t
                }
                Ok(None) => {
                    self.logger.error("ERROR: No auth token found");
                    return Err(anyhow::anyhow!("Не авторизован"));
                }
                Err(e) => {
                    self.logger.error(&format!("ERROR getting token: {}", e));
                    return Err(e);
                }
            };

            let url = format!("{}/desktop/brackets/{}/matches", self.base_url, bracket_id);
            self.logger.info(&format!("Full URL: {}", url));
            self.logger.info("Sending HTTP GET request with auth token...");

            let response = match self.client
                .get(&url)
                .bearer_auth(&token)
                .send()
                .await {
                    Ok(r) => r,
                    Err(e) => {
                        self.logger.error(&format!("HTTP request failed: {}", e));
                        return Err(anyhow::anyhow!("HTTP request failed: {}", e));
                    }
                };

            self.logger.info(&format!("HTTP response received, status: {}", response.status()));

            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
                self.logger.error(&format!("HTTP error {}: {}", status, error_text));
                self.logger.error("========== ApiClient::get_bracket_matches END ==========");
                return Err(anyhow::anyhow!("HTTP error {}: {}", status, error_text));
            }

            let matches: Vec<serde_json::Value> = response.json().await?;
            self.logger.info(&format!("SUCCESS: Received {} matches from local server", matches.len()));
            self.logger.info("========== ApiClient::get_bracket_matches END ==========");
            Ok(matches)
        } else {
            // Читаем из локального кэша (плоская схема)
            self.logger.info("Reading from local cache");
            let records = sqlx::query(
                "SELECT match_id, bracket_id, tournament_id, round_number, match_number,
                        p1_id, p1_name, p1_club,
                        p2_id, p2_name, p2_club,
                        score_p1, score_p2, warnings_p1, warnings_p2,
                        winner_id, result_type, status, version
                 FROM matches_cache WHERE bracket_id = ?
                 ORDER BY round_number, match_number"
            )
            .bind(bracket_id)
            .fetch_all(self.db.as_ref())
            .await?;

            let matches: Vec<serde_json::Value> = records
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
                    let version:     i32            = row.get("version");

                    let participant1 = if p1_id.is_some() || p1_name.is_some() {
                        serde_json::json!({ "id": p1_id, "fighter_id": p1_id, "full_name": p1_name, "club_name": p1_club })
                    } else { serde_json::Value::Null };
                    let participant2 = if p2_id.is_some() || p2_name.is_some() {
                        serde_json::json!({ "id": p2_id, "fighter_id": p2_id, "full_name": p2_name, "club_name": p2_club })
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
                        "version": version,
                    })
                })
                .collect();

            self.logger.info(&format!("Found {} matches in local cache", matches.len()));
            self.logger.info("========== ApiClient::get_bracket_matches END ==========");
            Ok(matches)
        }
    }

    // ====== Методы для работы с поединками ======

    // Начать матч (изменить статус на in_progress)
    pub async fn start_match(&self, match_id: i32) -> Result<()> {
        sqlx::query(
            "UPDATE matches_cache
             SET status = 'in_progress',
                 updated_at = datetime('now')
             WHERE match_id = ?"
        )
        .bind(match_id)
        .execute(self.db.as_ref())
        .await?;

        Ok(())
    }

    // Обновить счет матча (offline-first: SQLite + sync_queue)
    pub async fn update_match_score(
        &self,
        match_id: i32,
        red_score: i32,
        blue_score: i32,
        red_warnings: i32,
        blue_warnings: i32,
        status: String,
    ) -> Result<()> {
        // КРИТИЧНО: Используем транзакцию для атомарности операций
        // Если приложение упадет между UPDATE и INSERT - транзакция откатится
        let mut tx = self.db.begin().await?;

        // Обновить локальный кэш matches_cache с optimistic locking
        // participant1 = blue, participant2 = red (согласно существующей схеме)
        // Сначала читаем текущую версию
        let current_version: Option<(i64,)> = sqlx::query_as(
            "SELECT version FROM matches_cache WHERE match_id = ?"
        )
        .bind(match_id)
        .fetch_optional(&mut *tx)
        .await?;

        let version = current_version.map(|(v,)| v).unwrap_or(1);

        // Обновляем только если version совпадает (optimistic locking)
        let rows_affected = sqlx::query(
            "UPDATE matches_cache
             SET score_p1 = ?,
                 score_p2 = ?,
                 warnings_p1 = ?,
                 warnings_p2 = ?,
                 version = version + 1,
                 updated_at = datetime('now')
             WHERE match_id = ? AND version = ?"
        )
        .bind(blue_score)
        .bind(red_score)
        .bind(blue_warnings)
        .bind(red_warnings)
        .bind(match_id)
        .bind(version)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        // Если rows_affected = 0, значит версия изменилась (конкурентное обновление)
        if rows_affected == 0 {
            println!("[update_match_score] WARNING: Optimistic lock failed for match_id={}, version={}", match_id, version);
            return Err(anyhow::anyhow!("Match was updated by another judge, please retry"));
        }

        // Добавить в очередь синхронизации
        // ВАЖНО: Формат для production API (setki.pro)
        // participant1 = blue = fighter1, participant2 = red = fighter2
        let sync_data = serde_json::json!({
            "match_id": match_id,
            "fighter1_score": blue_score,  // fighter1 = participant1 = blue
            "fighter2_score": red_score,   // fighter2 = participant2 = red
            "winner_id": null,              // null пока матч не завершен
            "status": status
        });

        sqlx::query(
            "INSERT INTO sync_queue (match_id, data, synced)
             VALUES (?, ?, 0)"
        )
        .bind(match_id)
        .bind(sync_data.to_string())
        .execute(&mut *tx)
        .await?;

        // Обновить статус сетки на основе статусов матчей
        self.update_bracket_status_from_matches(&mut tx, match_id).await?;

        // Commit транзакции - либо все операции успешны, либо все откатятся
        tx.commit().await?;

        Ok(())
    }

    /// Обновляет статус сетки на основе статусов её матчей
    async fn update_bracket_status_from_matches(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        match_id: i32,
    ) -> Result<()> {
        // 1. Получить bracket_id для этого матча
        let bracket_id: Option<(i32,)> = sqlx::query_as(
            "SELECT bracket_id FROM matches_cache WHERE match_id = ?"
        )
        .bind(match_id)
        .fetch_optional(&mut **tx)
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
        .fetch_all(&mut **tx)
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
        .execute(&mut **tx)
        .await?;

        println!(
            "[update_bracket_status] Updated bracket {} status to: {}",
            bracket_id, bracket_status
        );

        Ok(())
    }

    // Записать событие в историю
    pub async fn record_match_event(
        &self,
        match_id: i32,
        event_type: String,
        participant: String,
        points: Option<i32>,
        action_name: Option<String>,
        timestamp: i64,
    ) -> Result<i64> {
        let result = sqlx::query(
            "INSERT INTO match_events
             (match_id, event_type, participant, points, action_name, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(match_id)
        .bind(event_type)
        .bind(participant)
        .bind(points)
        .bind(action_name)
        .bind(timestamp)
        .execute(self.db.as_ref())
        .await?;

        Ok(result.last_insert_rowid())
    }

    // Получить все события матча
    pub async fn get_match_events(&self, match_id: i32) -> Result<Vec<serde_json::Value>> {
        let rows = sqlx::query_as::<_, (i64, String, String, Option<i32>, Option<String>, i64)>(
            "SELECT id, event_type, participant, points, action_name, timestamp
             FROM match_events
             WHERE match_id = ?
             ORDER BY timestamp ASC"
        )
        .bind(match_id)
        .fetch_all(self.db.as_ref())
        .await?;

        let events: Vec<serde_json::Value> = rows
            .into_iter()
            .map(|(id, event_type, participant, points, action_name, timestamp)| {
                serde_json::json!({
                    "id": id,
                    "event_type": event_type,
                    "participant": participant,
                    "points": points,
                    "action_name": action_name,
                    "timestamp": timestamp
                })
            })
            .collect();

        Ok(events)
    }

    // Batch update: record event + update score + get events (3 операции последовательно)
    // КРИТИЧНО: Используем транзакцию для атомарности всех операций
    pub async fn batch_update_match(
        &self,
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
    ) -> Result<Vec<serde_json::Value>> {
        // Начинаем транзакцию для атомарности всех операций
        let mut tx = self.db.begin().await?;

        // 1. Записать событие в историю
        sqlx::query(
            "INSERT INTO match_events
             (match_id, event_type, participant, points, action_name, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(match_id)
        .bind(&event_type)
        .bind(&participant)
        .bind(points)
        .bind(&action_name)
        .bind(timestamp)
        .execute(&mut *tx)
        .await?;

        // 2. Обновить счет матча в кэше с optimistic locking
        // participant1 = blue, participant2 = red
        // Сначала читаем текущую версию
        let current_version: Option<(i64,)> = sqlx::query_as(
            "SELECT version FROM matches_cache WHERE match_id = ?"
        )
        .bind(match_id)
        .fetch_optional(&mut *tx)
        .await?;

        let version = current_version.map(|(v,)| v).unwrap_or(1);

        // Обновляем только если version совпадает (optimistic locking)
        let rows_affected = sqlx::query(
            "UPDATE matches_cache
             SET score_p1 = ?,
                 score_p2 = ?,
                 warnings_p1 = ?,
                 warnings_p2 = ?,
                 version = version + 1,
                 updated_at = datetime('now')
             WHERE match_id = ? AND version = ?"
        )
        .bind(blue_score)
        .bind(red_score)
        .bind(blue_warnings)
        .bind(red_warnings)
        .bind(match_id)
        .bind(version)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        // Если rows_affected = 0, значит версия изменилась (конкурентное обновление)
        if rows_affected == 0 {
            println!("[batch_update_match] WARNING: Optimistic lock failed for match_id={}, version={}", match_id, version);
            return Err(anyhow::anyhow!("Match was updated by another judge, please retry"));
        }

        // 3. Добавить в очередь синхронизации
        // ВАЖНО: Формат для production API (setki.pro)
        // participant1 = blue = fighter1, participant2 = red = fighter2
        let sync_data = serde_json::json!({
            "match_id": match_id,
            "fighter1_score": blue_score,  // fighter1 = participant1 = blue
            "fighter2_score": red_score,   // fighter2 = participant2 = red
            "winner_id": null,              // null пока матч не завершен
            "status": status
        });

        sqlx::query(
            "INSERT INTO sync_queue (match_id, data, synced)
             VALUES (?, ?, 0)"
        )
        .bind(match_id)
        .bind(sync_data.to_string())
        .execute(&mut *tx)
        .await?;

        // 4. Получить все события (включая только что добавленное)
        let rows = sqlx::query_as::<_, (i64, String, String, Option<i32>, Option<String>, i64)>(
            "SELECT id, event_type, participant, points, action_name, timestamp
             FROM match_events
             WHERE match_id = ?
             ORDER BY timestamp ASC"
        )
        .bind(match_id)
        .fetch_all(&mut *tx)
        .await?;

        let events: Vec<serde_json::Value> = rows
            .into_iter()
            .map(|(id, event_type, participant, points, action_name, timestamp)| {
                serde_json::json!({
                    "id": id,
                    "event_type": event_type,
                    "participant": participant,
                    "points": points,
                    "action_name": action_name,
                    "timestamp": timestamp
                })
            })
            .collect();

        // Commit транзакции - все 4 операции либо выполнятся, либо откатятся
        tx.commit().await?;

        Ok(events)
    }

    // Отменить последнее событие
    pub async fn undo_last_event(&self, match_id: i32) -> Result<()> {
        sqlx::query(
            "DELETE FROM match_events
             WHERE id = (
                 SELECT id FROM match_events
                 WHERE match_id = ?
                 ORDER BY timestamp DESC
                 LIMIT 1
             )"
        )
        .bind(match_id)
        .execute(self.db.as_ref())
        .await?;

        Ok(())
    }

    // Отправить завершение матча на локальный сервер админа (для режима local-client)
    async fn finish_match_on_local_server(
        &self,
        server_url: &str,
        match_id: i32,
        winner_id: Option<i32>,
        result_type: String,
        final_red_score: i32,
        final_blue_score: i32,
    ) -> Result<()> {
        println!("[finish_match_on_local_server] START - server: {}, match: {}", server_url, match_id);

        // Получить токен авторизации
        let token = match self.get_token().await {
            Ok(Some(t)) => {
                println!("[finish_match_on_local_server] Token retrieved");
                t
            }
            Ok(None) => {
                return Err(anyhow::anyhow!("No auth token found - cannot send to local server"));
            }
            Err(e) => {
                return Err(anyhow::anyhow!("Failed to get token: {}", e));
            }
        };

        // FIX: server_url уже содержит /api/v1, не дублируем
        let url = format!("{}/desktop/matches/update", server_url);
        println!("[finish_match_on_local_server] Full URL: {}", url);

        // Используем существующий endpoint update с status=completed
        let payload = serde_json::json!({
            "match_id": match_id,
            "red_score": final_red_score,
            "blue_score": final_blue_score,
            "red_warnings": 0, // Будет игнорироваться при status=completed
            "blue_warnings": 0,
            "status": "completed",
            "winner_id": winner_id,
            "result_type": result_type,
        });

        println!("[finish_match_on_local_server] Sending payload: {}", payload);

        // Retry логика: 5 попыток
        let max_retries = 5;
        for attempt in 0..max_retries {
            let response = self.client
                .post(&url)
                .bearer_auth(&token)
                .json(&payload)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    println!("[finish_match_on_local_server] ✅ SUCCESS on attempt {}", attempt + 1);
                    return Ok(());
                },
                Ok(resp) => {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    println!("[finish_match_on_local_server] ❌ Failed with status {} on attempt {}: {}",
                             status, attempt + 1, body);

                    if attempt < max_retries - 1 {
                        let delay = std::time::Duration::from_millis(1000 * 2_u64.pow(attempt as u32));
                        println!("[finish_match_on_local_server] Retrying after {}ms...", delay.as_millis());
                        tokio::time::sleep(delay).await;
                    }
                },
                Err(e) => {
                    println!("[finish_match_on_local_server] ❌ Network error on attempt {}: {}",
                             attempt + 1, e);

                    if attempt < max_retries - 1 {
                        let delay = std::time::Duration::from_millis(1000 * 2_u64.pow(attempt as u32));
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        }

        Err(anyhow::anyhow!("Failed to finish match on local server after {} attempts", max_retries))
    }

    // Отменить завершённый матч на локальном сервере админа (для режима local-client)
    pub async fn undo_match_on_local_server(
        &self,
        server_url: &str,
        match_id: i32,
    ) -> Result<()> {
        println!("[undo_match_on_local_server] START - server: {}, match: {}", server_url, match_id);

        // Получить токен авторизации
        let token = match self.get_token().await {
            Ok(Some(t)) => {
                println!("[undo_match_on_local_server] Token retrieved");
                t
            }
            Ok(None) => {
                return Err(anyhow::anyhow!("No auth token found - cannot send to local server"));
            }
            Err(e) => {
                return Err(anyhow::anyhow!("Failed to get token: {}", e));
            }
        };

        // Нормализуем URL: добавляем /api/v1 если отсутствует
        let base = if !server_url.contains("/api/v1") {
            format!("{}/api/v1", server_url.trim_end_matches('/'))
        } else {
            server_url.to_string()
        };
        let url = format!("{}/desktop/matches/undo", base);
        println!("[undo_match_on_local_server] Full URL: {}", url);

        let payload = serde_json::json!({
            "match_id": match_id,
        });

        println!("[undo_match_on_local_server] Sending payload: {}", payload);

        // Retry логика: 5 попыток
        let max_retries = 5;
        for attempt in 0..max_retries {
            let response = self.client
                .post(&url)
                .bearer_auth(&token)
                .json(&payload)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    println!("[undo_match_on_local_server] ✅ SUCCESS on attempt {}", attempt + 1);
                    return Ok(());
                },
                Ok(resp) => {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    println!("[undo_match_on_local_server] ❌ Failed with status {} on attempt {}: {}",
                             status, attempt + 1, body);

                    if attempt < max_retries - 1 {
                        let delay = std::time::Duration::from_millis(1000 * 2_u64.pow(attempt as u32));
                        println!("[undo_match_on_local_server] Retrying after {}ms...", delay.as_millis());
                        tokio::time::sleep(delay).await;
                    }
                },
                Err(e) => {
                    println!("[undo_match_on_local_server] ❌ Network error on attempt {}: {}",
                             attempt + 1, e);

                    if attempt < max_retries - 1 {
                        let delay = std::time::Duration::from_millis(1000 * 2_u64.pow(attempt as u32));
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        }

        Err(anyhow::anyhow!("Failed to undo match on local server after {} attempts", max_retries))
    }

    // Отменить активный матч на локальном сервере (для режима local-client)
    pub async fn cancel_match_on_local_server(
        &self,
        server_url: &str,
        match_id: i32,
    ) -> Result<()> {
        let token = self.get_token().await
            .map_err(|e| anyhow::anyhow!("Failed to get token: {}", e))?
            .ok_or_else(|| anyhow::anyhow!("No auth token found"))?;

        let base = if !server_url.contains("/api/v1") {
            format!("{}/api/v1", server_url.trim_end_matches('/'))
        } else {
            server_url.to_string()
        };
        let url = format!("{}/desktop/matches/cancel", base);

        let payload = serde_json::json!({ "match_id": match_id });

        let max_retries = 3;
        for attempt in 0..max_retries {
            let response = self.client
                .post(&url)
                .bearer_auth(&token)
                .json(&payload)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => return Ok(()),
                Ok(resp) => {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    println!("[cancel_match_on_local_server] Failed {} on attempt {}: {}", status, attempt + 1, body);
                    if attempt < max_retries - 1 {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    }
                }
                Err(e) => {
                    println!("[cancel_match_on_local_server] Error on attempt {}: {}", attempt + 1, e);
                    if attempt < max_retries - 1 {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    }
                }
            }
        }
        Err(anyhow::anyhow!("Failed to cancel match on local server after {} attempts", max_retries))
    }

    // Завершить матч
    pub async fn finish_match(
        &self,
        match_id: i32,
        winner_id: Option<i32>,
        result_type: String,
        final_red_score: i32,
        final_blue_score: i32,
    ) -> Result<()> {
        println!("[finish_match] Starting - match_id: {}, winner_id: {:?}", match_id, winner_id);

        // Проверяем режим работы: local-client должен отправлять на сервер админа
        let is_local_server = is_local_url(&self.base_url);

        if is_local_server {
            println!("[finish_match] Local client mode detected - sending to admin server at {}", self.base_url);

            // Отправляем запрос на локальный сервер админа
            return self.finish_match_on_local_server(
                &self.base_url,
                match_id,
                winner_id,
                result_type,
                final_red_score,
                final_blue_score,
            ).await;
        }

        println!("[finish_match] Online/local-server mode - processing locally");

        // 1. Получить информацию о текущем матче (раунд, номер матча, bracket_id)
        let match_info: (i32, i32, i32) = sqlx::query_as(
            "SELECT round_number, match_number, bracket_id
             FROM matches_cache
             WHERE match_id = ?"
        )
        .bind(match_id)
        .fetch_one(self.db.as_ref())
        .await?;

        let (current_round, current_match_number, bracket_id) = match_info;
        println!("[finish_match] Current match info - round: {}, number: {}, bracket: {}",
                 current_round, current_match_number, bracket_id);
        println!("[finish_match] Scores received - final_blue_score: {}, final_red_score: {}", final_blue_score, final_red_score);

        // 2. Определить winner_id по счету если не указан
        let final_winner_id = if winner_id.is_some() {
            winner_id
        } else {
            // Определяем по счету (для вручную добавленных участников без ID)
            if final_red_score > final_blue_score {
                // Красный победил - p2_id
                let red_id: Option<i32> = sqlx::query_scalar(
                    "SELECT p2_id FROM matches_cache WHERE match_id = ?"
                )
                .bind(match_id)
                .fetch_optional(self.db.as_ref())
                .await?
                .flatten();
                red_id
            } else if final_blue_score > final_red_score {
                // Синий победил - p1_id
                let blue_id: Option<i32> = sqlx::query_scalar(
                    "SELECT p1_id FROM matches_cache WHERE match_id = ?"
                )
                .bind(match_id)
                .fetch_optional(self.db.as_ref())
                .await?
                .flatten();
                blue_id
            } else {
                None // Ничья
            }
        };

        println!("[finish_match] Final winner_id: {:?}", final_winner_id);

        // Начинаем транзакцию для атомарности всех операций
        println!("[finish_match] Starting transaction for atomic match completion");
        let mut tx = self.db.begin().await?;

        // Переменная для хранения данных о продвижении победителя (для отправки на локальный сервер после коммита)
        let mut advancement_data: Option<(i32, u8, Option<i32>, Option<String>, Option<String>)> = None;

        // Если произойдёт ошибка ниже, транзакция автоматически откатится при drop
        let transaction_result: Result<(), anyhow::Error> = async {
            // 3. Обновить статус текущего матча в кэше (плоские колонки)
            sqlx::query(
            "UPDATE matches_cache
             SET status = 'completed',
                 winner_id = ?,
                 result_type = ?,
                 score_p1 = ?,
                 score_p2 = ?,
                 updated_at = datetime('now')
             WHERE match_id = ?"
        )
        .bind(final_winner_id)
        .bind(result_type.clone())
        .bind(final_blue_score)
        .bind(final_red_score)
        .bind(match_id)
        .execute(&mut *tx)
        .await?;

        // 4. Продвинуть победителя в следующий матч
        // Читаем плоские данные текущего матча для определения победителя
        let match_flat: Option<(Option<i32>, Option<String>, Option<String>,
                                Option<i32>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT p1_id, p1_name, p1_club, p2_id, p2_name, p2_club
             FROM matches_cache WHERE match_id = ?"
        )
        .bind(match_id)
        .fetch_optional(&mut *tx)
        .await?;

        // Определить объект победителя
        let winner_participant_json = if let Some((p1_id, p1_name, p1_club, p2_id, p2_name, p2_club)) = match_flat {
            let winner = final_winner_id;

            let make_participant = |id: Option<i32>, name: Option<String>, club: Option<String>| {
                serde_json::json!({
                    "id": id,
                    "fighter_id": id,
                    "full_name": name,
                    "club_name": club,
                })
            };

            if let Some(w) = winner {
                if p1_id == Some(w) {
                    println!("[finish_match] Winner matched: p1 (blue) id={}", w);
                    make_participant(p1_id, p1_name, p1_club)
                } else if p2_id == Some(w) {
                    println!("[finish_match] Winner matched: p2 (red) id={}", w);
                    make_participant(p2_id, p2_name, p2_club)
                } else {
                    println!("[finish_match] Winner ID {} not found - fallback to score", w);
                    if final_blue_score > final_red_score {
                        make_participant(p1_id, p1_name, p1_club)
                    } else if final_red_score > final_blue_score {
                        make_participant(p2_id, p2_name, p2_club)
                    } else {
                        serde_json::Value::Null
                    }
                }
            } else {
                println!("[finish_match] No winner_id, determining by score: blue={}, red={}", final_blue_score, final_red_score);
                if final_blue_score > final_red_score {
                    make_participant(p1_id, p1_name, p1_club)
                } else if final_red_score > final_blue_score {
                    make_participant(p2_id, p2_name, p2_club)
                } else {
                    serde_json::Value::Null
                }
            }
        } else {
            serde_json::Value::Null
        };

        if !winner_participant_json.is_null() {
            println!("[finish_match] Winner participant data: {}", winner_participant_json);

            // Вычислить параметры следующего матча
                let next_round = current_round + 1;
                // Нумерация матчей начинается с 1, поэтому формула: (current_match_number + 1) / 2
                let next_match_number = (current_match_number + 1) / 2;
                println!("[finish_match] Next match calculation - current_round: {}, current_match_number: {}, next_round: {}, next_match_number: {}",
                         current_round, current_match_number, next_round, next_match_number);

                // Проверить существует ли следующий матч
                let next_match_exists: Option<i32> = sqlx::query_scalar(
                    "SELECT match_id FROM matches_cache
                     WHERE bracket_id = ? AND round_number = ? AND match_number = ?"
                )
                .bind(bracket_id)
                .bind(next_round)
                .bind(next_match_number)
                .fetch_optional(&mut *tx)
                .await?;

                if let Some(next_match_id) = next_match_exists {
                    println!("[finish_match] Found next match_id: {}, checking free slots...", next_match_id);

                    // Читаем текущие слоты следующего матча (плоские колонки)
                    let next_slots: Option<(Option<i32>, Option<i32>)> = sqlx::query_as(
                        "SELECT p1_id, p2_id FROM matches_cache WHERE match_id = ?"
                    )
                    .bind(next_match_id)
                    .fetch_optional(&mut *tx)
                    .await?;

                    let (next_p1_id, next_p2_id) = next_slots.unwrap_or((None, None));

                    let winner_id_val = winner_participant_json.get("id").and_then(|v| v.as_i64()).map(|v| v as i32);

                    let already_in_p1 = winner_id_val.is_some() && next_p1_id == winner_id_val;
                    let already_in_p2 = winner_id_val.is_some() && next_p2_id == winner_id_val;

                    if already_in_p1 || already_in_p2 {
                        println!("[finish_match] ⚠️ Winner already in next match {}, skipping advancement", next_match_id);
                    } else {
                    let p1_empty = next_p1_id.is_none();
                    let p2_empty = next_p2_id.is_none();

                    // Выбираем первый свободный слот (1 = participant1, 2 = participant2)
                    let target_slot: Option<u8> = if p1_empty {
                        Some(1)
                    } else if p2_empty {
                        Some(2)
                    } else {
                        None
                    };

                    if target_slot.is_none() {
                        println!("[finish_match] ⚠️ Both slots occupied in match {}, cannot advance winner", next_match_id);
                    }

                    if let Some(slot) = target_slot {
                        let w_id = winner_participant_json.get("id").and_then(|v| v.as_i64()).map(|v| v as i32);
                        let w_name = winner_participant_json.get("full_name").and_then(|v| v.as_str()).map(String::from);
                        let w_club = winner_participant_json.get("club_name").and_then(|v| v.as_str()).map(String::from);

                        println!("[finish_match] Free slot {} found in match {}, advancing winner: id={:?}, name={:?}",
                                 slot, next_match_id, w_id, w_name);

                        if slot == 1 {
                            sqlx::query(
                                "UPDATE matches_cache
                                 SET p1_id = ?, p1_name = ?, p1_club = ?,
                                     updated_at = datetime('now')
                                 WHERE match_id = ?"
                            )
                            .bind(w_id)
                            .bind(&w_name)
                            .bind(&w_club)
                            .bind(next_match_id)
                            .execute(&mut *tx)
                            .await?;
                        } else {
                            sqlx::query(
                                "UPDATE matches_cache
                                 SET p2_id = ?, p2_name = ?, p2_club = ?,
                                     updated_at = datetime('now')
                                 WHERE match_id = ?"
                            )
                            .bind(w_id)
                            .bind(&w_name)
                            .bind(&w_club)
                            .bind(next_match_id)
                            .execute(&mut *tx)
                            .await?;
                        }

                    // Добавить в sync_queue для синхронизации с сервером
                    let next_match_sync_data = serde_json::json!({
                        "match_id": next_match_id,
                        "action": "update_participant",
                        "participant_slot": slot,
                        "participant_id": final_winner_id,
                        "participant_data": winner_participant_json.clone()
                    });

                    sqlx::query(
                        "INSERT INTO sync_queue (match_id, data, synced)
                         VALUES (?, ?, 0)"
                    )
                    .bind(next_match_id)
                    .bind(next_match_sync_data.to_string())
                    .execute(&mut *tx)
                    .await?;

                println!("[finish_match] Successfully advanced winner to next match_id: {}", next_match_id);

                // Сохранить данные для отправки на локальный сервер после коммита транзакции
                advancement_data = Some((next_match_id, slot, w_id, w_name, w_club));
                println!("[finish_match] Saved advancement data for local server sync: match_id={}, slot={}, participant_id={:?}",
                         next_match_id, slot, w_id);
                    } // Закрываем if let Some(slot)
                    } // Закрываем else (для if already_in_p1 || already_in_p2)
                } else {
                    println!("[finish_match] WARNING: No next match found for bracket_id: {}, round: {}, match_number: {} - this might be the final match or data issue",
                             bracket_id, next_round, next_match_number);
                }
        } else {
            println!("[finish_match] Draw or no winner determined");
        }

        // 5. Добавить в sync_queue информацию о завершении матча
        // ВАЖНО: Формат для production API (setki.pro)
        // participant1 = blue = fighter1, participant2 = red = fighter2
        let sync_data = serde_json::json!({
            "match_id": match_id,
            "fighter1_score": final_blue_score,  // fighter1 = participant1 = blue
            "fighter2_score": final_red_score,   // fighter2 = participant2 = red
            "winner_id": final_winner_id,         // ID победителя (participant_id)
            "status": "completed"
        });

            sqlx::query(
                "INSERT INTO sync_queue (match_id, data, synced)
                 VALUES (?, ?, 0)"
            )
            .bind(match_id)
            .bind(sync_data.to_string())
            .execute(&mut *tx)
            .await?;

            Ok(())
        }.await;

        // Обработка результата транзакции
        match transaction_result {
            Ok(_) => {
                // Всё успешно - коммитим транзакцию
                tx.commit().await?;
                println!("[finish_match] Transaction committed successfully");

                // После успешного коммита - отправить данные о продвижении на локальный сервер (если есть)
                if let Some((next_match_id, participant_slot, participant_id, participant_name, club)) = advancement_data {
                    println!("[finish_match] Checking if should send advancement to local server...");

                    // Проверяем, находимся ли мы в режиме local-client
                    // Локальный сервер - это IP вида 192.168.x.x, 10.0.x.x, 172.16-31.x.x, localhost
                    let is_local_server = is_local_url(&self.base_url);

                    if is_local_server {
                        println!("[finish_match] Local server detected ({}), sending participant advancement...", self.base_url);

                        // Отправляем обновление участника на локальный сервер
                        // ВАЖНО: Не фейлим finish_match если отправка не удалась - данные уже сохранены в локальной БД
                        match self.update_match_participant_on_local_server(
                            &self.base_url,
                            next_match_id,
                            participant_slot,
                            participant_id,
                            participant_name,
                            club,
                        ).await {
                            Ok(_) => {
                                println!("[finish_match] ✅ Successfully sent participant advancement to local server");
                            }
                            Err(e) => {
                                println!("[finish_match] ⚠️ WARNING: Failed to send participant advancement to local server: {}",  e);
                                println!("[finish_match] Data is safe in local DB and sync_queue, will retry later");
                            }
                        }
                    } else {
                        println!("[finish_match] Online mode detected ({}), skipping local server sync (will use sync_queue)", self.base_url);
                    }
                }

                Ok(())
            }
            Err(e) => {
                // Ошибка - откатываем транзакцию
                println!("[finish_match] Error during transaction, rolling back: {}", e);
                tx.rollback().await.ok(); // Игнорируем ошибку ROLLBACK
                Err(e)
            }
        }
    }

    /// Скачать всех спортсменов с setki.pro и сохранить в fighters_cache
    pub async fn download_fighters(&self) -> Result<usize> {
        let token = self.get_token().await?
            .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

        let url = format!("{}/desktop/fighters/", self.base_url);
        println!("[download_fighters] Requesting URL: {}", url);
        let response = self.client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            println!("[download_fighters] ERROR: HTTP {} at URL: {}", status, url);
            return Err(anyhow::anyhow!("HTTP {} (URL: {}): {}", status, url, text));
        }

        let fighters: Vec<serde_json::Value> = response.json().await?;
        let count = fighters.len();

        // Очистить старый кэш и залить новый
        sqlx::query("DELETE FROM fighters_cache")
            .execute(self.db.as_ref())
            .await?;

        for f in &fighters {
            let id = f["id"].as_i64().unwrap_or(0) as i32;
            let full_name = f["full_name"].as_str().unwrap_or("").to_string();
            let club_name = f["club_name"].as_str().map(String::from);
            let gender = f["gender"].as_str().map(String::from);

            sqlx::query(
                "INSERT INTO fighters_cache (fighter_id, full_name, club_name, gender)
                 VALUES (?, ?, ?, ?)"
            )
            .bind(id)
            .bind(&full_name)
            .bind(&club_name)
            .bind(&gender)
            .execute(self.db.as_ref())
            .await?;
        }

        println!("[download_fighters] Saved {} fighters to cache", count);
        Ok(count)
    }
}
