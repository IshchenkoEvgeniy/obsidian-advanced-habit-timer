import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url), { chromium } = require(process.env.DESIGN_PLAYWRIGHT_DIR || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true }), report = [], errors = [];
let page;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=';
const card = (id, values = {}) => ({ id, kind: 'sticky', x: 60, y: 90, w: 220, h: 100, z: 5, color: '#fff1b8', text: id, ...values });
function check(value, message) { if (!value) throw new Error(message); }
await mkdir('tests/browser/design-results', { recursive: true });
try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => errors.push(String(error)));
    await page.goto('http://127.0.0.1:4180'); await page.waitForSelector('[data-item="e0"]');
    await page.locator('.design-header').getByRole('button', { name: 'Новая доска', exact: true }).click();
    await page.locator('.fixture-overlay').getByRole('textbox', { name: 'Новая доска', exact: true }).fill('Milanote QA');
    await page.locator('.fixture-overlay').getByRole('button', { name: 'Сохранить', exact: true }).click();
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify([...window.designFixture.sessions.values()].find(session => session.board.name === 'Milanote QA').board)));
    const reset = async (items = [], edges = []) => { await page.evaluate(({ items, edges }) => { const s = [...window.designFixture.sessions.values()].find(session => session.board.name === 'Milanote QA'); s.checkpoint(); s.board = { ...s.board, items, edges, viewport: { x: 0, y: 0, zoom: 1 }, trash: [], readOnly: false }; s.touch(); }, { items, edges }); await page.waitForTimeout(100); };
    const flush = () => page.evaluate(async () => { const s = [...window.designFixture.sessions.values()].find(session => session.board.name === 'Milanote QA'); await s.flush(); });
    const canvas = page.locator('.design-canvas');
    async function drag(id, point, preview) { const rect = await canvas.boundingBox(), item = await page.locator(`[data-item="${id}"]`).boundingBox(); await page.mouse.move(item.x + 25, item.y + 25); await page.mouse.down(); await page.mouse.move(rect.x + point.x, rect.y + point.y, { steps: 16 }); if (preview) await preview(); await page.mouse.up(); await page.waitForTimeout(100); }
    check(await page.locator('.design-palette button[data-tool="board"]').isVisible(), 'Board creation is absent from the primary palette');
    await page.locator('.design-palette button[data-tool="board"]').click();
    await page.locator('.fixture-overlay').getByRole('textbox', { name: 'Новая доска', exact: true }).fill('Дочерняя доска');
    await page.locator('.fixture-overlay').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForSelector('.design-nested-board'); const nested = (await state()).items.find(item => item.kind === 'board');
    check(await page.locator('.design-nested-caption').innerText().then(text => text.includes('Дочерняя доска')), 'Nested board lacks its name');
    report.push('PASS Board palette creates a new nested board with a cover tile, name, count and open action');

    await reset([card('col', { kind: 'frame', column: true, columnManaged: true, title: 'Референсы', text: '', x: 60, y: 60, w: 310, h: 350, z: -1 }), card('first', { columnId: 'col', columnOrder: 0, x: 76, y: 120, w: 278 }), card('second', { columnId: 'col', columnOrder: 1, x: 76, y: 232, w: 278 }), card('loose', { x: 520, y: 100 })]);
    await drag('loose', { x: 160, y: 225 }, async () => check(await page.locator('.design-column-insertion').isVisible(), 'Column has no insertion preview'));
    let board = await state(), first = board.items.find(item => item.id === 'first'), loose = board.items.find(item => item.id === 'loose'), second = board.items.find(item => item.id === 'second');
    check(loose.columnId === 'col' && first.y < loose.y && loose.y < second.y, 'Column insertion order is incorrect');
    check(loose.w === 278 && second.y === loose.y + loose.h + 12, 'Column does not stack and resize its contents');
    await drag('second', { x: 160, y: 125 }); board = await state(); check(board.items.find(item => item.id === 'second').columnOrder === 0, 'Reordering within a column failed');
    await page.locator('[data-item="col"] .design-column-toggle').click(); check(await page.locator('[data-item="first"]').count() === 0, 'Collapsed column still shows its cards');
    await page.locator('[data-item="col"] .design-column-toggle').click(); check(await page.locator('[data-item="first"]').count() === 1, 'Expanded column did not restore its cards');
    await drag('loose', { x: 580, y: 170 }); check(!(await state()).items.find(item => item.id === 'loose').columnId, 'A canvas drop keeps stale column membership');
    report.push('PASS Column insertion guide, ordering, automatic spacing, collapse and detaching');

    await page.locator('[data-item="loose"]').click({ position: { x: 20, y: 20 } });
    await page.locator('.design-object-panel').getByRole('button', { name: 'В неразобранное', exact: true }).click();
    check((await state()).items.find(item => item.id === 'loose').unsorted, 'Unsorted was not persisted in the board');
    check(await page.locator('[data-item="loose"]').count() === 0, 'Unsorted object is still on the canvas');
    const shelfCard = await page.locator('[data-unsorted-item="loose"] .design-shelf-content').boundingBox(), area = await canvas.boundingBox();
    await page.mouse.move(shelfCard.x + 40, shelfCard.y + 25); await page.mouse.down(); await page.mouse.move(area.x + 450, area.y + 220, { steps: 15 }); await page.mouse.up(); await page.waitForTimeout(100);
    check(!(await state()).items.find(item => item.id === 'loose').unsorted, 'Dragging from Unsorted does not place the card');
    await page.locator('.design-shelf input[type="file"]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => [...window.designFixture.sessions.values()].find(s => s.board.name === 'Milanote QA').board.items.some(item => item.kind === 'image' && item.unsorted));
    await flush(); await page.evaluate(async () => { const s = [...window.designFixture.sessions.values()].find(s => s.board.name === 'Milanote QA'); await s.reload(); });
    check((await state()).items.some(item => item.kind === 'image' && item.unsorted), 'Unsorted files do not survive reload');
    report.push('PASS Unsorted drag in/out, file upload, saved state and reload');

    await page.locator('.design-shelf').getByRole('button', { name: 'Закрыть панель', exact: true }).click();
    await page.locator('[data-item="loose"]').click({ position: { x: 20, y: 20 } }); await canvas.focus(); await page.keyboard.press('Delete');
    await flush(); await page.evaluate(async () => { await [...window.designFixture.sessions.values()].find(s => s.board.name === 'Milanote QA').reload(); });
    check((await state()).trash.some(entry => entry.items.some(item => item.id === 'loose')), 'Trash contents disappeared after reload');
    await page.locator('.design-board-top').getByRole('button', { name: 'Корзина', exact: true }).click();
    await page.locator('.design-trash-card').filter({ hasText: 'loose' }).getByRole('button', { name: 'Восстановить', exact: true }).click();
    check((await state()).items.some(item => item.id === 'loose'), 'Trash recovery failed');
    await page.locator('.design-shelf').getByRole('button', { name: 'Закрыть панель', exact: true }).click();
    report.push('PASS Persistent trash and object recovery after file reload');

    await reset();
    await page.evaluate(png => { window.designRequestUrl = async ({ url }) => url.includes('cover.png') ? { status: 200, headers: { 'content-type': 'image/png' }, arrayBuffer: Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer } : { status: 200, headers: {}, text: '<title>Website</title><meta property="og:title" content="Исследование мира"><meta property="og:description" content="Материалы для локаций и персонажей"><meta property="og:image" content="/cover.png">' }; }, png);
    await page.locator('.design-palette button[data-tool="link"]').click();
    await page.locator('.fixture-overlay').getByRole('textbox').fill('https://example.com/research');
    await page.locator('.fixture-overlay').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => [...window.designFixture.sessions.values()].find(s => s.board.name === 'Milanote QA').board.items.some(item => item.preview?.image));
    board = await state(); const link = board.items[0]; check(link.preview.title === 'Исследование мира', 'Fetched preview title is incorrect');
    check(await page.locator('.design-link-preview-image').count() === 1, 'Cached preview image is not rendered');
    const svg = await page.evaluate(async () => { const f = window.designFixture, s = [...f.sessions.values()].find(s => s.board.name === 'Milanote QA'); return (await f.boardSvg(f.service, s.board)).svg; });
    check(svg.includes('data:image/png;base64,') && svg.includes('Исследование') && svg.includes('мира'), 'Export loses the link thumbnail or title');
    report.push('PASS Website metadata, cached thumbnail and exported preview');
    await page.evaluate(() => { window.designRequestUrl = async () => { throw new Error('Offline'); }; });
    await reset(); await page.locator('.design-palette button[data-tool="link"]').click(); await page.locator('.fixture-overlay').getByRole('textbox').fill('https://example.com/offline'); await page.locator('.fixture-overlay').getByRole('button', { name: 'Сохранить', exact: true }).click(); await page.waitForTimeout(100);
    check((await state()).items[0].text === 'https://example.com/offline' && !(await state()).items[0].preview, 'A failed preview request damaged the link');
    check(await page.locator('.design-link-card').getByRole('button', { name: /Открыть ссылку/ }).isVisible(), 'Offline link cannot be opened'); report.push('PASS Offline website remains a usable link card');

    await reset([card('photo', { kind: 'image', path: link.preview.image, x: 70, y: 90, w: 320, h: 240 })]);
    await page.locator('[data-item="photo"]').dblclick({ position: { x: 80, y: 60 } }); await page.waitForSelector('.design-image-editor'); await page.waitForFunction(() => document.querySelector('.design-image-stage img').complete); await page.waitForTimeout(100);
    const cropHandle = await page.locator('.design-crop-handle[data-crop-handle="se"]').boundingBox(), stage = await page.locator('.design-image-stage').boundingBox();
    await page.mouse.move(cropHandle.x + 5, cropHandle.y + 5); await page.mouse.down(); await page.mouse.move(stage.x + stage.width * .7, stage.y + stage.height * .8, { steps: 12 }); await page.mouse.up();
    await page.locator('.design-image-editor-tools').getByRole('button', { name: 'Рисовать на изображении', exact: true }).click();
    await page.mouse.move(stage.x + stage.width * .2, stage.y + stage.height * .2); await page.mouse.down(); await page.mouse.move(stage.x + stage.width * .5, stage.y + stage.height * .5, { steps: 14 }); await page.mouse.up();
    await page.locator('.design-image-editor-footer').getByRole('button', { name: 'Сохранить', exact: true }).click();
    board = await state(); const photo = board.items[0]; check(photo.crop.w < .8 && photo.crop.h < .9, 'Visual cropping was not saved: ' + JSON.stringify(photo.crop)); check(photo.imageStrokes.length === 1, 'Image annotations were not saved');
    check(await page.locator('.design-image-marks path').count() === 1, 'Saved image marks are not displayed');
    const markedSvg = await page.evaluate(async () => { const f = window.designFixture, s = [...f.sessions.values()].find(s => s.board.name === 'Milanote QA'); return (await f.boardSvg(f.service, s.board)).svg; });
    check(markedSvg.includes('stroke="#ef4444"'), 'Export loses image annotations');
    await page.evaluate(async () => { const f = window.designFixture, s = [...f.sessions.values()].find(s => s.board.name === 'Milanote QA'); await f.exportBoard(f.service, s.board, 'png'); await f.exportBoard(f.service, s.board, 'pdf'); }); await flush();
    await page.evaluate(async () => { await [...window.designFixture.sessions.values()].find(s => s.board.name === 'Milanote QA').reload(); }); check((await state()).items[0].imageStrokes.length === 1, 'Marks do not survive reload');
    report.push('PASS Visual crop, direct image drawing, SVG/PNG/PDF export and persistence');

    await reset([card('nested', { kind: 'board', ref: nested.ref, x: 470, y: 100, w: 240, h: 200, color: '#a78bfa' }), card('transfer', { x: 60, y: 110, text: 'Перенести в дочернюю' })]);
    await drag('transfer', { x: 560, y: 180 });
    await page.waitForFunction(() => ![...window.designFixture.sessions.values()].find(s => s.board.name === 'Milanote QA').board.items.some(item => item.id === 'transfer'));
    const destination = await page.evaluate(id => JSON.parse(JSON.stringify(window.designFixture.service.resolveBoard(id).board)), nested.ref);
    check(destination.items.some(item => item.text === 'Перенести в дочернюю' && item.unsorted), 'Board tile drop did not arrive in the destination Unsorted');
    await page.locator('[data-item="nested"] .design-nested-open').click(); await page.locator('.design-board-top').getByRole('button', { name: /^Неразобранное/ }).click();
    check(await page.locator('.design-shelf-content').filter({ hasText: 'Перенести в дочернюю' }).count() === 1, 'Nested board cannot show the transferred content');
    report.push('PASS Drop onto a Board tile saves destination before deleting source and opens its Unsorted');

    await page.locator('.design-breadcrumbs').getByRole('button', { name: 'Milanote QA', exact: true }).click();
    await reset([card('locked', { unsorted: true }), card('photo', { kind: 'image', path: link.preview.image })]);
    await page.evaluate(() => { const s = [...window.designFixture.sessions.values()].find(s => s.board.name === 'Milanote QA'); s.board.readOnly = true; s.touch(); });
    await page.locator('.design-board-top').getByRole('button', { name: /^Неразобранное/ }).click();
    check(await page.locator('.design-shelf-content').isDisabled(), 'Read-only shelf permits edits');
    check(await page.locator('.design-palette button[data-tool="board"]').isDisabled(), 'Read-only palette permits creation');
    report.push('PASS Read-only board refuses shelf placement and palette creation');

    await page.locator('.design-shelf').getByRole('button', { name: 'Закрыть панель', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(100);
    const paletteRect = await page.locator('.design-palette').boundingBox(); check(paletteRect.y > 700 && paletteRect.width < 390, 'Mobile palette is not a bottom strip');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile layout overflows horizontally');
    await page.screenshot({ path: 'tests/browser/design-results/milanote-mobile.png', fullPage: true });
    report.push('PASS Mobile bottom palette and no horizontal overflow');

    await page.setViewportSize({ width: 1440, height: 1000 });
    const landscape = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#ccbfe9"/><stop offset="1" stop-color="#f9dfcc"/></linearGradient></defs><rect width="600" height="350" fill="url(#sky)"/><circle cx="450" cy="100" r="35" fill="#ffefcf"/><path d="M0 350V270L150 120 280 240 390 160 600 290V350" fill="#8d8ea9"/><path d="M0 350V300L120 260 260 300 430 210 600 300V350" fill="#626b82"/></svg>';
    const demoPath = await page.evaluate(async svg => window.designFixture.service.importAsset(new File([svg], 'landscape.svg', { type: 'image/svg+xml' })), landscape);
    await page.evaluate(async ({ id, path }) => { await window.designFixture.service.setBoardAppearance(id, { icon: '🏔️', cover: path }); }, { id: nested.ref, path: demoPath });
    await reset([
        card('references', { kind: 'frame', column: true, columnManaged: true, title: 'Визуальное направление', x: 40, y: 45, w: 310, h: 490, z: -1, color: '#9a86d7' }),
        card('mood', { kind: 'image', path: demoPath, x: 56, y: 105, w: 278, h: 162, columnId: 'references', columnOrder: 0 }),
        card('note', { x: 56, y: 279, w: 278, h: 100, columnId: 'references', columnOrder: 1, autoSize: true, text: 'Туман в долине. Тёплый свет над холодными горами.\nМягкие формы и спокойная палитра.', color: '#fff0b3' }),
        card('nested', { kind: 'board', ref: nested.ref, x: 405, y: 45, w: 270, h: 220, color: '#b9a9d6' }),
        card('tasks', { kind: 'todo', x: 405, y: 305, w: 270, h: 140, text: '- [x] Собрать референсы\n- [ ] Описать локацию\n- [ ] Нарисовать карту' }),
        card('research', { kind: 'link', x: 725, y: 45, w: 270, h: 320, text: 'https://example.com/world', preview: { title: 'Мир, который хочется исследовать', description: 'Свет, окружение и истории персонажей — на одной доске.', image: demoPath, site: 'Референсы' } }),
        card('idea', { unsorted: true, text: 'Город у подножия гор — добавить торговую площадь', color: '#e3d6ff' })
    ]);
    await page.locator('.design-board-top').getByRole('button', { name: /^Неразобранное/ }).click();
    await page.locator('.design-board-shell').screenshot({ path: 'tests/browser/design-results/milanote-desktop.png' });
    check(errors.length === 0, errors.join('\n'));
    report.push('PASS Desktop palette, columns, cover tiles, link preview and Unsorted visual check');
    await writeFile('tests/browser/design-results/milanote-report.txt', report.join('\n') + '\n'); console.log(report.join('\n'));
} catch (error) { if (page) await page.screenshot({ path: 'tests/browser/design-results/milanote-failed.png', fullPage: true }); await writeFile('tests/browser/design-results/milanote-report.txt', report.join('\n') + '\nFAIL ' + error.stack); console.error(error); process.exitCode = 1; }
finally { await browser.close(); }
