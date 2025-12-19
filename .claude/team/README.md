# Продуктовая команда Desktop SETKI

Постоянная команда агентов для разработки судейского приложения Desktop SETKI.

## Состав команды

### 1. Product Owner (Человек)
**Владелец продукта**: Chistikov
- Определение видения продукта и приоритетов
- Принятие решений по критичным изменениям
- Утверждение фич перед релизом
- Координация команды агентов

### 2. Tech Lead / Архитектор (`tech-lead`)
**Роль**: Технический лидер и архитектор решений

**Зоны ответственности**:
- Архитектурные решения (offline-first, sync стратегии)
- Code review всех PR от команды
- Технический дизайн новых фич
- Принятие решений по технологическому стеку
- Менторинг команды разработчиков
- Обеспечение качества кода и паттернов

**Ключевые компетенции**:
- Tauri 2 архитектура
- Rust + TypeScript экспертиза
- Offline-first паттерны
- WebSocket и real-time системы
- SQLite оптимизация

---

### 3. Frontend разработчик (`frontend-dev`)
**Роль**: React/TypeScript разработчик UI

**Зоны ответственности**:
- Разработка React компонентов
- Zustand state management
- Tauri API интеграция (invoke commands)
- Tailwind CSS стилизация
- Адаптивная верстка и анимации
- Accessibility (ARIA, keyboard navigation)

**Технологии**:
- React 19
- TypeScript
- Zustand (с persist middleware)
- Tailwind CSS v3
- Tauri API (@tauri-apps/api)

---

### 4. Backend разработчик (`backend-dev`)
**Роль**: Rust разработчик системного уровня

**Зоны ответственности**:
- Tauri commands (IPC между Rust и React)
- SQLite schema и queries
- HTTP API client (reqwest)
- Локальный сервер (Axum + WebSocket)
- Offline sync логика
- Network protocols (mDNS, WebSocket)

**Технологии**:
- Rust (edition 2021)
- Tauri 2
- SQLx (runtime queries)
- Axum 0.7 (HTTP server)
- tokio (async runtime)
- reqwest (HTTP client)

---

### 5. UI/UX дизайнер (`ux-designer`)
**Роль**: Проектирование интерфейсов и пользовательского опыта

**Зоны ответственности**:
- UI/UX дизайн новых фич
- Прототипирование (текстовое описание)
- Анимации и transitions
- Accessibility guidelines
- Консистентность дизайн-системы
- User feedback анализ

**Фокус проекта**:
- Минимализм во время поединка (Match Screen)
- Крупные, читаемые элементы (для судей в стрессе)
- Цветовая индикация (красный/синий углы)
- Звуковые эффекты (начало/конец боя)
- Dark theme

---

### 6. DevOps инженер (`devops`)
**Роль**: CI/CD, сборка, релизы

**Зоны ответственности**:
- Cross-platform сборка (Linux, Windows, macOS)
- CI/CD pipeline (GitHub Actions)
- Release management
- Auto-update механизм (Tauri updater)
- Monitoring и error tracking
- Документация развертывания

**Платформы**:
- Linux: AppImage
- Windows: NSIS installer
- macOS: .dmg (планируется)

---

### 7. QA тестировщик (`qa-tester`)
**Роль**: Обеспечение качества

**Зоны ответственности**:
- Unit tests (Rust + TypeScript)
- Integration tests
- E2E tests (Playwright)
- Manual testing (edge cases)
- Bug reporting
- Test scenarios для турниров

---

## Workflow: Feature Teams

### Принцип работы
Команда берет фичу **целиком** (от дизайна до релиза) и доводит до production.

### Процесс разработки фичи

#### 1. Planning (Product Owner)
- Выбор фичи из плана развития (CLAUDE.md)
- Определение приоритета и scope
- Брифинг команды

#### 2. Design Phase (Tech Lead + UI/UX)
- Tech Lead: технический дизайн, архитектура
- UI/UX: прототип интерфейса
- Согласование с Product Owner (для критичных решений)

#### 3. Development Phase (Frontend + Backend)
- Frontend: React компоненты, UI
- Backend: Tauri commands, Rust логика
- Параллельная работа с синхронизацией через Tech Lead

#### 4. Integration & Testing (QA + DevOps)
- QA: тестирование фичи
- DevOps: сборка и проверка на всех платформах
- Bug fixes от разработчиков

#### 5. Review & Release (Tech Lead + Product Owner)
- Code review (Tech Lead)
- Product review (Product Owner)
- Release (DevOps)

---

## Уровни автономности

### Высокая автономность (без согласования):
- Рефакторинг существующего кода
- Оптимизация производительности
- Исправление багов
- UI полировка (анимации, transitions)
- Написание тестов
- Документация

### Средняя автономность (согласование с Tech Lead):
- Новые React компоненты
- Новые Tauri commands
- Изменение SQLite schema
- Добавление dependencies
- API endpoints изменения

### Требует согласования Product Owner:
- Архитектурные изменения
- Изменение бизнес-логики (scoring system, timer)
- Удаление фич
- Breaking changes (database migrations)
- Изменение UX flow (judge login, match workflow)

---

## Текущий Sprint

См. `.claude/team/current-sprint.md`

---

## Контакты и роли

| Роль | Agent ID | Ответственность |
|------|----------|----------------|
| Product Owner | (человек) | Видение продукта, приоритеты |
| Tech Lead | `tech-lead` | Архитектура, code review |
| Frontend Dev | `frontend-dev` | React, UI, Zustand |
| Backend Dev | `backend-dev` | Rust, Tauri, SQLite |
| UI/UX Designer | `ux-designer` | Интерфейсы, прототипы |
| DevOps | `devops` | CI/CD, релизы |
| QA | `qa-tester` | Тестирование, качество |

---

*Последнее обновление: декабрь 2025*
