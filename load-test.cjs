#!/usr/bin/env node

/**
 * Load Testing Script для локального сервера SETKI.PRO KEEPER
 *
 * Эмулирует работу 20 судей, одновременно обновляющих счёт в разных матчах
 *
 * Установка:
 *   npm install ws node-fetch
 *
 * Использование:
 *   node load-test.js --server=192.168.1.100:8081 --judges=20 --duration=60
 */

const WebSocket = require('ws');

// ==================== КОНФИГУРАЦИЯ ====================

const DEFAULT_CONFIG = {
  server: 'localhost:8081',
  judges: 10,              // Количество судей
  duration: 30,            // Длительность теста (сек)
  updateInterval: 500,     // Интервал обновлений (мс)
  tournament_id: 1,
  pin_code: '123456'
};

// Парсинг аргументов командной строки
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value;
  return acc;
}, {});

const CONFIG = {
  server: args.server || DEFAULT_CONFIG.server,
  judges: parseInt(args.judges) || DEFAULT_CONFIG.judges,
  duration: parseInt(args.duration) || DEFAULT_CONFIG.duration,
  updateInterval: parseInt(args.updateInterval) || DEFAULT_CONFIG.updateInterval,
  tournament_id: parseInt(args.tournament_id) || DEFAULT_CONFIG.tournament_id,
  pin_code: args.pin || DEFAULT_CONFIG.pin_code,
};

// ==================== СТАТИСТИКА ====================

const stats = {
  total_requests: 0,
  successful_requests: 0,
  failed_requests: 0,
  timeout_errors: 0,
  connection_errors: 0,
  http_500_errors: 0,
  http_409_errors: 0,  // Optimistic lock conflicts
  websocket_messages: 0,
  response_times: [],
  start_time: null,
  end_time: null,
};

// ==================== HTTP CLIENT ====================

async function httpRequest(method, path, body = null, token = null) {
  const url = `http://${CONFIG.server}${path}`;
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });

    const responseTime = Date.now() - startTime;
    stats.response_times.push(responseTime);

    if (!response.ok) {
      if (response.status === 500) {
        stats.http_500_errors++;
        const text = await response.text();
        if (text.includes('pool timed out')) {
          stats.timeout_errors++;
          throw new Error(`DATABASE POOL TIMEOUT (${responseTime}ms)`);
        }
        throw new Error(`HTTP 500: ${text}`);
      } else if (response.status === 409) {
        stats.http_409_errors++;
        throw new Error(`HTTP 409 CONFLICT (Optimistic Lock)`);
      }
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      stats.connection_errors++;
    }
    throw error;
  }
}

// ==================== JUDGE SIMULATOR ====================

class JudgeSimulator {
  constructor(judgeId, matchId) {
    this.judgeId = judgeId;
    this.judgeName = `Судья_${judgeId}`;
    this.tableNumber = judgeId;
    this.token = null;
    this.matchId = matchId; // Реальный match_id из БД
    this.redScore = 0;
    this.blueScore = 0;
    this.redWarnings = 0;
    this.blueWarnings = 0;
    this.ws = null;
    this.active = true;
  }

  async login() {
    try {
      const response = await httpRequest('POST', '/api/v1/auth/pin', {
        pin_code: CONFIG.pin_code,
        judge_name: this.judgeName,
        table_number: this.tableNumber,
      });

      this.token = response.access_token;
      console.log(`✅ ${this.judgeName} (стол ${this.tableNumber}) → Вход успешен`);
      return true;
    } catch (error) {
      console.error(`❌ ${this.judgeName} → Ошибка входа: ${error.message}`);
      stats.failed_requests++;
      return false;
    }
  }

  async updateScore() {
    if (!this.active) return;

    // Случайно увеличиваем счёт одного из участников
    const randomAction = Math.random();
    if (randomAction < 0.4) {
      this.redScore += Math.floor(Math.random() * 4) + 1; // +1 to +4
    } else if (randomAction < 0.8) {
      this.blueScore += Math.floor(Math.random() * 4) + 1;
    } else if (randomAction < 0.9) {
      this.redWarnings = Math.min(this.redWarnings + 1, 3);
    } else {
      this.blueWarnings = Math.min(this.blueWarnings + 1, 3);
    }

    const payload = {
      match_id: this.matchId,
      red_score: this.redScore,
      blue_score: this.blueScore,
      red_warnings: this.redWarnings,
      blue_warnings: this.blueWarnings,
      status: 'in_progress',
    };

    stats.total_requests++;

    try {
      await httpRequest('POST', '/api/v1/desktop/matches/update', payload, this.token);
      stats.successful_requests++;

      // Логируем только каждый 10-й успешный запрос для читаемости
      if (stats.successful_requests % 10 === 0) {
        console.log(`📊 ${this.judgeName} → Счёт: ${this.redScore}:${this.blueScore} (всего ${stats.successful_requests} успешных)`);
      }
    } catch (error) {
      stats.failed_requests++;
      console.error(`❌ ${this.judgeName} → ${error.message}`);
    }
  }

  connectWebSocket() {
    const wsUrl = `ws://${CONFIG.server}/api/v1/ws/matches/${this.matchId}?token=${this.token}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log(`🔌 ${this.judgeName} → WebSocket подключен`);
    });

    this.ws.on('message', (data) => {
      stats.websocket_messages++;
      // Не логируем каждое сообщение, чтобы не спамить консоль
    });

    this.ws.on('error', (error) => {
      console.error(`⚠️ ${this.judgeName} → WebSocket ошибка: ${error.message}`);
    });

    this.ws.on('close', () => {
      if (this.active) {
        console.log(`🔌 ${this.judgeName} → WebSocket отключен`);
      }
    });
  }

  async startSimulation() {
    // Логин
    const loginSuccess = await this.login();
    if (!loginSuccess) return;

    // Подключаем WebSocket
    this.connectWebSocket();

    // Периодически обновляем счёт
    const updateTimer = setInterval(() => {
      if (!this.active) {
        clearInterval(updateTimer);
        return;
      }
      this.updateScore();
    }, CONFIG.updateInterval);

    // Сохраняем таймер для очистки
    this.updateTimer = updateTimer;
  }

  stop() {
    this.active = false;
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

// ==================== HELPER: GET REAL MATCH IDS ====================

const sqlite3 = require('sqlite3');
const { promisify } = require('util');
const os = require('os');
const path = require('path');

async function getAvailableMatchIds(count) {
  const dbPath = path.join(os.homedir(), '.setki-keeper', 'data', 'setki.db');

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject(new Error(`Не удалось открыть БД: ${err.message}\nПуть: ${dbPath}`));
        return;
      }

      db.all('SELECT match_id FROM matches_cache LIMIT ?', [count], (err, rows) => {
        db.close();

        if (err) {
          reject(new Error(`Ошибка чтения БД: ${err.message}`));
          return;
        }

        if (rows.length === 0) {
          reject(new Error('В БД нет матчей! Скачайте турнир в приложении.'));
          return;
        }

        resolve(rows.map(row => row.match_id));
      });
    });
  });
}

// ==================== MAIN LOAD TEST ====================

async function runLoadTest() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║   SETKI.PRO KEEPER - Load Testing Script         ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log('📋 Конфигурация:');
  console.log(`   Сервер: ${CONFIG.server}`);
  console.log(`   Судей: ${CONFIG.judges}`);
  console.log(`   Длительность: ${CONFIG.duration} сек`);
  console.log(`   Интервал обновлений: ${CONFIG.updateInterval} мс`);
  console.log(`   PIN-код: ${CONFIG.pin_code}`);
  console.log('');

  // Получаем реальные match_id из БД
  console.log('🔍 Получение match_id из локальной БД...');
  let matchIds;
  try {
    matchIds = await getAvailableMatchIds(CONFIG.judges);
    console.log(`✅ Найдено ${matchIds.length} матчей в БД`);
    console.log(`   Match IDs: ${matchIds.slice(0, 5).join(', ')}${matchIds.length > 5 ? '...' : ''}`);
    console.log('');
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  // Проверка подключения к серверу
  console.log('🔍 Проверка доступности сервера...');
  try {
    const health = await httpRequest('GET', '/health');
    console.log(`✅ Сервер доступен: ${health.server} v${health.version}`);
    console.log(`   Активных матчей: ${health.monitoring?.active_matches || 0}`);
    console.log(`   WebSocket подключений: ${health.monitoring?.websocket_connections || 0}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Сервер недоступен: ${error.message}`);
    console.error('   Убедитесь, что локальный сервер запущен!');
    process.exit(1);
  }

  // Создаём судей с реальными match_id
  const judges = [];
  for (let i = 0; i < Math.min(CONFIG.judges, matchIds.length); i++) {
    judges.push(new JudgeSimulator(i + 1, matchIds[i]));
  }

  stats.start_time = Date.now();

  // Запускаем всех судей одновременно
  console.log(`🚀 Запуск ${CONFIG.judges} судей...\n`);
  await Promise.all(judges.map(judge => judge.startSimulation()));

  // Ждём указанное время
  console.log(`⏱️  Тест запущен на ${CONFIG.duration} секунд...\n`);

  // Показываем прогресс каждые 5 секунд
  const progressInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - stats.start_time) / 1000);
    console.log(`⏱️  Прогресс: ${elapsed}/${CONFIG.duration} сек | Успешно: ${stats.successful_requests} | Ошибок: ${stats.failed_requests}`);
  }, 5000);

  await new Promise(resolve => setTimeout(resolve, CONFIG.duration * 1000));

  clearInterval(progressInterval);
  stats.end_time = Date.now();

  // Останавливаем всех судей
  console.log('\n🛑 Останавливаем судей...\n');
  judges.forEach(judge => judge.stop());

  // Ждём завершения активных запросов
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Показываем статистику
  printStatistics();
}

// ==================== СТАТИСТИКА ====================

function printStatistics() {
  const duration = (stats.end_time - stats.start_time) / 1000;
  const avgResponseTime = stats.response_times.length > 0
    ? stats.response_times.reduce((a, b) => a + b, 0) / stats.response_times.length
    : 0;

  const sortedTimes = stats.response_times.sort((a, b) => a - b);
  const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0;
  const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0;
  const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0;
  const maxResponseTime = sortedTimes[sortedTimes.length - 1] || 0;

  const requestsPerSecond = stats.total_requests / duration;
  const successRate = stats.total_requests > 0
    ? ((stats.successful_requests / stats.total_requests) * 100).toFixed(2)
    : 0;

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║              РЕЗУЛЬТАТЫ LOAD TEST                 ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log('📊 Общие показатели:');
  console.log(`   Длительность: ${duration.toFixed(2)} сек`);
  console.log(`   Всего запросов: ${stats.total_requests}`);
  console.log(`   Успешных: ${stats.successful_requests} (${successRate}%)`);
  console.log(`   Ошибок: ${stats.failed_requests}`);
  console.log(`   RPS (запросов/сек): ${requestsPerSecond.toFixed(2)}`);
  console.log('');

  console.log('⏱️  Время отклика (мс):');
  console.log(`   Среднее: ${avgResponseTime.toFixed(2)} мс`);
  console.log(`   P50 (медиана): ${p50} мс`);
  console.log(`   P95: ${p95} мс`);
  console.log(`   P99: ${p99} мс`);
  console.log(`   Максимум: ${maxResponseTime} мс`);
  console.log('');

  console.log('❌ Типы ошибок:');
  console.log(`   Database Pool Timeout: ${stats.timeout_errors}`);
  console.log(`   HTTP 500 (Server Error): ${stats.http_500_errors}`);
  console.log(`   HTTP 409 (Optimistic Lock): ${stats.http_409_errors}`);
  console.log(`   Connection Errors: ${stats.connection_errors}`);
  console.log('');

  console.log('🔌 WebSocket:');
  console.log(`   Полученных сообщений: ${stats.websocket_messages}`);
  console.log('');

  // Вердикт
  console.log('📋 ВЕРДИКТ:');

  if (stats.timeout_errors > 0) {
    console.log(`   ⚠️  КРИТИЧНО: ${stats.timeout_errors} database pool timeout(s)!`);
    console.log('   → Рекомендация: Увеличьте max_connections в db.rs');
  } else if (stats.http_500_errors > 0) {
    console.log(`   ⚠️  ${stats.http_500_errors} серверных ошибок`);
  } else if (successRate >= 99) {
    console.log('   ✅ ОТЛИЧНО: Система выдержала нагрузку без проблем!');
  } else if (successRate >= 95) {
    console.log('   ✅ ХОРОШО: Система стабильна, но есть редкие ошибки');
  } else {
    console.log(`   ❌ ПЛОХО: Success rate ${successRate}% - требуется оптимизация`);
  }

  console.log('');
}

// ==================== ЗАПУСК ====================

// Перехватываем Ctrl+C для корректного завершения
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Получен сигнал прерывания, останавливаем тест...');
  if (stats.start_time && !stats.end_time) {
    stats.end_time = Date.now();
    printStatistics();
  }
  process.exit(0);
});

// Запускаем тест
runLoadTest().catch(error => {
  console.error('\n❌ Критическая ошибка:', error);
  process.exit(1);
});
