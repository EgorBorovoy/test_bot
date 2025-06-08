// ==============================================
// RISK_MANAGEMENT.JS - УПРАВЛЕНИЕ РИСКАМИ И МАНИ-МЕНЕДЖМЕНТ
// ==============================================

const logger = require('./logger');
const { CONFIG } = require('./config');

class RiskManager {
    constructor(whiteBitAPI) {
        this.api = whiteBitAPI;
        this.maxDailyLoss = CONFIG.TRADING.MAX_DAILY_LOSS || 10; // % от баланса
        this.maxOpenPositions = CONFIG.TRADING.MAX_OPEN_POSITIONS || 5;
        this.dailyStats = {
            startBalance: 0,
            currentPnL: 0,
            tradesCount: 0,
            lastReset: new Date().toDateString()
        };
    }

    // Сброс дневной статистики
    resetDailyStats() {
        const today = new Date().toDateString();
        if (this.dailyStats.lastReset !== today) {
            this.dailyStats = {
                startBalance: 0,
                currentPnL: 0,
                tradesCount: 0,
                lastReset: today
            };
            logger.info('Дневная статистика сброшена');
        }
    }

    // Рассчитать размер позиции
    async calculatePositionSize(symbol, price, activePositionsCount = 0) {
        try {
            logger.info('💰 Начинаем расчет размера позиции', { symbol, price });
            
            // Получаем баланс
            const balance = await this.api.getBalance();
            
            // Определяем валюту для расчета (USDT или DUSDT для демо)
            const baseBalance = await this.getBaseBalance(balance);
            
            if (baseBalance <= 0) {
                throw new Error('Недостаточный баланс для торговли');
            }

            // Базовый расчет риска
            const riskAmount = (baseBalance * CONFIG.TRADING.RISK_PERCENT) / 100;
            
            // Применяем ограничения
            let positionSize = Math.min(
                Math.max(riskAmount, CONFIG.TRADING.MIN_ORDER_SIZE),
                CONFIG.TRADING.MAX_ORDER_SIZE
            );

            // Дополнительные проверки риск-менеджмента
            positionSize = await this.applyRiskLimits(positionSize, baseBalance, activePositionsCount);

            // Проверяем минимальные требования рынка
            const marketLimits = await this.api.getMarketLimits(symbol);
            if (positionSize < marketLimits.minTotal) {
                logger.warn('Размер позиции меньше минимального требования рынка', {
                    calculated: positionSize,
                    required: marketLimits.minTotal
                });
                positionSize = marketLimits.minTotal;
            }

            logger.info('📊 Размер позиции рассчитан', {
                baseBalance,
                riskPercent: CONFIG.TRADING.RISK_PERCENT,
                riskAmount,
                finalPositionSize: positionSize,
                marketLimits
            });

            return positionSize;
            
        } catch (error) {
            logger.errorWithStack('Ошибка расчета размера позиции', error, { symbol, price });
            return CONFIG.TRADING.MIN_ORDER_SIZE;
        }
    }

    // Получить базовый баланс (USDT/DUSDT)
    async getBaseBalance(balance) {
        let baseBalance = 0;
        let source = '';

        // Ищем USDT/DUSDT баланс
        if (balance.USDT?.available) {
            baseBalance = parseFloat(balance.USDT.available);
            source = 'USDT';
        } else if (balance.main?.USDT?.available) {
            baseBalance = parseFloat(balance.main.USDT.available);
            source = 'main.USDT';
        } else if (balance.DUSDT?.available) {
            baseBalance = parseFloat(balance.DUSDT.available);
            source = 'DUSDT';
        } else if (balance.main?.DUSDT?.available) {
            baseBalance = parseFloat(balance.main.DUSDT.available);
            source = 'main.DUSDT';
        }

        logger.info('💵 Базовый баланс найден', { baseBalance, source });
        return baseBalance;
    }

    // Применить ограничения риск-менеджмента
    async applyRiskLimits(positionSize, baseBalance, activePositionsCount) {
        // Проверка максимального количества открытых позиций
        if (activePositionsCount >= this.maxOpenPositions) {
            throw new Error(`Достигнуто максимальное количество открытых позиций: ${this.maxOpenPositions}`);
        }

        // Проверка дневных лимитов
        this.resetDailyStats();
        
        if (this.dailyStats.startBalance === 0) {
            this.dailyStats.startBalance = baseBalance;
        }

        // Проверка максимальных дневных потерь
        const currentLoss = ((this.dailyStats.startBalance - baseBalance) / this.dailyStats.startBalance) * 100;
        if (currentLoss >= this.maxDailyLoss) {
            throw new Error(`Достигнуты максимальные дневные потери: ${currentLoss.toFixed(2)}%`);
        }

        // Уменьшение размера позиции при больших потерях
        if (currentLoss > this.maxDailyLoss / 2) {
            positionSize *= 0.5; // Уменьшаем размер позиции вдвое
            logger.warn('Размер позиции уменьшен из-за текущих потерь', { currentLoss, newSize: positionSize });
        }

        // Ограничение по проценту от баланса на одну позицию
        const maxPerPosition = baseBalance * 0.1; // Максимум 10% баланса на позицию
        if (positionSize > maxPerPosition) {
            positionSize = maxPerPosition;
            logger.warn('Размер позиции ограничен 10% от баланса', { newSize: positionSize });
        }

        return positionSize;
    }

    // Проверить можно ли открыть позицию
    async canOpenPosition(symbol, price, activePositions) {
        try {
            // Базовые проверки
            const isMarketActive = await this.api.isMarketActive(symbol);
            if (!isMarketActive) {
                return { allowed: false, reason: 'Рынок неактивен' };
            }

            // Проверка лимитов
            const activeCount = activePositions.size;
            if (activeCount >= this.maxOpenPositions) {
                return { 
                    allowed: false, 
                    reason: `Достигнуто максимальное количество позиций: ${this.maxOpenPositions}` 
                };
            }

            // Проверка дневных лимитов
            this.resetDailyStats();
            
            const balance = await this.api.getBalance();
            const baseBalance = await this.getBaseBalance(balance);
            
            if (this.dailyStats.startBalance === 0) {
                this.dailyStats.startBalance = baseBalance;
            }

            const currentLoss = ((this.dailyStats.startBalance - baseBalance) / this.dailyStats.startBalance) * 100;
            if (currentLoss >= this.maxDailyLoss) {
                return { 
                    allowed: false, 
                    reason: `Достигнуты дневные лимиты потерь: ${currentLoss.toFixed(2)}%` 
                };
            }

            // Проверка минимального баланса
            if (baseBalance < CONFIG.TRADING.MIN_ORDER_SIZE) {
                return { 
                    allowed: false, 
                    reason: `Недостаточный баланс: ${baseBalance}` 
                };
            }

            return { allowed: true, reason: 'Все проверки пройдены' };
            
        } catch (error) {
            logger.errorWithStack('Ошибка проверки возможности открытия позиции', error, { symbol });
            return { allowed: false, reason: `Ошибка: ${error.message}` };
        }
    }

    // Рассчитать уровни Take Profit
    calculateTPLevels(entryPrice, side = 'long') {
        const levels = [];
        const basePercentages = [2, 4, 6]; // 2%, 4%, 6% прибыли
        
        basePercentages.forEach((percentage, index) => {
            const multiplier = side === 'long' ? (1 + percentage / 100) : (1 - percentage / 100);
            const price = entryPrice * multiplier;
            
            levels.push({
                level: index + 1,
                price: price,
                percentage: CONFIG.STRATEGY.TP_LEVELS[index]?.percentage || 25
            });
        });

        return levels;
    }

    // Рассчитать Stop Loss
    calculateStopLoss(entryPrice, side = 'long', slPercentage = 3) {
        const multiplier = side === 'long' ? (1 - slPercentage / 100) : (1 + slPercentage / 100);
        return entryPrice * multiplier;
    }

    // Обновить дневную статистику
    updateDailyStats(tradeResult) {
        this.resetDailyStats();
        
        this.dailyStats.tradesCount++;
        if (tradeResult.pnl) {
            this.dailyStats.currentPnL += tradeResult.pnl;
        }

        logger.info('Дневная статистика обновлена', this.dailyStats);
    }

    // Получить дневную статистику
    getDailyStats() {
        this.resetDailyStats();
        return { ...this.dailyStats };
    }

    // Проверить нужно ли закрыть позицию по риск-менеджменту
    shouldClosePosition(position, currentPrice) {
        const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        
        // Проверка Stop Loss
        const stopLossPrice = this.calculateStopLoss(position.entryPrice, position.side);
        if ((position.side === 'long' && currentPrice <= stopLossPrice) ||
            (position.side === 'short' && currentPrice >= stopLossPrice)) {
            return { 
                shouldClose: true, 
                reason: 'Stop Loss triggered',
                type: 'STOP_LOSS',
                pnl: pnlPercent
            };
        }

        // Проверка максимальных потерь по позиции
        const maxLossPercent = CONFIG.TRADING.MAX_LOSS_PER_POSITION || 5;
        if (pnlPercent <= -maxLossPercent) {
            return { 
                shouldClose: true, 
                reason: `Максимальные потери по позиции: ${pnlPercent.toFixed(2)}%`,
                type: 'MAX_LOSS',
                pnl: pnlPercent
            };
        }

        return { shouldClose: false };
    }

    // Валидация ордера перед отправкой
    async validateOrder(symbol, side, amount, price = null) {
        try {
            // Получаем лимиты рынка
            const limits = await this.api.getMarketLimits(symbol);
            
            const validationResult = {
                valid: true,
                errors: [],
                warnings: []
            };

            // Проверка минимального количества
            if (amount < limits.minAmount) {
                validationResult.valid = false;
                validationResult.errors.push(`Количество меньше минимального: ${amount} < ${limits.minAmount}`);
            }

            // Проверка минимальной суммы (для покупки)
            if (side === 'buy' && price) {
                const total = amount * price;
                if (total < limits.minTotal) {
                    validationResult.valid = false;
                    validationResult.errors.push(`Сумма ордера меньше минимальной: ${total} < ${limits.minTotal}`);
                }
            }

            // Проверка максимальной суммы
            if (side === 'buy' && price) {
                const total = amount * price;
                if (total > limits.maxTotal) {
                    validationResult.valid = false;
                    validationResult.errors.push(`Сумма ордера больше максимальной: ${total} > ${limits.maxTotal}`);
                }
            }

            // Проверка точности
            const amountDecimals = (amount.toString().split('.')[1] || '').length;
            if (amountDecimals > limits.stockPrec) {
                validationResult.warnings.push(`Точность количества превышена: ${amountDecimals} > ${limits.stockPrec}`);
            }

            if (price) {
                const priceDecimals = (price.toString().split('.')[1] || '').length;
                if (priceDecimals > limits.moneyPrec) {
                    validationResult.warnings.push(`Точность цены превышена: ${priceDecimals} > ${limits.moneyPrec}`);
                }
            }

            logger.info('Валидация ордера завершена', { symbol, side, amount, price, validationResult });
            return validationResult;
            
        } catch (error) {
            logger.errorWithStack('Ошибка валидации ордера', error, { symbol, side, amount, price });
            return {
                valid: false,
                errors: [`Ошибка валидации: ${error.message}`],
                warnings: []
            };
        }
    }

    // Рассчитать оптимальное количество для частичного закрытия
    calculatePartialCloseAmount(position, percentage) {
        const closeAmount = (position.quantity * percentage) / 100;
        
        // Округляем до нужной точности
        const precision = 8; // Стандартная точность для криптовалют
        return Math.floor(closeAmount * Math.pow(10, precision)) / Math.pow(10, precision);
    }

    // Получить рекомендации по управлению позицией
    getPositionManagementAdvice(position, currentPrice, marketData) {
        const advice = {
            action: 'HOLD',
            reasons: [],
            tpLevels: [],
            slLevel: null,
            riskLevel: 'LOW'
        };

        const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        
        // Рассчитываем уровни TP
        advice.tpLevels = this.calculateTPLevels(position.entryPrice, position.side);
        advice.slLevel = this.calculateStopLoss(position.entryPrice, position.side);

        // Определяем уровень риска
        if (pnlPercent <= -2) {
            advice.riskLevel = 'HIGH';
            advice.reasons.push(`Убыток ${pnlPercent.toFixed(2)}%`);
        } else if (pnlPercent <= -1) {
            advice.riskLevel = 'MEDIUM';
        }

        // Проверяем достижение TP уровней
        advice.tpLevels.forEach(tp => {
            const reached = position.side === 'long' ? 
                currentPrice >= tp.price : 
                currentPrice <= tp.price;
                
            if (reached) {
                advice.action = 'PARTIAL_CLOSE';
                advice.reasons.push(`Достигнут TP${tp.level} уровень`);
            }
        });

        // Проверяем SL
        const slTriggered = position.side === 'long' ? 
            currentPrice <= advice.slLevel : 
            currentPrice >= advice.slLevel;
            
        if (slTriggered) {
            advice.action = 'CLOSE';
            advice.riskLevel = 'CRITICAL';
            advice.reasons.push('Сработал Stop Loss');
        }

        return advice;
    }

    // Получить общий отчет по рискам
    async getRiskReport(activePositions) {
        const balance = await this.api.getBalance();
        const baseBalance = await this.getBaseBalance(balance);
        
        this.resetDailyStats();
        if (this.dailyStats.startBalance === 0) {
            this.dailyStats.startBalance = baseBalance;
        }

        const report = {
            balance: {
                current: baseBalance,
                start: this.dailyStats.startBalance,
                change: baseBalance - this.dailyStats.startBalance,
                changePercent: ((baseBalance - this.dailyStats.startBalance) / this.dailyStats.startBalance) * 100
            },
            positions: {
                count: activePositions.size,
                maxAllowed: this.maxOpenPositions,
                utilizationPercent: (activePositions.size / this.maxOpenPositions) * 100
            },
            dailyLimits: {
                maxLossPercent: this.maxDailyLoss,
                currentLossPercent: ((this.dailyStats.startBalance - baseBalance) / this.dailyStats.startBalance) * 100,
                tradesCount: this.dailyStats.tradesCount
            },
            recommendations: []
        };

        // Добавляем рекомендации
        if (report.positions.utilizationPercent > 80) {
            report.recommendations.push('REDUCE_POSITIONS - Много открытых позиций');
        }
        
        if (report.dailyLimits.currentLossPercent > this.maxDailyLoss / 2) {
            report.recommendations.push('REDUCE_RISK - Приближение к дневным лимитам');
        }
        
        if (report.balance.changePercent < -5) {
            report.recommendations.push('REVIEW_STRATEGY - Значительные потери');
        }

        return report;
    }
}

module.exports = RiskManager;