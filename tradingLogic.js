const logger = require('./logger');
const { CONFIG, convertSymbol } = require('./config');

class TradingEngine {
  constructor(api, riskManager, bot) {
    this.api = api;
    this.riskManager = riskManager;
    this.bot = bot;

    // Хранилища
    this.activePositions = new Map();
    this.pendingSignals = new Map();
    this.orderHistory = [];

    // Статистика
    this.stats = {
      totalTrades: 0,
      profitable: 0,
      losing: 0,
      totalPnL: 0
    };
  }

  addOrderHistory(entry) {
    this.orderHistory.push(entry);
  }

  async sendTelegramMessage(message) {
    try {
      await this.bot.sendMessage(CONFIG.CHAT_ID, message, { parse_mode: 'HTML' });
    } catch (err) {
      logger.errorWithStack('Ошибка отправки сообщения', err);
    }
  }

  async monitorPositions() {
    for (const [symbol, position] of this.activePositions) {
      try {
        await this.monitorSinglePosition(symbol, position);
      } catch (err) {
        logger.errorWithStack('Ошибка мониторинга позиции', err, { symbol });
      }
    }
  }

  async monitorSinglePosition(symbol, position) {
    const ticker = await this.api.getTicker(position.symbol);
    const currentPrice = parseFloat(ticker.last);
    const check = this.riskManager.shouldClosePosition(position, currentPrice);
    if (check.shouldClose) {
      await this.closePosition(symbol, check.reason);
    }
  }

  async openLongPosition(symbol, price, signal) {
    const wbSymbol = convertSymbol(symbol);
    const amountUSDT = await this.riskManager.calculatePositionSize(
      wbSymbol,
      price,
      this.activePositions.size
    );

    await this.riskManager.validateOrder(wbSymbol, 'buy', amountUSDT);
    const order = await this.api.createMarketBuyOrder(wbSymbol, amountUSDT);
    const qty = parseFloat(order.dealStock) || amountUSDT / price;

    const position = {
      symbol: wbSymbol,
      originalSymbol: symbol,
      side: 'long',
      entryPrice: price,
      quantity: qty,
      remainingQuantity: qty,
      openTime: new Date(),
      signal
    };

    this.activePositions.set(symbol, position);
    this.addOrderHistory({
      action: 'OPEN_LONG',
      symbol,
      price,
      quantity: qty,
      orderId: order.orderId,
      timestamp: new Date()
    });

    this.stats.totalTrades += 1;
    return order;
  }

  async closePosition(symbol, reason = 'Manual close') {
    const position = this.activePositions.get(symbol);
    if (!position) return;

    const order = await this.api.createMarketSellOrder(
      position.symbol,
      position.remainingQuantity
    );
    const exitPrice =
      order.dealMoney && order.dealStock
        ? parseFloat(order.dealMoney) / parseFloat(order.dealStock)
        : position.entryPrice;

    const pnl = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    position.status = 'CLOSED';
    position.exitPrice = exitPrice;
    position.exitTime = new Date();
    position.closeReason = reason;
    position.totalPnL = pnl;

    if (pnl > 0) this.stats.profitable += 1; else this.stats.losing += 1;
    this.stats.totalPnL += pnl;

    this.addOrderHistory({
      action: 'CLOSE_POSITION',
      symbol,
      price: exitPrice,
      quantity: position.remainingQuantity,
      pnl,
      orderId: order.orderId,
      timestamp: new Date()
    });

    this.activePositions.delete(symbol);
    this.riskManager.updateDailyStats({ pnl });
    return order;
  }

  async partialClose(symbol, percentage, level) {
    const position = this.activePositions.get(symbol);
    if (!position) return;

    const qty = this.riskManager.calculatePartialCloseAmount(position, percentage);
    if (qty <= 0) return;

    const order = await this.api.createMarketSellOrder(position.symbol, qty);
    const exitPrice =
      order.dealMoney && order.dealStock
        ? parseFloat(order.dealMoney) / parseFloat(order.dealStock)
        : position.entryPrice;

    position.remainingQuantity -= qty;
    if (!position.partialCloses) position.partialCloses = [];
    position.partialCloses.push({ level, quantity: qty, price: exitPrice, timestamp: new Date() });

    this.addOrderHistory({
      action: 'PARTIAL_CLOSE',
      symbol,
      level,
      quantity: qty,
      price: exitPrice,
      orderId: order.orderId,
      timestamp: new Date()
    });

    if (position.remainingQuantity <= 0) {
      this.activePositions.delete(symbol);
    }

    return order;
  }

  cleanupPendingSignals() {
    const now = Date.now();
    const timeout = CONFIG.STRATEGY.CONFIRMATION_TIMEOUT;
    for (const [id, signal] of this.pendingSignals) {
      if (now - signal.timestamp.getTime() > timeout) {
        this.pendingSignals.delete(id);
      }
    }
  }

  exportData() {
    return {
      activePositions: Array.from(this.activePositions.entries()),
      pendingSignals: Array.from(this.pendingSignals.entries()),
      orderHistory: this.orderHistory,
      stats: this.stats
    };
  }

  importData(data) {
    if (data.activePositions) this.activePositions = new Map(data.activePositions);
    if (data.pendingSignals) this.pendingSignals = new Map(data.pendingSignals);
    if (data.orderHistory) this.orderHistory = data.orderHistory;
    if (data.stats) this.stats = data.stats;
  }

  async requestTradeConfirmation(signal) {
    const signalId = Date.now().toString();
    this.pendingSignals.set(signalId, { ...signal, timestamp: new Date() });

    const keyboard = {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ ДА', callback_data: `confirm_${signalId}` },
          { text: '❌ НЕТ', callback_data: `reject_${signalId}` }
        ]]
      }
    };

    const msg =
      `🚨 <b>ПОДТВЕРЖДЕНИЕ СДЕЛКИ</b>\n` +
      `📊 <b>Сигнал:</b> ${signal.action}\n` +
      `🎯 <b>Пара:</b> ${signal.ticker}\n` +
      `💰 <b>Цена:</b> $${signal.price}\n` +
      `🆔 <b>Signal ID:</b> ${signalId}\n\n` +
      `⚠️ <b>Войти в позицию?</b>`;

    await this.bot.sendMessage(CONFIG.CHAT_ID, msg, { parse_mode: 'HTML', ...keyboard });
  }

  async confirmTrade(signalId) {
    const signal = this.pendingSignals.get(signalId);
    if (!signal) throw new Error('Сигнал не найден или истек');
    this.pendingSignals.delete(signalId);
    return this.openLongPosition(signal.ticker, parseFloat(signal.price), signal);
  }

  async rejectTrade(signalId) {
    const signal = this.pendingSignals.get(signalId);
    if (!signal) throw new Error('Сигнал не найден');
    this.pendingSignals.delete(signalId);
    logger.info('Сделка отклонена пользователем', { signalId });
    return signal;
  }
}

module.exports = TradingEngine;
