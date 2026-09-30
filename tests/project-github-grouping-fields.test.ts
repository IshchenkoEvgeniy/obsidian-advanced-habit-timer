import { describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { GitHubProjectsClient } from '../src/projects/github-client';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

describe('GitHub fields for grouping stages', () => {
    it('includes issue milestones and custom stage fields in the loaded snapshot', async () => {
        vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { data: { user: { projectV2: {
            id: 'p1', title: 'Game', url: 'https://github.com/users/test/projects/1',
            fields: { nodes: [{ id: 'm1', name: 'Milestone', dataType: 'MILESTONE' },
                { id: 'f1', name: 'Release', dataType: 'SINGLE_SELECT', options: [{ id: 'o1', name: 'Alpha' }] }],
                pageInfo: { hasNextPage: false, endCursor: null } },
            items: { nodes: [{ id: 'i1', isArchived: false, content: { __typename: 'Issue', id: 'n1', title: 'Этап 1',
                milestone: { title: 'Prototype' } }, fieldValues: { nodes: [{ __typename: 'ProjectV2ItemFieldSingleSelectValue',
                    name: 'Alpha', field: { name: 'Release' } }] } }], pageInfo: { hasNextPage: false, endCursor: null } }
        } } } }, text: '', headers: {}, arrayBuffer: new ArrayBuffer(0) });
        const snapshot = await new GitHubProjectsClient('test-token').loadProject('https://github.com/users/test/projects/1');
        expect(snapshot.items[0]?.fields).toMatchObject({ Milestone: 'Prototype', Release: 'Alpha' });
        expect(snapshot.fields.map(field => field.type)).toEqual(['MILESTONE', 'SINGLE_SELECT']);
    });
});
