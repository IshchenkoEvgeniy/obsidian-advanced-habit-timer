import { Menu, Notice, type App, type TFile } from 'obsidian';
import { appendProjectImages, extractProjectImageReferences, isProjectImageFilename, resolveProjectImage } from './image-utils';
import { chooseProjectImageFiles, ProjectImageSuggestModal } from './modals/project-image-picker';
import type { ProjectDataEngine } from './project-data';
import type { ProjectScopeDefinition, ProjectTask } from './types';

export interface ProjectImageActionContext {
    app: App;
    dataEngine: ProjectDataEngine;
    scope: ProjectScopeDefinition;
    task: ProjectTask;
    lang: string;
    onRefresh: () => void;
    ownerDocument: Document;
}

const pendingTasks = new Set<string>();
const actionKey = (context: ProjectImageActionContext): string => `${context.scope.id}\u0000${context.task.id}`;

async function attachImages(context: ProjectImageActionContext, selected: TFile[] | File[]): Promise<void> {
    const key = actionKey(context);
    if (pendingTasks.has(key)) return;
    pendingTasks.add(key);
    const progress = new Notice(context.lang === 'ru' ? 'Добавление изображений…' : 'Adding images…', 0);
    const created: { file: TFile; path: string }[] = [];
    let committed = false;
    let descriptionSourcePath = '';
    try {
        const currentTask = async (): Promise<ProjectTask> => {
            const task = (await context.dataEngine.loadTasks(context.scope)).find(candidate => candidate.id === context.task.id);
            if (!task) throw new Error(context.lang === 'ru' ? 'Задача перемещена или удалена. Обновите проект.' : 'The task moved or was deleted. Refresh the project.');
            return task;
        };
        const task = await currentTask();
        descriptionSourcePath = task.notePath || task.file.path;
        const images: TFile[] = [];
        if (selected.some(file => 'arrayBuffer' in file && !isProjectImageFilename(file.name))) {
            throw new Error(context.lang === 'ru' ? 'Выберите изображения PNG, JPEG, GIF, WebP, SVG, AVIF или BMP.' : 'Choose PNG, JPEG, GIF, WebP, SVG, AVIF or BMP images.');
        }
        for (const file of selected) {
            if ('arrayBuffer' in file) {
                const path = await context.app.fileManager.getAvailablePathForAttachment(file.name, task.notePath || task.file.path);
                const attachment = await context.app.vault.createBinary(path, await file.arrayBuffer());
                created.push({ file: attachment, path });
                images.push(attachment);
            } else {
                images.push(file);
            }
        }
        // Read again after copying: another editor may have updated the description meanwhile.
        const latest = await currentTask();
        descriptionSourcePath = latest.notePath || latest.file.path;
        const description = appendProjectImages(context.app, latest.description || '', images, latest.notePath || latest.file.path);
        if (description !== (latest.description || '')) {
            await context.dataEngine.saveTaskDescription(context.scope, latest, description);
        }
        committed = true;
        context.dataEngine.invalidateCacheEntry(latest.file.path);
        context.onRefresh();
    } catch (error) {
        if (!committed) {
            // The note may have been written even if a later state-index write failed.
            let persistedSources: Set<string | null> | undefined;
            try {
                const note = context.app.vault.getFileByPath(descriptionSourcePath);
                if (note) {
                    const content = await context.app.vault.read(note);
                    persistedSources = new Set(extractProjectImageReferences(content)
                        .map(reference => resolveProjectImage(context.app, reference, descriptionSourcePath)));
                }
            } catch { /* Keep files if the written note cannot be inspected safely. */ }
            for (const attachment of created) {
                const referenced = Object.values(context.app.metadataCache.resolvedLinks)
                    .some(links => Boolean(links[attachment.path])) ||
                    persistedSources?.has(context.app.vault.getResourcePath(attachment.file));
                if (!persistedSources || referenced || attachment.file.path !== attachment.path) continue;
                try { await context.app.fileManager.trashFile(attachment.file); }
                catch { new Notice(context.lang === 'ru' ? `Не удалось убрать незаписанное вложение: ${attachment.path}` : `Could not remove the unsaved attachment: ${attachment.path}`); }
            }
        }
        new Notice(String(error));
    } finally {
        progress.hide();
        pendingTasks.delete(key);
    }
}

export function attachProjectImageFromVault(context: ProjectImageActionContext): void {
    if (pendingTasks.has(actionKey(context))) return;
    new ProjectImageSuggestModal(context.app, context.lang, file => {
        void attachImages(context, [file]);
    }).open();
}

export function attachProjectImagesFromDevice(context: ProjectImageActionContext): void {
    if (pendingTasks.has(actionKey(context))) return;
    try {
        chooseProjectImageFiles(context.app, context.lang, files => { void attachImages(context, files); },
            { ownerDocument: context.ownerDocument });
    } catch (error) {
        new Notice(context.lang === 'ru' ? `Не удалось открыть выбор изображения: ${String(error)}` : `Could not open the image picker: ${String(error)}`);
    }
}

export function addProjectImageMenuItems(menu: Menu, context: ProjectImageActionContext): void {
    const busy = pendingTasks.has(actionKey(context));
    menu.addItem(item => item.setTitle(context.lang === 'ru' ? 'Добавить изображение из хранилища' : 'Add image from vault')
        .setIcon('image-plus').setDisabled(busy).onClick(() => attachProjectImageFromVault(context)));
    menu.addItem(item => item.setTitle(context.lang === 'ru' ? 'Добавить изображения с устройства' : 'Add images from device')
        .setIcon('upload').setDisabled(busy).onClick(() => attachProjectImagesFromDevice(context)));
}

export function showProjectImageMenu(event: MouseEvent, context: ProjectImageActionContext, onEdit: () => void): void {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem(item => item.setTitle(context.lang === 'ru' ? 'Редактировать задачу' : 'Edit task')
        .setIcon('pencil').onClick(onEdit));
    menu.addSeparator();
    addProjectImageMenuItems(menu, context);
    menu.showAtMouseEvent(event);
}
