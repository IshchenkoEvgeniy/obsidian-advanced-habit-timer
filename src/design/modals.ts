import { FuzzySuggestModal, Modal } from 'obsidian';
import { mount, unmount } from 'svelte';
import SchemaEditor from './components/SchemaEditor.svelte';
import EntityEditor from './components/EntityEditor.svelte';
import type { DesignService } from './service';
import type { BoardItem, DesignEntity } from './types';
import ImageEditor from './components/ImageEditor.svelte';
import { BOARD_SHORTCUTS } from './shortcuts';
export class DesignHelpModal extends Modal {
    constructor(private service: DesignService) { super(service.plugin.app); }
    onOpen(): void { this.contentEl.createEl('h2', { text: this.service.tr('design_shortcuts') }); const list = this.contentEl.createEl('dl'); for (const [keys, label] of BOARD_SHORTCUTS) { list.createEl('dt', { text: keys }); list.createEl('dd', { text: this.service.tr(label) }); } }
}
export class DesignImageModal extends Modal {
    private component?: ReturnType<typeof mount>;
    constructor(private service: DesignService, private item: BoardItem, private save: (values: Partial<BoardItem>) => void) { super(service.plugin.app); }
    onOpen(): void { this.modalEl.addClass('design-image-modal'); this.component = mount(ImageEditor, { target: this.contentEl, props: { service: this.service, item: this.item, onClose: () => this.close(), onSave: (values: Partial<BoardItem>) => { this.save(values); this.close(); } } }); }
    onClose(): void { if (this.component) void unmount(this.component); }
}

export class DesignPicker<T> extends FuzzySuggestModal<T> {
    constructor(service: DesignService, private items: T[], private text: (item: T) => string, private choose: (item: T) => void, title: string) { super(service.plugin.app); this.setPlaceholder(title); }
    getItems(): T[] { return this.items; }
    getItemText(item: T): string { return this.text(item); }
    onChooseItem(item: T): void { this.choose(item); }
}
export class DesignPrompt extends Modal {
    constructor(private service: DesignService, private title: string, private initial: string, private submit: (value: string) => Promise<void>) { super(service.plugin.app); }
    onOpen(): void {
        this.contentEl.createEl('h3', { text: this.title }); const form = this.contentEl.createEl('form'); const input = form.createEl('input', { value: this.initial, attr: { 'aria-label': this.title, required: 'true' } });
        const button = form.createEl('button', { text: this.service.tr('save'), cls: 'mod-cta', attr: { type: 'submit' } });
        form.onsubmit = event => { event.preventDefault(); button.disabled = true; void this.submit(input.value).then(() => this.close()).catch(e => { this.service.report(e); button.disabled = false; }); }; input.focus();
    }
}
export class DesignConfirm extends Modal {
    constructor(private service: DesignService, private title: string, private submit: () => Promise<void>) { super(service.plugin.app); }
    onOpen(): void { this.contentEl.createEl('p', { text: this.title }); const yes = this.contentEl.createEl('button', { text: this.service.tr('design_confirm'), cls: 'mod-warning' }); yes.onclick = () => { yes.disabled = true; void this.submit().then(() => this.close()).catch(e => { this.service.report(e); yes.disabled = false; }); }; this.contentEl.createEl('button', { text: this.service.tr('cancel') }).onclick = () => this.close(); }
}
export class DesignSchemaModal extends Modal {
    private component?: ReturnType<typeof mount>;
    private opened = false;
    constructor(private service: DesignService, private initialType = '') { super(service.plugin.app); }
    onOpen(): void { this.opened = true; this.modalEl.addClass('design-schema-modal'); void this.service.initializeWorld().then(() => { if (this.opened) this.component = mount(SchemaEditor, { target: this.contentEl, props: { service: this.service, initialType: this.initialType, onClose: () => this.close() } }); }).catch(error => this.service.report(error)); }
    onClose(): void { this.opened = false; if (this.component) void unmount(this.component); }
}
export class NewDesignEntityModal extends Modal {
    private component?: ReturnType<typeof mount>;
    constructor(private service: DesignService, private saved: (entity: DesignEntity, add: boolean) => void, private currentBoard = false, private initialType = '', private initialValues: Record<string, unknown> = {}, private initialTitle = '') { super(service.plugin.app); }
    onOpen(): void { this.modalEl.addClass('design-record-modal'); this.component = mount(EntityEditor, { target: this.contentEl, props: { service: this.service, initialType: this.initialType, initialValues: this.initialValues, initialTitle: this.initialTitle, currentBoard: this.currentBoard, onClose: () => this.close(), onSaved: (entity: DesignEntity, add: boolean) => { this.saved(entity, add); this.close(); } } }); }
    onClose(): void { if (this.component) void unmount(this.component); }
}

/** Complete record editor opened from a canvas widget without replacing the board. */
export class DesignEntityModal extends Modal {
    private component?: ReturnType<typeof mount>;
    private unsubscribe?: () => void;
    constructor(private service: DesignService, private entity: DesignEntity, private readOnly = false) { super(service.plugin.app); }
    onOpen(): void {
        this.modalEl.addClass('design-record-modal');
        this.component = mount(EntityEditor, { target: this.contentEl, props: { service: this.service, entity: this.entity, readOnly: this.readOnly, onClose: () => this.close(), onSaved: () => this.close() } });
        this.unsubscribe = this.service.subscribe(() => {
            const latest = this.service.index.resolve(this.entity.id);
            if (latest) this.component?.refresh(latest);
        });
    }
    onClose(): void { this.unsubscribe?.(); this.unsubscribe = undefined; if (this.component) { void unmount(this.component); this.component = undefined; } }
}
