# Habit Timer Cloudflare Companion

The Companion keeps Telegram timers, habit actions, reminders, and reports working while Obsidian is closed. Obsidian remains the owner of Markdown files; the Worker stores events in D1 and the plugin applies them during synchronization.

## Architecture

- Telegram sends updates to `POST /telegram` using a secret webhook header.
- D1 stores configuration, current values, active timers, and an append-only event queue.
- Cron runs every minute to complete target timers and send scheduled reports.
- Obsidian pulls events first, applies each event once, then pushes a fresh 120-day snapshot.
- `COMPANION_API_TOKEN` protects every synchronization and setup endpoint.

## Deploy

Run these commands from this directory:

```powershell
npm install
npx wrangler login
npx wrangler d1 create habit-timer-companion
```

Copy the returned database ID into `wrangler.jsonc`, replacing `REPLACE_AFTER_D1_CREATE`, then run:

```powershell
npm run db:remote
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put COMPANION_API_TOKEN
npm run deploy
```

Use three different values:

- `TELEGRAM_BOT_TOKEN`: token received from BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: random webhook verification string, 32 or more characters.
- `COMPANION_API_TOKEN`: random synchronization key, 32 or more characters.

Do not put these values in `wrangler.jsonc` or commit them.

## Connect Obsidian

1. Open Habit Timer settings and select `Cloudflare Companion` as the Telegram mode.
2. Enter the deployed `https://...workers.dev` URL.
3. Enter the same `COMPANION_API_TOKEN` in the synchronization key field.
4. Send any message to the Telegram bot.
5. Press `Get Chat ID` in Obsidian.
6. Press `Synchronize` to upload habit configuration and history.
7. Press `Configure webhook`.
8. Send `/menu` to the bot.

## Telegram Mini App

Running `/api/setup` also installs an `Приложение` menu button in the Telegram chat. It opens the mobile control center at `/app` with four screens: Today, Timer, Library, and Statistics.

The Mini App uses Telegram `initData` as its session credential. The Worker validates its HMAC signature, rejects sessions older than 24 hours, and checks that the Telegram user matches the configured private chat. The page itself never receives the bot token or the Companion API token.

Timer and library actions made in the Mini App use the same D1 event queue as bot commands. They are therefore applied to Markdown files during the next Obsidian synchronization.

The Worker health endpoint is public and contains no private data:

```text
GET /health
```

All `/api/*` endpoints require `Authorization: Bearer <COMPANION_API_TOKEN>`.

## Telegram library

The plugin synchronizes library frontmatter only when its content changes. Obsidian remains the source of truth, and Telegram changes are returned to the original Markdown file through the event queue.

- `/library` opens collections with pagination.
- `/reading` shows current media.
- `/search <text>` searches titles, authors, genres, and series.
- `/addmedia` starts a guided media creation flow and queues a Markdown note for Obsidian.
- `/editmedia <text>` finds an item and opens its property editor.
- `/capture` saves a thought, link, idea, task, or quote into a dedicated daily-note section.
- Item cards can add progress, start an item, or mark it finished.

The creation flow collects collection, title, authors, genres, series, part number, book format, total, optional external cover URL, and status. Authors and genres are written as YAML lists. The plugin uses the configured collection folder and template when it applies the queued event.

Library cards support exact and signed progress, audiobook durations, season/episode values, session notes, linked habit timers, author and series pages, collection moves, and confirmed deletion. Progress changes are appended to the media note's `Progress` table.

D1 never stores image bytes or base64 data. Only external `http://` or `https://` cover URLs are synchronized; local Obsidian attachments are omitted. Telegram downloads an external cover directly and handles its own media cache.

## Planning and weekly review

- `/plan` immediately shows every unfinished habit, current book or course, active project task, and carried-over task for today.
- `/week` sends a PNG overview with a 14-day habit map, streaks, habit time, pages read, completed media and tasks, the main achievement, and comparison with the previous week.
- When weekly notifications are enabled, the PNG overview is sent automatically on Sunday at the configured evening time.

Project task metadata is synchronized only when it changes. Markdown files remain in Obsidian; D1 stores the compact task index needed to prepare plans and reports while Obsidian is closed.

## Local development

```powershell
npm run db:local
npm run dev
```

Wrangler reads local secrets from `.dev.vars`. That file is ignored and must never be committed.
