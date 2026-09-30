import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { collectTableStages, groupTableStages } from '../src/components/projects/table-stage-groups';
import { buildTableHierarchy } from '../src/components/projects/table-hierarchy';
import type { ProjectScopeDefinition, ProjectTask } from '../src/projects/types';

const scope: ProjectScopeDefinition = { id: 'test', name: 'Game', sourceType: 'file', sourceValue: 'Game.md', statuses: 'Backlog, Done' };
function task(id: string, section: string, status = 'Backlog', changes: Partial<ProjectTask> = {}): ProjectTask {
    return { id, name: id, file: new TFile('Game.md'), section, status, timeSpentSec: 0, ...changes };
}

describe('groups above project stages', () => {
    it('groups whole stages, preserves their internal source order and counts completed stages', () => {
        const tasks = [task('one', 'Этап 1', 'Done'), task('two', 'Этап 2'), task('three', 'Этап 3'), task('four', 'Этап 4')];
        const grouped = groupTableStages(collectTableStages(tasks), { ...scope,
            stageGroups: { 'stage:Этап 1': 'Prototype', 'stage:Этап 3': 'Prototype', 'stage:Этап 2': 'Release' }
        }, 'local', buildTableHierarchy(tasks, 'Done').stageProgress, 'Ungrouped');
        expect(grouped.map(stage => stage.key)).toEqual(['Этап 1', 'Этап 3', 'Этап 2', 'Этап 4']);
        expect(grouped[0]?.collection).toMatchObject({ label: 'Prototype', stages: 2, done: 1, first: true });
        expect(grouped[1]?.collection?.first).toBe(false);
        expect(grouped[3]?.collection?.label).toBe('Ungrouped');
    });

    it('keeps local assignments after renaming a stage with a persistent key', () => {
        const tasks = [task('one', 'Этап 1. Renamed', 'Backlog', { sectionKey: 'stage:original' })];
        const grouped = groupTableStages(collectTableStages(tasks), { ...scope,
            stageGroups: { 'stage:original': 'Prototype' }
        }, 'local', new Map(), 'Ungrouped');
        expect(grouped[0]?.collection?.label).toBe('Prototype');
    });

    it('uses the stage Issue field before child fields, including an explicitly empty value', () => {
        const tasks = [task('one', 'Этап 1'), task('two', 'Этап 2')];
        const linkedScope: ProjectScopeDefinition = { ...scope, githubNativeItems: {
            'stage:Этап 1': { itemId: 'i1', issueId: 'n1', baseTitle: 'Этап 1', meta: { fields: { Milestone: 'Release' } } },
            'stage:Этап 2': { itemId: 'i2', issueId: 'n2', baseTitle: 'Этап 2', meta: { fields: { Milestone: '' } } },
            'leaf:one': { itemId: 'i3', issueId: 'n3', baseTitle: 'one', meta: { fields: { Milestone: 'Child milestone' } } },
            'leaf:two': { itemId: 'i4', issueId: 'n4', baseTitle: 'two', meta: { fields: { Milestone: 'Child milestone' } } }
        } };
        const grouped = groupTableStages(collectTableStages(tasks), linkedScope, 'github:Milestone', new Map(), 'Ungrouped');
        expect(grouped.map(stage => stage.collection?.label)).toEqual(['Release', 'Ungrouped']);
    });

    it('keeps a linked stage without a grouping field unassigned even when its child has a value', () => {
        const tasks = [task('one', 'Этап 1')];
        const linkedScope: ProjectScopeDefinition = { ...scope, githubNativeItems: {
            'stage:Этап 1': { itemId: 'i1', issueId: 'n1', baseTitle: 'Этап 1', meta: { fields: {} } },
            'leaf:one': { itemId: 'i2', issueId: 'n2', baseTitle: 'one', meta: { fields: { Milestone: 'Child milestone' } } }
        } };
        expect(groupTableStages(collectTableStages(tasks), linkedScope, 'github:Milestone', new Map(), 'Ungrouped')[0]?.collection?.label)
            .toBe('Ungrouped');
    });

    it('does not split a stage when its children have different GitHub field values', () => {
        const tasks = [task('one', 'Этап 1'), task('two', 'Этап 1')];
        const linkedScope: ProjectScopeDefinition = { ...scope, githubNativeItems: {
            'leaf:one': { itemId: 'i1', issueId: 'n1', baseTitle: 'one', meta: { fields: { Release: 'Alpha' } } },
            'leaf:two': { itemId: 'i2', issueId: 'n2', baseTitle: 'two', meta: { fields: { Release: 'Beta' } } }
        } };
        const grouped = groupTableStages(collectTableStages(tasks), linkedScope, 'github:Release', new Map(), 'Ungrouped');
        expect(grouped).toHaveLength(1);
        expect(grouped[0]?.rows).toHaveLength(2);
        expect(grouped[0]?.collection?.label).toBe('Ungrouped');
    });
});
