# Backend Integration - Desktop SETKI

Документация по интеграции desktop приложения с backend API SETKI.PRO

## API Endpoints

### Production
- **API Base URL**: `https://setki.pro/api/v1`
- **WebSocket URL**: `wss://setki.pro/api/v1/ws/matches`

### Development
- **API Base URL**: `http://localhost:8000/api/v1`
- **WebSocket URL**: `ws://localhost:8000/api/v1/ws/matches`

## Конфигурация

Создайте файл `.env` в корне проекта:

```bash
# Для локальной разработки
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_WS_BASE_URL=ws://localhost:8000/api/v1/ws/matches

# Для продакшена
# VITE_API_BASE_URL=https://setki.pro/api/v1
# VITE_WS_BASE_URL=wss://setki.pro/api/v1/ws/matches
```

## Архитектура интеграции

### 1. API Client (`src/services/api.ts`)

Основной HTTP клиент для работы с REST API:

```typescript
import { loginAdmin, loginByPin, getMyTournaments } from './services/api';

// Вход администратора
const auth = await loginAdmin({ login: 'admin', password: 'pass' });

// Вход судьи
const auth = await loginByPin({ pin_code: '123456' });

// Получить турниры
const tournaments = await getMyTournaments();
```

**Доступные методы:**

**Auth:**
- `loginAdmin(data)` - POST /desktop/auth/login
- `loginByPin(data)` - POST /desktop/auth/pin-auth
- `logout()` - Очистка токена

**Tournaments:**
- `getMyTournaments()` - GET /desktop/tournaments/my
- `getTournamentDetails(id)` - GET /desktop/tournaments/{id}/details
- `getTournamentPin(id)` - GET /desktop/tournaments/{id}/pin

**Brackets:**
- `getTournamentBrackets(tournamentId)` - GET /desktop/brackets/tournament/{id}
- `getBracketMatches(bracketId)` - GET /desktop/brackets/{id}/matches

**Tables:**
- `createTable(data)` - POST /desktop/tables
- `getTournamentTables(tournamentId)` - GET /desktop/tables/tournament/{id}
- `assignTable(tableId, data)` - POST /desktop/tables/{id}/assign
- `releaseTable(tableId)` - DELETE /desktop/tables/{id}/release
- `deleteTable(tableId)` - DELETE /desktop/tables/{id}

**Sync:**
- `syncMatch(data)` - POST /desktop/sync/matches
- `syncHistory(data)` - POST /desktop/sync/history
- `getSyncChanges(tournamentId, lastSync?)` - GET /desktop/sync/changes

### 2. WebSocket Client (`src/services/websocket.ts`)

Real-time синхронизация матчей через WebSocket:

```typescript
import { createMatchWebSocket } from './services/websocket';

// Создать подключение
const ws = createMatchWebSocket(matchId, pinCode);

// Подключиться
await ws.connect();

// Подписаться на события
ws.on('score_update', (message) => {
  console.log('Счет обновлен:', message.data);
});

ws.on('timer_update', (message) => {
  console.log('Таймер обновлен:', message.data);
});

// Отправить обновление счета
ws.sendScoreUpdate({
  participant_id: 123,
  action_type: 'takedown',
  points: 2,
  round_number: 1
});

// Отправить обновление таймера
ws.sendTimerUpdate({
  elapsed_seconds: 45,
  is_running: true
});

// Начать матч
ws.sendMatchStart();

// Завершить матч
ws.sendMatchEnd({
  result_type: 'points'
});

// Отключиться
ws.disconnect();
```

**Типы сообщений:**
- `match_start` - Начало матча
- `match_end` - Завершение матча
- `score_update` - Обновление счета
- `timer_update` - Обновление таймера
- `round_change` - Смена раунда
- `action_recorded` - Действие записано
- `error` - Ошибка
- `connected` - Подключено

### 3. Auth Store (`src/stores/authStore.ts`)

Zustand store для управления аутентификацией:

```typescript
import { useAuthStore } from './stores/authStore';

function MyComponent() {
  const { user, isAuthenticated, loginAsAdmin, loginAsJudge, logout } = useAuthStore();

  const handleLogin = async () => {
    try {
      await loginAsAdmin('admin', 'password');
      // Успешный вход
    } catch (error) {
      // Обработка ошибки
    }
  };

  return (
    <div>
      {isAuthenticated ? (
        <p>Привет, {user?.role}!</p>
      ) : (
        <button onClick={handleLogin}>Войти</button>
      )}
    </div>
  );
}
```

**State:**
- `user: AuthResponse | null` - Данные пользователя
- `isAuthenticated: boolean` - Авторизован ли
- `isLoading: boolean` - Идёт ли запрос
- `error: string | null` - Ошибка

**Actions:**
- `loginAsAdmin(login, password)` - Вход администратора
- `loginAsJudge(pinCode)` - Вход судьи
- `logout()` - Выход
- `clearError()` - Очистить ошибку
- `restoreSession()` - Восстановить сессию из localStorage

## Аутентификация

### JWT Токены

После успешного входа backend возвращает JWT токен:

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "user_id": 123,
  "role": "organizer",
  "tournament_id": 456
}
```

Токен автоматически:
- Сохраняется в localStorage (через Zustand persist)
- Добавляется в заголовок `Authorization: Bearer {token}` всех запросов
- Восстанавливается при перезагрузке приложения

### Роли пользователей

- `organizer` - Организатор турнира (админ)
- `referee` - Судья (вход по PIN)
- `admin` - Системный администратор

## Обработка ошибок

Все ошибки API автоматически обрабатываются:

```typescript
try {
  await loginAdmin({ login, password });
} catch (error) {
  // error.message содержит текст ошибки с backend
  console.error('Ошибка входа:', error.message);
}
```

## Offline режим

TODO: В будущем будет реализовано:
- Кэширование данных в SQLite через Tauri
- Очередь синхронизации
- Автоматическая синхронизация при появлении сети

## Примеры использования

### Полный flow авторизации администратора

```typescript
import { useAuthStore } from './stores/authStore';
import { getMyTournaments } from './services/api';

function AdminDashboard() {
  const { loginAsAdmin, user } = useAuthStore();
  const [tournaments, setTournaments] = useState([]);

  const handleLogin = async () => {
    try {
      await loginAsAdmin('admin@setki.pro', 'password');

      // После успешного входа загрузить турниры
      const data = await getMyTournaments();
      setTournaments(data);
    } catch (error) {
      console.error('Ошибка:', error);
    }
  };

  return (
    <div>
      <button onClick={handleLogin}>Войти</button>
      {tournaments.map(t => (
        <div key={t.id}>{t.name}</div>
      ))}
    </div>
  );
}
```

### Полный flow матча с WebSocket

```typescript
import { createMatchWebSocket } from './services/websocket';
import { syncMatch } from './services/api';

function MatchScreen({ matchId, pinCode }) {
  const [score1, setScore1] = useState(0);
  const [score2, setScore2] = useState(0);
  const wsRef = useRef(null);

  useEffect(() => {
    // Подключиться к WebSocket
    const ws = createMatchWebSocket(matchId, pinCode);
    wsRef.current = ws;

    ws.on('score_update', (message) => {
      // Обновить UI при изменении счета от других устройств
      setScore1(message.data.score_participant1);
      setScore2(message.data.score_participant2);
    });

    ws.connect();

    return () => {
      ws.disconnect();
    };
  }, [matchId]);

  const handleScoreUpdate = async (participantId, points) => {
    // Обновить локально
    if (participantId === 1) {
      setScore1(s => s + points);
    } else {
      setScore2(s => s + points);
    }

    // Отправить через WebSocket
    wsRef.current?.sendScoreUpdate({
      participant_id: participantId,
      action_type: 'manual',
      points,
      round_number: 1
    });

    // Синхронизировать с backend
    await syncMatch({
      match_id: matchId,
      fighter1_score: score1,
      fighter2_score: score2,
      status: 'in_progress'
    });
  };

  return (
    <div>
      <div>Счет: {score1} - {score2}</div>
      <button onClick={() => handleScoreUpdate(1, 2)}>+2 Красному</button>
      <button onClick={() => handleScoreUpdate(2, 2)}>+2 Синему</button>
    </div>
  );
}
```

## Дополнительная информация

- Backend репозиторий: `/home/chistikov/SETKI/setki_pro_rewrite`
- API документация: https://setki.pro/docs
- Схема БД: `DATABASE_SCHEMA_FINAL.md` в backend репозитории
