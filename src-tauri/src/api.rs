use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;

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
}

impl ApiClient {
    pub fn new(base_url: String, db: Arc<SqlitePool>) -> Self {
        Self {
            client: Client::new(),
            base_url,
            db,
        }
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

        // Если base_url - локальный сервер (содержит 192.168 или 10.0), отправляем judge_name и table_number
        let is_local_server = self.base_url.contains("192.168")
            || self.base_url.contains("10.0")
            || self.base_url.contains("172.16")
            || self.base_url.contains("127.0.0.1")
            || self.base_url.contains("localhost");

        #[derive(serde::Serialize)]
        struct LocalLoginRequest {
            pin_code: String,
            judge_name: Option<String>,
            table_number: Option<i32>,
        }

        // Попытка online авторизации
        let online_result = if is_local_server {
            // Для локального сервера отправляем расширенный запрос
            self.client
                .post(&url)
                .json(&LocalLoginRequest {
                    pin_code: pin_code.clone(),
                    judge_name: judge_name.clone(),
                    table_number,
                })
                .send()
                .await
        } else {
            // Для setki.pro отправляем только PIN
            self.client
                .post(&url)
                .json(&PinLoginRequest { pin_code: pin_code.clone() })
                .send()
                .await
        };

        match online_result {
            Ok(response) if response.status().is_success() => {
                // Online успешно
                let mut auth: AuthResponse = response.json().await?;
                auth.judge_name = None; // Имя будет добавлено в Tauri command
                // Токен будет сохранен в save_judge_session с полными данными
                Ok(auth)
            },
            _ => {
                // Fallback на offline проверку
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
        // 1. Проверить, что номер стола свободен
        if let Some(tid) = tournament_id {
            let occupied = sqlx::query_as::<_, (i32,)>(
                "SELECT COUNT(*) FROM table_numbers WHERE tournament_id = ? AND table_number = ?"
            )
            .bind(tid)
            .bind(table_number)
            .fetch_one(self.db.as_ref())
            .await?;

            if occupied.0 > 0 {
                return Err(anyhow::anyhow!("Номер стола {} уже занят", table_number));
            }
        }

        // 2. Сохранить токен судьи
        self.save_judge_token(token, pin_code, judge_name, table_number, tournament_id).await?;

        // 3. Сохранить сессию судьи
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

        // 4. Зарезервировать номер стола
        if let Some(tid) = tournament_id {
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
        }

        Ok(())
    }

    // Освободить номер стола при выходе судьи
    pub async fn release_table_number(&self, tournament_id: i32, table_number: i32) -> Result<()> {
        sqlx::query(
            "DELETE FROM table_numbers WHERE tournament_id = ? AND table_number = ?"
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
        let record = sqlx::query_as::<_, (String,)>(
            "SELECT pin_code FROM cached_pins WHERE tournament_id = ?"
        )
        .bind(tournament_id)
        .fetch_optional(self.db.as_ref())
        .await?;

        match record {
            Some((pin,)) => Ok(pin),
            None => Err(anyhow::anyhow!("PIN не найден в кэше для турнира {}", tournament_id))
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
        sqlx::query(
            "INSERT OR REPLACE INTO judge_auth (pin_code, token, judge_name, table_number, tournament_id, created_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))"
        )
        .bind(pin_code)
        .bind(token)
        .bind(judge_name)
        .bind(table_number)
        .bind(tournament_id)
        .execute(self.db.as_ref())
        .await?;

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
        // Сначала проверяем админа
        if let Some(token) = self.get_admin_token().await? {
            return Ok(Some(token));
        }
        // Потом любого судью
        if let Some(token) = self.get_any_judge_token().await? {
            return Ok(Some(token));
        }
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

        // Извлекаем сетки с матчами
        let brackets = data["brackets"].as_array()
            .ok_or_else(|| anyhow::anyhow!("Неверный формат ответа"))?;

        // Сохраняем сетки и матчи
        for bracket in brackets {
            let bracket_id = bracket["id"].as_i64().unwrap() as i32;

            // Сохранить сетку (без вложенных matches)
            let mut bracket_copy = bracket.clone();
            bracket_copy.as_object_mut().unwrap().remove("matches");
            let bracket_data = serde_json::to_string(&bracket_copy)?;

            sqlx::query(
                "INSERT OR REPLACE INTO brackets_cache (bracket_id, data, tournament_id, updated_at)
                 VALUES (?, ?, ?, datetime('now'))"
            )
            .bind(bracket_id)
            .bind(bracket_data)
            .bind(tournament_id)
            .execute(self.db.as_ref())
            .await?;

            // Сохранить все матчи этой сетки
            if let Some(matches) = bracket["matches"].as_array() {
                for match_data in matches {
                    let match_id = match_data["id"].as_i64().unwrap_or(0) as i32;
                    let match_json = serde_json::to_string(&match_data)?;

                    sqlx::query(
                        "INSERT OR REPLACE INTO matches_cache (match_id, bracket_id, data, updated_at)
                         VALUES (?, ?, ?, datetime('now'))"
                    )
                    .bind(match_id)
                    .bind(bracket_id)
                    .bind(match_json)
                    .execute(self.db.as_ref())
                    .await?;
                }
            }
        }

        // Кэшируем PIN-код если есть
        if let Some(pin_code) = data["pin_code"].as_str() {
            let tournament_name = data["tournament"]["name"].as_str().unwrap_or("Unknown");
            self.cache_pin(pin_code, tournament_id, tournament_name).await.ok();
        }

        Ok(())
    }

    // Получить сетки из кэша (offline)
    pub async fn get_cached_brackets(&self, tournament_id: i32) -> Result<Vec<serde_json::Value>> {
        let records = sqlx::query_as::<_, (String,)>(
            "SELECT data FROM brackets_cache WHERE tournament_id = ?"
        )
        .bind(tournament_id)
        .fetch_all(self.db.as_ref())
        .await?;

        let brackets: Vec<serde_json::Value> = records
            .into_iter()
            .filter_map(|r| serde_json::from_str(&r.0).ok())
            .collect();

        Ok(brackets)
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

            let url = format!("{}/api/v1/desktop/matches/update", server_url);
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
                    let pin = pin_data["pin_code"].as_str().unwrap_or("000000").to_string();

                    // Сохранить PIN в кэш для offline работы судей
                    let tournament_name = tournament_data["name"].as_str().unwrap_or("Unknown");
                    self.cache_pin(&pin, tournament_id, tournament_name).await.ok();

                    pin
                } else {
                    // Fallback на кэшированный PIN
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
    pub async fn reserve_bracket(&self, bracket_id: i32, judge_name: &str, user_id: i32) -> Result<()> {
        // Проверить, не занята ли уже сетка
        let existing = sqlx::query_as::<_, (String, i32)>(
            "SELECT judge_name, user_id FROM bracket_reservations WHERE bracket_id = ?"
        )
        .bind(bracket_id)
        .fetch_optional(self.db.as_ref())
        .await?;

        if let Some((existing_judge, existing_user_id)) = existing {
            // Если сетка уже занята этим же судьей, просто обновляем время
            if existing_user_id == user_id {
                sqlx::query(
                    "UPDATE bracket_reservations SET reserved_at = datetime('now') WHERE bracket_id = ?"
                )
                .bind(bracket_id)
                .execute(self.db.as_ref())
                .await?;
                return Ok(());
            }

            // Иначе сетка занята другим судьей
            return Err(anyhow::anyhow!(
                "Сетка уже занята судьей: {}",
                existing_judge
            ));
        }

        // Зарезервировать сетку
        sqlx::query(
            "INSERT INTO bracket_reservations (bracket_id, judge_name, user_id, reserved_at)
             VALUES (?, ?, ?, datetime('now'))"
        )
        .bind(bracket_id)
        .bind(judge_name)
        .bind(user_id)
        .execute(self.db.as_ref())
        .await?;

        Ok(())
    }

    // Освободить сетку (отменить резервирование)
    pub async fn release_bracket(&self, bracket_id: i32) -> Result<()> {
        sqlx::query("DELETE FROM bracket_reservations WHERE bracket_id = ?")
            .bind(bracket_id)
            .execute(self.db.as_ref())
            .await?;

        Ok(())
    }

    // Очистить все резервирования (для отладки)
    pub async fn clear_all_reservations(&self) -> Result<()> {
        sqlx::query("DELETE FROM bracket_reservations")
            .execute(self.db.as_ref())
            .await?;

        Ok(())
    }

    // Получить информацию о резервировании сетки
    pub async fn get_bracket_reservation(&self, bracket_id: i32) -> Result<Option<(String, i32)>> {
        let result = sqlx::query_as::<_, (String, i32)>(
            "SELECT judge_name, user_id FROM bracket_reservations WHERE bracket_id = ?"
        )
        .bind(bracket_id)
        .fetch_optional(self.db.as_ref())
        .await?;

        Ok(result)
    }

    // Получить матчи сетки из кэша
    pub async fn get_bracket_matches(&self, bracket_id: i32) -> Result<Vec<serde_json::Value>> {
        let records = sqlx::query_as::<_, (String,)>(
            "SELECT data FROM matches_cache WHERE bracket_id = ?"
        )
        .bind(bracket_id)
        .fetch_all(self.db.as_ref())
        .await?;

        let matches: Vec<serde_json::Value> = records
            .into_iter()
            .filter_map(|r| serde_json::from_str(&r.0).ok())
            .collect();

        Ok(matches)
    }

    // ====== Методы для работы с поединками ======

    // Начать матч (изменить статус на in_progress)
    pub async fn start_match(&self, match_id: i32) -> Result<()> {
        // Обновить статус в кэше
        sqlx::query(
            "UPDATE matches_cache
             SET data = json_set(data, '$.status', 'in_progress'),
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

        // Обновить локальный кэш matches_cache
        // participant1 = blue, participant2 = red (согласно существующей схеме)
        sqlx::query(
            "UPDATE matches_cache
             SET data = json_set(
                 json_set(
                     json_set(
                         json_set(data, '$.score_participant1', ?),
                         '$.score_participant2', ?),
                     '$.warnings_participant1', ?),
                 '$.warnings_participant2', ?),
                 updated_at = datetime('now')
             WHERE match_id = ?"
        )
        .bind(blue_score)
        .bind(red_score)
        .bind(blue_warnings)
        .bind(red_warnings)
        .bind(match_id)
        .execute(&mut *tx)
        .await?;

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

        // Commit транзакции - либо обе операции успешны, либо обе откатятся
        tx.commit().await?;

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

        // 2. Обновить счет матча в кэше
        // participant1 = blue, participant2 = red
        sqlx::query(
            "UPDATE matches_cache
             SET data = json_set(
                 json_set(
                     json_set(
                         json_set(data, '$.score_participant1', ?),
                         '$.score_participant2', ?),
                     '$.warnings_participant1', ?),
                 '$.warnings_participant2', ?),
                 updated_at = datetime('now')
             WHERE match_id = ?"
        )
        .bind(blue_score)
        .bind(red_score)
        .bind(blue_warnings)
        .bind(red_warnings)
        .bind(match_id)
        .execute(&mut *tx)
        .await?;

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

        // 1. Получить информацию о текущем матче (раунд, номер матча, bracket_id)
        let match_info: (i32, i32, i32) = sqlx::query_as(
            "SELECT
                CAST(json_extract(data, '$.round_number') AS INTEGER) as round_number,
                CAST(json_extract(data, '$.match_number') AS INTEGER) as match_number,
                CAST(json_extract(data, '$.bracket_id') AS INTEGER) as bracket_id
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
                // Красный победил - нужно получить его ID из participant2
                let red_id: Option<i64> = sqlx::query_scalar(
                    "SELECT CAST(json_extract(data, '$.participant2.id') AS INTEGER) FROM matches_cache WHERE match_id = ?"
                )
                .bind(match_id)
                .fetch_optional(self.db.as_ref())
                .await?
                .flatten();
                red_id.map(|id| id as i32)
            } else if final_blue_score > final_red_score {
                // Синий победил - нужно получить его ID из participant1
                let blue_id: Option<i64> = sqlx::query_scalar(
                    "SELECT CAST(json_extract(data, '$.participant1.id') AS INTEGER) FROM matches_cache WHERE match_id = ?"
                )
                .bind(match_id)
                .fetch_optional(self.db.as_ref())
                .await?
                .flatten();
                blue_id.map(|id| id as i32)
            } else {
                None // Ничья
            }
        };

        println!("[finish_match] Final winner_id: {:?}", final_winner_id);

        // Начинаем транзакцию для атомарности всех операций
        println!("[finish_match] Starting transaction for atomic match completion");
        let mut tx = self.db.begin().await?;

        // Если произойдёт ошибка ниже, транзакция автоматически откатится при drop
        let transaction_result: Result<(), anyhow::Error> = async {
            // 3. Обновить статус текущего матча в кэше
            sqlx::query(
            "UPDATE matches_cache
             SET data = json_set(
                 json_set(
                     json_set(
                         json_set(
                             json_set(data, '$.status', 'completed'),
                             '$.winner_id', ?),
                         '$.result_type', ?),
                     '$.score_participant1', ?),
                 '$.score_participant2', ?),
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

        // 4. Продвинуть победителя в следующий матч (определяем по счету если нет winner_id)
        // Получить данные матча для определения победителя
        let match_data_json: String = sqlx::query_scalar(
            "SELECT data FROM matches_cache WHERE match_id = ?"
        )
        .bind(match_id)
        .fetch_one(&mut *tx)
        .await?;

        let match_data: serde_json::Value = serde_json::from_str(&match_data_json)
            .map_err(|e| anyhow::anyhow!("Failed to parse match data: {}", e))?;

        // Проверяем формат данных (новый vs старый)
        let has_participant_objects = match_data.get("participant1").is_some()
            && match_data["participant1"].is_object();

        // Определить победителя по счету если winner_id не указан
        let winner_participant_json = if final_winner_id.is_some() {
            // Если winner_id указан, ищем по ID или fighter_id
            let winner = final_winner_id.unwrap();

            if has_participant_objects {
                // НОВЫЙ формат: participant1/participant2 - объекты
                let p1_id = match_data["participant1"]["id"].as_i64();
                let p2_id = match_data["participant2"]["id"].as_i64();
                let p1_fighter_id = match_data["participant1"]["fighter_id"].as_i64();
                let p2_fighter_id = match_data["participant2"]["fighter_id"].as_i64();

                println!("[finish_match] NEW format - Looking for winner_id={}, participant1: id={:?}, fighter_id={:?}, participant2: id={:?}, fighter_id={:?}",
                         winner, p1_id, p1_fighter_id, p2_id, p2_fighter_id);

                if p1_id == Some(winner as i64) || p1_fighter_id == Some(winner as i64) {
                    println!("[finish_match] Winner matched: participant1 (by id or fighter_id)");
                    match_data["participant1"].clone()
                } else if p2_id == Some(winner as i64) || p2_fighter_id == Some(winner as i64) {
                    println!("[finish_match] Winner matched: participant2 (by id or fighter_id)");
                    match_data["participant2"].clone()
                } else {
                    println!("[finish_match] Winner ID {} not found in participants - falling back to score", winner);
                    if final_blue_score > final_red_score {
                        println!("[finish_match] Fallback winner: participant1 (blue)");
                        match_data["participant1"].clone()
                    } else if final_red_score > final_blue_score {
                        println!("[finish_match] Fallback winner: participant2 (red)");
                        match_data["participant2"].clone()
                    } else {
                        println!("[finish_match] Fallback: draw (scores are equal: {}:{})", final_blue_score, final_red_score);
                        serde_json::Value::Null
                    }
                }
            } else {
                // СТАРЫЙ формат: participant1_id, participant2_id - прямые поля
                let p1_id = match_data["participant1_id"].as_i64();
                let p2_id = match_data["participant2_id"].as_i64();

                println!("[finish_match] OLD format - Looking for winner_id={}, participant1_id={:?}, participant2_id={:?}",
                         winner, p1_id, p2_id);

                // В старом формате создаём объект победителя вручную
                if p1_id == Some(winner as i64) {
                    println!("[finish_match] Winner matched: participant1 (blue) id={}", winner);
                    serde_json::json!({
                        "id": winner,
                        "fighter_id": winner,
                        "full_name": match_data["fighter1_name"].clone(),
                        "club_name": match_data["fighter1_club"].clone()
                    })
                } else if p2_id == Some(winner as i64) {
                    println!("[finish_match] Winner matched: participant2 (red) id={}", winner);
                    serde_json::json!({
                        "id": winner,
                        "fighter_id": winner,
                        "full_name": match_data["fighter2_name"].clone(),
                        "club_name": match_data["fighter2_club"].clone()
                    })
                } else {
                    println!("[finish_match] Winner ID {} not found - fallback to score", winner);
                    if final_blue_score > final_red_score {
                        println!("[finish_match] Fallback winner: participant1 (blue)");
                        serde_json::json!({
                            "id": p1_id,
                            "fighter_id": p1_id,
                            "full_name": match_data["fighter1_name"].clone(),
                            "club_name": match_data["fighter1_club"].clone()
                        })
                    } else if final_red_score > final_blue_score {
                        println!("[finish_match] Fallback winner: participant2 (red)");
                        serde_json::json!({
                            "id": p2_id,
                            "fighter_id": p2_id,
                            "full_name": match_data["fighter2_name"].clone(),
                            "club_name": match_data["fighter2_club"].clone()
                        })
                    } else {
                        println!("[finish_match] Fallback: draw");
                        serde_json::Value::Null
                    }
                }
            }
        } else {
            // Если winner_id не указан, определяем по счету
            let score1 = match_data["score_participant1"].as_i64().unwrap_or(0);
            let score2 = match_data["score_participant2"].as_i64().unwrap_or(0);

            println!("[finish_match] No winner_id provided, determining by score: p1={}, p2={}", score1, score2);

            if has_participant_objects {
                // Новый формат
                if score1 > score2 {
                    match_data["participant1"].clone()
                } else if score2 > score1 {
                    match_data["participant2"].clone()
                } else {
                    serde_json::Value::Null
                }
            } else {
                // Старый формат - создаём объект
                if score1 > score2 {
                    serde_json::json!({
                        "id": match_data["participant1_id"].clone(),
                        "fighter_id": match_data["participant1_id"].clone(),
                        "full_name": match_data["fighter1_name"].clone(),
                        "club_name": match_data["fighter1_club"].clone()
                    })
                } else if score2 > score1 {
                    serde_json::json!({
                        "id": match_data["participant2_id"].clone(),
                        "fighter_id": match_data["participant2_id"].clone(),
                        "full_name": match_data["fighter2_name"].clone(),
                        "club_name": match_data["fighter2_club"].clone()
                    })
                } else {
                    serde_json::Value::Null
                }
            }
        };

        if !winner_participant_json.is_null() {
            let winner_json = winner_participant_json.to_string();
            println!("[finish_match] Winner participant data: {}", winner_json);

            // Вычислить параметры следующего матча
                let next_round = current_round + 1;
                // Нумерация матчей начинается с 0, поэтому формула: current_match_number / 2
                let next_match_number = current_match_number / 2;
                println!("[finish_match] Next match calculation - current_round: {}, current_match_number: {}, next_round: {}, next_match_number: {}",
                         current_round, current_match_number, next_round, next_match_number);

                // Определить слот в следующем матче (четные номера (0,2,4) → participant1, нечетные (1,3,5) → participant2)
                let target_slot = if current_match_number % 2 == 0 {
                    "$.participant1"
                } else {
                    "$.participant2"
                };
                println!("[finish_match] Target slot for winner: {}", target_slot);

                // Проверить существует ли следующий матч
                let next_match_exists: Option<i32> = sqlx::query_scalar(
                    "SELECT match_id FROM matches_cache
                     WHERE CAST(json_extract(data, '$.bracket_id') AS INTEGER) = ?
                       AND CAST(json_extract(data, '$.round_number') AS INTEGER) = ?
                       AND CAST(json_extract(data, '$.match_number') AS INTEGER) = ?"
                )
                .bind(bracket_id)
                .bind(next_round)
                .bind(next_match_number)
                .fetch_optional(&mut *tx)
                .await?;

                if let Some(next_match_id) = next_match_exists {
                    println!("[finish_match] Found next match_id: {}, updating slot {} with winner data", next_match_id, target_slot);

                    // Получаем данные следующего матча чтобы определить формат
                    let next_match_data_row = sqlx::query("SELECT data FROM matches_cache WHERE match_id = ?")
                        .bind(next_match_id)
                        .fetch_one(&mut *tx)
                        .await?;
                    let next_match_data_str: String = sqlx::Row::get(&next_match_data_row, "data");
                    let next_match_data: serde_json::Value = serde_json::from_str(&next_match_data_str)?;

                    let next_has_participant_objects = next_match_data.get("participant1").is_some()
                        && next_match_data["participant1"].is_object();

                    if next_has_participant_objects {
                        println!("[finish_match] Next match uses NEW format - updating participant object");
                        // НОВЫЙ формат - обновляем participant object целиком
                        sqlx::query(&format!(
                            "UPDATE matches_cache
                             SET data = json_set(data, '{}', json(?)),
                                 updated_at = datetime('now')
                             WHERE match_id = ?",
                            target_slot
                        ))
                        .bind(winner_json.clone())
                        .bind(next_match_id)
                        .execute(&mut *tx)
                        .await?;
                    } else {
                        println!("[finish_match] Next match uses OLD format - updating individual fields");
                        // СТАРЫЙ формат - обновляем отдельные поля
                        let winner_data: serde_json::Value = serde_json::from_str(&winner_json)?;
                        let winner_id = winner_data["fighter_id"].as_i64();
                        let winner_name = winner_data["full_name"].as_str().unwrap_or("");
                        let winner_club = winner_data["club_name"].as_str().unwrap_or("");

                        println!("[finish_match] Updating OLD format fields: id={:?}, name={}, club={}", winner_id, winner_name, winner_club);

                        if target_slot == "$.participant1" {
                            // Обновляем participant1 поля
                            sqlx::query(
                                "UPDATE matches_cache
                                 SET data = json_set(
                                     json_set(
                                         json_set(data, '$.participant1_id', ?),
                                         '$.fighter1_name', ?
                                     ),
                                     '$.fighter1_club', ?
                                 ),
                                 updated_at = datetime('now')
                                 WHERE match_id = ?"
                            )
                            .bind(winner_id)
                            .bind(winner_name)
                            .bind(winner_club)
                            .bind(next_match_id)
                            .execute(&mut *tx)
                            .await?;
                        } else {
                            // Обновляем participant2 поля
                            sqlx::query(
                                "UPDATE matches_cache
                                 SET data = json_set(
                                     json_set(
                                         json_set(data, '$.participant2_id', ?),
                                         '$.fighter2_name', ?
                                     ),
                                     '$.fighter2_club', ?
                                 ),
                                 updated_at = datetime('now')
                                 WHERE match_id = ?"
                            )
                            .bind(winner_id)
                            .bind(winner_name)
                            .bind(winner_club)
                            .bind(next_match_id)
                            .execute(&mut *tx)
                            .await?;
                        }
                    }

                    // Добавить в sync_queue для синхронизации с сервером
                    let next_match_sync_data = serde_json::json!({
                        "match_id": next_match_id,
                        "action": "update_participant",
                        "participant_slot": if current_match_number % 2 == 0 { 1 } else { 2 },
                        "participant_id": final_winner_id,
                        "participant_data": serde_json::from_str::<serde_json::Value>(&winner_json).ok()
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
}
