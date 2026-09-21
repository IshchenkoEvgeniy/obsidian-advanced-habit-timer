import { createServer } from 'node:http';
import { build } from 'esbuild';

// Local fixture server: no production credentials, database, or Telegram requests.
const bundled = await build({ entryPoints: ['src/webapp.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { webAppHtml } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const date = '2026-09-05';
const library = [
  { id: 1, title: 'Четыре тысячи недель', authors: ['Оливер Беркман'], collection: 'book', status: 'Чтение', progress: 52, total: 273, unit: 'pages', cover: 'https://covers.openlibrary.org/b/isbn/9780374159122-L.jpg' },
  { id: 2, title: 'Титановый плейлист', authors: ['Александр Бебрис'], collection: 'course', status: 'Изучаю', progress: 12, total: 300, unit: 'lessons', cover: '' },
  { id: 3, title: 'Атомные привычки', authors: ['Джеймс Клир'], collection: 'book', status: 'В планах', progress: 0, total: 320, unit: 'pages', cover: 'https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg' }
];
const habits = ['Habit-Read', 'Habit-English', 'Habit-Programming'].map((name, index) => ({
  name, type: 'timer', mediaCollections: index === 0 ? ['book'] : ['course'],
  today: { value: [600, 1200, 3000][index], desired: [900, 3600, 7200][index], state: 'partial' },
  streak: [7, 12, 4][index], rate: [86, 72, 65][index],
  days: Array.from({ length: 14 }, (_, day) => ({ date: `2026-08-${String(18 + day).padStart(2, '0')}`, state: day % 6 === index ? 'missed' : day % 4 === index ? 'partial' : 'completed', value: 1200 }))
}));
let timer = null;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/app/api/state') {
    res.setHeader('Content-Type', 'application/json');
    const selected = library.filter(item => (!url.searchParams.get('collection') || item.collection === url.searchParams.get('collection')) && (!url.searchParams.get('q') || item.title.includes(url.searchParams.get('q'))));
    res.end(JSON.stringify({ date, habits, current: library.slice(0, 2), library: selected,
      timer, goals: [{ collection: 'book', value: 7, goal: 10, unit: 'pages' }, { collection: 'course', value: 1, goal: 2, unit: 'lessons' }],
      collections: [{ collection_id: 'book', item_count: 2 }, { collection_id: 'course', item_count: 1 }],
      tasks: [{ name: 'Подготовить план следующего этапа', project: 'Личный проект', deadline: date }]
    }));
  } else if (url.pathname === '/app/api/create-options') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ collections: ['book', 'course', 'manga', 'film', 'anime', 'series', 'game'],
      authors: ['Оливер Беркман', 'Джеймс Клир'], genres: ['Саморазвитие', 'Роман'], series: ['Война роз'], recent: [] }));
  } else if (req.method === 'POST' && url.pathname.startsWith('/app/api/')) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (body.action === 'start') timer = { habit_name: body.habit, elapsed: 83, timer_state: 'running', target_seconds: body.minutes * 60, media: library.find(item => item.id === body.mediaId) };
    if (body.action === 'pause' && timer) timer.timer_state = 'paused';
    if (body.action === 'resume' && timer) timer.timer_state = 'running';
    if (body.action === 'finish') timer = null;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }));
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(webAppHtml());
  }
});
const port=Number(process.env.PORT)||8791;
server.listen(port, '127.0.0.1', () => console.log(`Mini App preview: http://127.0.0.1:${port}/app`));
