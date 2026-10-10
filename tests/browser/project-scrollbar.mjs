import { context } from 'esbuild';
import esbuildSvelte from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { resolve } from 'node:path';

const session = await context({
  stdin: { contents: "import { mount } from 'svelte'; import Fixture from './ProjectScrollbar.svelte'; mount(Fixture, { target: document.getElementById('root') });", resolveDir: resolve('tests/browser'), loader: 'js' },
  bundle: true, platform: 'browser', format: 'esm', write: false,
  outfile: 'tests/browser/bundle.js',
  plugins: [{ name: 'obsidian-browser-fixture', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve('tests/__mocks__/obsidian.ts') }));
    builder.onResolve({ filter: /\/modals\/task-editor$/ }, () => ({ path: 'task-editor', namespace: 'browser-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'browser-fixture' }, () => ({ contents: 'export class TaskEditorModal { open() {} }', loader: 'js' }));
  } }, esbuildSvelte({ compilerOptions: { css: 'injected' }, preprocess: sveltePreprocess() })],
});
await session.serve({ host: '127.0.0.1', port: 4179, servedir: 'tests/browser' });
console.log('Projects scrollbar fixture: http://127.0.0.1:4179');
