import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url), { chromium } = require(process.env.DESIGN_PLAYWRIGHT_DIR || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true }), report = [], errors = [];
let page;
function check(value, message) { if (!value) throw new Error(message); }
async function test(name, run) {
    try { await run(); report.push('PASS ' + name); }
    catch (error) { report.push('FAIL ' + name + ': ' + error.message); process.exitCode = 1; }
}
await mkdir('tests/browser/design-results', { recursive: true });
try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto('http://127.0.0.1:4180'); await page.waitForSelector('[data-item="e0"]');
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.designFixture.sessions.get(window.designFixture.initialBoard).board)));
    const reset = async (viewport = { x: 0, y: 0, zoom: 1 }) => {
        await page.keyboard.press('Escape');
        await page.evaluate(viewport => {
            const f = window.designFixture, s = f.sessions.get(f.initialBoard);
            s.checkpoint(); s.board.items = []; s.board.edges = []; s.board.readOnly = false;
            s.board.viewport = viewport; s.touch();
        }, viewport);
        await page.waitForTimeout(80);
    };
    async function start(tool, surface = page) {
        const button = surface.locator(`.design-palette button[data-tool="${tool}"]`);
        await button.scrollIntoViewIfNeeded(); const rect = await button.boundingBox();
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
        return button;
    }
    async function drag(tool, point = { x: 470, y: 190 }, surface = page) {
        await start(tool, surface); const rect = await surface.locator('.design-canvas').boundingBox();
        await page.mouse.move(rect.x + point.x, rect.y + point.y, { steps: 12 });
        check(await surface.locator('.design-palette-ghost.is-over').count() === 1, 'No valid-drop preview');
        await page.mouse.up(); await page.waitForTimeout(80);
    }
    await test('Trusted desktop mouse drags create exactly one object at the zoomed/panned drop point', async () => {
        for (const [tool, kind] of [['todo', 'todo'], ['table', 'table'], ['sketch', 'sketch'], ['column', 'frame'], ['frame', 'frame'], ['text', 'text'], ['shape', 'shape'], ['sticky', 'sticky']]) {
            await reset({ x: -80, y: 40, zoom: .8 }); await drag(tool);
            const items = (await state()).items;
            check(items.length === 1 && items[0].kind === kind, tool + ' created the wrong objects');
            // Sticky text autosizing changes height after creation; its horizontal centre remains stable.
            check(Math.abs(items[0].x + items[0].w / 2 - (470 + 80) / .8) < 2, tool + ' ignored viewport coordinates');
            if (tool === 'column') check(Math.abs(items[0].y - ((190 - 40) / .8 - 210)) < 2, 'Column ignored vertical coordinates before autosizing');
            else if (tool !== 'sticky') check(Math.abs(items[0].y + items[0].h / 2 - (190 - 40) / .8) < 2, tool + ' ignored vertical coordinates');
            check(await page.locator('.design-palette-ghost').count() === 0, 'Ghost survives release');
        }
    });
    await test('Desktop drop survives an application handler stopping document pointer events', async () => {
        await reset();
        await page.evaluate(() => {
            window.paletteHostBlock = event => event.stopPropagation();
            for (const type of ['pointermove', 'pointerup']) document.addEventListener(type, window.paletteHostBlock, true);
        });
        try { await drag('todo'); check((await state()).items.length === 1, 'Drop was swallowed by the host'); }
        finally {
            await page.mouse.up();
            await page.evaluate(() => { for (const type of ['pointermove', 'pointerup']) document.removeEventListener(type, window.paletteHostBlock, true); });
        }
    });
    await test('A world table picker keeps the original mouse drop point', async () => {
        await reset({ x: -80, y: 40, zoom: .8 }); await drag('world-view');
        const picker = page.locator('.fixture-overlay'); await picker.waitFor();
        await picker.getByRole('button').first().click();
        const item = (await state()).items[0];
        check(item?.kind === 'world-view', 'Picker did not create a world table');
        check(Math.abs(item.x + item.w / 2 - (470 + 80) / .8) < 2 && Math.abs(item.y + item.h / 2 - (190 - 40) / .8) < 2, 'World table appeared in the centre instead of the drop point');
    });
    await test('Dragging Board opens its prompt once and places the new nested board at the mouse drop point', async () => {
        await reset(); await drag('board');
        const prompt = page.locator('.fixture-overlay'); check(await prompt.count() === 1, 'Duplicate board prompts');
        await prompt.getByRole('textbox', { name: 'Новая доска', exact: true }).fill('Palette drag child');
        await prompt.getByRole('button', { name: 'Сохранить', exact: true }).click();
        await page.waitForSelector('.design-nested-board'); const items = (await state()).items;
        check(items.length === 1 && items[0].kind === 'board' && Math.abs(items[0].x + items[0].w / 2 - 470) < 2 && Math.abs(items[0].y + items[0].h / 2 - 190) < 2, 'Nested board ignored the drop point');
    });
    await test('Canceling the world table picker does not move the next clicked object to the old drop point', async () => {
        await reset(); await drag('world-view'); await page.locator('.fixture-overlay').waitFor();
        // The fixture modal has no close controls; remove its overlay to represent dismissal without choosing a view.
        await page.locator('.fixture-overlay').evaluate(node => node.remove());
        await page.locator('.design-palette button[data-tool="todo"]').click();
        const item = (await state()).items[0], canvas = await page.locator('.design-canvas').boundingBox();
        check(item?.kind === 'todo' && Math.abs(item.x + item.w / 2 - canvas.width / 2) < 2 && Math.abs(item.y + item.h / 2 - canvas.height / 2) < 2, 'Canceled picker leaked its drop point');
    });
    await test('Releasing outside the canvas cancels creation and preserves the next mouse click', async () => {
        await reset(); await start('todo'); await page.mouse.move(800, 15, { steps: 12 }); await page.mouse.up();
        check((await state()).items.length === 0 && await page.locator('.design-palette-ghost').count() === 0, 'Outside drop created an object or left a ghost');
        await page.locator('.design-palette button[data-tool="todo"]').click();
        check((await state()).items.length === 1, 'Next click was suppressed');
    });
    await test('Canceled pointer and window focus loss clean up a drag without creating an object', async () => {
        for (const cancel of ['pointercancel', 'blur', 'lostpointercapture']) {
            await reset(); const button = await start('todo'); const rect = await page.locator('.design-canvas').boundingBox();
            await page.mouse.move(rect.x + 440, rect.y + 200, { steps: 12 });
            if (cancel === 'pointercancel') await button.evaluate(node => node.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse' })));
            else if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
            else await button.evaluate(node => node.releasePointerCapture(1));
            await page.mouse.up(); await page.waitForTimeout(50);
            check((await state()).items.length === 0 && await page.locator('.design-palette-ghost').count() === 0, cancel + ' left an active drag');
            await page.locator('.design-palette button[data-tool="todo"]').click();
            check((await state()).items.length === 1, cancel + ' broke the next click');
        }
    });
    await test('Keyboard activation still works after a canceled mouse drop', async () => {
        await reset(); await start('todo'); await page.mouse.move(800, 15, { steps: 12 }); await page.mouse.up();
        await page.locator('.design-palette button[data-tool="todo"]').focus(); await page.keyboard.press('Enter');
        check((await state()).items.length === 1, 'Keyboard activation was suppressed');
    });
    await test('A board moved to another document handles mouse drag and renders its ghost there', async () => {
        await reset();
        // Obsidian can adopt an existing view into a detached window, leaving its module in the original JS realm.
        await page.evaluate(async () => {
            const iframe = document.createElement('iframe'); iframe.id = 'palette-popout';
            iframe.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:white;z-index:100000';
            document.body.appendChild(iframe); await new Promise(resolve => { iframe.onload = resolve; iframe.src = 'about:blank'; });
            const doc = iframe.contentDocument;
            for (const style of document.querySelectorAll('style,link[rel="stylesheet"]')) doc.head.appendChild(style.cloneNode(true));
            const surface = document.querySelector('.fixture-surface');
            window.paletteReturnMarker = document.createComment('Return fixture'); surface.before(window.paletteReturnMarker);
            doc.body.style.cssText = 'margin:0;height:100vh;display:flex'; doc.body.appendChild(surface);
        });
        try {
            const frame = page.frameLocator('#palette-popout'); await drag('todo', { x: 470, y: 190 }, frame);
            check((await state()).items.length === 1, 'Detached document did not create the object');
            check(await page.locator('body > .design-palette-ghost').count() === 0, 'Ghost leaked into the original document');
        } finally {
            await page.mouse.up();
            await page.evaluate(() => { const iframe = document.getElementById('palette-popout'); window.paletteReturnMarker.replaceWith(iframe.contentDocument.querySelector('.fixture-surface')); iframe.remove(); });
        }
    });
    await test('Read-only palette refuses mouse creation', async () => {
        await reset(); await page.evaluate(() => { const f = window.designFixture, s = f.sessions.get(f.initialBoard); s.board.readOnly = true; s.touch(); });
        const button = page.locator('.design-palette button[data-tool="todo"]'); check(await button.isDisabled(), 'Creation tool is not disabled');
        const rect = await button.boundingBox(), area = await page.locator('.design-canvas').boundingBox();
        await page.mouse.move(rect.x + 30, rect.y + 20); await page.mouse.down(); await page.mouse.move(area.x + 450, area.y + 200, { steps: 12 }); await page.mouse.up();
        check((await state()).items.length === 0, 'Read-only board changed');
    });
    await test('Trusted phone touch preserves note dragging, one-tap creation and tool drawer scrolling', async () => {
        const phone = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
        phone.on('pageerror', error => errors.push(String(error)));
        try {
            await phone.goto('http://127.0.0.1:4180'); await phone.waitForSelector('[data-item="e0"]');
            const seed = async () => {
                await phone.evaluate(() => { const f = window.designFixture, s = f.sessions.get(f.initialBoard); s.board.items = []; s.board.edges = []; s.board.viewport = { x: 0, y: 0, zoom: 1 }; s.touch(); });
                await phone.waitForTimeout(60);
            };
            const count = () => phone.evaluate(() => window.designFixture.sessions.get(window.designFixture.initialBoard).board.items.length);
            await seed();
            const cdp = await phone.context().newCDPSession(phone);
            async function swipe(from, to) {
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
                for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10, id: 1 }] }); await phone.waitForTimeout(16); }
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await phone.waitForTimeout(60);
            }
            const note = phone.locator('.design-palette button[data-tool="sticky"]'), button = await note.boundingBox(), canvas = await phone.locator('.design-canvas').boundingBox();
            await swipe({ x: button.x + button.width / 2, y: button.y + button.height / 2 }, { x: canvas.x + 180, y: canvas.y + 160 });
            check(await count() === 1 && await phone.locator('.design-palette-ghost').count() === 0, 'Touch drag creates the wrong number of notes');
            await phone.waitForSelector('.design-editing-text'); await phone.getByRole('button', { name: 'Готово', exact: true }).tap();
            await seed(); await note.tap(); check(await count() === 1, 'One tap duplicated or failed to create a note');
            await phone.getByRole('button', { name: 'Готово', exact: true }).tap(); await seed();
            await phone.getByRole('button', { name: 'Ещё', exact: true }).tap();
            const list = phone.locator('.design-palette.is-expanded .design-palette-list'), box = await list.boundingBox();
            await swipe({ x: box.x + box.width / 2, y: box.y + box.height - 40 }, { x: box.x + box.width / 2, y: box.y + 35 });
            check(await list.evaluate(node => node.scrollTop) > 0, 'Tool drawer stopped scrolling');
            check(await count() === 0 && await phone.locator('.design-palette-ghost').count() === 0, 'Scrolling the drawer created an object');
        } finally { await phone.close(); }
    });
    check(errors.length === 0, errors.join('\n'));
} catch (error) { report.push('FAIL fixture: ' + error.stack); process.exitCode = 1; }
finally { await writeFile('tests/browser/design-results/palette-drag-report.txt', report.join('\n') + '\n'); console.log(report.join('\n')); await browser.close(); }
