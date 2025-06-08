// Продолжение команды test-buy
        await bot.sendMessage(msg.chat.id, 
            `💰 Покупаем DBTC на ${orderSize.toFixed(2)} DUSDT по цене ${currentPrice.toFixed(2)}...`, 
            { parse_mode: 'HTML' }
        );
        
        // Создаем ордер
        const order = await whiteBitAPI.createMarketBuyOrder('DBTC_DUSDT', orderSize);
        
        const message = `
🎉 <b>ТЕСТОВАЯ ПОКУПКА ВЫПОЛНЕНА</b>

🆔 <b>Order ID:</b> ${order.orderId}
📊 <b>Статус:</b> ${order.status}
💰 <b>Потрачено:</b> ${parseFloat(order.dealMoney || orderSize).toFixed(2)} DUSDT
📦 <b>Получено:</b> ${parseFloat(order.dealStock || 0).toFixed(8)} DBTC
💵 <b>Цена:</b> ${currentPrice.toFixed(2)}
⏰ <b>Время:</b> ${new Date().toLocaleString()}
        `;
        
        await bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
        
        // Добавляем в историю
        tradingEngine.addOrderHistory({
            action: 'TEST_BUY',
            symbol: 'DBTC_DUSDT',
            price: currentPrice,
            quantity: parseFloat(order.dealStock || 0),
            spent: parseFloat(order.dealMoney || orderSize),
            orderId: order.orderId,
            timestamp: new Date()
        });
        
    } catch (error) {
        logger.errorWithStack('Ошибка команды test-buy', error);
        await bot.sendMessage(msg.chat.id, `❌ Ошибка: ${error.message}`, { parse_mode: 'HTML' });
    }
});

// Команда тестовой продажи
bot.onText(/\/test-sell/, async (msg) => {
    if (!checkAuth(msg)) return;

    try {
        await bot.sendMessage(msg.chat.id, '🔴 Запускаем тестовую продажу...', { parse_mode: 'HTML' });
        
        // Проверяем баланс DBTC
        const balance = await whiteBitAPI.getCurrencyBalance('DBTC');
        const availableBalance = parseFloat(balance.available || 0);
        
        if (availableBalance <= 0) {
            throw new Error(`Нет DBTC для продажи. Баланс: ${availableBalance}`);
        }
        
        // Получаем текущую цену
        const ticker = await whiteBitAPI.getTicker('DBTC_DUSDT');
        const currentPrice = parseFloat(ticker.last);
        
        await bot.sendMessage(msg.chat.id, 
            `💰 Продаем ${availableBalance.toFixed(8)} DBTC по цене ${currentPrice.toFixed(2)}...`, 
            { parse_mode: 'HTML' }
        );
        
        // Создаем ордер на продажу
        const order = await whiteBitAPI.createMarketSellOrder('DBTC_DUSDT', availableBalance);
        
        const message = `
🎉 <b>ТЕСТОВАЯ ПРОДАЖА ВЫПОЛНЕНА</b>

🆔 <b>Order ID:</b> ${order.orderId}
📊 <b>Статус:</b> ${order.status}
📦 <b>Продано:</b> ${parseFloat(order.dealStock || 0).toFixed(8)} DBTC
💵 <b>Получено:</b> ${parseFloat(order.dealMoney || 0).toFixed(2)} DUSDT
💰 <b>Цена:</b> ${currentPrice.toFixed(2)}
⏰ <b>Время:</b> ${new Date().toLocaleString()}
        `;
        
        await bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
        
        // Добавляем в историю
        tradingEngine.addOrderHistory({
            action: 'TEST_SELL',
            symbol: 'DBTC_DUSDT',
            price: currentPrice,
            quantity: parseFloat(order.dealStock || 0),
            received: parseFloat(order.dealMoney || 0),
            orderId: order.orderId,
            timestamp: new Date()
        });
        
    } catch (error) {
        logger.errorWithStack('Ошибка команды test-sell', error);
        await bot.sendMessage(msg.chat.id, `❌ Ошибка: ${error.message}`, { parse_mode: 'HTML' });
    }
});

// Команда получения рынков
bot.onText(/\/markets/, async (msg) => {
    if (!checkAuth(msg)) return;

    try {
        await bot.sendMessage(msg.chat.id, '🏪 Получаем список рынков...', { parse_mode: 'HTML' });
        
        const markets = await whiteBitAPI.getMarkets();
        
        // Фильтруем демо-рынки
        const demoMarkets = markets.filter(m => 
            m.name.includes('DBTC') || 
            m.name.includes('DETH') || 
            m.name.includes('DUSDT')
        );
        
        const marketsMessage = `
🏪 <b>ДОСТУПНЫЕ ДЕМО-РЫНКИ</b>

${demoMarkets.map(market => `
📊 <b>${market.name}</b>
💰 Базовая: ${market.stock}
💵 Котировочная: ${market.money}
📈 Торговля: ${market.tradesEnabled ? '✅' : '❌'}
📦 Мин. количество: ${market.minAmount}
💰 Мин. сумма: ${market.minTotal}
💸 Maker: ${market.makerFee} | Taker: ${market.takerFee}
`).join('\n')}

📊 <b>Всего рынков:</b> ${markets.length}
🎮 <b>Демо-рынков:</b> ${demoMarkets.length}
        `;
        
        await bot.sendMessage(msg.chat.id, marketsMessage, { parse_mode: 'HTML' });
        
    } catch (error) {
        logger.errorWithStack('Ошибка команды markets', error);
        await bot.sendMessage(msg.chat.id, `❌ Ошибка: ${error.message}`, { parse_mode: 'HTML' });
    }
});

// Обработка ошибок Telegram бота
bot.on('polling_error', (error) => {
    logger.errorWithStack('Telegram polling error', error);
});

// Обработка неизвестных команд
bot.on('message', (msg) => {
    if (!checkAuth(msg)) return;
    
    const text = msg.text;
    if (text && text.startsWith('/') && !text.match(/\/(help|status|pending|closeall|api-test|price|stats|risk|history|monitor|cleanup|backup|test-buy|test-sell|markets)/)) {
        bot.sendMessage(msg.chat.id, 
            '❓ Неизвестная команда. Используйте /help для списка доступных команд.', 
            { parse_mode: 'HTML' }
        );
    }
});

// ==============================================
// ПЕРИОДИЧЕСКИЕ ЗАДАЧИ
// ==============================================

// Мониторинг позиций каждые 30 секунд
const monitoringInterval = setInterval(async () => {
    try {
        await tradingEngine.monitorPositions();
    } catch (error) {
        logger.errorWithStack('Ошибка периодического мониторинга', error);
    }
}, 30000);

// Очистка просроченных сигналов каждые 5 минут
const cleanupInterval = setInterval(() => {
    try {
        tradingEngine.cleanupPendingSignals();
    } catch (error) {
        logger.errorWithStack('Ошибка очистки сигналов', error);
    }
}, 5 * 60 * 1000);

// Очистка старых логов каждый день
const logCleanupInterval = setInterval(() => {
    try {
        logger.cleanOldLogs();
    } catch (error) {
        logger.errorWithStack('Ошибка очистки логов', error);
    }
}, 24 * 60 * 60 * 1000);

// Автоматический бэкап каждые 6 часов
const backupInterval = setInterval(() => {
    try {
        const backupData = tradingEngine.exportData();
        const backupPath = path.join(__dirname, 'backup.json');
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
        logger.info('Автоматический бэкап создан', { 
            positions: backupData.activePositions.length,
            signals: backupData.pendingSignals.length,
            orders: backupData.orderHistory.length
        });
    } catch (error) {
        logger.errorWithStack('Ошибка автоматического бэкапа', error);
    }
}, 6 * 60 * 60 * 1000);

// ==============================================
// ЗАПУСК СЕРВЕРА
// ==============================================

const server = app.listen(CONFIG.PORT, async () => {
    logger.info(`🚀 Торговый бот запущен на порту ${CONFIG.PORT}`);
    logger.info(`📡 Webhook URL: http://your-domain.com/webhook`);
    logger.info(`🧪 Test Webhook URL: http://your-domain.com/test-webhook`);
    logger.info(`🏥 Health Check URL: http://your-domain.com/health`);
    
    // Отправляем стартовое сообщение
    try {
        await tradingEngine.sendTelegramMessage(`
🤖 <b>TRADING BOT ЗАПУЩЕН</b>

🔗 <b>Webhook:</b> Готов к приему сигналов
📊 <b>Стратегия:</b> ${CONFIG.STRATEGY.NAME}
💱 <b>Биржа:</b> WhiteBit (Демо-торговля)
⚙️ <b>Порт:</b> ${CONFIG.PORT}

🧪 <b>Команды для тестирования:</b>
• /api-test - Проверить API
• /test-buy - Тестовая покупка
• /status - Показать статус
• /help - Полная справка

📊 <b>Настройки риска:</b>
• Риск на сделку: ${CONFIG.TRADING.RISK_PERCENT}%
• Мин/Макс ордер: ${CONFIG.TRADING.MIN_ORDER_SIZE}-${CONFIG.TRADING.MAX_ORDER_SIZE}
• Timeout подтверждения: ${CONFIG.STRATEGY.CONFIRMATION_TIMEOUT / 1000}с

⚡ <b>Автоматические процессы:</b>
• Мониторинг позиций: каждые 30с
• Очистка сигналов: каждые 5мин
• Автобэкап: каждые 6ч

🎯 <b>Готов к работе!</b> Отправьте /help для списка команд.
        `);
    } catch (err) {
        logger.errorWithStack('Ошибка отправки стартового сообщения', err);
    }
});

// ==============================================
// ОБРАБОТКА ЗАВЕРШЕНИЯ РАБОТЫ
// ==============================================

const gracefulShutdown = async (signal) => {
    logger.info(`Получен сигнал ${signal}, завершаем работу...`);
    
    try {
        // Очищаем интервалы
        clearInterval(monitoringInterval);
        clearInterval(cleanupInterval);
        clearInterval(logCleanupInterval);
        clearInterval(backupInterval);
        
        // Отправляем уведомление в Telegram
        await tradingEngine.sendTelegramMessage(`🔴 Торговый бот останавливается (${signal})...`);
        
        // Экспортируем данные для бэкапа
        const backupData = tradingEngine.exportData();
        const backupPath = path.join(__dirname, 'backup.json');
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
        logger.info('Финальный бэкап создан', { backupPath });
        
        // Закрываем сервер
        server.close(() => {
            logger.info('HTTP сервер закрыт');
            
            // Останавливаем Telegram polling
            bot.stopPolling();
            logger.info('Telegram polling остановлен');
            
            // Завершаем процесс
            process.exit(0);
        });
        
        // Принудительное завершение через 10 секунд
        setTimeout(() => {
            logger.warn('Принудительное завершение через timeout');
            process.exit(1);
        }, 10000);
        
    } catch (error) {
        logger.errorWithStack('Ошибка при завершении работы', error);
        process.exit(1);
    }
};

// Обработчики сигналов завершения
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
    logger.errorWithStack('Необработанная ошибка', error);
    tradingEngine.sendTelegramMessage(`🚨 Критическая ошибка бота: ${error.message}`)
        .catch(() => {}) // Игнорируем ошибки отправки
        .finally(() => {
            process.exit(1);
        });
});

process.on('unhandledRejection', (reason, promise) => {
    logger.errorWithStack('Необработанное отклонение промиса', reason);
    tradingEngine.sendTelegramMessage(`🚨 Ошибка промиса: ${reason}`)
        .catch(() => {}) // Игнорируем ошибки отправки
});

// Обработка предупреждений Node.js
process.on('warning', (warning) => {
    logger.warn('Node.js warning', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
    });
});

// ==============================================
// ЭКСПОРТ ДЛЯ ТЕСТИРОВАНИЯ
// ==============================================

module.exports = { 
    app, 
    server,
    bot,
    tradingEngine, 
    whiteBitAPI, 
    riskManager,
    gracefulShutdown
};