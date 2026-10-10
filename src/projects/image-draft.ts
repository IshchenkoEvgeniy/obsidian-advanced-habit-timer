import { Notice, parseYaml, type App, type TFile } from 'obsidian';
import { extractProjectImageReferences, resolveProjectImage } from './image-utils';
import { readTaskMetadata } from './engine/task-metadata';

interface CreatedImage { file: TFile; path: string; mtime: number; size: number; }

/** Only this draft's newly created files can be cleaned up on cancellation. */
export class ProjectImageDraft {
    private closed = false;
    private committed = false;
    private pending: Promise<TFile | null> | undefined;
    private cleanup: Promise<void> | undefined;
    private created: CreatedImage[] = [];

    constructor(private app: App, private sourcePath: string) {}

    async upload(image: File): Promise<TFile | null> {
        if (this.closed || this.pending) return null;
        const operation = this.create(image);
        this.pending = operation;
        try { return await operation; }
        finally { if (this.pending === operation) this.pending = undefined; }
    }

    private async create(image: File): Promise<TFile | null> {
        const bytes = await image.arrayBuffer();
        if (this.closed) return null;
        const path = await this.app.fileManager.getAvailablePathForAttachment(image.name, this.sourcePath);
        if (this.closed) return null;
        const file = await this.app.vault.createBinary(path, bytes);
        this.created.push({ file, path: file.path, mtime: file.stat.mtime, size: file.stat.size });
        return this.closed ? null : file;
    }

    commit(): void { this.committed = true; }

    cancel(submission?: Promise<unknown>): Promise<void> {
        this.closed = true;
        return this.cleanup ??= this.cleanupCreated(submission);
    }

    private async cleanupCreated(submission?: Promise<unknown>): Promise<void> {
        await Promise.allSettled([this.pending, submission]);
        if (this.committed || !this.created.length) return;
        try {
            // Read actual notes too: metadataCache may not have observed a new reference yet.
            const notes = await Promise.all(this.app.vault.getMarkdownFiles().map(async note => {
                const content = await this.app.vault.read(note);
                const references = extractProjectImageReferences(content);
                for (const line of content.split('\n')) {
                    const cover = readTaskMetadata(line).cover;
                    if (cover) references.push(cover);
                }
                const yaml = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
                if (yaml !== undefined) {
                    const properties: unknown = parseYaml(yaml);
                    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
                        for (const key of ['cover', 'image']) {
                            const value = (properties as Record<string, unknown>)[key];
                            if (typeof value === 'string') references.push(value);
                        }
                    }
                }
                return new Set(references.map(reference => resolveProjectImage(this.app, reference, note.path)).filter(Boolean));
            }));
            for (const image of this.created) {
                if (this.app.vault.getFileByPath(image.path) !== image.file) continue;
                if (image.file.path !== image.path || image.file.stat.mtime !== image.mtime || image.file.stat.size !== image.size) continue;
                const linked = Object.values(this.app.metadataCache.resolvedLinks || {}).some(links => Boolean(links[image.path]));
                const resource = this.app.vault.getResourcePath(image.file);
                if (linked || notes.some(references => references.has(resource))) continue;
                await this.app.fileManager.trashFile(image.file);
            }
        } catch (error) {
            new Notice(`Could not clean up unsaved image attachments: ${String(error)}`);
        }
    }
}
