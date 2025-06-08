// ==============================================
// LOGGER.JS - СИСТЕМА ЛОГИРОВАНИЯ
// ==============================================

const fs = require('fs');
const path = require('path');

// Создаем директорию для логов если не существует
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Форматирование временной метки
function getTimestamp() {
    return new Date().toISOString();
}

// Получение имени файла лога по дате
function getLogFileName(type = 'app') {
    const date = new Date().toISOString().split('T')[0];
    return path.join(logsDir, `${type}-${date}.log`);
}

// Основная функция логирования
function log(level, message, data = null, logType = 'app') {
    const timestamp = getTimestamp();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    let fullMessage = logMessage;
    if (data) {
        fullMessage += `\nData: ${JSON.stringify(data, null, 2)}`;
    }
    
    // Логируем в консоль
    console.log(fullMessage);
    
    // Логируем в файл
    try {
        fs.appendFileSync(getLogFileName(logType), fullMessage + '\n');
    } catch (error) {
        console.error('Ошибка записи в лог файл:', error);
    }
}

// Специальное логирование для торговых операций
function logTrade(action, symbol, data) {
    const tradeLog = {
        timestamp: getTimestamp(),
        action,
        symbol,
        ...data
    };
    
    log('trade', `${action} ${symbol}`, tradeLog, 'trades');
}

// Специальное логирование для API вызовов
function logAPI(endpoint, method, data, response) {
    const apiLog = {
        timestamp: getTimestamp(),
        endpoint,
        method,
        request: data,
        response: response ? {
            status: response.status || 'unknown',
            data: response.data || response
        } : null
    };
    
    log('api', `${method} ${endpoint}`, apiLog, 'api');
}

// Логирование ошибок с полным стеком
function logError(message, error, context = {}) {
    const errorLog = {
        message,
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack
        },
        context,
        timestamp: getTimestamp()
    };
    
    log('error', message, errorLog, 'errors');
}

// Основные функции логирования
const logger = {
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
    debug: (msg, data) => log('debug', msg, data),
    
    // Специализированные логгеры
    trade: logTrade,
    api: logAPI,
    errorWithStack: logError,
    
    // Очистка старых логов (старше 7 дней)
    cleanOldLogs: () => {
        try {
            const files = fs.readdirSync(logsDir);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 7);
            
            files.forEach(file => {
                const filePath = path.join(logsDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime < cutoffDate) {
                    fs.unlinkSync(filePath);
                    console.log(`Удален старый лог файл: ${file}`);
                }
            });
        } catch (error) {
            console.error('Ошибка очистки логов:', error);
        }
    },

    // Получение статистики логов
    getLogStats: () => {
        try {
            const files = fs.readdirSync(logsDir);
            const stats = {
                totalFiles: files.length,
                files: files.map(file => {
                    const filePath = path.join(logsDir, file);
                    const fileStats = fs.statSync(filePath);
                    return {
                        name: file,
                        size: fileStats.size,
                        created: fileStats.birthtime,
                        modified: fileStats.mtime
                    };
                })
            };
            return stats;
        } catch (error) {
            console.error('Ошибка получения статистики логов:', error);
            return null;
        }
    }
};

// Очистка старых логов при старте
logger.cleanOldLogs();

module.exports = logger;