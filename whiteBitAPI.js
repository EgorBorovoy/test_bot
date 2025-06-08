// ==============================================
// WHITBIT_API.JS - ПОДКЛЮЧЕНИЕ К БИРЖЕ
// ==============================================

const axios = require('axios');
const crypto = require('crypto');
const logger = require('./logger');

class WhiteBitAPI {
    constructor(apiKey, secretKey, baseURL = 'https://whitebit.com') {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.baseURL = baseURL;
        
        // Счетчики для мониторинга API
        this.requestCount = 0;
        this.errorCount = 0;
        this.lastRequestTime = null;
    }

    // Создание подписи для WhiteBit API v4
    createSignature(data) {
        const payload = Buffer.from(JSON.stringify(data)).toString('base64');
        const signature = crypto
            .createHmac('sha512', this.secretKey)
            .update(payload)
            .digest('hex');
        
        return { signature, payload };
    }

    // Приватный запрос к API v4
    async privateRequest(endpoint, data = {}) {
        this.requestCount++;
        this.lastRequestTime = new Date();
        
        const requestData = {
            request: endpoint,
            nonce: Date.now(),
            ...data
        };

        const { signature, payload } = this.createSignature(requestData);

        const headers = {
            'X-TXC-APIKEY': this.apiKey,
            'X-TXC-PAYLOAD': payload,
            'X-TXC-SIGNATURE': signature,
            'Content-Type': 'application/json'
        };

        try {
            logger.api(endpoint, 'POST', requestData);
            
            const response = await axios({
                method: 'POST',
                url: `${this.baseURL}${endpoint}`,
                headers,
                data: requestData,
                timeout: 10000 // 10 секунд таймаут
            });
            
            logger.api(endpoint, 'POST', requestData, response);
            return response.data;
        } catch (error) {
            this.errorCount++;
            logger.errorWithStack('WhiteBit Private API Error', error, {
                endpoint,
                requestData
            });
            throw error;
        }
    }

    // Публичный запрос к API v4
    async publicRequest(endpoint) {
        this.requestCount++;
        this.lastRequestTime = new Date();
        
        try {
            logger.api(endpoint, 'GET');
            
            const response = await axios.get(`${this.baseURL}/api/v4/public${endpoint}`, {
                timeout: 5000 // 5 секунд таймаут для публичных запросов
            });
            
            logger.api(endpoint, 'GET', null, response);
            return response.data;
        } catch (error) {
            this.errorCount++;
            logger.errorWithStack('WhiteBit Public API Error', error, { endpoint });
            throw error;
        }
    }

    // ==============================================
    // МЕТОДЫ ДЛЯ РАБОТЫ С БАЛАНСОМ
    // ==============================================

    // Получить баланс
    async getBalance() {
        return await this.privateRequest('/api/v4/trade-account/balance');
    }

    // Получить баланс конкретной валюты
    async getCurrencyBalance(currency) {
        const balance = await this.getBalance();
        
        // Ищем валюту в разных возможных местах
        if (balance[currency]) {
            return balance[currency];
        } else if (balance.main?.[currency]) {
            return balance.main[currency];
        }
        
        return { available: "0", freeze: "0" };
    }

    // ==============================================
    // МЕТОДЫ ДЛЯ ПОЛУЧЕНИЯ РЫНОЧНЫХ ДАННЫХ
    // ==============================================

    // Получить тикер
    async getTicker(symbol) {
        const tickers = await this.publicRequest('/ticker');
        
        if (!tickers[symbol]) {
            throw new Error(`Тикер ${symbol} не найден`);
        }
        
        return {
            last: tickers[symbol].last_price,
            vol: tickers[symbol].base_volume,
            change: tickers[symbol].change,
            high: tickers[symbol].quote_volume,
            low: tickers[symbol].base_volume,
            raw: tickers[symbol] // Сырые данные
        };
    }

    // Получить все тикеры
    async getAllTickers() {
        return await this.publicRequest('/ticker');
    }

    // Получить информацию о рынках
    async getMarkets() {
        return await this.publicRequest('/markets');
    }

    // Получить orderbook
    async getOrderbook(symbol, limit = 10) {
        return await this.publicRequest(`/orderbook/${symbol}?limit=${limit}`);
    }

    // Получить недавние сделки
    async getRecentTrades(symbol, type = null) {
        const endpoint = type ? `/trades/${symbol}?type=${type}` : `/trades/${symbol}`;
        return await this.publicRequest(endpoint);
    }

    // ==============================================
    // ТОРГОВЫЕ МЕТОДЫ
    // ==============================================

    // Создать рыночный ордер на покупку (указываем сумму в USDT)
    async createMarketBuyOrder(symbol, amountInUSDT) {
        const orderData = {
            market: symbol,
            side: 'buy',
            amount: amountInUSDT.toString()
        };
        
        logger.trade('MARKET_BUY_REQUEST', symbol, orderData);
        
        const result = await this.privateRequest('/api/v4/order/market', orderData);
        
        logger.trade('MARKET_BUY_RESPONSE', symbol, result);
        return result;
    }

    // Создать рыночный ордер на продажу (указываем количество криптовалюты)
    async createMarketSellOrder(symbol, amountInStock) {
        const orderData = {
            market: symbol,
            side: 'sell',
            amount: amountInStock.toString()
        };
        
        logger.trade('MARKET_SELL_REQUEST', symbol, orderData);
        
        const result = await this.privateRequest('/api/v4/order/market', orderData);
        
        logger.trade('MARKET_SELL_RESPONSE', symbol, result);
        return result;
    }

    // Создать лимитный ордер
    async createLimitOrder(symbol, side, amount, price) {
        const orderData = {
            market: symbol,
            side: side,
            amount: amount.toString(),
            price: price.toString()
        };
        
        logger.trade('LIMIT_ORDER_REQUEST', symbol, orderData);
        
        const result = await this.privateRequest('/api/v4/order/new', orderData);
        
        logger.trade('LIMIT_ORDER_RESPONSE', symbol, result);
        return result;
    }

    // Отменить ордер
    async cancelOrder(orderId, symbol) {
        const cancelData = {
            market: symbol,
            orderId: orderId
        };
        
        logger.trade('CANCEL_ORDER_REQUEST', symbol, cancelData);
        
        const result = await this.privateRequest('/api/v4/order/cancel', cancelData);
        
        logger.trade('CANCEL_ORDER_RESPONSE', symbol, result);
        return result;
    }

    // Получить активные ордера
    async getActiveOrders(symbol) {
        return await this.privateRequest('/api/v4/orders', { market: symbol });
    }

    // Получить историю ордеров
    async getOrderHistory(symbol, limit = 50, offset = 0) {
        return await this.privateRequest('/api/v4/trade-account/order/history', {
            market: symbol,
            limit,
            offset
        });
    }

    // ==============================================
    // СЛУЖЕБНЫЕ МЕТОДЫ
    // ==============================================

    // Проверить статус сервера
    async ping() {
        return await this.publicRequest('/ping');
    }

    // Получить время сервера
    async getServerTime() {
        return await this.publicRequest('/time');
    }

    // Проверить доступность рынка
    async isMarketActive(symbol) {
        try {
            const markets = await this.getMarkets();
            const market = markets.find(m => m.name === symbol);
            return market ? market.tradesEnabled : false;
        } catch (error) {
            logger.error('Ошибка проверки активности рынка', { symbol, error: error.message });
            return false;
        }
    }

    // Получить минимальные требования для ордера
    async getMarketLimits(symbol) {
        try {
            const markets = await this.getMarkets();
            const market = markets.find(m => m.name === symbol);
            
            if (!market) {
                throw new Error(`Рынок ${symbol} не найден`);
            }
            
            return {
                minAmount: parseFloat(market.minAmount),
                minTotal: parseFloat(market.minTotal),
                maxTotal: parseFloat(market.maxTotal),
                makerFee: parseFloat(market.makerFee),
                takerFee: parseFloat(market.takerFee),
                stockPrec: parseInt(market.stockPrec),
                moneyPrec: parseInt(market.moneyPrec)
            };
        } catch (error) {
            logger.error('Ошибка получения лимитов рынка', { symbol, error: error.message });
            throw error;
        }
    }

    // Получить статистику API вызовов
    getAPIStats() {
        return {
            requestCount: this.requestCount,
            errorCount: this.errorCount,
            errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount * 100).toFixed(2) + '%' : '0%',
            lastRequestTime: this.lastRequestTime
        };
    }

    // Проверить подключение к API
    async testConnection() {
        try {
            // Тест публичного API
            const ping = await this.ping();
            const serverTime = await this.getServerTime();
            
            // Тест приватного API
            const balance = await this.getBalance();
            
            return {
                success: true,
                publicAPI: { ping, serverTime },
                privateAPI: { balanceKeys: Object.keys(balance) },
                stats: this.getAPIStats()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                stats: this.getAPIStats()
            };
        }
    }
}

module.exports = WhiteBitAPI;