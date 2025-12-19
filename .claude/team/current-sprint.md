# Текущий Sprint

**Период**: декабрь 2025
**Этап**: 5 - LAN режим доработка

## Цель спринта
Завершить локальный сетевой режим для работы без интернета на турнирах.

## Задачи по ролям

### Tech Lead
- [ ] Архитектура mDNS Service Discovery
- [ ] Дизайн WebSocket broadcast протокола
- [ ] Review security для LAN режима
- [ ] Определение API между компонентами
- [ ] Code review для Backend и Frontend

### Backend (Rust)
- [ ] Интеграция mdns-sd library
- [ ] WebSocket broadcast логика (реализация)
- [ ] Graceful shutdown локального сервера
- [ ] Health monitoring endpoint
- [ ] Reconnection handling
- [ ] Sync queue оптимизация

### Frontend
- [ ] UI автодискавери серверов
- [ ] Индикатор подключения к LAN
- [ ] Reconnection UI (loading, retry)
- [ ] Error handling для сетевых ошибок
- [ ] Тестирование на реальной LAN

### UI/UX
- [ ] Дизайн LAN setup экрана
- [ ] Индикаторы состояния сети (подключено/отключено/поиск)
- [ ] Error messages (понятные судьям)
- [ ] Success states (подключено успешно)
- [ ] Анимации переходов состояний

### DevOps
- [ ] LAN testing environment (Docker network simulation)
- [ ] Performance benchmarks (latency измерения)
- [ ] Troubleshooting guide для LAN режима
- [ ] Release plan для новой версии
- [ ] CI/CD для тестирования в изолированной сети

### QA
- [ ] Тест-кейсы для LAN режима (функциональные)
- [ ] Edge cases (сеть пропала во время боя)
- [ ] Load testing (10+ судейских столов одновременно)
- [ ] Manual testing на реальной LAN
- [ ] Security тестирование (изоляция от интернета)

## Backlog (следующие спринты)

### Приоритет 1: Match Screen доработка
- История действий (Ctrl+Z для отмены)
- Звуковые эффекты (начало/конец боя, баллы)
- Анимации (transitions, celebrations)
- Полировка UX

### Приоритет 2: Real-time синхронизация
- WebSocket интеграция для live обновлений поединков
- Offline queue обработка (background sync)
- Conflict resolution (если 2 судьи изменили одно)

### Приоритет 3: Админ-панель расширенная
- Мониторинг судейских столов (live dashboard)
- Список активных поединков
- Ручная синхронизация (force sync)
- Статистика турнира

---

*Обновлено: декабрь 2025*
