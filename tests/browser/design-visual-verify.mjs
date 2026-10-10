import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url), { chromium } = require(process.env.DESIGN_PLAYWRIGHT_DIR || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true }), reports = [], errors = [];
const check = (value, message) => { if (!value) throw new Error(message); reports.push(message); };
const results = 'tests/browser/design-results'; await mkdir(results, { recursive: true });
async function load(page) { page.on('pageerror', error => errors.push(String(error))); await page.goto('http://127.0.0.1:4180'); await page.waitForSelector('[data-item="e0"]'); }
async function world(page) {
    await page.getByRole('button', { name: 'Назад', exact: true }).first().click();
    await page.getByRole('button', { name: 'Таблицы мира', exact: true }).first().click(); await page.waitForSelector('.world-table');
    await page.evaluate(async () => {
        const s = window.designFixture.service, names = ['Медный меч', 'Клинок рассвета', 'Охотничий лук', 'Посох странника', 'Ледяной топор', 'Кинжал разведчика', 'Молот кузнеца', 'Щит стража'];
        for (let i = 0; i < names.length; i++) await s.createEntity('weapon', names[i], { damage: [12, 48, 24, 18, 36, 9, 30, 0][i], weight: i + 1, rarity: ['Обычное', 'Легендарное', 'Редкое'][i % 3], design_state: ['Идея', 'В работе', 'Готово'][i % 3], task: 'task1' });
        const view = structuredClone(s.world.datasets.find(dataset => dataset.id === 'weapon').views[0]);
        view.columns = ['title', 'damage', 'rarity', 'weight', 'design_state', 'status']; view.widths = { title: 240, damage: 100, rarity: 140, weight: 100, design_state: 160, status: 150 }; await s.saveWorldView('weapon', view);
    });
    if (await page.locator('.world-nav-toggle').isVisible()) await page.locator('.world-nav-toggle').click();
    await page.getByRole('button', { name: /^Оружие/ }).click(); await page.waitForSelector('.world-table [data-world-record]');
}
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }); await load(page); await world(page);
    check(await page.locator('.world-chip').count() === 16, 'Table renders single-select fields as colored chips');
    await page.getByRole('button', { name: 'Урон: 12', exact: true }).click(); await page.locator('.world-cell-editing').getByLabel('Урон').fill('15'); await page.locator('.world-cell-editing').getByLabel('Урон').press('Tab');
    await page.getByRole('button', { name: 'Урон: 15', exact: true }).waitFor();
    check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Редкость: Обычное'), 'Tab saves a cell and focuses the next field in its row');
    await page.getByRole('button', { name: 'Урон: 15', exact: true }).click(); await page.locator('.world-cell-editing').getByLabel('Урон').fill('17'); await page.locator('.world-toolbar input').click();
    await page.getByRole('button', { name: 'Урон: 17', exact: true }).waitFor();
    check(await page.evaluate(() => window.designFixture.service.index.all().find(record => record.title === 'Медный меч').values.damage) === 17, 'Leaving an edited cell saves the original Markdown record');
    await page.locator('.world-toolbar').getByRole('button', { name: 'Группы', exact: true }).click(); await page.getByLabel('Группировка').selectOption('rarity'); await page.locator('.world-config').getByRole('button', { name: 'Сохранить', exact: true }).click();
    const group = page.locator('.world-group-row').filter({ hasText: 'Обычное' }).getByRole('button'); await group.click();
    check(await page.locator('.world-table tbody [data-world-record]').count() === 5, 'Table groups collapse without filtering or deleting their records');
    await group.click(); check(await page.locator('.world-table tbody [data-world-record]').count() === 8, 'Collapsed groups expand back to the same records');
    check((await page.locator('.world-table tfoot').textContent()).includes('Σ 182'), 'Numeric footer calculates all filtered records, including collapsed groups');
    await page.screenshot({ path: `${results}/world-table-redesign-desktop.png` });
    await page.getByRole('button', { name: 'Урон: 17', exact: true }).click(); await page.locator('.world-cell-editing').getByLabel('Урон').fill('-1'); await page.locator('.world-cell-editing').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.locator('.world-cell-editing [role=alert]').waitFor();
    check(await page.evaluate(() => window.designFixture.service.index.all().find(record => record.title === 'Медный меч').values.damage) === 17, 'Invalid numeric edits retain the draft and do not overwrite the record');
    await page.locator('.world-cell-editing').getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: 'Урон: 17', exact: true }).click(); await page.locator('.world-cell-editing').getByLabel('Урон').fill('99');
    await page.evaluate(async () => { const s = window.designFixture.service, record = s.index.all().find(record => record.title === 'Медный меч'); await s.updateWorldValue(record.id, 'damage', 23, record.raw); });
    await page.locator('.world-cell-editing').getByRole('button', { name: 'Сохранить', exact: true }).click(); await page.locator('.world-cell-editing [role=alert]').waitFor();
    check(await page.locator('.world-cell-editing').getByLabel('Урон').inputValue() === '99' && await page.evaluate(() => window.designFixture.service.index.all().find(record => record.title === 'Медный меч').values.damage) === 23, 'External changes cause a visible conflict while preserving the unsaved draft');
    await page.locator('.world-cell-editing').getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.locator('.world-views').getByRole('button', { name: 'Канбан', exact: true }).click(); await page.screenshot({ path: `${results}/world-kanban-redesign-desktop.png` });
    await page.close();

    const canvas = await browser.newPage({ viewport: { width: 1440, height: 950 } }); await load(canvas);
    await canvas.evaluate(async () => {
        const f = window.designFixture, s = f.sessions.get(f.initialBoard), child = await f.service.createBoard('Персонажи и их истории');
        child.board.items = [{ id: 'tiny', kind: 'sticky', x: 30, y: 30, w: 150, h: 100, z: 1, color: '#facc15', text: 'История героя' }, { id: 'tiny2', kind: 'sticky', x: 210, y: 90, w: 150, h: 100, z: 1, color: '#a78bfa', text: 'Характер' }]; await f.service.saveBoard(child.board, child.path, child.raw);
        const base = { w: 240, h: 180, z: 1 }, entity = f.service.index.all()[0];
        s.board.viewport = { x: 50, y: 45, zoom: 1 }; s.board.edges = []; s.board.items = [
            { ...base, id: 'note', autoSize: true, kind: 'sticky', x: 0, y: 0, color: '#facc15', text: 'Идея для мира\n\nГород на спине древнего зверя. Каждое утро — новый горизонт.' },
            { ...base, id: 'cyan', autoSize: true, kind: 'sticky', x: 275, y: 0, color: '#00ffff', text: 'Что важно\n\nИсследование, выбор пути и встречи с необычными персонажами.' },
            { ...base, id: 'nested', kind: 'board', x: 550, y: 0, h: 210, color: '#8b5cf6', ref: child.board.id },
            { ...base, id: 'record', kind: 'entity', x: 825, y: 0, h: 230, color: '#8b5cf6', ref: entity.id },
            { ...base, id: 'link', kind: 'link', x: 0, y: 260, h: 250, color: '#3b82f6', text: 'https://milanote.com/', title: 'Референсы и настроение', preview: { title: 'Референсы и настроение', description: 'Собираем идеи, персонажей и визуальные ориентиры в одном месте.', site: 'milanote.com' } },
            { ...base, id: 'todo', kind: 'todo', x: 275, y: 260, text: '[x] Продумать мир\n[ ] Нарисовать карту\n[ ] Описать героев' },
            { ...base, id: 'table', kind: 'table', x: 550, y: 260, w: 360, h: 250, table: { columns: [{ name: 'Материал', type: 'text' }, { name: 'Цена', type: 'number' }], rows: [['Медь', '12'], ['Железо', '24'], ['Итого', '=SUM(B1:B2)']] } }
        ]; s.touch();
    });
    await canvas.waitForSelector('[data-item="note"]');
    check(await canvas.locator('[data-item="note"]').evaluate(node => getComputedStyle(node).backgroundColor === 'rgb(253, 237, 173)'), 'Sticky paper uses a soft tint with readable default ink');
    check(await canvas.locator('.design-nested-cover').evaluate(node => node.getBoundingClientRect().height <= 104), 'Nested board thumbnail has a bounded height');
    await canvas.screenshot({ path: `${results}/board-redesign-desktop.png` });
    await canvas.context().grantPermissions(['clipboard-read', 'clipboard-write']); await canvas.evaluate(() => navigator.clipboard.writeText('Дерево\t8\nКамень\t10'));
    const first = canvas.locator('[data-item="table"] .design-cell').first(); await first.focus(); await first.press('Control+v'); await first.press('Enter');
    check(await canvas.evaluate(() => window.designFixture.sessions.get(window.designFixture.initialBoard).board.items.find(item => item.id === 'table').table.rows[1][1]) === '10', 'Spreadsheet paste fills a rectangular canvas table range');
    check(await canvas.evaluate(() => document.activeElement?.getAttribute('data-table-cell')) === '1:0', 'Enter saves a canvas table cell and moves down');
    await canvas.setViewportSize({ width: 393, height: 851 }); await canvas.evaluate(() => document.body.classList.add('is-android'));
    await canvas.getByRole('button', { name: 'Редактировать на весь экран', exact: true }).click();
    await canvas.evaluate(() => { const f = window.designFixture, s = f.sessions.get(f.initialBoard); s.board.items = s.board.items.filter(item => ['note', 'cyan', 'nested'].includes(item.id)); s.board.items.forEach((item, index) => { item.x = 45; item.y = index * 200; item.w = 270; item.h = 180; }); s.board.viewport = { x: 0, y: 12, zoom: 1 }; s.touch(); });
    await canvas.screenshot({ path: `${results}/board-redesign-mobile.png` });
    check(await canvas.evaluate(() => document.querySelector('.design-palette').getBoundingClientRect().bottom <= innerHeight - 48), 'Mobile canvas palette stays above Android system navigation');
    await canvas.addStyleTag({ content: ':root{--background-primary:#181b22;--background-secondary:#222630;--background-modifier-border:#343a46;--text-normal:#e9edf5;--text-muted:#9da7b8;--background-modifier-hover:#2b303c}button,input,select,textarea{background:var(--background-primary)}' });
    await canvas.screenshot({ path: `${results}/board-redesign-mobile-dark.png` });
    check(await canvas.locator('[data-item="note"] .design-rich-text').evaluate(node => getComputedStyle(node).color === 'rgb(23, 43, 77)'), 'Sticky notes retain readable default ink in a dark app theme');
    await canvas.close();

    const phone = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true }); await load(phone); await world(phone); await phone.evaluate(() => document.body.classList.add('is-android'));
    await phone.locator('.world-heading').getByRole('button', { name: 'Редактировать на весь экран', exact: true }).click();
    check(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile table scrolls internally without widening the app');
    await phone.screenshot({ path: `${results}/world-table-redesign-mobile.png` });
    await phone.locator('.world-views').getByRole('button', { name: 'Канбан', exact: true }).click(); await phone.screenshot({ path: `${results}/world-kanban-redesign-mobile.png` });
    await phone.locator('.world-toolbar').getByRole('button', { name: 'Вид', exact: true }).click();
    check(await phone.locator('.world-config-mobile-actions').getByRole('button', { name: 'Поля таблицы', exact: true }).isVisible() && await phone.locator('.world-config-mobile-actions').getByRole('button', { name: 'На доску…', exact: true }).isVisible(), 'Mobile view menu retains schema and place-on-board actions');
    await phone.locator('.world-config-mobile-actions').getByRole('button', { name: 'Поля таблицы', exact: true }).click(); await phone.locator('.design-schema-modal').waitFor();
    await phone.locator('.design-schema-modal').getByRole('button', { name: 'Отмена', exact: true }).click();
    await phone.close(); check(!errors.length, 'No runtime errors in the redesigned desktop/mobile surfaces');
    await writeFile(`${results}/visual-redesign-report.json`, JSON.stringify({ reports, errors }, null, 2)); console.log(JSON.stringify({ reports, errors }, null, 2));
} finally { await browser.close(); }
