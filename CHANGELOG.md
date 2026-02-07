# Changelog

Все заметные изменения в проекте SETKI.PRO KEEPER документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/).

## [Unreleased]

## [0.5.3] - 2025-02-07

### Added
- **Совместимость со старыми Linux системами**
  - Сборка на Ubuntu 20.04 для совместимости с Linux Mint 19.3+ и Ubuntu 18.04+
  - Добавлен `.deb` пакет с правильными зависимостями для старых систем
  - Поддержка webkit2gtk-4.0 (для Ubuntu 18.04/Linux Mint 19.3)
- **DOWNLOAD.md** - Страница с прямыми ссылками для быстрой загрузки
  - Прямые ссылки на GitHub Releases (без перехода на страницу релиза)
  - CDN зеркала через jsDelivr для быстрой загрузки из России
  - Таблица совместимости с различными дистрибутивами
  - Инструкции по установке для каждой платформы

### Changed
- GitHub Actions теперь собирает на Ubuntu 20.04 вместо 22.04
- Добавлен формат `.deb` в дополнение к AppImage
- Обновлена документация с указанием рекомендуемых форматов для разных систем

### Fixed
- Все исправления из v0.5.2 (отмена действий, курсор)

## [0.5.2] - 2025-02-07

### Fixed
- **Отмена действий**: Теперь корректно синхронизируется с локальным сервером
  - Используется `updateMatchScoreUniversal` вместо `updateMatchScore` для правильной маршрутизации
  - Добавлено расширенное логирование для отладки
  - Обеспечена согласованность со всеми другими операциями (addScore, addWarning)
- **Курсор мыши**: Больше не уходит на второй монитор (публичное табло)
  - Захват курсора в основном окне судьи через `setCursorGrab()`
  - Скрытие курсора на публичном табло (`cursor: none`)
  - Автоматическое освобождение курсора при выходе из экрана матча

## [0.5.1] - 2025-02-06

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
