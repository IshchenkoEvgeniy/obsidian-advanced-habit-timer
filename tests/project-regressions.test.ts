import { describe, expect, it, vi } from 'vitest';
import { App, TFile, parseYaml, stringifyYaml } from 'obsidian';
import type HabitTimerPlugin from '../src/main';
import { ProjectDataEngine } from '../src/projects/project-data';
import { ProjectParser } from '../src/projects/engine/parser';
import { ProjectMutator } from '../src/projects/engine/mutator';
import { ProjectCache } from '../src/projects/engine/cache';
import { taskMetadataMarker, readTaskMetadata } from '../src/projects/engine/task-metadata';
import { projectTaskToData } from '../src/projects/task-data';
import { boardHierarchyMatches, boardVisibleSubtasks, moveBoardTask } from '../src/projects/board-actions';
import { ProjectImageDraft } from '../src/projects/image-draft';
import { extractProjectImageReferences, projectImageEmbed, resolveProjectImage } from '../src/projects/image-utils';
import { renameProjectCovers, renamedProjectCover } from '../src/projects/image-renames';
import type { ProjectScopeDefinition } from '../src/projects/types';

const scope: ProjectScopeDefinition = { id: 'regression', name: 'Regression', sourceType: 'file',
    sourceValue: 'Project.md', statuses: 'Backlog, Done' };
const columns = ['Backlog', 'Done'];
const formatTime = () => '00:00:00';

function memory(initial: Record<string, string>) {
    const contents = new Map<string, string>();
    const files = new Map<string, TFile>();
    const folders = new Map<string, { path: string }>();
    function add(path: string, content = '') {
        const file = new TFile(path);
        Object.assign(file, { parent: { path: path.split('/').slice(0, -1).join('/') || '/' } });
        files.set(path, file); contents.set(path, content);
        return file;
    }
    for (const [path, content] of Object.entries(initial)) add(path, content);
    const frontmatter = (path: string): Record<string, unknown> => {
        const yaml = contents.get(path)?.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
        return yaml ? parseYaml(yaml) as Record<string, unknown> : {};
    };
    const process = vi.fn(async (file: TFile, update: (text: string) => string) => {
        const previous = contents.get(file.path)!;
        const next = update(previous);
        if (next !== previous) { contents.set(file.path, next); file.stat.mtime++; }
        return next;
    });
    const trashFile = vi.fn(async (file: TFile) => { files.delete(file.path); contents.delete(file.path); });
    const app = { vault: {
        read: async (file: TFile) => contents.get(file.path)!, cachedRead: async (file: TFile) => contents.get(file.path)!, process,
        modify: async (file: TFile, content: string) => { contents.set(file.path, content); file.stat.mtime++; },
        getAbstractFileByPath: (path: string) => files.get(path) || folders.get(path) || null,
        getFileByPath: (path: string) => files.get(path) || null,
        getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()].filter(file => file.extension === 'md'),
        create: async (path: string, content: string) => add(path, content),
        createBinary: async (path: string) => add(path),
        createFolder: async (path: string) => { const folder = { path }; folders.set(path, folder); return folder; },
        getResourcePath: (file: TFile) => `resource:${file.path}`,
    }, metadataCache: {
        resolvedLinks: {}, getFileCache: (file: TFile) => ({ frontmatter: frontmatter(file.path) }),
        getFirstLinkpathDest: (path: string, source: string) => files.get(path) || files.get(`${source.split('/').slice(0, -1).join('/')}/${path}`.replace(/^\//, '')) || null,
    }, fileManager: {
        getAvailablePathForAttachment: async (name: string) => `Assets/${name}`, trashFile,
        processFrontMatter: async (file: TFile, update: (properties: Record<string, unknown>) => void) => {
            const fm = frontmatter(file.path); update(fm);
            const body = contents.get(file.path)!.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '');
            contents.set(file.path, `---\n${stringifyYaml(fm)}---\n${body}`); file.stat.mtime++;
        }
    } } as unknown as App;
    const plugin = { settings: { projectScopes: [scope] }, formatTime, updateDailyNoteProjectLog: async () => {} } as unknown as HabitTimerPlugin;
    const parser = new ProjectParser(app, new ProjectCache());
    const mutator = new ProjectMutator(app, plugin, parser);
    const engine = new ProjectDataEngine(app, plugin);
    const parse = (definition = scope) => parser.loadTasks(definition);
    const simpleEngine = { saveTask: mutator.saveTask.bind(mutator), loadTasks: parse,
        moveTaskBefore: mutator.moveTaskBefore.bind(mutator),
        moveTaskAfter: (definition: ProjectScopeDefinition, source: Parameters<ProjectMutator['moveTaskBefore']>[1], target: Parameters<ProjectMutator['moveTaskBefore']>[2]) =>
            mutator.moveTaskBefore(definition, source, target, true)
    } as unknown as ProjectDataEngine;
    return { app, plugin, parser, mutator, engine, parse, simpleEngine, files, contents, add, trashFile, process };
}

describe('safe checklist field changes', () => {
    it('preserves distinct links with identical labels when renaming', async () => {
        const state = memory({ 'Project.md': '- [ ] Demo [Doc](One.md) [Doc](Two.md) ^demo' });
        const task = (await state.parse())[0]!;
        await state.mutator.saveTask(task.file, projectTaskToData(task, formatTime, { name: 'Changed Doc Doc' }), true, task.name, columns, task.blockId, task.sourceLine);
        expect(state.contents.get('Project.md')).toContain('Changed [Doc](One.md) [Doc](Two.md)');
    });
    it('does not insert a retained link into a new word or code span', async () => {
        const state = memory({ 'Project.md': '- [ ] Demo [Doc](One.md) ^demo' });
        const task = (await state.parse())[0]!;
        await state.mutator.saveTask(task.file, projectTaskToData(task, formatTime, { name: 'Documentation `Doc`' }), true, task.name, columns, task.blockId, task.sourceLine);
        expect(state.contents.get('Project.md')).toContain('Documentation `Doc` [Doc](One.md)');
    });
    it.each([{ priority: 'high' }, { status: 'Done' }, { endDate: '2026-10-10' }])('preserves links, images and formatting for %j', async changes => {
        const state = memory({ 'Project.md': '## Backlog\n- [ ] **Demo** ![[Assets/a.png]] ![b](Assets/b.png "Caption") [Docs](Guide.md) ^demo\n## Done' });
        const task = (await state.parse())[0]!;
        await state.mutator.saveTask(task.file, projectTaskToData(task, formatTime, changes), true, task.name, columns, task.blockId, task.sourceLine);
        expect(state.contents.get('Project.md')).toContain('**Demo** ![[Assets/a.png]] ![b](Assets/b.png "Caption") [Docs](Guide.md)');
    });
    it('retains embeds when explicitly renaming a task', async () => {
        const state = memory({ 'Project.md': '- [ ] Demo ![[Assets/a.png]] ^demo' });
        const task = (await state.parse())[0]!;
        await state.mutator.saveTask(task.file, projectTaskToData(task, formatTime, { name: 'Renamed' }), true, task.name, columns, task.blockId, task.sourceLine);
        expect(state.contents.get('Project.md')).toContain('Renamed ![[Assets/a.png]]');
    });
    it('retains link destinations on explicit rename without duplicating their labels', async () => {
        const state = memory({ 'Project.md': '- [ ] Demo [Docs](Guide.md) ^demo' });
        const task = (await state.parse())[0]!;
        await state.mutator.saveTask(task.file, projectTaskToData(task, formatTime, { name: 'Renamed Docs' }), true, task.name, columns, task.blockId, task.sourceLine);
        expect(state.contents.get('Project.md')).toContain('Renamed [Docs](Guide.md)');
        expect(state.contents.get('Project.md')).not.toContain('Renamed Docs [Docs]');
    });
    it('preserves field-like characters inside image paths', async () => {
        const state = memory({ 'Project.md': '- [ ] Demo ![[Assets/photo #tag here.png]] ^demo' });
        const task = (await state.parse())[0]!;
        await state.mutator.saveTask(task.file, projectTaskToData(task, formatTime, { priority: 'high' }), true, task.name, columns, task.blockId, task.sourceLine);
        expect(state.contents.get('Project.md')).toContain('![[Assets/photo #tag here.png]]');
    });
});

describe('subtask identity', () => {
    it('rejects an old line that now belongs to another checkbox', async () => {
        const state = memory({ 'Project.md': '- [ ] Parent ^parent\n  - [ ] Child ^child\n- [ ] Other ^other' });
        const child = (await state.parse())[0]!.subtasks![0]!;
        await state.app.vault.process(state.files.get('Project.md')!, content => content.replace('  - [ ] Child ^child\n', ''));
        await expect(state.mutator.toggleSubtask(state.files.get('Project.md')!, child, true)).rejects.toThrow();
        expect(state.contents.get('Project.md')).toContain('- [ ] Other ^other');
    });
    it('locates a moved subtask by its block ID', async () => {
        const state = memory({ 'Project.md': '- [ ] Parent ^parent\n  - [ ] Child ^child\n- [ ] Other ^other' });
        const child = (await state.parse())[0]!.subtasks![0]!;
        await state.app.vault.process(state.files.get('Project.md')!, content => '\n' + content);
        await state.mutator.toggleSubtask(state.files.get('Project.md')!, child, true);
        expect(state.contents.get('Project.md')).toContain('  - [x] Child');
        expect(state.contents.get('Project.md')).toContain('- [ ] Other ^other');
    });
    it('rejects an edited or unanchored moved subtask', async () => {
        const state = memory({ 'Project.md': '- [ ] Parent ^parent\n  - [ ] Child\n- [ ] Other ^other' });
        const child = (await state.parse())[0]!.subtasks![0]!;
        await state.app.vault.process(state.files.get('Project.md')!, content => '\n' + content);
        await expect(state.mutator.toggleSubtask(state.files.get('Project.md')!, child, true)).rejects.toThrow();
        expect(state.contents.get('Project.md')).toContain('  - [ ] Child');
    });
    it('refreshes subtask snapshots after initial ID migration', async () => {
        const state = memory({ 'Project.md': '- [ ] Parent\n  - [ ] Child' });
        const tasks = await state.engine.loadTasks(scope);
        const parent = tasks.find(task => !task.parentId)!;
        const child = parent.subtasks![0]!;
        expect(child.blockId).toBeTruthy();
        expect(child.sourceText).toBe(state.contents.get('Project.md')!.split('\n')[child.line]);
        await state.engine.toggleSubtask(parent.file, child, true);
        expect(state.contents.get('Project.md')).toContain('  - [x] Child');
    });
});

describe('board movements and hierarchy search', () => {
    it('reorders source blocks without resaving unrelated cards', async () => {
        const state = memory({ 'Project.md': '## Backlog\n- [ ] A ![[Assets/a.png]] ^a\n- [ ] B ^b\n- [ ] C ^c\n## Done' });
        const tasks = await state.parse();
        const save = vi.spyOn(state.simpleEngine, 'saveTask');
        await moveBoardTask(state.simpleEngine, scope, tasks, tasks[2]!.id, 'Backlog', tasks[1]!.id, formatTime, columns);
        expect((await state.parse()).map(task => task.blockId)).toEqual(['a', 'c', 'b']);
        expect(save).not.toHaveBeenCalled();
        expect(state.contents.get('Project.md')).toContain('![[Assets/a.png]]');
    });
    it('can move to the end of a column without losing the source subtree', async () => {
        const state = memory({ 'Project.md': '- [ ] A ^a\n  - [ ] Child ^child\n- [ ] B ^b\n- [ ] C ^c' });
        const tasks = await state.parse();
        await moveBoardTask(state.simpleEngine, scope, tasks, tasks[0]!.id, 'Backlog', undefined, formatTime, columns);
        expect((await state.parse()).map(task => task.blockId)).toEqual(['b', 'c', 'a', 'child']);
    });
    it('changes only the moved card when switching status', async () => {
        const state = memory({ 'Project.md': '## Backlog\n- [ ] A ^a\n## Done\n- [x] B ![[Assets/b.png]] ^b' });
        const tasks = await state.parse();
        const save = vi.spyOn(state.simpleEngine, 'saveTask');
        await moveBoardTask(state.simpleEngine, scope, tasks, tasks[0]!.id, 'Done', tasks[1]!.id, formatTime, columns);
        expect(save).toHaveBeenCalledTimes(1);
        expect(tasks[0]!.status).toBe('Backlog');
        expect(state.contents.get('Project.md')).toContain('- [x] B ![[Assets/b.png]] ^b');
        expect((await state.parse()).find(task => task.blockId === 'a')!.status).toBe('Done');
    });
    it('rejects reordering across checklist stages', async () => {
        const state = memory({ 'Project.md': '## Stage A\n- [ ] A ^a\n## Stage B\n- [ ] B ^b' });
        const tasks = await state.parse();
        const original = state.contents.get('Project.md');
        await expect(moveBoardTask(state.simpleEngine, scope, tasks, tasks[0]!.id, 'Backlog', tasks[1]!.id, formatTime, columns)).rejects.toThrow();
        expect(state.contents.get('Project.md')).toBe(original);
    });
    it('keeps ancestors of matching nested tasks in search and filters', async () => {
        const state = memory({ 'Project.md': '- [ ] Parent ^parent\n  - [ ] Child ^child\n    - [ ] Needle #match ^needle\n- [ ] Other ^other' });
        const tasks = await state.parse();
        expect([...boardHierarchyMatches(tasks, tasks.filter(task => task.name === 'Needle'))]).toEqual([tasks[2]!.id, tasks[1]!.id, tasks[0]!.id]);
    });
    it('shows the actual matching descendant and keeps its checkbox identity', async () => {
        const state = memory({ 'Project.md': '- [ ] Parent ^parent\n  - [ ] Child ^child\n    - [ ] Needle ^needle\n- [ ] Other ^other' });
        const tasks = await state.parse();
        const subtasks = boardVisibleSubtasks(tasks[0]!, tasks, tasks.filter(task => task.name === 'Needle'), task => task.status === 'Done');
        expect(subtasks.map(task => task.text)).toEqual(['Needle']);
        await state.mutator.toggleSubtask(tasks[0]!.file, subtasks[0]!, true);
        expect(state.contents.get('Project.md')).toContain('    - [x] Needle');
        expect(state.contents.get('Project.md')).toContain('  - [ ] Child');
    });
});

describe('status vocabulary', () => {
    it('keeps inline code and paragraph examples while renaming actual task metadata', async () => {
        const initial = '## Backlog\n- [ ] Real `<!-- project-status: Backlog -->` <!-- project-status: Backlog --> ^real\nExample: <!-- project-status: Backlog -->';
        const state = memory({ 'Project.md': initial });
        await state.engine.renameStatuses({ ...scope }, { Backlog: 'Inbox' });
        expect(state.contents.get('Project.md')).toContain('## Inbox\n- [ ] Real `<!-- project-status: Backlog -->` <!-- project-status: Inbox -->');
        expect(state.contents.get('Project.md')).toContain('Example: <!-- project-status: Backlog -->');
    });
    it('ignores YAML, fenced code and HTML comments during rename', async () => {
        const initial = '---\nexample: |\n  ## Backlog\n---\n## Backlog\n- [ ] Real <!-- project-status: Backlog --> ^real\n```md\n## Backlog\n- [ ] Example <!-- project-status: Backlog -->\n```\n<!--\n## Backlog\n-->';
        const state = memory({ 'Project.md': initial });
        await state.engine.renameStatuses({ ...scope }, { Backlog: 'Inbox' });
        const actual = state.contents.get('Project.md')!;
        expect(actual).toContain('## Inbox\n- [ ] Real <!-- project-status: Inbox -->');
        expect(actual).toContain('```md\n## Backlog\n- [ ] Example <!-- project-status: Backlog -->\n```');
        expect(actual).toContain('example: |\n  ## Backlog');
        expect(actual).toContain('<!--\n## Backlog\n-->');
    });
});

describe('image Markdown', () => {
    it.each([
        ['![a](Assets/a.png "Caption")', ['Assets/a.png']],
        ['![a](Assets/photo%20(1).png)', ['Assets/photo%20(1).png']],
        ['![a](Assets/photo\\(1\\).png)', ['Assets/photo(1).png']],
        ['![a](<Assets/photo (1).png> "Caption")', ['Assets/photo (1).png']],
        ['![[b.png]] ![a](a.png)', ['b.png', 'a.png']],
        ['```md\n![[a.png]]\n```\n`![[b.png]]`\n<!-- ![[c.png]] -->', []],
        ['\\![[a.png]] ![[b.png]]', ['b.png']],
        ['![Alt][id]\n[id]: Assets/a.png "Caption"', ['Assets/a.png']],
        ['![Alt][]\n[Alt]: Assets/a.png', ['Assets/a.png']],
    ])('parses %s', (markdown, expected) => expect(extractProjectImageReferences(markdown)).toEqual(expected));
    it('resolves wrapped URL and titled local covers', () => {
        const state = memory({ 'Project.md': '', 'Assets/a.png': '' });
        expect(resolveProjectImage(state.app, '![a](Assets/a.png "Caption")', 'Project.md')).toBe('resource:Assets/a.png');
        expect(resolveProjectImage(state.app, '![a](<https://example.test/a.png> "Caption")', 'Project.md')).toBe('https://example.test/a.png');
    });
    it('round trips uploaded filenames with brackets, spaces, percent and parentheses', () => {
        const state = memory({ 'Assets/a]] b%(1).png': '' });
        const file = state.files.get('Assets/a]] b%(1).png')!;
        const reference = extractProjectImageReferences(projectImageEmbed(file))[0]!;
        expect(resolveProjectImage(state.app, reference, 'Project.md')).toBe('resource:Assets/a]] b%(1).png');
    });
});

describe('image draft cancellation', () => {
    it('stops before file creation when closed during file reading', async () => {
        const state = memory({ 'Project.md': '' });
        let finish!: (bytes: ArrayBuffer) => void;
        const image = { name: 'a.png', arrayBuffer: () => new Promise<ArrayBuffer>(resolve => finish = resolve) } as File;
        const draft = new ProjectImageDraft(state.app, 'Project.md');
        const uploading = draft.upload(image);
        const cancelling = draft.cancel();
        finish(new ArrayBuffer(1));
        expect(await uploading).toBeNull(); await cancelling;
        expect(state.files.has('Assets/a.png')).toBe(false);
    });
    it('cleans only its own unreferenced uploads', async () => {
        const state = memory({ 'Project.md': '', 'Assets/existing.png': '' });
        const draft = new ProjectImageDraft(state.app, 'Project.md');
        await draft.upload({ name: 'a.png', arrayBuffer: async () => new ArrayBuffer(1) } as File);
        await draft.cancel();
        expect(state.files.has('Assets/a.png')).toBe(false);
        expect(state.files.has('Assets/existing.png')).toBe(true);
    });
    it('cleans an upload that finishes creating its file after closure', async () => {
        const state = memory({ 'Project.md': '' });
        let started!: () => void;
        let finish!: () => void;
        const creating = new Promise<void>(resolve => started = resolve);
        const pending = new Promise<void>(resolve => finish = resolve);
        state.app.vault.createBinary = async path => {
            started();
            await pending;
            return state.add(path);
        };
        const draft = new ProjectImageDraft(state.app, 'Project.md');
        const uploading = draft.upload({ name: 'a.png', arrayBuffer: async () => new ArrayBuffer(1) } as File);
        await creating;
        const cancelling = draft.cancel();
        finish();
        expect(await uploading).toBeNull();
        await cancelling;
        expect(state.files.has('Assets/a.png')).toBe(false);
        expect(state.trashFile).toHaveBeenCalledOnce();
    });
    it('shares cleanup between repeated cancellation requests', async () => {
        const state = memory({ 'Project.md': '' });
        const draft = new ProjectImageDraft(state.app, 'Project.md');
        await draft.upload({ name: 'a.png', arrayBuffer: async () => new ArrayBuffer(1) } as File);
        const first = draft.cancel();
        const second = draft.cancel();
        expect(first).toBe(second);
        await Promise.all([first, second]);
        expect(state.trashFile).toHaveBeenCalledOnce();
    });
    it('keeps a replacement file created at the same path', async () => {
        const state = memory({ 'Project.md': '' });
        const draft = new ProjectImageDraft(state.app, 'Project.md');
        await draft.upload({ name: 'a.png', arrayBuffer: async () => new ArrayBuffer(1) } as File);
        const replacement = state.add('Assets/a.png');
        await draft.cancel();
        expect(state.files.get('Assets/a.png')).toBe(replacement);
        expect(state.trashFile).not.toHaveBeenCalled();
    });
    it('keeps uploads referenced by a different note even before metadata refresh', async () => {
        const state = memory({ 'Project.md': '', 'Other.md': '![[Assets/a.png]]' });
        const draft = new ProjectImageDraft(state.app, 'Project.md');
        await draft.upload({ name: 'a.png', arrayBuffer: async () => new ArrayBuffer(1) } as File);
        await draft.cancel();
        expect(state.files.has('Assets/a.png')).toBe(true);
    });
    it('waits for an in-flight save and keeps committed attachments', async () => {
        const state = memory({ 'Project.md': '' });
        const draft = new ProjectImageDraft(state.app, 'Project.md');
        await draft.upload({ name: 'a.png', arrayBuffer: async () => new ArrayBuffer(1) } as File);
        let finish!: () => void;
        const submission = new Promise<void>(resolve => finish = resolve).then(() => { draft.commit(); });
        const cancelling = draft.cancel(submission);
        finish(); await cancelling;
        expect(state.files.has('Assets/a.png')).toBe(true);
    });
    it('keeps a referenced image if a save failed after writing the note', async () => {
        const state = memory({ 'Project.md': '' });
        const draft = new ProjectImageDraft(state.app, 'Project.md');
        await draft.upload({ name: 'a.png', arrayBuffer: async () => new ArrayBuffer(1) } as File);
        state.contents.set('Project.md', `- [ ] Task${taskMetadataMarker({ cover: 'Assets/a.png' })} ^task`);
        await draft.cancel(Promise.reject(new Error('State index write failed')));
        expect(state.files.has('Assets/a.png')).toBe(true);
    });
});

describe('cover image renames', () => {
    it('updates encoded checklist metadata and YAML covers without touching code examples', async () => {
        const marker = taskMetadataMarker({ cover: 'Assets/a.png', id: 'task' });
        const state = memory({ 'Project.md': `- [ ] Task${marker} ^task\n\n\`\`\`md\n- [ ] Example${marker} ^example\n\`\`\``,
            'Separate.md': '---\ncover: Assets/a.png\n---\nBody', 'Other.md': '---\ncover: Assets/other.png\n---\nBody' });
        await renameProjectCovers(state.app, [...state.files.values()], 'Assets/a.png', 'Assets/new.png');
        const content = state.contents.get('Project.md')!;
        expect(readTaskMetadata(content.split('\n')[0]!).cover).toBe('Assets/new.png');
        expect(content).toContain(`Example${marker}`);
        expect(state.contents.get('Separate.md')).toContain('cover: Assets/new.png');
        expect(state.contents.get('Other.md')).toContain('cover: Assets/other.png');
    });
    it('matches literal percent paths and relative destinations', () => {
        expect(renamedProjectCover('Assets/a%20.png', 'Project.md', 'Assets/a%20.png', 'Assets/new.png')).toBe('Assets/new.png');
        expect(renamedProjectCover('../Assets/a.png', 'Projects/Task.md', 'Assets/a.png', 'Assets/new.png')).toBe('Assets/new.png');
        expect(renamedProjectCover('Assets/other.png', 'Project.md', 'Assets/a.png', 'Assets/new.png')).toBeUndefined();
    });
    it('distinguishes literal percent names from encoded Markdown destinations', () => {
        expect(renamedProjectCover('Assets/a%20b.png', 'Project.md', 'Assets/a b.png', 'Assets/new.png')).toBeUndefined();
        expect(renamedProjectCover('![[Assets/a%20b.png]]', 'Project.md', 'Assets/a b.png', 'Assets/new.png')).toBeUndefined();
        expect(renamedProjectCover('![a](Assets/a%20b.png)', 'Project.md', 'Assets/a b.png', 'Assets/new.png')).toBe('Assets/new.png');
    });
});
