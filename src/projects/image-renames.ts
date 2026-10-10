import { normalizePath, parseYaml, TFile, type App } from 'obsidian';
import { projectImageReferencePath } from './image-utils';
import { markdownContentLines } from './engine/markdown-lines';
import { readTaskMetadata, replaceTaskMetadata } from './engine/task-metadata';

export function renamedProjectCover(reference: string, sourcePath: string, oldPath: string, newPath: string): string | undefined {
    const path = projectImageReferencePath(reference);
    if (/^(https?:|data:image\/)/i.test(path)) return undefined;
    const paths = [path];
    if (/^!?\[(?!\[)/.test(reference.trim())) {
        try { paths.push(decodeURIComponent(path)); } catch { /* Literal filename. */ }
    }
    const clean = (value: string): string => {
        const parts: string[] = [];
        for (const part of value.split('/')) {
            if (part === '..') parts.pop();
            else if (part && part !== '.') parts.push(part);
        }
        return normalizePath(parts.join('/'));
    };
    return paths.some(candidate => candidate === oldPath ||
        clean(`${sourcePath.split('/').slice(0, -1).join('/')}/${candidate}`) === oldPath) ? newPath : undefined;
}

/** Cover paths in encoded checklist metadata cannot be maintained by Obsidian's link updater. */
export async function renameProjectCovers(app: App, files: TFile[], oldPath: string, newPath: string): Promise<void> {
    for (const file of files) {
        const updateChecklist = (content: string): string => {
            const lines = content.split('\n');
            const contentLines = markdownContentLines(lines);
            return lines.map((line, index) => {
                if (!contentLines[index] || !/^[ \t]*-[ \t]+\[[ xX]\]/.test(line)) return line;
                const metadata = readTaskMetadata(line);
                if (!metadata.cover) return line;
                const cover = renamedProjectCover(metadata.cover, file.path, oldPath, newPath);
                return cover ? replaceTaskMetadata(line, { ...metadata, cover }) : line;
            }).join('\n');
        };
        const snapshot = await app.vault.read(file);
        if (updateChecklist(snapshot) !== snapshot) await app.vault.process(file, updateChecklist);
        const content = await app.vault.read(file);
        const yaml = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
        if (yaml === undefined) continue;
        const raw: unknown = parseYaml(yaml);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const fields = raw as Record<string, unknown>;
        if (!['cover', 'image'].some(key => typeof fields[key] === 'string' && renamedProjectCover(fields[key], file.path, oldPath, newPath))) continue;
        await app.fileManager.processFrontMatter(file, properties => {
            const current = properties as Record<string, unknown>;
            for (const key of ['cover', 'image']) {
                const value = current[key];
                if (typeof value !== 'string') continue;
                const updated = renamedProjectCover(value, file.path, oldPath, newPath);
                if (updated) current[key] = updated;
            }
        });
    }
}
