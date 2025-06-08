// ==============================================
// TRADING_LOGIC.JS - ОСНОВНАЯ ТОРГОВАЯ ЛОГИКА
// ==============================================

const logger = require('./logger');
const { CONFIG, convertSymbol } = require('./config');

class TradingEngine {
    constructor(whiteBitAPI, riskManager, telegramBot) {
        this.api = whiteBitAPI;
        this.riskManager = riskManager;
        this.bot = telegramBot;
        
    // Подтвердить сделку
    async confirmTrade(signalId) {
        const signal = this.pendingSignals.get(signalId);
        if (!signal) {
            throw new Error('Сигнал не найден или истек');
        }
        
        // Удаляем из pending
        this.pendingSignals.delete(signalId);
        
        // Выполняем покупку
        return await this.openLongPosition(signal.ticker, parseFloat(signal.price), signal);
    }

    // Отклонить сделку
    async rejectTrade(signalId) {
        const signal = this.pendingSignals.get(signalId);
        if (!signal) {
            throw new Error('Сигнал не найден');
        }
        
        this.pendingSignals.delete(signalId);
        
        logger.info('Сделка отклонена пользователем', { 
            signalId, 
            ticker: signal.ticker, 
            action: signal.action 
        });
        
        return signal;
    }

    // ==============================================
    // МОНИТОРИНГ ПОЗИЦИЙ
    // ==============================================

    // Мониторинг всех активных позиций
    async monitorPositions() {
        if (this.activePositions.size === 0) {
            return;
        }

        logger.info('Начинаем мониторинг позиций', { count: this.activePositions.size });

        for (const [symbol, position] of this.activePositions) {
            try {
                await this.monitorSinglePosition(symbol, position);
            } catch (error) {
                logger.errorWithStack('Ошибка мониторинга позиции', error, { symbol });
            }
        }
    }

    // Мониторинг одной позиции
    async monitorSinglePosition(symbol, position) {
        try {
            // Получаем текущую цену
            const ticker = await this.api.getTicker(position.symbol);
            const currentPrice = parseFloat(ticker.last);
            
            // Получаем рекомендации риск-менеджера
            const advice = this.riskManager.getPositionManagementAdvice(position, currentPrice, ticker);
            
            // Проверяем нужно ли закрыть позицию
            const shouldClose = this.riskManager.shouldClosePosition(position, currentPrice);
            
            if (shouldClose.shouldClose) {
                logger.warn('Позиция требует закрытия', { symbol, reason: shouldClose.reason });
                await this.closePosition(symbol, shouldClose.reason);
                return;
            }

            // Проверяем достижение TP уровней (автоматическое срабатывание)
            for (const tp of position.tpLevels) {
                const tpReached = position.side === 'long' ? 
                    currentPrice >= tp.price : 
                    currentPrice <= tp.price;
                    
                if (tpReached && !position.partialCloses.some(pc => pc.level === tp.level)) {
                    logger.info('Автоматическое срабатывание TP', { symbol, level: tp.level, currentPrice });
                    await this.partialClose(symbol, tp.percentage, tp.level);
                }
            }
            
            // Логируем состояние позиции
            const pnl = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
            logger.debug('Мониторинг позиции', {
                symbol,
                currentPrice,
                entryPrice: position.entryPrice,
                pnl: pnl.toFixed(2) + '%',
                advice: advice.action,
                risk: advice.riskLevel
            });
            
        } catch (error) {
            logger.errorWithStack('Ошибка мониторинга позиции', error, { symbol });
        }
    }

    // ==============================================
    // УТИЛИТЫ И СТАТИСТИКА
    // ==============================================

    // Отправить сообщение в Telegram
    async sendTelegramMessage(message) {
        try {
            await this.bot.sendMessage(CONFIG.CHAT_ID, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            logger.info('Telegram сообщение отправлено');
        } catch (error) {
            logger.errorWithStack('Ошибка отправки Telegram сообщения', error);
        }
    }

    // Получить статистику торговли
    getStats() {
        const winRate = this.stats.totalTrades > 0 ? 
            (this.stats.profitable / this.stats.totalTrades * 100).toFixed(2) + '%' : '0%';
            
        return {
            ...this.stats,
            winRate,
            activePositions: this.activePositions.size,
            pendingSignals: this.pendingSignals.size,
            averagePnL: this.stats.totalTrades > 0 ? 
                (this.stats.totalPnL / this.stats.totalTrades).toFixed(2) + '%' : '0%'
        };
    }

    // Получить детальный отчет
    async getDetailedReport() {
        const stats = this.getStats();
        const riskReport = await this.riskManager.getRiskReport(this.activePositions);
        const apiStats = this.api.getAPIStats();
        
        return {
            trading: stats,
            risk: riskReport,
            api: apiStats,
            positions: Array.from(this.activePositions.entries()).map(([symbol, position]) => ({
                symbol,
                originalSymbol: position.originalSymbol,
                side: position.side,
                entryPrice: position.entryPrice,
                quantity: position.quantity,
                remainingQuantity: position.remainingQuantity,
                openTime: position.openTime,
                partialCloses: position.partialCloses.length,
                status: position.status
            })),
            recentOrders: this.orderHistory.slice(-10)
        };
    }

    // Закрыть все позиции
    async closeAllPositions(reason = 'Принудительное закрытие') {
        const symbols = Array.from(this.activePositions.keys());
        const results = [];
        
        logger.info('Закрываем все позиции', { count: symbols.length, reason });
        
        for (const symbol of symbols) {
            try {
                const result = await this.closePosition(symbol, reason);
                results.push({ symbol, success: true, result });
            } catch (error) {
                logger.errorWithStack('Ошибка закрытия позиции', error, { symbol });
                results.push({ symbol, success: false, error: error.message });
            }
        }
        
        return results;
    }

    // Очистить просроченные pending сигналы
    cleanupPendingSignals() {
        const now = Date.now();
        const timeout = CONFIG.STRATEGY.CONFIRMATION_TIMEOUT;
        
        let cleanedCount = 0;
        for (const [signalId, signal] of this.pendingSignals) {
            if (now - signal.timestamp.getTime() > timeout) {
                this.pendingSignals.delete(signalId);
                cleanedCount++;
                logger.info('Просроченный сигнал удален', { signalId, age: now - signal.timestamp.getTime() });
            }
        }
        
        if (cleanedCount > 0) {
            logger.info('Очистка pending сигналов завершена', { cleanedCount });
        }
        
        return cleanedCount;
    }

    // Получить позицию по символу
    getPosition(symbol) {
        return this.activePositions.get(symbol);
    }

    // Получить все активные позиции
    getAllPositions() {
        return Array.from(this.activePositions.entries());
    }

    // Получить все pending сигналы
    getAllPendingSignals() {
        return Array.from(this.pendingSignals.entries());
    }

    // Проверить есть ли позиция по символу
    hasPosition(symbol) {
        return this.activePositions.has(symbol);
    }

    // Получить историю ордеров
    getOrderHistory(limit = 50) {
        return this.orderHistory.slice(-limit);
    }

    // Экспорт данных для бэкапа
    exportData() {
        return {
            activePositions: Array.from(this.activePositions.entries()),
            pendingSignals: Array.from(this.pendingSignals.entries()),
            orderHistory: this.orderHistory,
            stats: this.stats,
            timestamp: new Date()
        };
    }

    // Импорт данных из бэкапа
    importData(data) {
        if (data.activePositions) {
            this.activePositions = new Map(data.activePositions);
        }
        if (data.pendingSignals) {
            this.pendingSignals = new Map(data.pendingSignals);
        }
        if (data.orderHistory) {
            this.orderHistory = data.orderHistory;
        }
        if (data.stats) {
            this.stats = data.stats;
        }
        
        logger.info('Данные импортированы', {
            activePositions: this.activePositions.size,
            pendingSignals: this.pendingSignals.size,
            orderHistory: this.orderHistory.length
        });
    }
}

// Экспорт класса
module.exports = TradingEngine; Хранилища
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

    // ==============================================
    // ОБРАБОТКА СИГНАЛОВ
    // ==============================================

    // Обработать входящий сигнал
    async processSignal(signal) {
        try {
            const { action, ticker, price, strategy } = signal;
            
            // Проверяем стратегию
            if (strategy !== CONFIG.STRATEGY.NAME) {
                logger.warn('Неизвестная стратегия', { strategy, expected: CONFIG.STRATEGY.NAME });
                return;
            }

            logger.info(`Получен сигнал ${action} для ${ticker}`, { price, action });

            switch (action) {
                case 'BUY':
                    await this.handleBuySignal(signal);
                    break;
                    
                case 'TP1':
                case 'TP2':
                case 'TP3':
                    await this.handleTakeProfitSignal(signal);
                    break;
                    
                case 'SL':
                case 'EXIT':
                    await this.handleExitSignal(signal);
                    break;
                    
                default:
                    logger.warn('Неизвестное действие сигнала', { action });
            }
        } catch (error) {
            logger.errorWithStack('Ошибка обработки сигнала', error, { signal });
            await this.sendTelegramMessage(`❌ Ошибка обработки сигнала: ${error.message}`);
        }
    }

    // Обработать сигнал покупки
    async handleBuySignal(signal) {
        const { ticker, price } = signal;
        const wbSymbol = convertSymbol(ticker);
        
        // Проверяем возможность открытия позиции
        const riskCheck = await this.riskManager.canOpenPosition(wbSymbol, parseFloat(price), this.activePositions);
        
        if (!riskCheck.allowed) {
            logger.warn('Сигнал покупки отклонен риск-менеджером', { reason: riskCheck.reason });
            await this.sendTelegramMessage(`⚠️ Сигнал отклонен: ${riskCheck.reason}`);
            return;
        }

        // Отправляем запрос на подтверждение
        await this.requestTradeConfirmation(signal);
    }

    // Обработать сигнал Take Profit
    async handleTakeProfitSignal(signal) {
        const { ticker, action } = signal;
        const tpLevel = parseInt(action.replace('TP', ''));
        
        const position = this.activePositions.get(ticker);
        if (!position) {
            logger.warn('Позиция не найдена для TP', { ticker, action });
            return;
        }

        const tpConfig = CONFIG.STRATEGY.TP_LEVELS.find(tp => tp.level === tpLevel);
        if (!tpConfig) {
            logger.warn('Конфигурация TP не найдена', { tpLevel });
            return;
        }

        await this.partialClose(ticker, tpConfig.percentage, tpLevel);
    }

    // Обработать сигнал выхода
    async handleExitSignal(signal) {
        const { ticker } = signal;
        const reason = signal.action === 'SL' ? 'Stop Loss' : signal.message || 'Exit сигнал';
        
        await this.closePosition(ticker, reason);
    }

    // ==============================================
    // УПРАВЛЕНИЕ ПОЗИЦИЯМИ
    // ==============================================

    // Открыть LONG позицию
    async openLongPosition(symbol, price, signal) {
        try {
            logger.info('🎯 Начинаем открытие LONG позиции', { symbol, price });
            
            const wbSymbol = convertSymbol(symbol);
            
            // Рассчитываем размер позиции
            const positionSizeUSDT = await this.riskManager.calculatePositionSize(
                wbSymbol, 
                price, 
                this.activePositions.size
            );
            
            // Валидируем ордер
            const validation = await this.riskManager.validateOrder(wbSymbol, 'buy', positionSizeUSDT);
            if (!validation.valid) {
                throw new Error(`Валидация ордера не пройдена: ${validation.errors.join(', ')}`);
            }

            logger.info('🚀 Создаем рыночный ордер на покупку', {
                symbol: wbSymbol,
                sizeUSDT: positionSizeUSDT,
                price
            });
            
            // Создаем ордер
            const order = await this.api.createMarketBuyOrder(wbSymbol, positionSizeUSDT);
            
            // Анализируем результат
            const quantity = parseFloat(order.dealStock) || (positionSizeUSDT / price);
            const actualPrice = order.dealMoney && order.dealStock ? 
                parseFloat(order.dealMoney) / parseFloat(order.dealStock) : price;
            
            // Рассчитываем уровни TP/SL
            const tpLevels = this.riskManager.calculateTPLevels(actualPrice, 'long');
            const slLevel = this.riskManager.calculateStopLoss(actualPrice, 'long');
            
            // Создаем объект позиции
            const position = {
                symbol: wbSymbol,
                originalSymbol: symbol,
                side: 'long',
                entryPrice: actualPrice,
                quantity: quantity,
                remainingQuantity: quantity,
                orderId: order.orderId,
                openTime: new Date(),
                signal: signal,
                tpLevels: tpLevels,
                slLevel: slLevel,
                partialCloses: [],
                status: 'ACTIVE'
            };
            
            // Сохраняем позицию
            this.activePositions.set(symbol, position);
            
            // Обновляем статистику
            this.stats.totalTrades++;
            
            // Записываем в историю
            this.orderHistory.push({
                timestamp: new Date(),
                action: 'OPEN_LONG',
                symbol: symbol,
                wbSymbol: wbSymbol,
                price: actualPrice,
                quantity: quantity,
                orderId: order.orderId,
                positionSizeUSDT: positionSizeUSDT
            });

            await this.sendTelegramMessage(`
🟢 <b>ПОЗИЦИЯ ОТКРЫТА</b>
📊 Символ: ${symbol} → ${wbSymbol}
💰 Потрачено: $${positionSizeUSDT.toFixed(2)} USDT
📦 Получено: ${quantity.toFixed(6)} ${wbSymbol.split('_')[0]}
💵 Средняя цена: $${actualPrice.toFixed(2)}
📈 Сигнал: ${signal.message || 'BUY сигнал'}
🆔 Order ID: ${order.orderId}

🎯 <b>Take Profit уровни:</b>
${tpLevels.map(tp => `TP${tp.level}: $${tp.price.toFixed(2)} (${tp.percentage}%)`).join('\n')}
🛑 <b>Stop Loss:</b> $${slLevel.toFixed(2)}
            `);

            logger.trade('POSITION_OPENED', symbol, {
                wbSymbol,
                entryPrice: actualPrice,
                quantity,
                positionSizeUSDT,
                orderId: order.orderId,
                tpLevels,
                slLevel
            });

            return order;
            
        } catch (error) {
            logger.errorWithStack('Ошибка открытия позиции', error, { symbol, price });
            await this.sendTelegramMessage(`❌ Ошибка открытия позиции ${symbol}: ${error.message}`);
            throw error;
        }
    }

    // Закрыть позицию
    async closePosition(symbol, reason = 'Сигнал выхода') {
        try {
            const position = this.activePositions.get(symbol);
            if (!position) {
                logger.warn('Позиция не найдена для закрытия', { symbol });
                return;
            }

            if (position.remainingQuantity <= 0) {
                logger.warn('Позиция уже полностью закрыта', { symbol });
                this.activePositions.delete(symbol);
                return;
            }

            logger.info('🔴 Закрываем позицию', { symbol, reason });
            
            // Валидируем ордер на продажу
            const validation = await this.riskManager.validateOrder(
                position.symbol, 
                'sell', 
                position.remainingQuantity
            );
            if (!validation.valid) {
                throw new Error(`Валидация ордера не пройдена: ${validation.errors.join(', ')}`);
            }
            
            // Создаем ордер на продажу
            const order = await this.api.createMarketSellOrder(position.symbol, position.remainingQuantity);
            
            // Рассчитываем результаты
            const exitPrice = order.dealMoney && order.dealStock ? 
                parseFloat(order.dealMoney) / parseFloat(order.dealStock) : 
                position.entryPrice;
                
            const totalPnL = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
            const receivedUSDT = parseFloat(order.dealMoney) || 0;
            
            // Обновляем статистику
            if (totalPnL > 0) {
                this.stats.profitable++;
            } else {
                this.stats.losing++;
            }
            this.stats.totalPnL += totalPnL;

            // Обновляем позицию
            position.status = 'CLOSED';
            position.exitPrice = exitPrice;
            position.exitTime = new Date();
            position.closeReason = reason;
            position.totalPnL = totalPnL;
            position.receivedUSDT = receivedUSDT;

            await this.sendTelegramMessage(`
🔴 <b>ПОЗИЦИЯ ЗАКРЫТА</b>
📊 Символ: ${symbol} → ${position.symbol}
💰 Цена входа: $${position.entryPrice.toFixed(2)}
💰 Цена выхода: $${exitPrice.toFixed(2)}
📦 Продано: ${position.remainingQuantity.toFixed(6)} ${position.symbol.split('_')[0]}
💵 Получено: $${receivedUSDT.toFixed(2)} USDT
📈 P&L: ${totalPnL > 0 ? '+' : ''}${totalPnL.toFixed(2)}%
📝 Причина: ${reason}
🆔 Order ID: ${order.orderId}
            `);

            // Записываем в историю
            this.orderHistory.push({
                timestamp: new Date(),
                action: 'CLOSE_POSITION',
                symbol: symbol,
                wbSymbol: position.symbol,
                entryPrice: position.entryPrice,
                exitPrice: exitPrice,
                quantity: position.remainingQuantity,
                pnl: totalPnL,
                reason: reason,
                orderId: order.orderId
            });

            logger.trade('POSITION_CLOSED', symbol, {
                entryPrice: position.entryPrice,
                exitPrice,
                pnl: totalPnL,
                reason,
                orderId: order.orderId
            });

            // Удаляем позицию из активных
            this.activePositions.delete(symbol);
            
            // Обновляем дневную статистику риск-менеджера
            this.riskManager.updateDailyStats({ pnl: totalPnL });

            return order;
            
        } catch (error) {
            logger.errorWithStack('Ошибка закрытия позиции', error, { symbol, reason });
            await this.sendTelegramMessage(`❌ Ошибка закрытия позиции ${symbol}: ${error.message}`);
            throw error;
        }
    }

    // Частичное закрытие позиции
    async partialClose(symbol, percentage, tpLevel) {
        try {
            const position = this.activePositions.get(symbol);
            if (!position) {
                logger.warn('Позиция не найдена для частичного закрытия', { symbol });
                return;
            }

            if (position.remainingQuantity <= 0) {
                logger.warn('Нет остатка для частичного закрытия', { symbol });
                return;
            }

            const closeQuantity = this.riskManager.calculatePartialCloseAmount(
                { quantity: position.remainingQuantity }, 
                percentage
            );
            
            if (closeQuantity <= 0) {
                logger.warn('Количество для закрытия слишком мало', { symbol, closeQuantity });
                return;
            }

            logger.info('💰 Частичное закрытие позиции', { symbol, percentage, closeQuantity });
            
            // Валидируем ордер
            const validation = await this.riskManager.validateOrder(position.symbol, 'sell', closeQuantity);
            if (!validation.valid) {
                throw new Error(`Валидация ордера не пройдена: ${validation.errors.join(', ')}`);
            }
            
            // Создаем ордер на частичную продажу
            const order = await this.api.createMarketSellOrder(position.symbol, closeQuantity);
            
            // Рассчитываем результаты
            const exitPrice = order.dealMoney && order.dealStock ? 
                parseFloat(order.dealMoney) / parseFloat(order.dealStock) : 
                position.entryPrice;
                
            const pnl = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
            const receivedUSDT = parseFloat(order.dealMoney) || 0;
            
            // Обновляем позицию
            position.remainingQuantity -= closeQuantity;
            position.partialCloses.push({
                level: tpLevel,
                percentage,
                quantity: closeQuantity,
                price: exitPrice,
                pnl,
                receivedUSDT,
                timestamp: new Date(),
                orderId: order.orderId
            });

            await this.sendTelegramMessage(`
💰 <b>ЧАСТИЧНАЯ ФИКСАЦИЯ TP${tpLevel}</b>
📊 Символ: ${symbol} → ${position.symbol}
🎯 Уровень: TP${tpLevel} (${percentage}%)
📦 Продано: ${closeQuantity.toFixed(6)} ${position.symbol.split('_')[0]}
💵 Получено: $${receivedUSDT.toFixed(2)} USDT
💰 Цена: $${exitPrice.toFixed(2)}
📈 P&L: +${pnl.toFixed(2)}%
📦 Осталось: ${position.remainingQuantity.toFixed(6)}
🆔 Order ID: ${order.orderId}
            `);

            // Записываем в историю
            this.orderHistory.push({
                timestamp: new Date(),
                action: 'PARTIAL_CLOSE',
                symbol: symbol,
                wbSymbol: position.symbol,
                level: tpLevel,
                percentage,
                quantity: closeQuantity,
                price: exitPrice,
                pnl,
                orderId: order.orderId
            });

            logger.trade('PARTIAL_CLOSE', symbol, {
                level: tpLevel,
                percentage,
                quantity: closeQuantity,
                price: exitPrice,
                pnl,
                orderId: order.orderId
            });

            return order;
            
        } catch (error) {
            logger.errorWithStack('Ошибка частичного закрытия', error, { symbol, percentage, tpLevel });
            await this.sendTelegramMessage(`❌ Ошибка частичного закрытия ${symbol}: ${error.message}`);
            throw error;
        }
    }

    // ==============================================
    // ЗАПРОС ПОДТВЕРЖДЕНИЯ
    // ==============================================

    // Отправить запрос на подтверждение сделки
    async requestTradeConfirmation(signal) {
        const { action, ticker, price } = signal;
        const wbSymbol = convertSymbol(ticker);
        
        // Генерируем уникальный ID
        const signalId = Date.now().toString();
        
        // Сохраняем сигнал
        this.pendingSignals.set(signalId, {
            ...signal,
            wbSymbol,
            timestamp: new Date()
        });
        
        // Создаем клавиатуру
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ ДА', callback_data: `confirm_${signalId}` },
                        { text: '❌ НЕТ', callback_data: `reject_${signalId}` }
                    ]
                ]
            }
        };
        
        const confirmMessage = `
🚨 <b>ПОДТВЕРЖДЕНИЕ СДЕЛКИ</b>

📊 <b>Сигнал:</b> ${action}
🎯 <b>Пара TradingView:</b> ${ticker}
💱 <b>Пара WhiteBit:</b> ${wbSymbol}
💰 <b>Цена:</b> $${price}
📈 <b>Сообщение:</b> ${signal.message || 'Торговый сигнал'}
🆔 <b>Signal ID:</b> ${signalId}

⚠️ <b>Войти в позицию?</b>
        `;
        
        try {
            const sentMessage = await this.bot.sendMessage(CONFIG.CHAT_ID, confirmMessage, {
                parse_mode: 'HTML',
                ...keyboard
            });
            
            logger.info('Запрос подтверждения отправлен', { signalId, ticker, action, price });
            
            // Автоудаление через 5 минут
            setTimeout(() => {
                if (this.pendingSignals.has(signalId)) {
                    this.pendingSignals.delete(signalId);
                    this.bot.sendMessage(CONFIG.CHAT_ID, 
                        `⏰ Время ожидания истекло для сигнала ${ticker} ${action} (ID: ${signalId})`
                    );
                    logger.info('Сигнал удален по истечению времени', { signalId });
                }
            }, CONFIG.STRATEGY.CONFIRMATION_TIMEOUT);
            
        } catch (error) {
            logger.errorWithStack('Ошибка отправки запроса подтверждения', error, { signalId, signal });
            this.pendingSignals.delete(signalId);
        }
    }

    // Подтвердить сделку
    async confirmTrade(signalId) {
        const signal = this.pendingSignals.get(signalId);
        if (!signal) {
            throw new Error('Сигнал не найден или истек');
        }
        
        //