import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DESIGN_PLAYWRIGHT_DIR || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [], errors = [];
const card = (id, extra = {}) => ({ id, kind: 'sticky', text: id, x: 200, y: 160, w: 180, h: 120, z: 1, ...extra });
const anchor = (id, x, y) => card(id, { kind: 'anchor', x, y, w: 1, h: 1 });
const line = (id, from, to, extra = {}) => ({ id, from, to, style: 'straight', arrow: 'none', label: 'Line', ...extra });
const assert = (value, message) => { if (!value) throw new Error(message); };
await mkdir('tests/browser/design-results', { recursive: true });
async function seed(page, items, edges = [], flags = {}) {
  await page.evaluate(async ({ items, edges, flags }) => {
    const f = window.designFixture, s = f.sessions.get(f.initialBoard);
    s.board = { ...s.board, viewport: { x: 0, y: 0, zoom: 1 }, items, edges, ...flags };
    s.touch(); await s.flush();
  }, { items, edges, flags });
}
const state = page => page.evaluate(() => JSON.parse(JSON.stringify(window.designFixture.sessions.get(window.designFixture.initialBoard).board)));
async function test(name, run, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile, isMobile: mobile });
  const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(`${name}: ${error}`));
  try { await page.goto('http://127.0.0.1:4180'); await page.waitForSelector('[data-item="e0"]'); await run(page, context); reports.push(`PASS ${name}`); }
  catch (error) { reports.push(`FAIL ${name}: ${error.message}`); await page.screenshot({ path: `tests/browser/design-results/audit-failure-${reports.length}.png` }); }
  finally { console.log(reports.at(-1)); await context.close(); }
}
try {
  await test('OS clipboard URL creates the same link card as native paste', async page => {
    await seed(page, []);
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'read', { configurable: true, value: async () => [{ types: ['text/plain'], getType: async () => new Blob(['https://example.com/reference'], { type: 'text/plain' }) }] }));
    await page.locator('.design-palette').getByRole('button', { name: 'Вставить из буфера ОС', exact: true }).click();
    await page.waitForFunction(() => window.designFixture.sessions.get(window.designFixture.initialBoard).board.items.length === 1);
    const board = await state(page); assert(board.items[0].kind === 'link' && board.items[0].text === 'https://example.com/reference', 'OS clipboard URL became plain text');
  });
  await test('Pointer cancellation restores the first erased stroke and its trash state', async page => {
    await seed(page, [card('drawn', { kind: 'stroke', points: [[0, 0], [120, 30]], width: 4 })]);
    await page.getByRole('button', { name: 'Ластик', exact: true }).click();
    await page.evaluate(() => {
      const canvas = document.querySelector('.design-canvas'), target = document.querySelector('[data-item="drawn"]'), r = canvas.getBoundingClientRect();
      canvas.setPointerCapture = () => {};
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 42, pointerType: 'pen', clientX: r.x + 210, clientY: r.y + 170, button: 0 }));
      canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 42, pointerType: 'pen' }));
    });
    const board = await state(page); assert(board.items.some(item => item.id === 'drawn'), 'Cancel discarded the erased stroke'); assert(!board.trash?.length, 'Cancel left an extra trash entry');
  });
  await test('Edits during a delayed board transfer preserve the newer source card', async page => {
    const child = await page.evaluate(async () => {
      const f = window.designFixture, doc = await f.service.createBoard('Delayed destination'), original = f.service.saveBoard.bind(f.service);
      f.service.saveBoard = async (board, ...args) => { if (board.id === doc.board.id) { window.transferStarted = true; await new Promise(resolve => window.releaseTransfer = resolve); } return original(board, ...args); };
      return doc.board.id;
    });
    await seed(page, [card('moving'), card('target', { kind: 'board', ref: child, x: 600, y: 160 })]);
    const from = await page.locator('[data-item="moving"]').boundingBox(), to = await page.locator('[data-item="target"]').boundingBox();
    await page.mouse.move(from.x + 35, from.y + 35); await page.mouse.down(); await page.mouse.move(to.x + 35, to.y + 35, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => window.transferStarted);
    await page.evaluate(() => { const f = window.designFixture, s = f.sessions.get(f.initialBoard); s.board.items.find(item => item.id === 'moving').text = 'Newer edit'; s.touch(); window.releaseTransfer(); });
    await page.waitForTimeout(150);
    assert((await state(page)).items.some(item => item.id === 'moving' && item.text === 'Newer edit'), 'Newer edit was deleted by transfer completion');
    assert(await page.evaluate(id => window.designFixture.service.resolveBoard(id).board.items.some(item => item.text === 'moving'), child), 'Destination did not retain its saved earlier copy');
  });
  await test('Native paste edits table cells, blur saves formulas, locked tables disable inputs', async (page, context) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seed(page, [card('table', { kind: 'table', w: 400, h: 220, table: { columns: [{ name: 'A', type: 'text' }], rows: [['old']] } })]);
    await page.evaluate(() => navigator.clipboard.writeText('=1+2'));
    const input = page.locator('[data-item="table"] .design-cell'); await input.focus(); await input.press('Control+a'); await input.press('Control+v'); await input.press('Tab');
    assert((await state(page)).items.length === 1, 'Cell paste created an object on the canvas');
    assert((await state(page)).items[0].table.rows[0][0] === '=1+2', 'Pasted formula was lost');
    assert(await input.inputValue() === '3', 'Formula is not shown after blur');
    await seed(page, [card('table', { kind: 'table', locked: true, table: { columns: [{ name: 'A', type: 'text' }], rows: [['old']] } })]);
    assert(await page.locator('[data-item="table"] .design-cell').isDisabled(), 'Locked cell stays editable');
  });
  await test('Read-only blocks line editing, undo buttons and asset paste without crashing', async page => {
    await seed(page, [anchor('a', 200, 100), anchor('b', 600, 100)], [line('edge', 'a', 'b')]);
    await page.locator('[data-label="edge-label"]').click(); await page.locator('.design-board-menu summary').click(); await page.getByLabel('Только чтение', { exact: true }).check(); await page.locator('.design-board-menu summary').click();
    await page.getByRole('button', { name: 'Добавить подпись', exact: true }).click();
    assert(await page.locator('.design-label-layer input').count() === 0, 'Read-only label editor opened');
    assert(await page.getByTitle('Отменить', { exact: true }).isDisabled(), 'Undo bypasses read-only');
    const count = await page.evaluate(() => window.designFixture.files.size);
    await page.evaluate(() => { const data = new DataTransfer(); data.items.add(new File(['x'], 'test.png', { type: 'image/png' })); document.querySelector('.design-canvas').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); });
    assert(await page.evaluate(() => window.designFixture.files.size) === count, 'Read-only paste wrote an asset');
    assert(await page.getByRole('button', { name: 'Иконки и эмодзи', exact: true }).isDisabled(), 'Icon import stays enabled');
  });
  await test('Free-line copy/paste and selection export preserve geometry', async page => {
    await seed(page, [anchor('a', 200, 100), anchor('b', 600, 100)], [line('edge', 'a', 'b')]);
    await page.locator('[data-label="edge-label"]').click(); await page.locator('.design-canvas').focus(); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.designFixture.sessions.get(window.designFixture.initialBoard).board.edges.length === 2);
    const board = await state(page); assert(board.items.length === 4, 'Line ends were not copied');
    const exported = await page.evaluate(async () => { const f = window.designFixture, s = f.sessions.get(f.initialBoard); return f.boardSvg(f.service, s.board, new Set([s.board.edges[1].id])); });
    assert(exported.svg.includes('Line') && exported.width < 1000, 'Selection export skipped the selected edge');
    await page.keyboard.press('Alt+2'); assert(Number.isFinite((await state(page)).viewport.x), 'Fit line selection damaged viewport');
  });
  await test('Frame cut/paste moves contents and their internal edge', async page => {
    await seed(page, [card('frame', { kind: 'frame', title: 'Frame', x: 180, y: 130, w: 500, h: 400, z: -1 }), card('a', { x: 220, y: 190 }), card('b', { x: 440, y: 190 })], [line('edge', 'a', 'b')]);
    await page.locator('[data-item="frame"] .design-rich-text').click(); await page.locator('.design-canvas').focus(); await page.keyboard.press('Control+x');
    assert((await state(page)).items.length === 0, 'Cut left frame contents behind'); await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.designFixture.sessions.get(window.designFixture.initialBoard).board.items.length === 3);
    assert((await state(page)).edges.length === 1, 'Paste lost the internal edge');
  });
  await test('Endpoint drags remove old anchors and labels open by double click', async page => {
    await seed(page, [anchor('a', 200, 100), anchor('b', 600, 100)], [line('edge', 'a', 'b')]);
    await page.locator('[data-label="edge-label"]').click();
    for (const delta of [40, 80, 120]) { const handle = await page.locator('[data-endpoint="edge"][data-side="to"]').boundingBox(); await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); const c = await page.locator('.design-canvas').boundingBox(); await page.mouse.move(c.x + 600 + delta, c.y + 150); await page.mouse.up(); }
    assert((await state(page)).items.length === 2, 'Unused anchors accumulate');
    await page.locator('[data-label="edge-label"]').dblclick(); await page.locator('.design-label-layer input').waitFor();
    await page.locator('.design-label-layer input').fill('Edited'); await page.keyboard.press('Enter');
    assert((await state(page)).edges[0].labels[0].text === 'Edited', 'Double-click line editing failed');
  });
  await test('Pointer cancellation restores object positions', async page => {
    await seed(page, [card('a')]); const box = await page.locator('[data-item="a"]').boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 70);
    await page.locator('.design-canvas').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true }); await page.mouse.up();
    assert((await state(page)).items[0].x === 200 && (await state(page)).items[0].y === 160, 'Cancelled drag was saved');
  });
  await test('Rotated sketch stores pen coordinates in the card space', async page => {
    await seed(page, [card('sketch', { kind: 'sketch', x: 300, y: 160, w: 240, h: 120, rotation: 90, sketch: [] })]);
    await page.getByRole('button', { name: 'Перо', exact: true }).click(); const c = await page.locator('.design-canvas').boundingBox();
    await page.mouse.move(c.x + 420, c.y + 200); await page.mouse.down(); await page.mouse.move(c.x + 420, c.y + 240, { steps: 4 }); await page.mouse.up();
    const sketch = (await state(page)).items[0].sketch; assert(sketch.length === 1, 'Stroke escaped the rotated sketch');
    assert(Math.abs(sketch[0].points[0][0] - 100) < 1 && Math.abs(sketch[0].points[0][1] - 60) < 1, 'Sketch used world-space coordinates');
  });
  await test('Column reordering respects locked contents', async page => {
    await seed(page, [card('left', { kind: 'frame', column: true, title: 'Left', x: 200, y: 160, w: 260, h: 350, z: -1 }), card('right', { kind: 'frame', column: true, title: 'Right', x: 500, y: 160, w: 260, h: 350, z: -1 }), card('locked', { locked: true, x: 530, y: 200, w: 180 })]);
    const title = await page.locator('[data-item="left"] .design-rich-text').boundingBox(); await page.mouse.move(title.x + 20, title.y + 15); await page.mouse.down(); await page.mouse.move(title.x + 450, title.y + 15, { steps: 8 }); await page.mouse.up();
    assert((await state(page)).items.find(item => item.id === 'right').x === 200, 'Column did not reorder'); assert((await state(page)).items.find(item => item.id === 'locked').x === 530, 'Column shifted a locked card');
  });
  await test('Group snapping preserves offsets and Ctrl+A includes free lines', async page => {
    await seed(page, [card('a', { x: 203, groupId: 'g' }), card('b', { x: 427, y: 160, groupId: 'g' }), anchor('from', 250, 400), anchor('to', 450, 400)], [line('free', 'from', 'to')], { snap: true });
    const box = await page.locator('[data-item="a"]').boundingBox(); await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 67, box.y + 30); await page.mouse.up();
    let board = await state(page); assert(board.items[1].x - board.items[0].x === 224, 'Snapping changed group spacing');
    await page.locator('.design-canvas').focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('ArrowRight'); board = await state(page); assert(board.items.find(item => item.id === 'from').x === 251, 'Select all did not move free lines');
  });
  await test('Export keeps headings, strike, paragraph alignment and color bands', async page => {
    await seed(page, [card('styled', { kind: 'text', w: 500, h: 240, band: '#ff0000', richText: '<h1>Heading</h1><div style="text-align: right"><s>Strike</s></div>' })]);
    const svg = await page.evaluate(async () => { const f = window.designFixture; return (await f.boardSvg(f.service, f.sessions.get(f.initialBoard).board)).svg; });
    const headingSize = await page.locator('[data-item="styled"] h1').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    assert(svg.includes(`font-size="${headingSize}"`) && svg.includes('text-decoration="line-through"') && svg.includes('height="8" fill="#ff0000"'), 'Export dropped text styling or band');
    const doc = await page.evaluate(svg => { const dom = new DOMParser().parseFromString(svg, 'image/svg+xml'); const texts = [...dom.querySelectorAll('text')]; return texts.map(node => ({ text: node.textContent, x: Number(node.getAttribute('x')), y: Number(node.getAttribute('y')) })); }, svg);
    assert(doc.find(node => node.text === 'Strike').y > doc.find(node => node.text === 'Heading').y && doc.find(node => node.text === 'Strike').x > 300, 'Paragraph layout was flattened');
  });
  await test('Failed breadcrumb transfer retains objects on source board', async page => {
    await page.evaluate(async () => { const f = window.designFixture, s = f.sessions.get(f.initialBoard), child = await f.service.createBoard('Child'); child.board.items = [{ id: 'moving', kind: 'sticky', text: 'Move me', x: 200, y: 180, w: 200, h: 120, z: 1 }]; await f.service.saveBoard(child.board, child.path, child.raw); s.board.items = [{ id: 'nested', kind: 'board', ref: child.board.id, x: 200, y: 160, w: 200, h: 160, z: 1 }]; s.board.edges = []; s.touch(); await s.flush(); const original = f.service.saveBoard.bind(f.service); f.service.saveBoard = (board, ...args) => board.id === f.initialBoard ? Promise.reject(new Error('Simulated disk failure')) : original(board, ...args); });
    await page.locator('[data-item="nested"]').dblclick(); await page.locator('[data-item="moving"]').waitFor();
    const from = await page.locator('[data-item="moving"]').boundingBox(), to = await page.locator('[data-board-target]').first().boundingBox();
    await page.mouse.move(from.x + 40, from.y + 40); await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(150);
    assert(await page.evaluate(() => [...window.designFixture.sessions.values()].find(s => s.board.name === 'Child').board.items.some(item => item.id === 'moving')), 'Failed destination save removed source content');
  });
  await test('Mobile toolbar stays below cards and trusted double-tap opens a record', async (page, context) => {
    const panel = await page.locator('.design-palette').boundingBox(), canvas = await page.locator('.design-canvas').boundingBox(); assert(panel.height <= 65 && panel.width <= 390 && panel.y > canvas.y + canvas.height / 2, 'Mobile toolbar covers the cards');
    const box = await page.locator('[data-item="e0"]').boundingBox(), cdp = await context.newCDPSession(page);
    for (let i = 0; i < 2; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 30, y: box.y + 30, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    await page.locator('.fixture-overlay .design-record-modal').waitFor(); await page.screenshot({ path: 'tests/browser/design-results/audit-mobile.png' });
  }, true);
} finally { await browser.close(); await writeFile('tests/browser/design-results/audit-report.txt', [...reports, ...errors.map(error => `ERROR ${error}`)].join('\n') + '\n'); }
if (errors.length || reports.some(report => report.startsWith('FAIL'))) process.exitCode = 1;
