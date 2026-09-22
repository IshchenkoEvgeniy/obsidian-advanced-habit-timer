import { describe, expect, it } from 'vitest';
import { findTaskBlockEnd } from '../src/projects/engine/task-block';
import { projectTaskId } from '../src/projects/types';
import { blockIdFromTaskLine, ensureTaskBlockIds, stripTaskBlockId } from '../src/projects/engine/task-identity';
import { ProjectCache } from '../src/projects/engine/cache';
import { projectTaskToData } from '../src/projects/task-data';
import { TFile } from 'obsidian';
import type { ProjectTask } from '../src/projects/types';

describe('project task identity', () => {
    it('distinguishes checklist tasks sharing a file', () => {
        expect(projectTaskId('Projects/Hub.md', 4)).not.toBe(projectTaskId('Projects/Hub.md', 9));
        expect(projectTaskId('Projects/Hub.md')).toBe('file:Projects/Hub.md');
    });

    it('adds stable Obsidian block ids only to parent tasks', () => {
        const source = '## To Do\n- [ ] First\n  - [ ] Child\n- [ ] Second ^existing';
        const migrated = ensureTaskBlockIds(source, 'Projects/Hub.md');
        const lines = migrated.content.split('\n');
        expect(migrated.changed).toBe(true);
        expect(blockIdFromTaskLine(lines[1]!)).toMatch(/^ht-/);
        expect(blockIdFromTaskLine(lines[2]!)).toBeUndefined();
        expect(blockIdFromTaskLine(lines[3]!)).toBe('existing');
        expect(stripTaskBlockId('Second ^existing')).toBe('Second');
        expect(ensureTaskBlockIds(migrated.content, 'Projects/Hub.md').changed).toBe(false);
    });
});

describe('project Markdown blocks', () => {
    it('keeps blank lines and indented subtasks in the parent block', () => {
        const lines = [
            '## To Do',
            '- [ ] Parent',
            '',
            '  - [ ] Child',
            '  - [x] Another child',
            '- [ ] Sibling'
        ];
        expect(findTaskBlockEnd(lines, 1, 0)).toBe(5);
        expect(lines.slice(1, findTaskBlockEnd(lines, 1, 0))).toEqual([
            '- [ ] Parent', '', '  - [ ] Child', '  - [x] Another child'
        ]);
    });
});

describe('project cache', () => {
    it('invalidates the same file in every project scope', () => {
        const cache = new ProjectCache();
        cache.set('scope-a\u0000Projects/Task.md', { mtime: 1, tasks: [] });
        cache.set('scope-b\u0000Projects/Task.md', { mtime: 1, tasks: [] });
        cache.invalidateCacheEntry('Projects/Task.md');
        expect(cache.get('scope-a\u0000Projects/Task.md')).toBeUndefined();
        expect(cache.get('scope-b\u0000Projects/Task.md')).toBeUndefined();
    });
});

describe('project task updates', () => {
    it('preserves unrelated fields when one property changes', () => {
        const task: ProjectTask = {
            id: 'file:Projects/Task.md', file: new TFile('Projects/Task.md'),
            name: 'Task', status: 'To Do', timeSpentSec: 120,
            timeEstimatedSec: 3600, habitName: 'Work', priority: 'high',
            startDate: '2026-07-20', endDate: '2026-07-25', tags: 'project, focus'
        };
        expect(projectTaskToData(task, () => '01:00:00', { status: 'Done' })).toMatchObject({
            status: 'Done', habitName: 'Work', priority: 'high',
            startDate: '2026-07-20', endDate: '2026-07-25', tags: 'project, focus'
        });
    });
});
