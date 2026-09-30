import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { compile, preprocess } from 'svelte/compiler';
import { sveltePreprocess } from 'svelte-preprocess';
import { TFile } from 'obsidian';
import { fieldKeys } from '../src/components/projects/table-view-config';
import type { ProjectScopeDefinition, ProjectTask } from '../src/projects/types';

let renderTable: (props: unknown) => string;
beforeAll(async () => {
    const result = await build({ stdin: { contents: `import Table from './src/components/projects/ProjectTable.svelte';
        import { render } from 'svelte/server'; export const renderTable = props => render(Table, { props }).body;`,
        resolveDir: process.cwd(), loader: 'js' }, bundle: true, platform: 'node', format: 'esm', write: false,
        plugins: [{ name: 'project-table-server-test', setup(builder) {
            builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve('tests/__mocks__/obsidian.ts') }));
            // Editing is not exercised by the render test; avoid loading the full plugin through its modal.
            builder.onResolve({ filter: /\/modals\/task-editor$/ }, () => ({ path: 'task-editor', namespace: 'table-test' }));
            builder.onLoad({ filter: /.*/, namespace: 'table-test' }, () => ({ contents: 'export class TaskEditorModal {}', loader: 'js' }));
            builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
                const source = await preprocess(await readFile(path, 'utf8'), sveltePreprocess(), { filename: path });
                return { contents: compile(source.code, { generate: 'server', filename: path }).js.code,
                    loader: 'js', resolveDir: resolve(path, '..') };
            });
        } }] });
    const module: unknown = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString('base64')}`);
    renderTable = (module as { renderTable: (props: unknown) => string }).renderTable;
}, 30000);
afterEach(() => vi.unstubAllGlobals());

function render(saved: Record<string, unknown> | null, changes: Partial<ProjectScopeDefinition> = {}): string {
    const scope: ProjectScopeDefinition = { id: 'test', name: 'Game', sourceType: 'file', sourceValue: 'Game.md',
        statuses: 'Backlog, Done', githubProjectUrl: 'https://github.com/users/test/projects/1', ...changes };
    const tasks: ProjectTask[] = [{ id: 'one', file: new TFile('Game.md'), name: 'First step', section: 'Этап 1',
        status: 'Done', timeSpentSec: 0, checklistAncestors: [{ id: 'g1', title: '1. Parent', sourceLine: 1 }] },
        { id: 'two', file: new TFile('Game.md'), name: 'Second step', section: 'Этап 1', status: 'Backlog', timeSpentSec: 0,
            checklistAncestors: [{ id: 'g2', title: '2. Parent', sourceLine: 3 }] }];
    const storage = new Map<string, string>();
    if (saved) storage.set('habit-timer:project-table:test', JSON.stringify(saved));
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value) });
    return renderTable({ scope, plugin: { settings: { language: 'ru' }, formatTime: () => '00:00:00' }, app: {}, dataEngine: {},
        ctx: { allTasks: tasks, filteredTasks: tasks, selectedTasks: new Set(), columns: ['Backlog', 'Done'],
            compactMode: false, onRefresh: () => undefined } });
}

describe('project table initial render', () => {
    it('renders restored progress columns on the first render, without toggling any checkbox', () => {
        const html = render({ visible: ['assignees', 'status', 'linkedPrs', 'subIssues'], fieldOrder: [...fieldKeys] });
        const header = html.match(/<thead\b[^>]*>[\s\S]*?<\/thead>/)![0];
        expect(header).toContain('Прогресс подзадач');
        expect(header).toContain('Исполнители');
        expect(header).not.toContain('Оценка');
        expect(html).toContain('50%');
    });

    it('keeps current column changes when an older saved view is active', () => {
        const html = render({ visible: ['status', 'subIssues'], fieldOrder: [...fieldKeys], activeViewId: 'custom',
            savedViews: [{ id: 'custom', name: 'Проверка', config: { visible: ['status', 'estimate'], groupBy: 'section' } }] });
        const header = html.match(/<thead\b[^>]*>[\s\S]*?<\/thead>/)![0];
        expect(header).toContain('Прогресс подзадач');
        expect(header).not.toContain('Оценка');
        expect(html).toContain('dirty-dot');
    });

    it('shows local checklist progress by default', () => {
        expect(render(null, { githubProjectUrl: undefined })).toContain('Прогресс подзадач');
    });

    it('restores a collapsed group above stages while keeping its progress visible', () => {
        const key = JSON.stringify(['local', 'Prototype']);
        const html = render({ visible: ['status', 'subIssues'], groupBy: 'section', stageGrouping: 'local', collapsedStageGroups: [key] },
            { stageGroups: { 'stage:Этап 1': 'Prototype' } });
        expect(html).toContain('Prototype');
        expect(html).toContain('Выполнено этапов');
        expect(html).not.toContain('class="stage-row');
    });
});
