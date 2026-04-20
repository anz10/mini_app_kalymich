# Telegram Mini App Monorepo

## Structure

- `apps/web` - minimal web entrypoint for the future Telegram Mini App UI
- `apps/api` - minimal HTTP API service
- `apps/bot` - minimal Telegram bot process scaffold
- `packages/shared` - shared TypeScript package scaffold
- `prisma` - Prisma schema location
- `docs` - project documentation

## Quick start

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Prepare environment:

   ```bash
   copy .env.example .env
   pnpm prisma:generate
   pnpm prisma:push
   ```

3. Start all applications:

   ```bash
   pnpm dev
   ```

4. Or run services individually:

   ```bash
   pnpm dev:web
    pnpm dev:api
    pnpm dev:bot
    ```

## Default ports

- `apps/web`: `3000`
- `apps/api`: `3001`
- `apps/bot`: `3002`

## Minimal auth flow

- `apps/web` renders a small Telegram auth page
- `apps/api` exposes `POST /auth/telegram`, `GET /auth/session`, and `POST /auth/logout`
- API creates or updates users by `telegramId`
- Session state is stored in an `httpOnly` cookie and mirrored in the web app `sessionStorage`
- If `TELEGRAM_BOT_TOKEN` is set, `initData` signature validation is applied for Telegram Mini App requests
