# Advanced Habit Timer & Stats

Плагин для [Obsidian](https://obsidian.md): фокус-таймер и трекер привычек с задачами, проектами, медиа-библиотекой, статистикой, Telegram-ботом и опциональным облачным компаньоном на Cloudflare.

English summary below ↓

## Возможности

- **⏱ Таймер и привычки** — секундомер и Pomodoro, цели по привычкам, музыкальный плеер для фокус-сессий, сохранение и восстановление сессий.
- **✅ Задания** — ежедневное планирование задач, повторяющиеся задачи, реестр выполненных в ежедневных заметках, перенос незавершённых.
- **📋 Проекты** — доска (kanban), таблица, календарь и canvas-доска; подзадачи, метрики дашборда, экспорт в Obsidian Canvas.
- **📚 Библиотека** — трекинг медиа (книги, манга и свои коллекции): прогресс, рейтинги, серии, цели на год, темп чтения, таймлайн.
- **📊 Статистика** — тепловые карты за год, стрики, детальная аналитика, геймификация (достижения и уровни).
- **🧩 Виджеты** — дашборд с виджетами: стрик, живой таймер, тепловая карта, сводка статистики, мини-бейдж, глобальная цель.
- **🗂 Рабочая область** — единая навигация между разделами: Обзор, Таймер, Задания, Проекты, Библиотека, Статистика, Виджеты.
- **💬 Telegram** — бот с живыми уведомлениями таймера, утренним планом и вечерней сводкой, недельным отчётом, управлением таймером из чата и Mini WebApp.
- **☁️ Cloudflare-компаньон** (опционально) — синхронизация задач и библиотеки через Workers + D1, обложки в R2, веб-приложение с авторизацией через Telegram.
- **🗓 Ежедневные заметки** — лог сессий и задач в ваших daily notes.
- **🌐 Интерфейс** — русский и английский, светлая/тёмная темы.

## Команды плагина

- **Focus Library** — открыть главное окно рабочей области (иконка «слои» на ленте).
- **Задания** — открыть раздел задач.
- **Telegram: Sync Cloudflare companion** / **Configure Cloudflare webhook**.
- **Telegram: Send Morning Plan Briefing** / **Send Evening Summary Report**.
- **Update Daily Note Project Log**, **Migrate Media Frontmatter (Legacy to New)**.

## Установка (из исходников)

```bash
npm install
npm run build
```

Скопируйте `main.js`, `manifest.json`, `styles.css` в `<хранилище>/.obsidian/plugins/obsidian-advanced-habit-timer/` и включите плагин в настройках Obsidian.

Для разработки: `npm run dev` (esbuild в режиме наблюдения), тесты — `npm test`, линт — `npm run lint`.

## Cloudflare-компаньон

Отдельное приложение в [`cloudflare-companion/`](./cloudflare-companion): Workers + D1 + R2, разворачивается через `wrangler`. Подробности в его [README](./cloudflare-companion/README.md).

## Безопасность

Токен Telegram-бота и токен Cloudflare хранятся в `data.json` внутри хранилища — это стандартное место настроек плагинов Obsidian, но учитывайте это при использовании сторонних сервисов синхронизации. Ключи не попадают в репозиторий (`data.json` в `.gitignore`).

## English (summary)

Obsidian plugin: focus timer (stopwatch/Pomodoro) with habit tracking, daily tasks, projects (kanban/table/calendar/canvas), media library with reading goals, statistics with heatmaps and gamification, a dashboard of widgets, Telegram bot with briefings and a Mini WebApp, and an optional Cloudflare Workers companion for sync. Russian/English UI.

## Лицензия

[0-BSD](./LICENSE)