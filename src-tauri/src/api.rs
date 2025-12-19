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

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateMatchScoreRequest {
    pub match_id: i32,
    pub red_score: i32,
    pub blue_score: i32,
    pub red_warnings: i32,
    pub blue_warnings: i32,
    pub status: String,
}

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
        let req = LoginRequest { login, password };

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

        // Сохранить токен в БД
        self.save_token(&auth.access_token).await?;

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
                self.save_token(&auth.access_token).await?;
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
                self.save_token(&fake_token).await?;

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

    // Сохранить сессию судьи (имя и номер стола)
    pub async fn save_judge_session(&self, pin_code: &str, judge_name: &str, table_number: i32, tournament_id: Option<i32>) -> Result<()> {
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

        // 2. Сохранить сессию судьи
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

        // 3. Зарезервировать номер стола
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

    // Сохранить токен в БД
    async fn save_token(&self, token: &str) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO auth (id, token, created_at) VALUES (1, ?, datetime('now'))"
        )
        .bind(token)
        .execute(self.db.as_ref())
        .await?;

        Ok(())
    }

    // Получить сохранённый токен
    pub async fn get_token(&self) -> Result<Option<String>> {
        let record = sqlx::query_as::<_, (String,)>("SELECT token FROM auth WHERE id = 1")
            .fetch_optional(self.db.as_ref())
            .await?;

        Ok(record.map(|r| r.0))
    }

    // Скачать данные турнира для offline режима (батч-запрос)
    pub async fn download_tournament(&self, tournament_id: i32) -> Result<()> {
        let token = self.get_token().await?
            .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

        // Батч-запрос: получаем всё за один раз
        let url = format!("{}/desktop/tournaments/{}/download", self.base_url, tournament_id);
        let response = self.client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!("Ошибка загрузки данных: {}", response.status()));
        }

        let data: serde_json::Value = response.json().await?;

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

    // Получить список турниров администратора
    pub async fn get_tournaments(&self) -> Result<Vec<TournamentBrief>> {
        let token = self.get_token().await?
            .ok_or_else(|| anyhow::anyhow!("Не авторизован"))?;

        let url = format!("{}/desktop/tournaments/my", self.base_url);
        let response = self.client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!("Ошибка загрузки турниров: {}", response.status()));
        }

        let tournaments: Vec<TournamentBrief> = response.json().await?;
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

        // Получить PIN турнира
        let pin_url = format!("{}/desktop/tournaments/{}/pin", self.base_url, tournament_id);
        let pin_response = self.client
            .get(&pin_url)
            .bearer_auth(&token)
            .send()
            .await?;

        let pin_code = if pin_response.status().is_success() {
            let pin_data: serde_json::Value = pin_response.json().await?;
            let pin = pin_data["pin_code"].as_str().unwrap_or("000000").to_string();

            // Сохранить PIN в кэш для offline работы судей
            let tournament_name = tournament_data["name"].as_str().unwrap_or("Unknown");
            self.cache_pin(&pin, tournament_id, tournament_name).await.ok();

            pin
        } else {
            "000000".to_string() // Fallback если нет PIN
        };

        // Получить сетки турнира из API (не из кэша!)
        let brackets_url = format!("{}/desktop/brackets/tournament/{}", self.base_url, tournament_id);
        let brackets_response = self.client
            .get(&brackets_url)
            .bearer_auth(&token)
            .send()
            .await;

        let brackets = if let Ok(resp) = brackets_response {
            if resp.status().is_success() {
                resp.json::<Vec<serde_json::Value>>().await.unwrap_or_default()
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
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
        .execute(self.db.as_ref())
        .await?;

        // Добавить в очередь синхронизации
        let sync_data = serde_json::json!({
            "match_id": match_id,
            "red_score": red_score,
            "blue_score": blue_score,
            "red_warnings": red_warnings,
            "blue_warnings": blue_warnings,
            "status": status
        });

        sqlx::query(
            "INSERT INTO sync_queue (match_id, data, synced)
             VALUES (?, ?, 0)"
        )
        .bind(match_id)
        .bind(sync_data.to_string())
        .execute(self.db.as_ref())
        .await?;

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
    // Оптимизация: 3 IPC вызова → 1 вызов (без транзакции для упрощения)
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
        .execute(self.db.as_ref())
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
        .execute(self.db.as_ref())
        .await?;

        // 3. Добавить в очередь синхронизации
        let sync_data = serde_json::json!({
            "match_id": match_id,
            "red_score": red_score,
            "blue_score": blue_score,
            "red_warnings": red_warnings,
            "blue_warnings": blue_warnings,
            "status": status
        });

        sqlx::query(
            "INSERT INTO sync_queue (match_id, data, synced)
             VALUES (?, ?, 0)"
        )
        .bind(match_id)
        .bind(sync_data.to_string())
        .execute(self.db.as_ref())
        .await?;

        // 4. Получить все события (включая только что добавленное)
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
        // Обновить статус матча в кэше
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
        .bind(winner_id)
        .bind(result_type.clone())
        .bind(final_blue_score)
        .bind(final_red_score)
        .bind(match_id)
        .execute(self.db.as_ref())
        .await?;

        // Добавить в sync_queue
        let sync_data = serde_json::json!({
            "match_id": match_id,
            "winner_id": winner_id,
            "result_type": result_type,
            "red_score": final_red_score,
            "blue_score": final_blue_score,
            "status": "completed"
        });

        sqlx::query(
            "INSERT INTO sync_queue (match_id, data, synced)
             VALUES (?, ?, 0)"
        )
        .bind(match_id)
        .bind(sync_data.to_string())
        .execute(self.db.as_ref())
        .await?;

        Ok(())
    }
}
