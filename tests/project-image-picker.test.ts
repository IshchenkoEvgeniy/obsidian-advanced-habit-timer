import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { chooseProjectImageFiles } from '../src/projects/modals/project-image-picker';
import { attachProjectImagesFromDevice, type ProjectImageActionContext } from '../src/projects/project-image-actions';

const modals = vi.hoisted(() => ({ instances: [] as { contentEl: unknown; open: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>; onClose: () => void; title: string }[], document: undefined as unknown,
    openError: undefined as Error | undefined, notices: [] as string[] }));

vi.mock('obsidian', async importOriginal => {
    const actual = await importOriginal<typeof import('obsidian')>();
    return { ...actual, Notice: class {
        hide = vi.fn();
        constructor(message: string) { modals.notices.push(message); }
    }, Modal: class {
        contentEl = new Parent(modals.document as TestDocument);
        title = '';
        onClose = () => {};
        open = vi.fn(() => { if (modals.openError) throw modals.openError; });
        close = vi.fn(() => this.onClose());
        constructor() { modals.instances.push(this); }
        setTitle(title: string) { this.title = title; }
    } };
});

class Parent {
    children: Input[] = [];
    constructor(public ownerDocument: TestDocument) {}
    appendChild(input: Input) { input.parent = this; this.children.push(input); }
}

class Input extends EventTarget {
    type = '';
    accept = '';
    multiple = false;
    hidden = false;
    files: File[] = [];
    parent: Parent | undefined;
    attributes = new Map<string, string>();
    showPicker: (() => void) | undefined = vi.fn();
    click = vi.fn(() => this.dispatchEvent(new Event('click')));
    remove = vi.fn(() => {
        if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
        this.parent = undefined;
    });
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
}

class TestDocument {
    body = new Parent(this);
    defaultView = { navigator: { userActivation: { isActive: true } } };
    inputs: Input[] = [];
    createElement() { const input = new Input(); this.inputs.push(input); return input; }
}

function fixture(active = true) {
    const document = new TestDocument();
    document.defaultView.navigator.userActivation.isActive = active;
    // A modal may be mounted in a different document by Obsidian.
    const modalDocument = new TestDocument();
    modals.document = modalDocument;
    const choose = vi.fn();
    const open = (multiple = true) => chooseProjectImageFiles({} as App, 'ru', choose,
        { ownerDocument: document as unknown as Document, multiple });
    return { document, modalDocument, choose, open };
}

afterEach(() => { modals.instances.length = 0; modals.notices.length = 0; modals.openError = undefined; });

describe('device image picker', () => {
    it('opens synchronously in the invoking pane and bypasses synthetic menu clicks', () => {
        const state = fixture();
        const dispose = state.open();
        const input = state.document.inputs[0]!;
        expect(input.type).toBe('file');
        expect(input.hidden).toBe(true);
        expect(input.multiple).toBe(true);
        expect(input.accept).toContain('.png');
        expect(input.parent).toBe(state.document.body);
        expect(input.showPicker).toHaveBeenCalledOnce();
        expect(input.click).not.toHaveBeenCalled();
        expect(modals.instances).toHaveLength(0);
        dispose();
    });
    it('passes all selected files once and removes the transient input', () => {
        const state = fixture();
        state.open();
        const input = state.document.inputs[0]!;
        input.files = [{ name: 'one.png' }, { name: 'two.jpg' }] as File[];
        input.dispatchEvent(new Event('change'));
        input.dispatchEvent(new Event('change'));
        expect(state.choose).toHaveBeenCalledExactlyOnceWith(input.files);
        expect(state.document.body.children).toHaveLength(0);
    });
    it('shows a visible file control when a native menu has no DOM activation', () => {
        const state = fixture(false);
        state.open();
        expect(state.document.inputs[0]!.showPicker).not.toHaveBeenCalled();
        expect(state.document.body.children).toHaveLength(0);
        const modal = modals.instances[0]!;
        const input = state.modalDocument.inputs[0]!;
        expect(modal.open).toHaveBeenCalledOnce();
        expect(input.hidden).toBe(false);
        expect(input.multiple).toBe(true);
        expect(input.parent).toBe(modal.contentEl);
        expect(input.attributes.get('aria-label')).toBe('Выбрать изображения с устройства');
        input.files = [{ name: 'one.png' }] as File[];
        input.dispatchEvent(new Event('change'));
        expect(state.choose).toHaveBeenCalledExactlyOnceWith(input.files);
        expect(modal.close).toHaveBeenCalledOnce();
    });
    it('falls back when showPicker is blocked despite reported activation', () => {
        const state = fixture();
        const originalCreate = state.document.createElement.bind(state.document);
        state.document.createElement = () => {
            const input = originalCreate();
            input.showPicker = vi.fn(() => { throw new DOMException('Blocked', 'NotAllowedError'); });
            return input;
        };
        state.open();
        expect(modals.instances[0]!.open).toHaveBeenCalledOnce();
        expect(state.modalDocument.inputs[0]!.hidden).toBe(false);
        expect(state.choose).not.toHaveBeenCalled();
    });
    it('supports legacy pickers and stops the click reaching menu handlers', () => {
        const state = fixture();
        const originalCreate = state.document.createElement.bind(state.document);
        state.document.createElement = () => { const input = originalCreate(); input.showPicker = undefined; return input; };
        state.open();
        const input = state.document.inputs[0]!;
        expect(input.click).toHaveBeenCalledOnce();
        const event = new Event('click', { cancelable: true });
        const stop = vi.spyOn(event, 'stopPropagation');
        input.dispatchEvent(event);
        expect(stop).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(false);
    });
    it('cleans up when the native picker is cancelled and permits choosing again', () => {
        const state = fixture();
        state.open();
        state.document.inputs[0]!.dispatchEvent(new Event('cancel'));
        expect(state.choose).not.toHaveBeenCalled();
        expect(state.document.body.children).toHaveLength(0);
        state.open();
        const input = state.document.inputs[1]!;
        input.files = [{ name: 'same.png' }] as File[];
        input.dispatchEvent(new Event('change'));
        expect(state.choose).toHaveBeenCalledOnce();
    });
    it('cleans up when the fallback modal closes without selection', () => {
        const state = fixture(false);
        state.open();
        modals.instances[0]!.close();
        expect(state.modalDocument.inputs[0]!.parent).toBeUndefined();
        expect(state.choose).not.toHaveBeenCalled();
        expect(modals.instances[0]!.close).toHaveBeenCalledOnce();
    });
    it('ignores late file events after the task editor closes', () => {
        const state = fixture(false);
        const dispose = state.open(false);
        const input = state.modalDocument.inputs[0]!;
        expect(input.multiple).toBe(false);
        dispose(); dispose();
        input.files = [{ name: 'late.png' }] as File[];
        input.dispatchEvent(new Event('change'));
        expect(state.choose).not.toHaveBeenCalled();
        expect(modals.instances[0]!.close).toHaveBeenCalledOnce();
    });
    it('removes the input and surfaces failure when the fallback cannot open', () => {
        const state = fixture(false);
        modals.openError = new Error('Window unavailable');
        expect(() => state.open()).toThrow('Window unavailable');
        expect(modals.instances).toHaveLength(1);
        expect(state.document.body.children).toHaveLength(0);
        expect(state.modalDocument.inputs[0]!.parent).toBeUndefined();
        expect(state.choose).not.toHaveBeenCalled();
    });
    it('copies selected files and saves their links through the quick task action', async () => {
        const state = fixture();
        const task = { id: 'device-task', file: new TFile('Project.md'), notePath: 'Project.tasks/Task.md',
            name: 'Task', status: 'Backlog', description: 'Existing description', timeSpentSec: 0 };
        const createBinary = vi.fn(async (path: string, _bytes: ArrayBuffer) => new TFile(path));
        const getPath = vi.fn(async (name: string, _source: string) => `Assets/${name}`);
        const saveTaskDescription = vi.fn(async () => {});
        const onRefresh = vi.fn();
        const context = { app: { vault: { createBinary, getResourcePath: (file: TFile) => `resource:${file.path}` },
            fileManager: { getAvailablePathForAttachment: getPath } },
            scope: { id: 'device-scope', sourceType: 'file', sourceValue: 'Project.md' }, task, lang: 'ru',
            dataEngine: { loadTasks: async () => [task], saveTaskDescription, invalidateCacheEntry: vi.fn() },
            ownerDocument: state.document, onRefresh } as unknown as ProjectImageActionContext;
        attachProjectImagesFromDevice(context);
        const input = state.document.inputs[0]!;
        input.files = ['one.png', 'two.jpg'].map(name => ({ name, arrayBuffer: async () => new ArrayBuffer(1) })) as File[];
        input.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
        expect(getPath).toHaveBeenNthCalledWith(1, 'one.png', 'Project.tasks/Task.md');
        expect(createBinary).toHaveBeenCalledTimes(2);
        expect(saveTaskDescription).toHaveBeenCalledExactlyOnceWith(context.scope, task,
            'Existing description\n\n![[Assets/one.png]]\n\n![[Assets/two.jpg]]');
        expect(modals.notices).toEqual(['Добавление изображений…']);
    });
    it('reports an opening failure through the quick task action', () => {
        const state = fixture(false);
        modals.openError = new Error('Window unavailable');
        attachProjectImagesFromDevice({ app: {} as App, scope: { id: 'device-scope' }, task: { id: 'device-task' },
            ownerDocument: state.document, lang: 'ru' } as unknown as ProjectImageActionContext);
        expect(modals.notices[0]).toContain('Не удалось открыть выбор изображения');
        expect(modals.notices[0]).toContain('Window unavailable');
    });
});
