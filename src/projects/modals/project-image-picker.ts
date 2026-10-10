import { FuzzySuggestModal, Modal, type App, type TFile } from 'obsidian';
import { isProjectImageFile } from '../image-utils';

export class ProjectImageSuggestModal extends FuzzySuggestModal<TFile> {
    constructor(app: App, lang: string, private onChoose: (file: TFile) => void) {
        super(app);
        this.setPlaceholder(lang === 'ru' ? 'Выберите изображение из хранилища' : 'Choose an image from the vault');
    }

    getItems(): TFile[] { return this.app.vault.getFiles().filter(isProjectImageFile); }
    getItemText(file: TFile): string { return file.path; }
    onChooseItem(file: TFile): void { this.onChoose(file); }
}

export interface ProjectImagePickerOptions {
    ownerDocument: Document;
    multiple?: boolean;
}

/** Native menu callbacks can lack DOM user activation; keep a visible file control as a fallback. */
export function chooseProjectImageFiles(app: App, lang: string, onChoose: (files: File[]) => void,
    options: ProjectImagePickerOptions): () => void {
    let input: HTMLInputElement;
    let modal: Modal | undefined;
    let finished = false;
    const finish = (files: File[] = []): void => {
        if (finished) return;
        finished = true;
        input.remove();
        const closingModal = modal;
        modal = undefined;
        closingModal?.close();
        if (files.length) onChoose(files);
    };
    const createInput = (parent: HTMLElement, hidden: boolean): HTMLInputElement => {
        const element = parent.ownerDocument.createElement('input');
        element.type = 'file';
        element.accept = '.avif,.bmp,.gif,.jpeg,.jpg,.png,.svg,.webp';
        element.multiple = options.multiple !== false;
        element.hidden = hidden;
        element.setAttribute('aria-label', lang === 'ru' ? 'Выбрать изображения с устройства' : 'Choose images from device');
        // A menu's bubbling click handler must not cancel the file input's default action.
        element.addEventListener('click', event => event.stopPropagation());
        element.addEventListener('change', () => finish(Array.from(element.files || [])), { once: true });
        element.addEventListener('cancel', () => finish(), { once: true });
        parent.appendChild(element);
        return element;
    };
    const showFallback = (): void => {
        input.remove();
        modal = new Modal(app);
        modal.setTitle(lang === 'ru' ? 'Добавить изображения с устройства' : 'Add images from device');
        input = createInput(modal.contentEl, false);
        modal.onClose = () => { modal = undefined; finish(); };
        modal.open();
    };
    input = createInput(options.ownerDocument.body, true);
    try {
        const activation = options.ownerDocument.defaultView?.navigator.userActivation;
        if (activation && !activation.isActive) showFallback();
        else if (typeof input.showPicker === 'function') input.showPicker();
        else input.click();
    } catch (error) {
        if (modal) { finish(); throw error; }
        try { showFallback(); }
        catch (error) { finish(); throw error; }
    }
    return () => finish();
}
