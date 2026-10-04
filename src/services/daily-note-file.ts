import { TFile, type App } from 'obsidian';

export function dailyNotePath(folder: string, date: string): string {
    const normalized = folder.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
    return `${normalized ? `${normalized}/` : ''}${date}.md`;
}

export async function ensureDailyNoteFile(app: App, folder: string, date: string): Promise<TFile | null> {
    const path = dailyNotePath(folder, date);
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    try {
        const parents = path.split('/').slice(0, -1);
        for (let i = 1; i <= parents.length; i++) {
            const parent = parents.slice(0, i).join('/');
            if (!app.vault.getAbstractFileByPath(parent)) {
                try { await app.vault.createFolder(parent); }
                catch (error) { if (!app.vault.getAbstractFileByPath(parent)) throw error; }
            }
        }
        return await app.vault.create(path, '---\n---\n');
    } catch {
        const retry = app.vault.getAbstractFileByPath(path);
        return retry instanceof TFile ? retry : null;
    }
}
