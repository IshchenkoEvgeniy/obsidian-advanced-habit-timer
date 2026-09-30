import { describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { ProjectCache } from '../src/projects/engine/cache';
import { ProjectParser } from '../src/projects/engine/parser';
import type { ProjectScopeDefinition } from '../src/projects/types';

function fixture(sourceType: 'file' | 'folder') {
    const file = new TFile('Projects/Module/Task.md');
    file.stat.mtime = 7;
    const read = vi.fn().mockResolvedValue('- [ ] Open task\n- [x] Complete task');
    const app = { vault: { read, cachedRead: read, getMarkdownFiles: () => [file], getAbstractFileByPath: () => file },
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) } } as unknown as App;
    const scope: ProjectScopeDefinition = { id: 'same', name: 'Test', sourceType,
        sourceValue: sourceType === 'file' ? file.path : 'Projects', statuses: 'Backlog, Done', color: '#111111' };
    return { parser: new ProjectParser(app, new ProjectCache()), scope, read, file };
}

describe('project cache after scope settings change', () => {
    it('reuses unchanged checklist data, then refreshes statuses and color without a file edit', async () => {
        const { parser, scope, read, file } = fixture('file');
        expect((await parser.loadTasks(scope)).map(task => task.status)).toEqual(['Backlog', 'Done']);
        await parser.loadTasks(scope);
        expect(read).toHaveBeenCalledTimes(1);
        scope.statuses = 'Planned, Released';
        scope.color = '#ff0000';
        const tasks = await parser.loadTasks(scope);
        expect(file.stat.mtime).toBe(7);
        expect(tasks.map(task => task.status)).toEqual(['Planned', 'Released']);
        expect(tasks.every(task => task.color === '#ff0000')).toBe(true);
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('refreshes separate-file defaults and sections after changing a folder scope', async () => {
        const { parser, scope, read } = fixture('folder');
        expect((await parser.loadTasks(scope))[0]).toMatchObject({ status: 'Backlog', section: 'Module', color: '#111111' });
        scope.sourceValue = 'Projects/Module';
        scope.statuses = 'Planned, Released';
        scope.color = '#ff0000';
        expect((await parser.loadTasks(scope))[0]).toMatchObject({ status: 'Planned', section: undefined, color: '#ff0000' });
        expect(read).toHaveBeenCalledTimes(2);
    });
});
