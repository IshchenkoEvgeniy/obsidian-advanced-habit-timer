import esbuild from 'esbuild';
import esbuildSvelte from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
const result = await esbuild.build({ stdin: { contents: "import { mount } from 'svelte'; import Fixture from './WorldProjectsFixture.svelte'; mount(Fixture, { target: document.getElementById('root') });", resolveDir: resolve('tests/browser'), loader: 'js' }, bundle: true, platform: 'browser', format: 'esm', write: false,
    plugins: [{ name: 'world-projects-fixture', setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve('tests/__mocks__/obsidian.ts') }));
        builder.onResolve({ filter: /\/modals\/task-editor$/ }, () => ({ path: 'task-editor', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export class TaskEditorModal {}', loader: 'js' }));
    } }, esbuildSvelte({ compilerOptions: { css: 'injected' }, preprocess: sveltePreprocess() })] });
const files = new Map([['/', ['text/html', await readFile('tests/browser/design.html')]], ['/styles.css', ['text/css', await readFile('styles.css')]], ['/bundle.js', ['text/javascript', result.outputFiles[0].contents]]]);
createServer((req, res) => { const file = files.get(req.url?.split('?')[0]); if (!file) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': file[0], 'Cache-Control': 'no-store' }); res.end(file[1]); }).listen(4181, '127.0.0.1', () => console.log('World / development plan integration fixture: http://127.0.0.1:4181'));
