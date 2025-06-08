# WhiteBit Trading Bot

A simple trading bot that integrates with WhiteBit and Telegram.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file with your Telegram and WhiteBit credentials.
3. Start the bot:
   ```bash
   npm start
   ```

## Testing Webhook Integration

The bot includes a `/test-webhook` route to verify that webhook calls are correctly received.
See [docs/test-webhook.md](docs/test-webhook.md) for details on how to send a sample payload and check the confirmation message.
