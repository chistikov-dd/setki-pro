# Автоматическое продвижение победителя в турнирной сетке

## Обзор

При завершении матча победитель автоматически переходит в следующий раунд турнирной сетки (для single elimination).

## Архитектура

### Расположение кода

- **Backend**: `src-tauri/src/api.rs` → функция `finish_match()`
- **Frontend**: `src/stores/matchStore.ts` → вызывает `finishMatch()`
- **UI**: `src/components/match/MatchScreen.tsx` → обработчик `handleFinishMatch()`

### Алгоритм продвижения

#### 1. Вычисление следующего матча

```rust
// Single Elimination Tournament Structure
next_round = current_round + 1
next_match_number = (current_match_number + 1) / 2  // целочисленное деление
target_slot = if current_match_number % 2 == 1 {
    "participant1"
} else {
    "participant2"
}
```

#### 2. Пример для 8 участников

```
Раунд 1 (Четвертьфинал):
  Match 1.1: P1 vs P2 → Winner → Match 2.1 (slot 1)
  Match 1.2: P3 vs P4 → Winner → Match 2.1 (slot 2)
  Match 1.3: P5 vs P6 → Winner → Match 2.2 (slot 1)
  Match 1.4: P7 vs P8 → Winner → Match 2.2 (slot 2)

Раунд 2 (Полуфинал):
  Match 2.1: W1.1 vs W1.2 → Winner → Match 3.1 (slot 1)
  Match 2.2: W1.3 vs W1.4 → Winner → Match 3.1 (slot 2)

Раунд 3 (Финал):
  Match 3.1: W2.1 vs W2.2 → Champion
```

### Шаги обработки

#### Шаг 1: Получение информации о текущем матче

```rust
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
```

#### Шаг 2: Обновление статуса текущего матча

```rust
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
```

#### Шаг 3: Извлечение полных данных победителя

```rust
let winner_data_json: Option<String> = sqlx::query_scalar(
    "SELECT CASE
        WHEN CAST(json_extract(data, '$.participant1.id') AS INTEGER) = ?
            THEN json_extract(data, '$.participant1')
        WHEN CAST(json_extract(data, '$.participant2.id') AS INTEGER) = ?
            THEN json_extract(data, '$.participant2')
        ELSE NULL
     END as winner_data
     FROM matches_cache
     WHERE match_id = ?"
)
.bind(winner)
.bind(winner)
.bind(match_id)
.fetch_optional(self.db.as_ref())
.await?;
```

**Данные победителя включают:**
- `id` - ID участника
- `fighter_id` - ID бойца
- `full_name` - Полное имя
- `club_name` - Название клуба
- `final_weight` - Взвешивание

#### Шаг 4: Вычисление параметров следующего матча

```rust
let next_round = current_round + 1;
let next_match_number = (current_match_number + 1) / 2;

let target_slot = if current_match_number % 2 == 1 {
    "$.participant1"
} else {
    "$.participant2"
};
```

#### Шаг 5: Проверка существования следующего матча

```rust
let next_match_exists: Option<i32> = sqlx::query_scalar(
    "SELECT match_id FROM matches_cache
     WHERE CAST(json_extract(data, '$.bracket_id') AS INTEGER) = ?
       AND CAST(json_extract(data, '$.round_number') AS INTEGER) = ?
       AND CAST(json_extract(data, '$.match_number') AS INTEGER) = ?"
)
.bind(bracket_id)
.bind(next_round)
.bind(next_match_number)
.fetch_optional(self.db.as_ref())
.await?;
```

#### Шаг 6: Обновление следующего матча

```rust
sqlx::query(&format!(
    "UPDATE matches_cache
     SET data = json_set(data, '{}', json(?)),
         updated_at = datetime('now')
     WHERE match_id = ?",
    target_slot
))
.bind(winner_json.clone())
.bind(next_match_id)
.execute(self.db.as_ref())
.await?;
```

#### Шаг 7: Добавление в очередь синхронизации

```rust
let next_match_sync_data = serde_json::json!({
    "match_id": next_match_id,
    "action": "update_participant",
    "participant_slot": if current_match_number % 2 == 1 { 1 } else { 2 },
    "participant_id": winner,
    "participant_data": serde_json::from_str::<serde_json::Value>(&winner_json).ok()
});

sqlx::query(
    "INSERT INTO sync_queue (match_id, data, synced)
     VALUES (?, ?, 0)"
)
.bind(next_match_id)
.bind(next_match_sync_data.to_string())
.execute(self.db.as_ref())
.await?;
```

## Логирование

При выполнении функции выводятся следующие логи:

```
[finish_match] Starting - match_id: 123, winner_id: Some(456)
[finish_match] Current match info - round: 1, number: 1, bracket: 789
[finish_match] Next match calculation - round: 2, number: 1
[finish_match] Found next match: 234, updating with winner data
[finish_match] Successfully advanced winner to next match
```

Или для финального матча:

```
[finish_match] Starting - match_id: 345, winner_id: Some(678)
[finish_match] Current match info - round: 3, number: 1, bracket: 789
[finish_match] Next match calculation - round: 4, number: 1
[finish_match] No next match found - this is the final match
```

## Offline-First поддержка

### Локальный кэш (SQLite)

1. **Немедленное обновление**: Победитель сразу добавляется в следующий матч в `matches_cache`
2. **Очередь синхронизации**: Изменения добавляются в `sync_queue` с флагом `synced=0`
3. **Фоновая синхронизация**: Background worker отправляет изменения на сервер

### Обработка конфликтов

- Изменения в локальном кэше применяются немедленно
- При синхронизации с сервером используется timestamp-based conflict resolution
- Если сервер отклоняет изменение, локальный кэш обновляется из серверных данных

## Frontend интеграция

### MatchStore

```typescript
finishMatch: async (
  resultType: 'points' | 'submission' | 'disqualification',
  winnerId?: number
) => {
  const { match, redScore, blueScore, redFighter, blueFighter } = get();
  if (!match) return;

  // Определение победителя (если не указан явно)
  let finalWinnerId = winnerId;
  if (!finalWinnerId && resultType === 'points') {
    if (redScore > blueScore) {
      finalWinnerId = redFighter?.id;
    } else if (blueScore > redScore) {
      finalWinnerId = blueFighter?.id;
    }
  }

  // Завершение матча (автоматически продвигает победителя)
  await apiFinishMatch({
    matchId: match.id,
    winnerId: finalWinnerId,
    resultType,
    finalRedScore: redScore,
    finalBlueScore: blueScore,
  });
}
```

### UI обновление

После завершения матча:

1. Текущий матч помечается как `completed`
2. Победитель автоматически появляется в следующем матче
3. UI обновляется через реактивные подписки (Zustand)
4. Судья видит обновленную сетку без перезагрузки

## Особенности реализации

### 1. Целочисленное деление для match_number

```rust
// Правильно: (1 + 1) / 2 = 1
// Правильно: (2 + 1) / 2 = 1
// Правильно: (3 + 1) / 2 = 2
// Правильно: (4 + 1) / 2 = 2
```

### 2. Определение слота по четности

```rust
// Нечетные номера (1, 3, 5...) → participant1
// Четные номера (2, 4, 6...) → participant2
```

### 3. JSON обновления в SQLite

Используется `json_set()` для атомарного обновления:

```sql
UPDATE matches_cache
SET data = json_set(data, '$.participant1', json(?))
WHERE match_id = ?
```

### 4. Полные данные участника

В следующий матч передается весь объект участника, а не только ID:

```json
{
  "id": 456,
  "fighter_id": 789,
  "full_name": "Иванов Иван Иванович",
  "club_name": "Спортклуб Победа",
  "final_weight": 75.5
}
```

## Тестирование

### Ручное тестирование

1. Создать тестовую сетку с 8 участниками (3 раунда)
2. Завершить Match 1.1 → проверить появление победителя в Match 2.1 (slot 1)
3. Завершить Match 1.2 → проверить появление победителя в Match 2.1 (slot 2)
4. Завершить Match 2.1 → проверить появление победителя в Match 3.1 (slot 1)
5. Завершить Match 3.1 → проверить что нет следующего матча (финал)

### Проверка логов

```bash
# Запустить приложение с логами
npm run tauri dev

# В консоли должны появиться логи:
# [finish_match] Starting...
# [finish_match] Current match info...
# [finish_match] Successfully advanced winner...
```

### Проверка базы данных

```bash
# Открыть SQLite
sqlite3 ~/.setki-keeper/data/setki.db

# Проверить matches_cache
SELECT
  match_id,
  json_extract(data, '$.round_number') as round,
  json_extract(data, '$.match_number') as number,
  json_extract(data, '$.participant1.full_name') as p1,
  json_extract(data, '$.participant2.full_name') as p2,
  json_extract(data, '$.status') as status
FROM matches_cache
WHERE bracket_id = ?;
```

## Известные ограничения

1. **Только Single Elimination**: Текущая реализация поддерживает только single elimination. Для double elimination потребуется дополнительная логика (winners bracket, losers bracket).

2. **Нет обработки walkover**: Если участник не явился, нужна дополнительная логика.

3. **Синхронизация с сервером**: Backend API (setki.pro) должен поддерживать обновление участников матчей через sync endpoint.

## Будущие улучшения

1. Поддержка Double Elimination
2. Обработка walkover и disqualification
3. Автоматическое создание третьего места (bronze match)
4. Уведомления судьям о новых матчах
5. История изменений участников
