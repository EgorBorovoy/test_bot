require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const logger = require('./logger');
const { CONFIG, validateConfig } = require('./config');
const WhiteBitAPI = require('./whiteBitAPI');
const RiskManager = require('./riskManagement');
const TradingEngine = require('./tradingLogic');

validateConfig();

const app = express();
app.use(express.json());

const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { polling: true });
const whiteBitAPI = new WhiteBitAPI(
  CONFIG.WHITEBIT_API_KEY,
  CONFIG.WHITEBIT_SECRET_KEY,
  CONFIG.WHITEBIT_BASE_URL
);
const riskManager = new RiskManager(whiteBitAPI);
const tradingEngine = new TradingEngine(whiteBitAPI, riskManager, bot);

function checkAuth(msg) {
  return msg.chat && String(msg.chat.id) === String(CONFIG.CHAT_ID);
}

// =============================
// TELEGRAM COMMANDS
// =============================

bot.onText(/\/test-buy/, async msg => {
  if (!checkAuth(msg)) return;
  try {
    const ticker = await whiteBitAPI.getTicker('DBTC_DUSDT');
    const currentPrice = parseFloat(ticker.last);
    const orderSize = CONFIG.TRADING.MIN_ORDER_SIZE;

    await bot.sendMessage(
      msg.chat.id,
      `💰 Покупаем DBTC на ${orderSize.toFixed(2)} DUSDT по цене ${currentPrice.toFixed(2)}...`,
      { parse_mode: 'HTML' }
    );

    const order = await whiteBitAPI.createMarketBuyOrder('DBTC_DUSDT', orderSize);
    const message = `🎉 <b>ТЕСТОВАЯ ПОКУПКА ВЫПОЛНЕНА</b>\n\n` +
      `🆔 <b>Order ID:</b> ${order.orderId}\n` +
      `📊 <b>Статус:</b> ${order.status}\n` +
      `💰 <b>Потрачено:</b> ${parseFloat(order.dealMoney || orderSize).toFixed(2)} DUSDT\n` +
      `📦 <b>Получено:</b> ${parseFloat(order.dealStock || 0).toFixed(8)} DBTC\n` +
      `💵 <b>Цена:</b> ${currentPrice.toFixed(2)}\n` +
      `⏰ <b>Время:</b> ${new Date().toLocaleString()}`;

    await bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });

    tradingEngine.addOrderHistory({
      action: 'TEST_BUY',
      symbol: 'DBTC_DUSDT',
      price: currentPrice,
      quantity: parseFloat(order.dealStock || 0),
      spent: parseFloat(order.dealMoney || orderSize),
      orderId: order.orderId,
      timestamp: new Date()
    });
  } catch (err) {
    logger.errorWithStack('Ошибка команды test-buy', err);
    await bot.sendMessage(msg.chat.id, `❌ Ошибка: ${err.message}`, { parse_mode: 'HTML' });
  }
});

bot.onText(/\/test-sell/, async msg => {
  if (!checkAuth(msg)) return;
  try {
    await bot.sendMessage(msg.chat.id, '🔴 Запускаем тестовую продажу...', { parse_mode: 'HTML' });
    const balance = await whiteBitAPI.getCurrencyBalance('DBTC');
    const available = parseFloat(balance.available || 0);
    if (available <= 0) throw new Error(`Нет DBTC для продажи. Баланс: ${available}`);

    const ticker = await whiteBitAPI.getTicker('DBTC_DUSDT');
    const currentPrice = parseFloat(ticker.last);

    await bot.sendMessage(
      msg.chat.id,
      `💰 Продаем ${available.toFixed(8)} DBTC по цене ${currentPrice.toFixed(2)}...`,
      { parse_mode: 'HTML' }
    );

    const order = await whiteBitAPI.createMarketSellOrder('DBTC_DUSDT', available);
    const message = `🎉 <b>ТЕСТОВАЯ ПРОДАЖА ВЫПОЛНЕНА</b>\n\n` +
      `🆔 <b>Order ID:</b> ${order.orderId}\n` +
      `📊 <b>Статус:</b> ${order.status}\n` +
      `📦 <b>Продано:</b> ${parseFloat(order.dealStock || 0).toFixed(8)} DBTC\n` +
      `💵 <b>Получено:</b> ${parseFloat(order.dealMoney || 0).toFixed(2)} DUSDT\n` +
      `💰 <b>Цена:</b> ${currentPrice.toFixed(2)}\n` +
      `⏰ <b>Время:</b> ${new Date().toLocaleString()}`;

    await bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });

    tradingEngine.addOrderHistory({
      action: 'TEST_SELL',
      symbol: 'DBTC_DUSDT',
      price: currentPrice,
      quantity: parseFloat(order.dealStock || 0),
      received: parseFloat(order.dealMoney || 0),
      orderId: order.orderId,
      timestamp: new Date()
    });
  } catch (err) {
    logger.errorWithStack('Ошибка команды test-sell', err);
    await bot.sendMessage(msg.chat.id, `❌ Ошибка: ${err.message}`, { parse_mode: 'HTML' });
  }
});

bot.onText(/\/markets/, async msg => {
  if (!checkAuth(msg)) return;
  try {
    await bot.sendMessage(msg.chat.id, '🏪 Получаем список рынков...', { parse_mode: 'HTML' });
    const markets = await whiteBitAPI.getMarkets();
    const demoMarkets = markets.filter(m => m.name.includes('DBTC') || m.name.includes('DETH') || m.name.includes('DUSDT'));

    const lines = demoMarkets.map(m =>
      `📊 <b>${m.name}</b>\n💰 Базовая: ${m.stock}\n💵 Котировочная: ${m.money}\n📈 Торговля: ${m.tradesEnabled ? '✅' : '❌'}\n📦 Мин. количество: ${m.minAmount}\n💰 Мин. сумма: ${m.minTotal}\n💸 Maker: ${m.makerFee} | Taker: ${m.takerFee}`
    ).join('\n');

    const message = `🏪 <b>ДОСТУПНЫЕ ДЕМО-РЫНКИ</b>\n\n${lines}\n\n📊 <b>Всего рынков:</b> ${markets.length}\n🎮 <b>Демо-рынков:</b> ${demoMarkets.length}`;
    await bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
  } catch (err) {
    logger.errorWithStack('Ошибка команды markets', err);
    await bot.sendMessage(msg.chat.id, `❌ Ошибка: ${err.message}`, { parse_mode: 'HTML' });
  }
});

bot.on('polling_error', error => {
  logger.errorWithStack('Telegram polling error', error);
});

bot.on('message', msg => {
  if (!checkAuth(msg)) return;
  const text = msg.text;
  if (text && text.startsWith('/') && !text.match(/\/(test-buy|test-sell|markets)/)) {
    bot.sendMessage(msg.chat.id, '❓ Неизвестная команда. Используйте /test-buy, /test-sell или /markets.', { parse_mode: 'HTML' });
  }
});

// =============================
// EXPRESS ROUTES
// =============================

app.post('/webhook', async (req, res) => {
  if (req.headers['x-secret'] !== CONFIG.WEBHOOK_SECRET) {
    res.status(403).send('Forbidden');
    return;
  }

  try {
    await tradingEngine.processSignal(req.body);
    res.json({ status: 'ok' });
  } catch (err) {
    logger.errorWithStack('Ошибка обработки webhook', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/test-webhook', async (req, res) => {
  if (req.headers['x-secret'] !== CONFIG.WEBHOOK_SECRET) {
    res.status(403).send('Forbidden');
    return;
  }

  const message = req.body && req.body.message ? req.body.message : 'ping';

  try {
    await tradingEngine.sendTelegramMessage(`✅ Получен тестовый webhook: ${message}`);
    res.json({ status: 'ok' });
  } catch (err) {
    logger.errorWithStack('Ошибка обработки test-webhook', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// =============================
// PERIODIC TASKS
// =============================

const monitoringInterval = setInterval(() => {
  tradingEngine.monitorPositions().catch(e => logger.errorWithStack('Ошибка мониторинга', e));
}, 30000);

const cleanupInterval = setInterval(() => {
  try {
    tradingEngine.cleanupPendingSignals();
  } catch (e) {
    logger.errorWithStack('Ошибка очистки сигналов', e);
  }
}, 5 * 60 * 1000);

const backupInterval = setInterval(() => {
  try {
    const data = tradingEngine.exportData();
    fs.writeFileSync(path.join(__dirname, 'backup.json'), JSON.stringify(data, null, 2));
  } catch (e) {
    logger.errorWithStack('Ошибка бэкапа', e);
  }
}, 6 * 60 * 60 * 1000);

const server = app.listen(CONFIG.PORT, () => {
  logger.info(`🚀 Торговый бот запущен на порту ${CONFIG.PORT}`);
});

async function gracefulShutdown(signal) {
  logger.info(`Получен сигнал ${signal}, завершаем работу...`);
  clearInterval(monitoringInterval);
  clearInterval(cleanupInterval);
  clearInterval(backupInterval);

  try {
    await tradingEngine.sendTelegramMessage(`🔴 Торговый бот останавливается (${signal})...`);
  } catch {}

  server.close(() => {
    bot.stopPolling();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', err => {
  logger.errorWithStack('Необработанная ошибка', err);
  tradingEngine.sendTelegramMessage(`🚨 Критическая ошибка: ${err.message}`).catch(() => {});
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  logger.errorWithStack('Необработанное отклонение промиса', reason);
});

module.exports = { app, server, bot, tradingEngine, whiteBitAPI, riskManager, gracefulShutdown };
