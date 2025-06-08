require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: true});

console.log('🤖 Тестовый бот запущен');

bot.on('message', (msg) => {
    console.log('📨 Получено сообщение:', msg.text, 'от:', msg.chat.id);
    
    if (msg.text === '/test') {
        bot.sendMessage(msg.chat.id, '✅ Тест успешен!');
    }
});

bot.on('polling_error', (error) => {
    console.log('❌ Ошибка polling:', error);
});