# Тестирование продвижения победителя в турнирной сетке

## Реализованная логика

### 1. Вычисление следующего матча
```rust
// Формула для Single Elimination:
next_round = current_round + 1
next_match_number = (current_match_number + 1) / 2  // ceil division
target_slot = if current_match_number % 2 == 1 { participant1 } else { participant2 }
```

### 2. Пример для 8 участников (3 раунда)

#### Раунд 1 (Четвертьфинал) - 4 матча
- Match 1.1 → Winner → Match 2.1 (slot participant1)
- Match 1.2 → Winner → Match 2.1 (slot participant2)
- Match 1.3 → Winner → Match 2.2 (slot participant1)
- Match 1.4 → Winner → Match 2.2 (slot participant2)

#### Раунд 2 (Полуфинал) - 2 матча
- Match 2.1 → Winner → Match 3.1 (slot participant1)
- Match 2.2 → Winner → Match 3.1 (slot participant2)

#### Раунд 3 (Финал) - 1 матч
- Match 3.1 → Champion (нет следующего матча)

### 3. Проверка формулы

Match 1.1 (round=1, number=1):
- next_round = 1 + 1 = 2
- next_match_number = (1 + 1) / 2 = 1
- target_slot = participant1 (1 % 2 == 1)
- ✓ Правильно: Match 2.1, slot participant1

Match 1.2 (round=1, number=2):
- next_round = 1 + 1 = 2
- next_match_number = (2 + 1) / 2 = 1
- target_slot = participant2 (2 % 2 == 0)
- ✓ Правильно: Match 2.1, slot participant2

Match 1.3 (round=1, number=3):
- next_round = 1 + 1 = 2
- next_match_number = (3 + 1) / 2 = 2
- target_slot = participant1 (3 % 2 == 1)
- ✓ Правильно: Match 2.2, slot participant1

Match 1.4 (round=1, number=4):
- next_round = 1 + 1 = 2
- next_match_number = (4 + 1) / 2 = 2
- target_slot = participant2 (4 % 2 == 0)
- ✓ Правильно: Match 2.2, slot participant2

Match 2.1 (round=2, number=1):
- next_round = 2 + 1 = 3
- next_match_number = (1 + 1) / 2 = 1
- target_slot = participant1 (1 % 2 == 1)
- ✓ Правильно: Match 3.1, slot participant1

Match 2.2 (round=2, number=2):
- next_round = 2 + 1 = 3
- next_match_number = (2 + 1) / 2 = 1
- target_slot = participant2 (2 % 2 == 0)
- ✓ Правильно: Match 3.1, slot participant2

Match 3.1 (round=3, number=1):
- next_round = 3 + 1 = 4
- next_match_number = (1 + 1) / 2 = 1
- Следующий матч не существует → Финал
- ✓ Правильно: Нет следующего матча

## Что было реализовано

### В файле `src-tauri/src/api.rs`:

1. **Получение данных текущего матча**
   - Извлечение round_number, match_number, bracket_id из SQLite

2. **Получение полных данных победителя**
   - Извлечение participant1 или participant2 (полный JSON с id, full_name, club_name)

3. **Вычисление следующего матча**
   - Использование формулы для next_round и next_match_number
   - Определение target_slot (participant1 или participant2)

4. **Обновление следующего матча**
   - Вставка полных данных победителя в следующий матч
   - Обновление matches_cache с помощью json_set()

5. **Синхронизация с сервером**
   - Добавление записи в sync_queue для обоих матчей

## План тестирования

1. Запустить приложение в dev режиме
2. Создать тестовую сетку с 8 участниками
3. Завершить Match 1.1 с победителем
4. Проверить что победитель появился в Match 2.1 slot participant1
5. Завершить Match 1.2 с победителем
6. Проверить что победитель появился в Match 2.1 slot participant2
7. Завершить Match 2.1 и проверить продвижение в Match 3.1

## Ожидаемое поведение

- ✅ Победитель автоматически переходит в следующий матч
- ✅ В следующем матче отображается полное имя и клуб
- ✅ Изменения синхронизируются с сервером через sync_queue
- ✅ Финальный матч не имеет следующего матча
- ✅ UI автоматически обновляется при изменении данных
