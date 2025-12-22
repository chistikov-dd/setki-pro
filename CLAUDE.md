# CLAUDE.md

# Desktop SETKI - Судейское приложение для турниров

**SETKI.PRO KEEPER** - кроссплатформенное десктопное приложение для судейских столиков (Tauri 2 + React 19 + TypeScript).

## Быстрый старт

```bash
npm install
npm run tauri dev     # Разработка
npm run tauri build   # Production (AppImage + NSIS)
npm run test          # Unit tests (221 тестов)
```

## Брендинг и настройки

**Название приложения:** SETKI.PRO KEEPER
**Bundle ID:** pro.setki.keeper
**Исполняемый файл:** setki-keeper (.exe на Windows)
**Логотип:** `logo.jpg` (1024x1024) → автогенерация иконок через `npx @tauri-apps/cli icon`

**Конфигурация:**
- `tauri.conf.json`: productName, identifier, icon paths
- `Cargo.toml`: name = "setki-keeper", lib name = "setki_keeper_lib"
- `package.json`: name = "setki-keeper"
- `src-tauri/icons/*`: все иконки для платформ (ico, icns, png)

**Сборка установщиков:**
- Windows: `SETKI-PRO-KEEPER_0.1.0_x64-setup.exe` (NSIS)
- Linux: `setki-keeper_0.1.0_amd64.AppImage`

## Концепция

- **Offline-first**: Работа без интернета, автосинхронизация
- **Real-time**: WebSocket синхронизация между столами
- **LAN режим**: Локальный сервер (Axum) для турниров без интернета
- **Роли**: Администратор (логин/пароль), Судьи (PIN + имя + номер стола)

### Workflow на турнире (LAN без интернета)

```
1. Подготовка (с интернетом):
   Админ → Вход → Выбор турнира → "Скачать турнир" → SQLite кэш

2. На турнире (без интернета):
   Админ → "Режим работы" → "Запустить локальный сервер" → Показать IP судьям
   Судья → "Режим работы" → "Подключение к локальному серверу" → Ввод IP → Вход (PIN + имя + стол)

3. После турнира (с интернетом):
   Админ → "Режим работы" → "Работа через интернет" → "Выгрузить результаты"
```

### Режимы работы

- **Online**: Интернет с setki.pro
- **Local Server**: Админ запускает Axum сервер (порты 8081-8091)
- **Local Client**: Судьи подключаются к локальному серверу по IP

**ВАЖНО**: Кнопка "Режим работы" доступна ДО входа!

## Архитектура

### Tauri Commands

Frontend → `invoke('command_name', { params })` → Rust Backend → SQLite/HTTP

**30 команд**: Auth (4), Tournament (4), Brackets (4), Matches (5), Local Server (4), Sync (2), Monitoring (2), Utils (5)

### SQLite Schema

**Портативный режим**: `~/.setki-keeper/data/setki.db`
- Linux/macOS: `~/.setki-keeper/data/setki.db`
- Windows: `%USERPROFILE%\.setki-keeper\data\setki.db`

**9 таблиц**: auth, brackets_cache, matches_cache, sync_queue, cached_pins, judge_sessions, bracket_reservations, match_events, table_numbers

### Offline-First Flow

```
1. Download: downloadTournament() → GET /api/v1/desktop/tournaments/{id}/download → SQLite
2. Offline Work: getCachedBrackets() → Read SQLite → Display
3. Updates: Insert sync_queue (synced=0) → Continue immediately
4. Background Sync: POST /api/v1/desktop/sync/matches → Mark synced=1
```

## State Management (Zustand)

**authStore**: user, isAuthenticated, loginAsAdmin(), loginAsJudge(), logout()
**sessionStore**: tournaments, currentSession, loadTournaments()
**serverModeStore**: mode, serverUrl, setMode(), setServerUrl()
**matchStore**: match, scores, warnings, addScore(), addWarning(), undoLastAction(), finishMatch()

## Rust Backend

### Структура
```
src-tauri/src/
├── main.rs         # Entry point (setki_keeper_lib::run())
├── lib.rs          # Tauri commands (30)
├── api.rs          # HTTP client для SETKI.PRO
├── db.rs           # SQLite init & schema
└── local_server.rs # Axum HTTP/WebSocket server
```

### Local Server (Axum 0.7)

**Endpoints**:
- `/api/v1/auth/pin` - авторизация судьи
- `/api/v1/desktop/brackets/tournament/:id` - сетки
- `/api/v1/desktop/matches/update` - обновление счета
- `/api/v1/ws/matches/:match_id` - WebSocket (матчи)
- `/api/v1/ws/admin/events` - WebSocket (админ уведомления)
- `/health` - health check

## Ключевые паттерны

### 1. SQLite Runtime Queries

```rust
// НЕ ИСПОЛЬЗУЙ: sqlx::query!() - требует DATABASE_URL
// ИСПОЛЬЗУЙ: runtime queries
sqlx::query("INSERT INTO auth (id, token, created_at) VALUES (1, ?, datetime('now'))")
    .bind(token).execute(&pool).await?;
```

### 2. WebSocket синхронизация

```tsx
// Судья - синхронизация матчей
const { isConnected, sendScoreUpdate } = useMatchWebSocket({
  matchId: match.id,
  pinCode: currentSession?.pin_code,
  onScoreUpdate: (data) => { /* handle */ },
});

// Админ - уведомления о судьях
useAdminEventsWebSocket({
  enabled: serverMode === 'local-server',
  onJudgeConnected: (event) => showToast(`Судья ${event.judge_name} → стол №${event.table_number}`),
});
```

### 3. Performance Optimizations

- **SQLite Connection Pool**: 20 connections
- **SQLite WAL Mode**: +30% write throughput
- **WebSocket Rate Limiting**: 10 msg/sec
- **Admin Polling Debounce**: 300ms
- **Результат**: CPU 15-25%, latency 100-200ms, 15-20 столов

### 4. Error Handling

```typescript
const { handleError } = useErrorHandler();
try {
  await loginAdmin(login, password);
} catch (error) {
  handleError(error); // Логирование + toast
}
```

### 5. Zustand Selectors

```typescript
export const matchStoreSelectors = {
  fighters: (state) => ({ redFighter: state.redFighter, blueFighter: state.blueFighter }),
  scores: (state) => ({ redScore: state.redScore, blueScore: state.blueScore }),
};

const { redFighter, blueFighter } = useMatchStore(useShallow(matchStoreSelectors.fighters));
```

### 6. Toast уведомления

```tsx
const { toasts, showToast } = useToast();
showToast('Действие отменено', 'success', 2000);
```

**Типы**: `success`, `error`, `info`, `warning`

## Локальный сервер (LAN)

### Настройки
- **Архитектура**: Мастер-Сервер
- **Порт**: 8081-8091 (автопоиск)
- **IP**: Автоопределение (UDP socket)
- **mDNS**: "_setki._tcp.local."

### Уникальность номеров столов

**Таблица**: `table_numbers` (PK: tournament_id, table_number)

**Логика**:
1. Вход судьи → проверка свободен ли стол
2. Занят → ошибка "Номер стола N уже занят"
3. Успех → резервирование в таблице
4. Выход → автоосвобождение через `authStore.logout()`

### WebSocket события админу

```typescript
{ type: "judge_connected", judge_name, table_number, timestamp }
{ type: "judge_disconnected", judge_name, table_number, timestamp }
```

## Match Screen

### Реализованные фичи (20+)

**Таймер:**
- Автоизменение цвета (красный при ≤10 сек)
- Звуковой сигнал при окончании
- Управление: Space (старт/пауза), R (сброс)

**Баллы:**
- Горячие клавиши: Q/W/E/R (красный), 1/2/3/4 (синий)
- Кликабельный счет: ЛКМ +1, ПКМ -1
- Batch обновления в БД

**Предупреждения:**
- Горячие клавиши: Z (синий), X (красный)
- Автодисквалификация при 4-м предупреждении
- Лимит: 3 предупреждения

**Интеграции:**
- Публичное табло (Tauri WebviewWindow API)
- WebSocket синхронизация
- Звуковые эффекты (Web Audio API)
- Отмена последних 5 действий (Ctrl+Z)

### Важные детали

**Предупреждения:**
```typescript
// ПРАВИЛЬНО: newWarnings > maxWarnings (дисквалификация при 4-м)
if (newWarnings > maxWarnings) {
  disqualify(participant);
}
```

**Публичное табло:**
```typescript
// НЕ ИСПОЛЬЗУЙ: window.open() - не работает в Tauri
// ИСПОЛЬЗУЙ: Tauri API
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
const publicDisplay = new WebviewWindow('public-display', { url: '/public-display' });
```

**Горячие клавиши:**
- Красный: Q (+1), W (+2), E (+3), R (+4), X (предупреждение)
- Синий: 1 (+1), 2 (+2), 3 (+3), 4 (+4), Z (предупреждение)
- Общие: Space (таймер), Ctrl+Z (отмена), Enter (завершить)

## Автоматическое продвижение победителя

**НОВАЯ ФУНКЦИОНАЛЬНОСТЬ** (декабрь 2025): При победе участник автоматически переходит в следующий раунд турнирной сетки.

### Ключевые особенности

- **Автоматическое продвижение**: Победитель матча сразу добавляется в следующий матч
- **Single Elimination**: Поддержка классической олимпийской системы
- **Полные данные**: Передается не только ID, но и имя, клуб участника
- **Offline-First**: Работает без интернета с синхронизацией через sync_queue
- **Правильная логика**: Вычисление следующего матча по формуле `(match_number + 1) / 2`

### Формула продвижения

```
next_round = current_round + 1
next_match_number = (current_match_number + 1) / 2
target_slot = match_number % 2 == 1 ? participant1 : participant2
```

### Пример для 8 участников

```
Раунд 1: Match 1.1, 1.2, 1.3, 1.4 (4 матча)
         ↓
Раунд 2: Match 2.1, 2.2 (2 матча)
         ↓
Раунд 3: Match 3.1 (финал)
```

**Детали**: См. `docs/WINNER_ADVANCEMENT.md`

## Статус проекта

### ✅ Завершено (декабрь 2025)

**Этапы 1-7**: Backend API, Админ-панель, Судейский UI, Real-Time, LAN, Performance, Полировка
**Этап 8**: Автоматическое продвижение победителя в турнирной сетке ✨

**Достижения:**
- Адаптивность (HD → 4K)
- Error Handling (централизованная система)
- UI/UX (skeleton, micro-interactions, accessibility)
- Performance (connection pool, rate limiting, debounce)
- **Unit Tests: 221/221 (100%)** ✅
- **Documentation** (user manual, admin guide) ✅
- **Брендинг: SETKI.PRO KEEPER** ✅
- E2E Tests: отложены (tauri-driver v2) ⚠️

**Документация**:
- `docs/USER_MANUAL.md` - руководство для судей
- `docs/ADMIN_GUIDE.md` - руководство для администраторов
- `docs/E2E_TESTING.md` - стратегия тестирования
- `docs/BRACKET_EDITING_GUIDE.md` - руководство по редактированию сеток ✨

### 🎯 Статус: Production-Ready

Приложение готово к использованию на турнирах.

## Статистика

**Components (35):** Auth (3), Admin (7), Judge (3), Match (8), Brackets (7), UI (7)
**Hooks (12):** useResponsive, useMatchTimer, useToast, useMatchWebSocket, useAdminEventsWebSocket, useSound, useSyncWorker, useDebounce, useErrorHandler, useLogger, usePageVisibility, **usePanZoom**
**Stores (6):** authStore, sessionStore, serverModeStore, matchStore, **bracketEditorStore**, publicDisplayStore
**Tauri Commands (33):** Auth (4), Tournament (4), Brackets (7), Matches (5), Local Server (4), Sync (2), Monitoring (2), Utils (5)
**SQLite Tables (10):** auth, brackets_cache, matches_cache, sync_queue, cached_pins, judge_sessions, bracket_reservations, match_events, table_numbers, **bracket_participant_edits**
**Lines of Code:** ~13,500 (10,000 TypeScript, 3,500 Rust)

**Тестирование:**
- Unit Tests: 221/221 (100% ✅)
- E2E Tests: 6/69 (отложены)
- Coverage: Высокий (stores, utils, hooks, components)

**Производительность:**
- CPU: 15-25% peak
- Latency: 100-200ms
- Memory: ~200MB RAM
- Поддержка: 15-20 судейских столов

**Фичи:**
- Admin Monitoring (4 фичи)
- Offline-First (SQLite cache + sync queue)
- Real-Time (WebSocket)
- LAN Mode (Axum + mDNS)
- Public Display
- Match Features (20+)
- Error Handling (retry logic)
- **Pan & Zoom Navigation** (турнирная сетка) ✨
  - Перемещение: ЛКМ + drag
  - Масштабирование: колесико, кнопки +/-, pinch-to-zoom
  - Мини-карта навигации
  - Индикатор масштаба и кнопка сброса
  - Границы области перемещения
- **Bracket Editing** (редактирование сеток) ✨ **NEW!**
  - Drag & Drop участников между матчами
  - Добавление новых участников
  - Удаление участников
  - Замена участников
  - История изменений (последние 50)
  - Контроль прав доступа (админ/судья)
  - Автосинхронизация с сервером
  - Поддержка offline режима

## Важные заметки

### Общие принципы
- **Только русский язык** в UI
- **Один судья = одна сетка**
- **Offline-first**: SQLite → sync_queue → REST API
- **Runtime SQL** (не compile-time macros)

### Резервирование столов

```typescript
// При входе
save_judge_session(pin, judge_name, table_number, tournament_id)
  // 1. Проверка свободен ли стол
  // 2. Сохранение в judge_sessions
  // 3. Резервирование в table_numbers

// При выходе
authStore.logout()
  // 1. release_table_number(tournament_id, table_number)
  // 2. Очистка state
```

### Передача данных судьи

При входе судьи через локальный сервер передаются:
- `pin_code` - PIN-код турнира
- `judge_name` - имя судьи
- `table_number` - номер стола

**Определение локального сервера**: проверка IP (192.168.x.x, 10.0.x.x, 172.16.x.x, localhost)

## Практические примеры

### Использование Pan & Zoom для компонентов сетки

```typescript
import { usePanZoom } from '../hooks/usePanZoom';
import { PanZoomControls } from './PanZoomControls';
import { MiniMap } from './MiniMap';

function MyBracketComponent() {
  const {
    panZoomState,
    handleMouseDown,
    handleWheel,
    handleTouchStart,
    zoomIn,
    zoomOut,
    resetView,
    navigateTo,
    containerRef,
  } = usePanZoom({
    minScale: 0.5,
    maxScale: 2.0,
    zoomSpeed: 0.1,
    enableBoundaries: true,
    contentWidth: 2000,
    contentHeight: 1500,
  });

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{ cursor: 'grab' }}
      >
        <div
          style={{
            transform: `translate(${panZoomState.x}px, ${panZoomState.y}px) scale(${panZoomState.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Ваш контент здесь */}
        </div>
      </div>

      {/* UI элементы управления */}
      <PanZoomControls
        scale={panZoomState.scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={resetView}
        minScale={0.5}
        maxScale={2.0}
      />

      <MiniMap
        contentWidth={2000}
        contentHeight={1500}
        viewportX={panZoomState.x}
        viewportY={panZoomState.y}
        viewportWidth={viewportWidth}
        viewportHeight={viewportHeight}
        scale={panZoomState.scale}
        onNavigate={navigateTo}
      />
    </div>
  );
}
```

**Ключевые моменты:**
- `usePanZoom` возвращает все необходимые обработчики и состояние
- `enableBoundaries: true` ограничивает перемещение границами контента
- Поддерживает все методы масштабирования: колесико, кнопки, pinch-to-zoom
- `MiniMap` автоматически показывает текущую позицию viewport
- `PanZoomControls` предоставляет UI для управления масштабом

### Добавление нового Tauri Command

```rust
// src-tauri/src/lib.rs
#[tauri::command]
async fn my_new_command(
    param1: String,
    state: State<'_, AppState>,
) -> Result<MyResponse, String> {
    let pool = &state.db_pool;
    let result = sqlx::query("SELECT * FROM my_table WHERE id = ?")
        .bind(param1)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(MyResponse { /* ... */ })
}
```

```typescript
// Frontend (src/services/api.ts)
import { invoke } from '@tauri-apps/api/core';

export async function myNewCommand(param1: string): Promise<MyResponse> {
  return await invoke('my_new_command', { param1 });
}
```

### Добавление нового Store

```typescript
// src/stores/myStore.ts
import { create } from 'zustand';

interface MyStoreState {
  data: MyData | null;
  loadData: () => Promise<void>;
}

export const useMyStore = create<MyStoreState>((set) => ({
  data: null,
  loadData: async () => {
    set({ isLoading: true });
    const result = await myApiCall();
    set({ data: result, isLoading: false });
  },
}));
```

### WebSocket Hook

```typescript
import { useEffect, useState } from 'react';
import { useServerModeStore } from '../stores/serverModeStore';

export function useMyWebSocket(roomId: number) {
  const [isConnected, setIsConnected] = useState(false);
  const { mode, serverUrl } = useServerModeStore();

  useEffect(() => {
    if (!roomId) return;
    const wsUrl = mode === 'local-client' && serverUrl
      ? `ws://${serverUrl}/api/v1/ws/my-room/${roomId}`
      : `wss://setki.pro/api/v1/ws/my-room/${roomId}`;

    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    return () => ws.close();
  }, [roomId, mode, serverUrl]);

  return { isConnected };
}
```

### Обработка ошибок

```typescript
import { useErrorHandler } from '../hooks/useErrorHandler';

function MyComponent() {
  const { handleError } = useErrorHandler();

  const handleAction = async () => {
    try {
      await someApiCall();
    } catch (error) {
      handleError(error); // Логирование + toast
    }
  };

  return <button onClick={handleAction}>Action</button>;
}
```

## Типичные проблемы и решения

### "Cannot read properties of undefined"

**Причина:** Tauri API не инициализируется в тестах

**Решение:**
```typescript
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const currentWindow = getCurrentWebviewWindow?.();
if (currentWindow && currentWindow.label === 'public-display') {
  // ...
}
```

### SQLite "database is locked"

**Решение:**
- Увеличьте pool: `.max_connections(30)` в `db.rs`
- Проверьте `acquire_timeout`: минимум 5 секунд
- Используйте WAL mode (уже включен)

### WebSocket reconnect loop

**Решение:**
```typescript
const [reconnectAttempts, setReconnectAttempts] = useState(0);

ws.onclose = () => {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  setTimeout(() => {
    setReconnectAttempts(prev => prev + 1);
    // reconnect
  }, delay);
};
```

### "Номер стола уже занят"

**Решение:**
```typescript
// При выходе ВСЕГДА вызывайте
authStore.logout(); // Освобождает стол автоматически
```

## Связанные проекты

- **Backend API**: `/home/chistikov/SETKI/setki_pro_rewrite` (FastAPI + PostgreSQL)
- **Production API**: https://setki.pro/api/v1
- **GitHub**: https://github.com/anthropics/setki-desktop (example)
