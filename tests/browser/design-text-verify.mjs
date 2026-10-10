import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url), { chromium } = require(process.env.DESIGN_PLAYWRIGHT_DIR || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true }), reports = [], errors = [];
const check = (value, message) => { if (!value) throw new Error(message); };
await mkdir('tests/browser/design-results', { recursive: true });
let page;
try {
    for (const mobile of [false, true]) {
        const context = await browser.newContext({ viewport: mobile ? { width: 393, height: 851 } : { width: 1440, height: 960 }, hasTouch: mobile, isMobile: mobile });
        page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
        await page.goto('http://127.0.0.1:4180'); await page.waitForSelector('[data-item="e0"]');
        await page.addStyleTag({ content: ':root{--text-normal:#eeeeee;--background-primary:#111318;--background-secondary:#1c2029}.fixture-controls{display:none!important}' });
        const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.designFixture.sessions.get(window.designFixture.initialBoard).board)));
        const reset = async (kind = 'text', extra = {}) => {
            await page.evaluate(({ kind, extra }) => { const f = window.designFixture, s = f.sessions.get(f.initialBoard); s.board = { ...s.board, readOnly: false, items: [{ id: 't', kind, text: 'Alpha Beta', title: 'Alpha Beta', color: '#fff1b8', x: 220, y: 100, w: 240, h: 140, z: 1, ...extra }], edges: [], viewport: { x: kind === 'text' ? 0 : 0, y: 0, zoom: 1 } }; if (innerWidth < 720) s.board.items[0].x = 35; s.touch(); }, { kind, extra });
            await page.waitForTimeout(400);
        };
        const editor = page.locator('.design-editing-text'), palette = page.locator('.design-palette');
        const size = palette.getByLabel('Размер шрифта', { exact: true }), color = palette.getByLabel('Цвет текста', { exact: true });
        const open = async () => { if (await page.locator('[data-item="t"] .design-shape-text').count()) await page.locator('[data-item="t"]').dblclick(); else await page.locator('[data-item="t"] .design-rich-text').dblclick(); await editor.waitFor(); await page.waitForFunction(() => document.activeElement?.classList.contains('design-editing-text')); await page.waitForTimeout(40); };
        const done = async () => { await palette.getByRole('button', { name: 'Готово', exact: true }).click(); await editor.waitFor({ state: 'detached' }); };
        const select = async word => editor.evaluate((node, word) => { node.focus(); const range = document.createRange(), selection = window.getSelection(); if (!word) { range.selectNodeContents(node); range.collapse(false); } else { const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let run; while (run = walker.nextNode()) { const start = run.textContent.indexOf(word); if (start !== -1) { range.setStart(run, start); range.setEnd(run, start + word.length); break; } } } selection.removeAllRanges(); selection.addRange(range); }, word);
        const runs = () => page.locator('[data-item="t"] .design-rich-text').evaluate(node => { const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), runs = []; let text; while (text = walker.nextNode()) { const style = getComputedStyle(text.parentElement); runs.push({ text: text.textContent, size: parseFloat(style.fontSize), color: style.color, weight: style.fontWeight, align: style.textAlign }); } return runs; });
        await reset(); await open();
        check((await runs()).every(run => run.color === 'rgb(238, 238, 238)'), 'Default plain text is unreadable in a dark theme');
        await select(); await size.fill('25');
        check((await runs()).every(run => run.size === 25), 'Caret-only size change does not immediately style existing text');
        check(await size.evaluate(node => document.activeElement === node), 'Changing numeric size steals focus from the input');
        await color.fill('#ffffff'); check((await runs()).every(run => run.color === 'rgb(255, 255, 255)'), 'Caret-only color change does not style existing text');
        await done(); let item = (await state()).items[0]; check(item.textStyle?.fontSize === 25 && item.textStyle?.color === '#ffffff', 'Whole-card style is not stored');
        await open(); check(await size.inputValue() === '25' && await color.inputValue() === '#ffffff', 'Palette loses whole-card style on reopening');
        await editor.press('End'); await page.keyboard.type('!'); check((await runs()).every(run => run.size === 25 && run.color === 'rgb(255, 255, 255)'), 'New typing lost whole-card style');
        reports.push(`PASS ${mobile ? 'Mobile' : 'Desktop'}: caret-only size/color, live number input, theme contrast, reopen and future typing`);
        await select('Beta'); await color.fill('#ff0000'); await size.fill('34'); await color.fill('#00ff00');
        let textRuns = await runs();
        check(textRuns.filter(run => run.text.includes('Alpha')).every(run => run.size === 25 && run.color === 'rgb(255, 255, 255)'), 'Selection styles leaked into the unselected text: ' + JSON.stringify(textRuns));
        check(textRuns.some(run => run.text === 'Beta' && run.size === 34 && run.color === 'rgb(0, 255, 0)'), 'Consecutive selection styles lost the range or failed to override old styles: ' + JSON.stringify(textRuns));
        await palette.getByRole('button', { name: 'Жирный', exact: true }).click();
        check((await runs()).some(run => run.text === 'Beta' && Number(run.weight) >= 600), 'Bold lost the saved selection after size/color input');
        await done(); await page.evaluate(async () => { const f = window.designFixture; await f.sessions.get(f.initialBoard).flush(); });
        item = (await state()).items[0]; check(item.richText.includes('34px') && /rgb\(0,\s*255,\s*0\)|#00ff00/.test(item.richText), 'Partial styles did not persist in rich text');
        check(await page.evaluate(() => { const f = window.designFixture, s = f.sessions.get(f.initialBoard), stored = JSON.parse(f.files.get(s.path).raw); return stored.items[0].textStyle.fontSize === 25 && stored.items[0].richText.includes('34px'); }), 'Styles did not reach the board file');
        await page.evaluate(() => { const f = window.designFixture; f.sessions.get(f.initialBoard).undo(); });
        check(!(await state()).items[0].richText?.includes('34px'), 'Undo failed to remove selection formatting');
        await page.evaluate(() => { const f = window.designFixture; f.sessions.get(f.initialBoard).redo(); });
        await open(); textRuns = await runs(); check(textRuns.some(run => run.text === 'Beta' && run.size === 34), 'Redo/reopen lost formatted text');
        reports.push(`PASS ${mobile ? 'Mobile' : 'Desktop'}: partial color/size/bold, repeated formatting, vault persistence, undo/redo`);
        await select(); await size.fill('30'); await color.fill('#3366ff'); await done();
        textRuns = await runs(); check(textRuns.every(run => run.size === 30 && run.color === 'rgb(51, 102, 255)'), 'Whole-card styling did not replace previous inline overrides');
        check(textRuns.some(run => run.text === 'Beta' && Number(run.weight) >= 600), 'Whole-card styling destroyed other formatting');
        if (mobile) await page.getByRole('button', { name: /Свойства/ }).click();
        const panel = page.locator('.design-object-panel');
        await panel.getByLabel('Размер шрифта', { exact: true }).fill('42'); await panel.getByLabel('Размер шрифта', { exact: true }).press('Tab');
        await panel.getByLabel('Цвет текста', { exact: true }).fill('#ff8800'); await panel.getByLabel('Цвет текста', { exact: true }).dispatchEvent('change');
        check((await runs()).every(run => run.size === 42 && run.color === 'rgb(255, 136, 0)'), 'Properties do not override rich-text color/size');
        await panel.getByLabel('Размер шрифта', { exact: true }).fill('0'); await panel.getByLabel('Размер шрифта', { exact: true }).press('Tab');
        check((await state()).items[0].textStyle.fontSize === 6, 'Properties did not clamp the minimum font size: ' + JSON.stringify((await state()).items[0]));
        if (mobile) await panel.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
        reports.push(`PASS ${mobile ? 'Mobile' : 'Desktop'}: whole-card/property styles override rich text, preserve bold and clamp invalid sizes`);
        await reset(); await open(); await size.fill('37');
        await page.locator('.design-board-top button[title="Отменить"],.design-board-top button[aria-label="Отменить"]').click();
        check(await editor.count() === 0 && (await runs()).every(run => run.size === 18), 'Toolbar undo leaves a stale editable draft');
        await page.locator('.design-board-top button[title="Повторить"],.design-board-top button[aria-label="Повторить"]').click();
        check((await runs()).every(run => run.size === 37), 'Toolbar redo does not restore the visible style');
        await open(); await page.evaluate(() => { const f = window.designFixture, s = f.sessions.get(f.initialBoard); s.board.items[0].richText = '<b>External text</b>'; s.board.items[0].text = 'External text'; s.touch(); });
        check(await editor.innerText() === 'External text', 'An accepted external/model update leaves stale editor contents');
        await page.evaluate(() => { const f = window.designFixture, s = f.sessions.get(f.initialBoard); s.board.readOnly = true; s.touch(); });
        await editor.waitFor({ state: 'detached' }); check((await state()).items[0].text === 'External text', 'Read-only transition loses the current text');
        reports.push(`PASS ${mobile ? 'Mobile' : 'Desktop'}: toolbar undo/redo during editing, incoming text refresh and read-only transition`);
        await reset('text', { richText: '<span style="font-size:42px;color:#ffffff;text-align:right"><b>Alpha Beta</b></span>' });
        await page.locator('[data-item="t"]').click(); if (mobile) await page.getByRole('button', { name: /Свойства/ }).click();
        await page.evaluate(() => window.designFixture.designClipboard.style = { textStyle: { fontSize: 28, color: '#aa00ff', align: 'center' } });
        await panel.getByRole('button', { name: 'Вставить стиль', exact: true }).click();
        check((await runs()).every(run => run.size === 28 && run.color === 'rgb(170, 0, 255)' && run.align === 'center' && Number(run.weight) >= 600), 'Pasted style is overridden by existing rich text');
        const svg = await page.evaluate(async () => { const f = window.designFixture; return (await f.boardSvg(f.service, f.sessions.get(f.initialBoard).board)).svg; });
        check(svg.includes('font-size="28"') && svg.includes('#aa00ff') && svg.includes('font-weight="bold"'), 'Export loses size/color/bold');
        if (mobile) await panel.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
        reports.push(`PASS ${mobile ? 'Mobile' : 'Desktop'}: pasted styles override inline styles and export retains formatting`);
        await reset(); await open(); await select('Alpha');
        for (const name of ['Жирный', 'Курсив', 'Подчёркнутый', 'Зачёркнутый']) await palette.getByRole('button', { name, exact: true }).click();
        check(await editor.locator('b,strong').count() && await editor.locator('i,em').count() && await editor.locator('u').count() && await editor.locator('strike,s,del').count(), 'Inline formatting commands lost the selection');
        await palette.getByRole('button', { name: 'Ссылка', exact: true }).click();
        await page.locator('.fixture-overlay').getByRole('textbox', { name: 'Ссылка', exact: true }).fill('https://example.com/world');
        await page.locator('.fixture-overlay').getByRole('button', { name: 'Сохранить', exact: true }).click();
        check(await editor.locator('a[href="https://example.com/world"]').count() === 1, 'Text link command lost the selected fragment'); await done();
        for (const [name, tag] of [['H1', 'h1'], ['H2', 'h2'], ['H3', 'h3'], ['Цитата', 'blockquote'], ['Маркированный список', 'ul'], ['Нумерованный список', 'ol']]) {
            await reset(); await open(); await palette.getByRole('button', { name, exact: true }).click();
            check(await editor.locator(tag).count() > 0, `Text command ${name} failed`);
            if (name.startsWith('H')) {
                const rendered = await editor.locator(tag).first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
                const exported = await page.evaluate(async () => { const f = window.designFixture; return (await f.boardSvg(f.service, f.sessions.get(f.initialBoard).board)).svg; });
                const exportedSize = Number(exported.match(/<text[^>]*font-size="([\d.]+)"/)?.[1]);
                check(Math.abs(rendered - exportedSize) < .01, `${name} exported at ${exportedSize}px instead of the displayed ${rendered}px`);
                await size.fill('25'); check((await runs()).every(run => run.size === 25), `${name}: entering 25px is overridden by heading size`);
                check(await size.inputValue() === '25', `${name}: size field jumps away from the entered value`);
            }
            for (const [alignName, align] of [['По центру', 'center'], ['По правому краю', 'right'], ['По левому краю', 'left']]) {
                await palette.getByRole('button', { name: alignName, exact: true }).click(); check((await runs()).every(run => run.align === align), `${alignName} failed after ${name}`);
            }
            await done();
            if (tag === 'h1') {
                if (mobile) await page.getByRole('button', { name: /Свойства/ }).click();
                await panel.getByLabel('Размер шрифта', { exact: true }).fill('32'); await panel.getByLabel('Размер шрифта', { exact: true }).press('Tab');
                check((await runs()).every(run => run.size === 32), 'Heading overrides the size set in properties');
                if (mobile) await panel.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
            }
        }
        reports.push(`PASS ${mobile ? 'Mobile' : 'Desktop'}: bold/italic/underline/strike, text links, H1/H2/H3, quote, lists, alignment and heading export size`);
        for (const kind of ['sticky', 'shape', 'frame']) {
            await reset(kind); await open(); await size.fill('25'); await color.fill('#ffffff'); await done();
            check((await runs()).every(run => run.size === 25 && run.color === 'rgb(255, 255, 255)'), `Formatting failed for ${kind}`);
        }
        await reset('text', { locked: true }); await page.locator('[data-item="t"] .design-rich-text').dblclick(); check(await editor.count() === 0, 'Locked text can be edited');
        await page.evaluate(() => { const f = window.designFixture, s = f.sessions.get(f.initialBoard); s.board.items[0].locked = false; s.board.readOnly = true; s.touch(); });
        await page.locator('[data-item="t"] .design-rich-text').dblclick(); check(await editor.count() === 0, 'Read-only text can be edited');
        reports.push(`PASS ${mobile ? 'Mobile' : 'Desktop'}: sticky/shape/frame formatting, locked and read-only guards`);
        await page.screenshot({ path: `tests/browser/design-results/text-${mobile ? 'mobile' : 'desktop'}.png` }); await context.close();
    }
    check(errors.length === 0, errors.join('\n'));
} catch (error) { errors.push(String(error)); if (page && !page.isClosed()) await page.screenshot({ path: 'tests/browser/design-results/text-error.png' }); process.exitCode = 1; }
finally { console.log([...reports, ...errors].join('\n')); await writeFile('tests/browser/design-results/text-report.txt', [...reports, ...errors].join('\n')); await browser.close(); }
