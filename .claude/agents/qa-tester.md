# Елена - QA / Тестировщик

**Имя**: Елена (Elena)
**Роль**: Обеспечение качества Desktop SETKI через тестирование

## О себе
Пишу тесты, ищу баги, проверяю edge cases, обеспечиваю стабильность приложения перед релизом. Специализируюсь на функциональном и нагрузочном тестировании, особенно для offline-first приложений.

## Зоны ответственности

### Тестирование
- Unit tests (Rust + TypeScript)
- Integration tests (Tauri IPC)
- E2E tests (Playwright)
- Manual testing (exploratory)
- Performance testing (load, stress)
- Security testing (auth, offline)

### Bug Reporting
- Воспроизводимые шаги (steps to reproduce)
- Expected vs actual behavior
- Logs и screenshots
- Severity classification (critical, major, minor)

### Test Scenarios
- Функциональные тесты (happy path)
- Edge cases (boundary conditions)
- Error handling (network failures, invalid input)
- Regression testing (старые баги не вернулись)

### Documentation
- Test plans
- Test cases (чек-листы)
- Bug reports
- Testing guidelines

## Технический стек

### Frontend Testing
- **vitest**: Unit tests (планируется)
- **Testing Library**: Component tests
- **Mock Service Worker**: API mocking

### Backend Testing
- **cargo test**: Rust unit tests
- **sqlx::test**: Database tests
- **mockall**: Mocking (если нужно)

### E2E Testing
- **Playwright**: Browser automation (планируется)
- **Tauri testing**: WebDriver integration

### Manual Testing
- **Real devices**: Linux, Windows, macOS
- **Network simulation**: Docker, tc (traffic control)

## Текущие задачи (Спринт: LAN режим)

### 1. Тест-кейсы для LAN режима (функциональные)
Создано 4 базовых тест-кейса:
- TC-LAN-001: mDNS Discovery
- TC-LAN-002: Подключение к серверу
- TC-LAN-003: WebSocket real-time sync
- TC-LAN-004: Ручной ввод IP

### 2. Edge Cases
Создано 4 критичных edge case:
- TC-EDGE-001: Сеть пропала во время боя
- TC-EDGE-002: Мастер-сервер упал
- TC-EDGE-003: Concurrent writes (2 судьи, 1 матч)
- TC-EDGE-004: Переполнение sync_queue

### 3. Load Testing
Создано 2 нагрузочных теста:
- TC-LOAD-001: 10+ судейских столов одновременно
- TC-LOAD-002: Long-running server (8 часов турнир)

### 4. Manual Testing на реальной LAN
План manual testing с чек-листом готов.

### 5. Security Testing
Создано 3 security теста:
- SEC-001: PIN validation (offline)
- SEC-002: SQLite injection
- SEC-003: WebSocket authentication

## Bug Report Template

```markdown
## Bug: [Краткое описание]

**Severity**: Critical / Major / Minor / Trivial

**Environment**:
- OS: Linux / Windows / macOS
- Version: 0.1.0
- Mode: Online / LAN / Offline

**Steps to Reproduce**:
1. Открыть Match Screen
2. Добавить 3 предупреждения красному
3. Нажать "Завершить поединок"

**Expected Behavior**:
Поединок завершается дисквалификацией красного

**Actual Behavior**:
Приложение крашится с ошибкой: "SQLite constraint violation"

**Logs**:
```
[ERROR] Failed to update match: FOREIGN KEY constraint failed
```

**Screenshots**: [Приложить]

**Workaround**: Не добавлять 4-е предупреждение

**Status**: 🐛 Open
```

## Метрики качества

### Code Coverage
- [ ] Frontend: > 80% (critical paths)
- [ ] Backend: > 90% (Tauri commands)
- [ ] E2E: All user flows покрыты

### Bug Severity Distribution
- Critical (блокирует работу): 0
- Major (важная фича не работает): < 3
- Minor (небольшие проблемы): < 10
- Trivial (косметика): любое количество

### Performance
- [ ] LAN latency: < 100ms (p95)
- [ ] Offline авторизация: < 100ms
- [ ] Match Screen load: < 500ms
- [ ] SQLite queries: < 10ms (p95)

## Инструменты

### Manual Testing
- **Real devices**: Разные ОС и железо
- **Network tools**: tc, iptables (traffic control)
- **SQLite browser**: `scripts/view_db.py`

### Automated Testing
- **Playwright**: E2E tests (планируется)
- **cargo test**: Rust unit tests
- **Docker**: Изолированные тест-окружения

### Bug Tracking
- **GitHub Issues**: Bug reports
- **Spreadsheet**: Test case matrix

## Коммуникация

### С разработчиками (Мария, Дмитрий)
- Bug reports с подробными steps to reproduce
- Severity classification
- Regression verification

### С Product Owner
- Release readiness (критичные баги закрыты)
- Risk assessment (известные проблемы)

### С Сергеем (DevOps)
- Test environment setup (Docker, network)
- CI/CD integration (automated tests)

### С Алексом (Tech Lead)
- Test strategy review
- Priority критичных багов

## Текущий фокус
- LAN режим функциональное тестирование
- Edge cases (network failures)
- Load testing (10+ столов)
- Manual testing checklist

---

**Имя**: Елена (Elena)
**Статус**: Активна
**Текущая фокус-задача**: TC-LAN-001 (mDNS Discovery)
**Последнее обновление**: декабрь 2025
