# Changelog

Все заметные изменения в проекте SETKI.PRO KEEPER документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/).

## [Unreleased]

### Added
- Брендинг: название "SETKI.PRO KEEPER", логотип, иконки
- GitHub Actions workflows для автоматической сборки

## [0.1.0] - 2025-12-19

### Added
- Offline-first режим с SQLite кэшированием
- Real-time WebSocket синхронизация между столами
- LAN режим (локальный сервер на Axum)
- Роли: Администратор и Судья
- Админ-панель: мониторинг судей, активные матчи, ручная синхронизация
- Судейский интерфейс: выбор сетки, ведение поединка
- Match Screen: таймер, счет, предупреждения, горячие клавиши
- Публичное табло на втором мониторе
- Уникальность номеров столов
- Error handling с retry logic
- Unit тесты: 221/221 (100%)
- Performance optimizations (connection pool, WAL mode, rate limiting)
- Документация: USER_MANUAL.md, ADMIN_GUIDE.md, E2E_TESTING.md

### Technical
- Frontend: React 19, TypeScript, Zustand, Tailwind CSS
- Backend: Tauri 2, Rust, Axum 0.7, SQLx
- Database: SQLite с WAL mode
- Build: Vite, cargo
- Testing: Vitest, Playwright (частично)

[unreleased]: https://github.com/chistikov/desktop_setki/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chistikov/desktop_setki/releases/tag/v0.1.0
