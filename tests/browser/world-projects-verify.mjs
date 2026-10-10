import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require(process.env.DESIGN_PLAYWRIGHT_DIR || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = [];
const check = (value, message) => { if (!value) throw new Error(message); reports.push(message); };
try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } }); page.on('pageerror', error => errors.push(String(error)));
    await page.goto('http://127.0.0.1:4181'); await page.waitForSelector('.project-dataset-nav');
    check(await page.getByRole('button', { name: 'GitHub Sync', exact: true }).count() === 1, 'Main development plan retains GitHub sync');
    const stageBefore = await page.evaluate(() => JSON.stringify(window.worldProjectsFixture.snapshot));
    await page.getByRole('button', { name: 'Таблицы мира', exact: true }).first().click(); await page.waitForSelector('.world-table');
    check(await page.getByRole('button', { name: 'GitHub Sync', exact: true }).count() === 0, 'World tables expose no GitHub sync action');
    check(await page.locator('.world-table').textContent().then(text => text.includes('Trader')), 'World records are available inside ProjectsApp');
    await page.getByRole('button', { name: 'Роль: Merchant', exact: true }).click(); await page.locator('.world-cell-editing input').fill('Miner'); await page.locator('.world-cell-editing').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByRole('button', { name: 'Роль: Miner', exact: true }).waitFor();
    check(await page.evaluate(() => window.worldProjectsFixture.service.index.all()[0].values.role) === 'Miner', 'Projects world table writes only the world source');
    check(await page.evaluate(() => window.worldProjectsFixture.syncs) === 0, 'Switching and editing world tables never invokes GitHub sync');
    await page.getByRole('button', { name: 'План разработки · GitHub', exact: true }).click();
    check(await page.getByRole('button', { name: 'GitHub Sync', exact: true }).count() === 1, 'Returning to plan restores its GitHub action');
    check(await page.locator('.projects-app').textContent().then(text => text.includes('Implement trader') && text.includes('Stage 1')), 'Stage hierarchy and plan tasks remain available');
    check(stageBefore === await page.evaluate(() => JSON.stringify(window.worldProjectsFixture.snapshot)), 'World editing does not replace the plan store');
    check(!errors.length, 'No integration runtime errors'); console.log(JSON.stringify({ reports, errors }, null, 2));
} finally { await browser.close(); }
