// ==============================================
// CONFIG.JS - КОНФИГУРАЦИЯ И НАСТРОЙКИ
// ==============================================

require('dotenv').config();

const CONFIG = {
    // Telegram Bot
    TELEGRAM_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    
    // WhiteBit API
    WHITEBIT_API_KEY: process.env.WHITEBIT_API_KEY,
    WHITEBIT_SECRET_KEY: process.env.WHITEBIT_SECRET_KEY,
    WHITEBIT_BASE_URL: 'https://whitebit.com',
    
    // Настройки торговли
    TRADING: {
        RISK_PERCENT: parseFloat(process.env.RISK_PERCENT) || 2,
        MIN_ORDER_SIZE: parseFloat(process.env.MIN_ORDER_SIZE) || 10,
        MAX_ORDER_SIZE: parseFloat(process.env.MAX_ORDER_SIZE) || 1000,
        SLIPPAGE: parseFloat(process.env.SLIPPAGE) || 0.1,
    },
    
    // Webhook настройки
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    PORT: process.env.PORT || 3000,

    // Настройки стратегии
    STRATEGY: {
        NAME: 'EMA Ribbon v2',
        TP_LEVELS: [
            { level: 1, percentage: 25 },
            { level: 2, percentage: 25 },
            { level: 3, percentage: 25 },
            // Остальные 25% остаются до полного закрытия
        ],
        CONFIRMATION_TIMEOUT: 5 * 60 * 1000, // 5 минут
    },

    // Конвертация символов
    SYMBOL_MAPPING: {
        'BTCUSDT': 'DBTC_DUSDT',
        'BTC': 'DBTC_DUSDT',
        'ETHUSDT': 'DETH_DUSDT', 
        'ETH': 'DETH_DUSDT',
    }
};

// Проверка обязательных переменных окружения
function validateConfig() {
    const requiredEnvVars = [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_CHAT_ID', 
        'WHITEBIT_API_KEY',
        'WHITEBIT_SECRET_KEY',
        'WEBHOOK_SECRET'
    ];

    const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingVars.length > 0) {
        console.error(`❌ Отсутствуют обязательные переменные окружения: ${missingVars.join(', ')}`);
        process.exit(1);
    }

    console.log('✅ Конфигурация валидна');
    return true;
}

// Конвертация символа из TradingView в WhiteBit формат
function convertSymbol(tvSymbol) {
    // Проверяем прямое соответствие
    if (CONFIG.SYMBOL_MAPPING[tvSymbol]) {
        return CONFIG.SYMBOL_MAPPING[tvSymbol];
    }

    // Проверяем частичные соответствия
    for (const [key, value] of Object.entries(CONFIG.SYMBOL_MAPPING)) {
        if (tvSymbol.includes(key)) {
            return value;
        }
    }
    
    // Обычная конвертация для других пар
    if (tvSymbol.includes('USDT')) {
        return tvSymbol.replace('USDT', '_USDT');
    }
    if (tvSymbol.includes('BTC') && !tvSymbol.includes('_')) {
        return tvSymbol.replace('BTC', 'BTC_');
    }
    if (tvSymbol.includes('ETH') && !tvSymbol.includes('_')) {
        return tvSymbol.replace('ETH', 'ETH_');
    }
    
    return tvSymbol;
}

module.exports = {
    CONFIG,
    validateConfig,
    convertSymbol
};