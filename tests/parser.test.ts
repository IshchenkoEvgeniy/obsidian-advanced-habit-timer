import { describe, it, expect, vi } from 'vitest';
import { ProjectParser } from '../src/projects/engine/parser';
import { App, TFile } from 'obsidian';
import type { ProjectScopeDefinition, ProjectTask } from '../src/projects/types';
import type { ProjectCache } from '../src/projects/engine/cache';

/** Typed view of the parser's private members used by the parseSingleFile test. */
interface ParserInternals {
    app: {
        metadataCache: { getFileCache: (file: TFile) => { frontmatter: Record<string, unknown> } | null };
        vault: {
            read: (file: TFile) => Promise<string>;
            modify: (file: TFile, data: string) => Promise<void>;
        };
    };
    parseSingleFile(file: TFile, columns: string[], scope: ProjectScopeDefinition): Promise<ProjectTask[]>;
}

describe('ProjectParser', () => {

    const mockApp = {} as App;
    const mockCache = { get: vi.fn().mockReturnValue(null), set: vi.fn() } as unknown as ProjectCache;
    const parser = new ProjectParser(mockApp, mockCache);

    describe('matchesExcludePatterns', () => {
        it('should not exclude if patterns are empty', () => {
            expect(parser.matchesExcludePatterns('file.md', '')).toBe(false);
        });

        it('should exclude by directory prefix', () => {
            expect(parser.matchesExcludePatterns('Archive/test.md', 'Archive/')).toBe(true);
            expect(parser.matchesExcludePatterns('Archive/2024/test.md', 'Archive/')).toBe(true);
            expect(parser.matchesExcludePatterns('test.md', 'Archive/')).toBe(false);
        });

        it('should exclude by exact match or substring', () => {
            expect(parser.matchesExcludePatterns('secret.md', 'secret.md')).toBe(true);
            expect(parser.matchesExcludePatterns('folder/secret.md', 'secret.md')).toBe(true);
        });

        it('should handle negation (include back)', () => {
            // "Archive/, !Archive/Keep/"
            // Archive/test.md is excluded. Archive/Keep/test.md should NOT be excluded.
            expect(parser.matchesExcludePatterns('Archive/test.md', 'Archive/, !Archive/Keep/')).toBe(true);
            expect(parser.matchesExcludePatterns('Archive/Keep/test.md', 'Archive/, !Archive/Keep/')).toBe(false);
        });
    });

    describe('findTaskLineIndex', () => {
        it('should find exact match in clean text', () => {
            const lines = [
                '# Header',
                '- [ ] Some task',
                '- [x] Target task'
            ];
            const res = parser.findTaskLineIndex(lines, 'Target task');
            expect(res.lineIdx).toBe(2);
            expect(res.checked).toBe(true);
            expect(res.indent).toBe(0);
        });

        it('should ignore emojis and metadata when matching', () => {
            const lines = [
                '- [ ] Target task ⏱️ 01:30 ⏳ 02:00 🏷️ Habit ⏫ 📅 2024-01-01 🏁 2024-12-31 #tag [[Habits/Sleep]]'
            ];
            // The task Name should be purely "Target task"
            const res = parser.findTaskLineIndex(lines, 'Target task');
            expect(res.lineIdx).toBe(0);
            expect(res.checked).toBe(false);
        });

        it('should parse indentation correctly', () => {
            const lines = [
                '- [ ] Parent',
                '  - [x] Child'
            ];
            const res = parser.findTaskLineIndex(lines, 'Child');
            expect(res.lineIdx).toBe(1);
            expect(res.indent).toBe(2);
            expect(res.checked).toBe(true);
        });

        it('uses block id to distinguish duplicate task names', () => {
            const lines = [
                '- [ ] Repeated task ^ht-first',
                '- [ ] Repeated task ^ht-second'
            ];
            expect(parser.findTaskLineIndex(lines, 'Repeated task', 'ht-second').lineIdx).toBe(1);
        });
    });

    describe('parseSingleFile (Markdown Regex)', () => {
        it('should parse all task metadata correctly', async () => {
            // We use a typed cast to access the private members
            const p = parser as unknown as ParserInternals;

            // Mock a TFile and app vault
            const mockFile = new TFile('test.md');
            mockFile.stat.mtime = 1;
            
            p.app = {
                metadataCache: {
                    getFileCache: () => ({ frontmatter: {} })
                },
                vault: {
                    read: vi.fn().mockResolvedValue(`
## To Do
- [ ] Task with time ⏱️ 01:30:00 ⏳ 02:00:00
- [ ] Task with habit 🏷️ Reading [[Habits/Sleep]]
- [ ] Task with priority ⏫
- [ ] Task with dates 📅 2024-01-01 🏁 2024-01-10
- [ ] Task with tags and images #project ![img](http://link) ![[img2.png]]
- [x] Completed task
                    `.trim()),
                    modify: vi.fn().mockResolvedValue(undefined)
                }
            };

            const scope: ProjectScopeDefinition = {
                id: '1', name: 'Test', sourceType: 'folder', sourceValue: '',
                statuses: 'To Do, Done', excludePatterns: '', defaultHabit: '', autoTrack: false
            };
            const columns = ['To Do', 'Done'];

            const tasks = await p.parseSingleFile(mockFile, columns, scope);

            expect(tasks).toHaveLength(6);
            expect(new Set(tasks.map(task => task.id)).size).toBe(6);

            const tTime = tasks.find(t => t.name === 'Task with time');
            expect(tTime!.timeSpentSec).toBe(90 * 60); // 1:30:00
            expect(tTime!.timeEstimatedSec).toBe(120 * 60); // 2:00:00
            expect(tTime!.status).toBe('To Do');

            const tHabit = tasks.find(t => t.name === 'Task with habit');
            // 'Reading' should be matched as habit
            expect(tHabit!.habitName).toBe('Reading');

            const tPriority = tasks.find(t => t.name === 'Task with priority');
            expect(tPriority!.priority).toBe('high');

            const tDates = tasks.find(t => t.name === 'Task with dates');
            expect(tDates!.startDate).toBe('2024-01-01');
            expect(tDates!.endDate).toBe('2024-01-10');

            const tTags = tasks.find(t => t.name.startsWith('Task with tags and images'));
            expect(tTags!.tags).toContain('project');
            expect(tTags!.images).toContain('http://link');
            expect(tTags!.images).toContain('img2.png');

            const tCompleted = tasks.find(t => t.name === 'Completed task');
            expect(tCompleted!.status).toBe('Done');
        });
    });
});
