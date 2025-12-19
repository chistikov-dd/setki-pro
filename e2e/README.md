# E2E Tests

End-to-End тесты для SETKI.PRO KEEPER с использованием Playwright.

## Структура

```
e2e/
├── admin-workflow.spec.ts      # Тесты для админ-панели
├── judge-workflow.spec.ts      # Тесты для судейского интерфейса
├── offline-mode.spec.ts        # Тесты для offline режима
├── fixtures/
│   └── mock-data.ts            # Моковые данные для тестов
└── helpers/
    ├── tauri-helpers.ts        # Хелперы для работы с Tauri
    └── test-setup.ts           # Функции инициализации тестов
```

## ⚠️ Статус E2E тестов

**ВАЖНО**: Текущие E2E тесты подготовлены как основа для будущей интеграции с `tauri-driver` или WebDriver для Tauri приложений. Для полноценного запуска требуется:

1. **Tauri Driver** - специальный драйвер для автоматизации Tauri приложений
2. **Mock Tauri API** - необходимо настроить перехват Tauri команд в тестовом окружении

На данный момент рекомендуется использовать **Unit тесты** (см. раздел Testing в главном README).

## Запуск тестов (требует настройки)

### Все тесты (headless)
```bash
npm run test:e2e
```

### С UI интерфейсом Playwright
```bash
npm run test:e2e:ui
```

### С открытым браузером (headed mode)
```bash
npm run test:e2e:headed
```

### Отладка конкретного теста
```bash
npm run test:e2e:debug
```

### Просмотр отчета
```bash
npm run test:e2e:report
```

## Покрытие тестами

### Admin Workflow (9 тестов)
- ✅ Авторизация администратора
- ✅ Просмотр списка турниров
- ✅ Скачивание данных турнира
- ✅ Создание сессии с PIN-кодом
- ✅ Мониторинг судейских столов
- ✅ Мониторинг активных поединков
- ✅ Ручная синхронизация результатов
- ✅ Переключение режимов сервера
- ✅ Выход из системы

### Judge Workflow (14 тестов)
- ✅ Авторизация судьи по PIN и имени
- ✅ Просмотр доступных сеток
- ✅ Проверка занятости сеток
- ✅ Резервирование и выбор сетки
- ✅ Просмотр турнирной сетки с поединками
- ✅ Запуск поединка
- ✅ Добавление баллов (горячие клавиши)
- ✅ Добавление предупреждений
- ✅ Отмена последнего действия (Ctrl+Z)
- ✅ Управление таймером (Space)
- ✅ Завершение поединка
- ✅ Сброс поединка (Ctrl+R)
- ✅ Справка по горячим клавишам (H)
- ✅ Выход из системы

### Offline Mode (9 тестов)
- ✅ Авторизация с кэшированным PIN
- ✅ Просмотр кэшированных сеток
- ✅ Проведение поединка offline с sync queue
- ✅ Индикатор offline состояния
- ✅ Синхронизация при восстановлении сети
- ✅ Сохранение кэша между перезапусками
- ✅ Накопление изменений в sync queue
- ✅ Работа админа с загруженными данными offline

**Всего: 32 теста**

## Технические детали

### Моки Tauri Commands

Тесты используют моки для всех Tauri команд:
- `login_admin` - авторизация администратора
- `login_by_pin` - авторизация судьи
- `get_tournaments` - получение списка турниров
- `download_tournament` - скачивание данных
- `get_cached_brackets` - получение кэшированных сеток
- `batch_update_match` - обновление поединка
- И другие...

### Offline режим

Для тестирования offline режима используется:
- `page.route()` для блокировки сетевых запросов
- Моки SQLite операций через Tauri commands
- Симуляция восстановления сети

### Responsive тестирование

Все тесты запускаются с разрешением 1920×1080 (Full HD).

## Добавление новых тестов

1. Создайте файл `*.spec.ts` в `e2e/`
2. Импортируйте хелперы из `helpers/`
3. Используйте моковые данные из `fixtures/mock-data.ts`
4. Следуйте паттернам существующих тестов

Пример:
```typescript
import { test, expect } from '@playwright/test';
import { setupApp, setupAdminMocks } from './helpers/test-setup';

test.describe('My Feature', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await setupAdminMocks(page);
  });

  test('should do something', async ({ page }) => {
    // Your test code
  });
});
```

## CI/CD интеграция

Для запуска в CI добавьте в `.github/workflows/test.yml`:

```yaml
- name: Install dependencies
  run: npm ci

- name: Install Playwright browsers
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npm run test:e2e
```

## Известные ограничения

1. **Tauri mocking**: Тесты мокируют Tauri команды на уровне JavaScript. Для тестирования реального Rust backend нужны интеграционные тесты в Rust.

2. **WebView тестирование**: Playwright тестирует веб-часть приложения, а не нативное Tauri окно. Для полного E2E тестирования Tauri приложения можно использовать `tauri-driver`.

3. **SQLite**: Тесты не проверяют реальные операции с SQLite, только моки команд.

## Troubleshooting

### Тесты падают с timeout
- Увеличьте timeout в `playwright.config.ts`
- Проверьте, что dev server запустился

### Элементы не найдены
- Добавьте `data-testid` атрибуты в компоненты
- Используйте более конкретные селекторы

### WebSocket тесты нестабильны
- Увеличьте таймауты ожидания
- Используйте `page.waitForSelector()` вместо фиксированных `waitForTimeout()`
