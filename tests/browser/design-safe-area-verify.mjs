import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url), { chromium } = require(process.env.DESIGN_PLAYWRIGHT_DIR || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true }), reports = [], errors = [];
const check = (value, message) => { if (!value) throw new Error(message); };
await mkdir('tests/browser/design-results', { recursive: true });
let page;
try {
    for (const config of [
        { name: 'Android zero env', width: 393, height: 851, android: true, top: 48, bottom: 48 },
        { name: 'Android native insets', width: 393, height: 851, android: true, top: 40, bottom: 56, native: true },
        { name: 'iOS native insets', width: 393, height: 851, android: false, top: 47, bottom: 34, native: true },
        { name: 'Android landscape zero env', width: 851, height: 393, android: true, top: 48, bottom: 48, right: 48 },
        { name: 'Android reverse landscape zero env', width: 851, height: 393, android: true, top: 48, bottom: 48, left: 48 },
    ]) {
        const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, isMobile: true, hasTouch: true });
        await context.addInitScript(({ width, height }) => { const viewport = new EventTarget(); Object.assign(viewport, { width, height, offsetTop: 0, offsetLeft: 0 }); Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true }); window.fixtureViewport = viewport; }, config);
        page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
        await page.goto('http://127.0.0.1:4180'); await page.waitForSelector('[data-item="e0"]');
        await page.addStyleTag({ content: '#root{padding:70px 0 90px;box-sizing:border-box}.fixture-controls{display:none!important}.system-overlay{position:fixed;z-index:1000;background:#333;pointer-events:auto;left:0;right:0}' });
        await page.evaluate(config => {
            document.getElementById('root').style.paddingRight = (config.right || 0) + 'px';
            document.getElementById('root').style.paddingLeft = (config.left || 0) + 'px';
            document.body.classList.toggle('is-android', config.android); document.body.classList.add('is-mobile');
            for (const side of ['top', 'right', 'bottom', 'left']) document.body.style.setProperty('--safe-area-inset-' + side, (config.native ? config[side] || 0 : 0) + 'px');
            const top = document.createElement('div'), bottom = document.createElement('div'); top.className = bottom.className = 'system-overlay'; top.style.cssText = `top:0;height:${config.top}px`; bottom.style.cssText = `bottom:0;height:${config.bottom}px`; top.textContent = 'Status bar'; bottom.textContent = 'Back / Home / Recent'; document.body.append(top, bottom);
            if (config.right) { const right = document.createElement('div'); right.className = 'system-overlay'; right.style.cssText = `left:auto;right:0;top:0;bottom:0;width:${config.right}px`; document.body.append(right); }
            if (config.left) { const left = document.createElement('div'); left.className = 'system-overlay'; left.style.cssText = `right:auto;left:0;top:0;bottom:0;width:${config.left}px`; document.body.append(left); }
        }, config);
        await page.getByRole('button', { name: 'Редактировать на весь экран', exact: true }).tap();
        const rect = async selector => page.locator(selector).boundingBox();
        let header = await rect('.design-board-heading'), palette = await rect('.design-palette'), canvas = await rect('.design-canvas');
        check(header.y >= config.top && palette.y + palette.height <= config.height - config.bottom, `${config.name}: controls overlap system bars`);
        check(palette.x + palette.width <= config.width - (config.right || 0), `${config.name}: toolbar overlaps landscape navigation`);
        check(palette.x >= (config.left || 0), `${config.name}: toolbar overlaps reverse-landscape navigation`);
        check(canvas.height >= (config.height - config.top - config.bottom) * (config.width > config.height ? .65 : .7), `${config.name}: excessive chrome shrinks the board`);
        await page.getByRole('button', { name: 'Ещё', exact: true }).tap(); await page.locator('.design-palette.is-expanded').waitFor({ timeout: 3000 });
        palette = await rect('.design-palette'); check(palette.y >= header.y + header.height && palette.y + palette.height <= config.height - config.bottom, `${config.name}: expanded tools overlap protected areas`);
        await page.locator('.design-palette').getByRole('button', { name: 'Текст', exact: true }).tap();
        const editor = page.locator('.design-editing-text'); await editor.fill('Текст выше системных кнопок');
        await page.locator('.design-palette').getByLabel('Размер шрифта', { exact: true }).fill('25');
        await page.locator('.design-palette').getByLabel('Цвет текста', { exact: true }).fill('#ffffff');
        palette = await rect('.design-palette'); check(palette.y + palette.height <= config.height - config.bottom, `${config.name}: formatting overlaps navigation`);
        if (config.height > config.width) {
            await page.evaluate(() => { window.fixtureViewport.height = 430; window.fixtureViewport.dispatchEvent(new Event('resize')); document.querySelectorAll('.system-overlay').forEach(node => node.remove()); });
            await page.waitForTimeout(100); const root = await rect('.design-root'); canvas = await rect('.design-canvas'); palette = await rect('.design-palette'); const text = await editor.boundingBox();
            check(root.height === 430 && palette.y + palette.height <= 430 && text.y >= canvas.y && text.y < palette.y, `${config.name}: keyboard hides editor or controls`);
            await page.evaluate(() => { window.fixtureViewport.offsetTop = 12; window.fixtureViewport.offsetLeft = 4; window.fixtureViewport.width -= 4; window.fixtureViewport.dispatchEvent(new Event('scroll')); });
            await page.waitForTimeout(50); const shifted = await rect('.design-root'); check(shifted.x === 4 && shifted.y === 12, `${config.name}: visual viewport offsets ignored`);
            await page.evaluate(() => { window.fixtureViewport.height = 851; window.fixtureViewport.width = 393; window.fixtureViewport.offsetTop = window.fixtureViewport.offsetLeft = 0; window.fixtureViewport.dispatchEvent(new Event('resize')); });
        }
        await page.getByRole('button', { name: 'Готово', exact: true }).tap();
        await page.screenshot({ path: `tests/browser/design-results/safe-area-${config.name.replaceAll(' ', '-').toLowerCase()}.png` });
        await page.getByRole('button', { name: 'Выйти из полноэкранного режима', exact: true }).tap();
        check(await page.locator('body > .design-root').count() === 0, 'Exit left a full-screen overlay');
        check(await page.locator('.design-root').evaluate(node => !node.style.getPropertyValue('--design-safe-top')), 'Exit retained full-screen insets');
        reports.push(`PASS ${config.name}: header, tools, text formatting, keyboard/viewport and exit`); await context.close();
    }
    check(errors.length === 0, errors.join('\n'));
} catch (error) { errors.push(String(error)); if (page && !page.isClosed()) await page.screenshot({ path: 'tests/browser/design-results/safe-area-error.png' }); process.exitCode = 1; }
finally { console.log([...reports, ...errors].join('\n')); await writeFile('tests/browser/design-results/safe-area-report.txt', [...reports, ...errors].join('\n')); await browser.close(); }
