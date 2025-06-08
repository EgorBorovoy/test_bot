# Testing the Webhook Endpoint

This project exposes a `/test-webhook` endpoint for verifying that the bot can receive webhook events and send a confirmation message to Telegram.

## Sending a Request

Use `curl` or a similar tool to POST a JSON payload. Include your `X-Secret` header that matches `WEBHOOK_SECRET` from your environment variables.

```bash
curl -X POST http://localhost:3000/test-webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Secret: <WEBHOOK_SECRET>' \
  -d '{"message":"ping"}'
```

## Expected Bot Response

The HTTP response will be:

```json
{"status":"ok"}
```

Shortly after, the bot sends a Telegram message to the configured chat:

```
✅ Получен тестовый webhook: ping
```

Replace `ping` in the payload with any text to customize the confirmation message.
