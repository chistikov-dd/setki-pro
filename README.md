# SETKI.PRO KEEPER

Кроссплатформенное десктопное приложение для судейских столиков на турнирах.

[![Tests](https://github.com/chistikov/desktop_setki/actions/workflows/test.yml/badge.svg)](https://github.com/chistikov/desktop_setki/actions/workflows/test.yml)
[![Release](https://github.com/chistikov/desktop_setki/actions/workflows/release.yml/badge.svg)](https://github.com/chistikov/desktop_setki/actions/workflows/release.yml)

## 🎯 Возможности

- **Offline-first**: Работа без интернета с автосинхронизацией
- **Real-time**: WebSocket синхронизация между столами
- **LAN режим**: Локальный сервер для турниров без интернета
- **Публичное табло**: Второй монитор для зрителей
- **Горячие клавиши**: Быстрое ведение поединков
- **Admin monitoring**: Отслеживание всех судейских столов

## 📦 Установка

Скачайте последнюю версию из [Releases](https://github.com/chistikov-d/setki.pro-keeper/releases)

### Windows
```powershell
# Скачайте SETKI-PRO-KEEPER_*_x64-setup.exe и запустите
```

### Linux
**Для старых систем (Linux Mint 19.3, Ubuntu 18.04+):**
```bash
# Используйте .deb пакет
sudo dpkg -i setki-keeper_*_amd64.deb
sudo apt-get install -f
```

**Для новых систем (Ubuntu 20.04+):**
```bash
# Используйте AppImage
chmod +x setki-keeper_*.AppImage
./setki-keeper_*.AppImage
```

### Android
```
Минимальная версия: Android 7.0 (API 24)
Установите APK файл
```

## 🚀 Быстрый старт для разработки

### Требования
- **Node.js** 20+
- **Rust** 1.70+
- **System dependencies**:
  - Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev`
  - Windows: Visual Studio Build Tools
  - macOS: Xcode Command Line Tools

### Установка зависимостей

```bash
npm install
```

### Разработка

```bash
npm run tauri dev
```

### Тестирование

```bash
npm run test              # Unit tests (221 тестов)
npm run test:coverage     # Coverage report
```

### Сборка production

```bash
npm run tauri build
```

**Результат:**
- Windows: `src-tauri/target/release/bundle/nsis/SETKI-PRO-KEEPER_*.exe`
- Linux: `src-tauri/target/release/bundle/appimage/setki-keeper_*.AppImage`

## 🏗️ Сборка через GitHub Actions (рекомендуется)

Для мультиплатформенной сборки:

```bash
# 1. Commit изменения
git add .
git commit -m "Release v1.0.0"

# 2. Создать тег
git tag v1.0.0

# 3. Push с тегом
git push origin main --tags
```

GitHub Actions автоматически соберёт установщики для:
- Windows (x64)
- Linux (x64, AppImage)
- macOS (Intel + Apple Silicon)

## 🏗️ Архитектура

- **Frontend**: React 19 + TypeScript + Zustand + Tailwind CSS v3
- **Backend**: Tauri 2 (Rust) + SQLite + Axum
- **API**: REST + WebSocket
- **Синхронизация**: Hybrid (WebSocket + REST queue)

Подробнее см. [CLAUDE.md](./CLAUDE.md)

## 🧪 Тестирование

### Unit тесты (Vitest)

```bash
# Запуск всех unit тестов
npm test

# Watch режим (авто-перезапуск при изменении)
npm run test:watch

# С UI интерфейсом Vitest
npm run test:ui

# Coverage отчет
npm run test:coverage
```

**Покрытие**: 127 тестов (93 проходят ✅, 34 требуют доработки)

**Unit тесты** (79 тестов):
- errorHandler утилиты: 22 теста (8 проходят)
- retry утилиты: 13 тестов (13 проходят ✅)
- logger утилиты: 20 тестов (требуют доработки API)
- helper функции (utils): 24 теста (24 проходят ✅)

**Integration тесты** (48 тестов):
- authStore: 21 тест (21 проходят ✅)
- matchStore: 27 тестов (27 проходят ✅)

**Тестируемые модули**:
- `src/stores/authStore.ts` - Авторизация (admin/judge)
- `src/stores/matchStore.ts` - Match state, conflict resolution
- `src/utils/errorHandler.ts` - Централизованная обработка ошибок
- `src/utils/retry.ts` - Retry логика с exponential backoff
- `src/utils/logger.ts` - Система логирования
- `src/lib/utils.ts` - Helper функции (formatTime, removePatronymic, determineWinner)

### E2E тесты (Playwright) - В разработке

```bash
# Запуск всех E2E тестов
npm run test:e2e

# С UI интерфейсом
npm run test:e2e:ui

# С открытым браузером
npm run test:e2e:headed

# Отладка
npm run test:e2e:debug

# Отчет
npm run test:e2e:report
```

**Статус**: Подготовлено 32 E2E теста (требуется настройка tauri-driver)
- Admin workflow: 9 тестов
- Judge workflow: 14 тестов
- Offline mode: 9 тестов

Подробнее см. [e2e/README.md](./e2e/README.md)

## 📦 Сборка

### Linux AppImage
```bash
npm run tauri build
```

### Windows NSIS
```bash
npm run tauri build
```

## 🛠️ Разработка

### Структура проекта

```
desktop_setki/
├── src/                      # React frontend
│   ├── components/          # UI компоненты
│   ├── stores/              # Zustand stores
│   ├── hooks/               # Custom hooks
│   ├── services/            # API клиенты
│   └── utils/               # Утилиты
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── main.rs          # Entry point
│   │   ├── lib.rs           # Tauri commands
│   │   ├── api.rs           # HTTP client
│   │   ├── db.rs            # SQLite
│   │   └── local_server.rs  # Axum server
│   └── Cargo.toml
├── e2e/                     # E2E тесты
│   ├── *.spec.ts            # Тест-файлы
│   ├── fixtures/            # Моковые данные
│   └── helpers/             # Хелперы
└── CLAUDE.md                # Полная документация
```

### Полезные команды

```bash
# Просмотр SQLite БД
python3 scripts/view_db.py

# Очистка всех кэшей
rm -rf node_modules/.vite dist && cd src-tauri && cargo clean

# Проверка типов
npm run build

# Dev с hot reload
npm run tauri dev
```

## 📚 Документация

- [CLAUDE.md](./CLAUDE.md) - Техническая документация для разработчиков
- [USER_MANUAL.md](./docs/USER_MANUAL.md) - Руководство для судей
- [ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md) - Руководство для администраторов
- [CHANGELOG.md](./CHANGELOG.md) - История изменений

## 🛠️ Технологии

**Frontend:**
- React 19
- TypeScript
- Zustand (state management)
- Tailwind CSS

**Backend:**
- Tauri 2
- Rust
- Axum 0.7 (local server)
- SQLx + SQLite

**Testing:**
- Vitest (unit tests: 221/221 ✅)
- Playwright (E2E, частично)

## 📊 Статистика проекта

- **Lines of Code:** ~12,000 (9,000 TS + 3,000 Rust)
- **Components:** 31
- **Tauri Commands:** 30
- **Hooks:** 11
- **Test Coverage:** Высокий

## 🔧 Рекомендуемые IDE

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 📄 Лицензия

Proprietary - SETKI.PRO © 2025
