import { App, normalizePath, parseYaml, stringifyYaml, TFile } from 'obsidian';
import type { ChecklistStateEntry } from './checklist-state';
import { stableHash } from './engine/task-identity';
import { validateTaskDescription } from './description-validation';

export interface ChecklistNoteState {
    source: string;
    entries: ChecklistStateEntry[];
    rootNotes?: Record<string, string>;
    pendingNoteArchives?: { path: string; fingerprint: string; key: string; destination: string }[];
    pendingSectionMoves?: { path: string; key: string; destination: string; description: string; destinationDescription?: string; anchor?: string; title?: string }[];
}

export function checklistNoteLink(entry: { notePath?: string; noteAnchor?: string }): string | undefined {
    return entry.notePath ? `${entry.notePath.replace(/\.md$/i, '')}${entry.noteAnchor ? '#^' + entry.noteAnchor : ''}` : undefined;
}

function sectionKey(entry: ChecklistStateEntry): string {
    return entry.kind === 'task' ? `task:${entry.id.replace(/^(leaf|task):/, '')}` : entry.id;
}

function anchor(key: string): string {
    return `pt-${stableHash(key)}-${stableHash([...key].reverse().join(''))}`;
}

export function localCompletionTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const two = (value: number) => String(value).padStart(2, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes < 0 ? '-' : '+';
    const offset = `${sign}${two(Math.floor(Math.abs(offsetMinutes) / 60))}:${two(Math.abs(offsetMinutes) % 60)}`;
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
        `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())} ${offset}`;
}

function frontmatter(content: string): Record<string, unknown> {
    const yaml = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const parsed: unknown = yaml ? parseYaml(yaml[1] || '') : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid project note frontmatter.');
    return parsed as Record<string, unknown>;
}

function noteBody(content: string): string {
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
}

const sectionPattern = (): RegExp => /^<!-- project-section: (\S+) -->\r?\n([\s\S]*?)^<!-- \/project-section: \1 -->[ \t]*(?:\r?\n|$)/gm;

function readSections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    for (const match of content.matchAll(sectionPattern())) {
        const key = decodeURIComponent(match[1]!);
        if (sections.has(key)) throw new Error(`Duplicate task section in project note: ${key}`);
        const header = /^<!-- project-section-header:start -->\r?\n[\s\S]*?^<!-- project-section-header:end -->[ \t]*(?:\r?\n|$)/m;
        if (!header.test(match[2]!)) throw new Error(`Task section header is damaged: ${key}. Restore its markers before syncing.`);
        sections.set(key, match[2]!.replace(header, '').trim());
    }
    const starts = content.match(/^<!-- project-section:/gm)?.length || 0;
    const ends = content.match(/^<!-- \/project-section:/gm)?.length || 0;
    if (starts !== sections.size || ends !== starts) throw new Error('A project note section marker was removed or damaged. Restore its markers before syncing.');
    return sections;
}

function filename(id: string, title: string): string {
    const slug = title.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, '-').slice(0, 64) || 'project';
    return `${slug}-${stableHash(id)}.md`;
}

function fingerprint(content: string): string {
    return `${content.length}:${stableHash(content)}:${stableHash([...content].reverse().join(''))}`;
}

function entryDepth(entry: ChecklistStateEntry, byId: Map<string, ChecklistStateEntry>): number {
    let depth = 1;
    let parent = entry.parentId ? byId.get(entry.parentId) : undefined;
    const seen = new Set([entry.id]);
    while (parent) {
        if (seen.has(parent.id)) throw new Error('Cycle in project task hierarchy.');
        seen.add(parent.id);
        depth++;
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return depth;
}

function markdownTitle(title: string): string {
    return title.replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]]/g, '\\$&');
}

function sectionContent(entry: ChecklistStateEntry, description: string, depth: number): string {
    const key = encodeURIComponent(sectionKey(entry));
    const fields = [entry.checked ? '✅ ' + entry.status : '○ ' + entry.status];
    if (entry.completedAt) fields.push(`Завершено: ${localCompletionTime(entry.completedAt)}`);
    else if (entry.checked) fields.push('Время завершения неизвестно');
    if (entry.startDate) fields.push(`Начало: ${entry.startDate}`);
    if (entry.dueDate) fields.push(`Срок: ${entry.dueDate}`);
    if (entry.priority) fields.push(`Приоритет: ${entry.priority}`);
    if (entry.tags) fields.push(`Метки: ${entry.tags}`);
    if (entry.habitName) fields.push(`Привычка: ${entry.habitName}`);
    if (entry.estimateSeconds) fields.push(`Оценка: ${entry.estimateSeconds} с`);
    if (entry.timeSpentSeconds) fields.push(`Затрачено: ${entry.timeSpentSeconds} с`);
    if (entry.archived) fields.push('В архиве');
    if (entry.github?.url) fields.push(`[GitHub](${entry.github.url})`);
    return `<!-- project-section: ${key} -->\n<!-- project-section-header:start -->\n` +
        `${'#'.repeat(Math.min(6, Math.max(2, depth + 1)))} ${markdownTitle(entry.title)}\n\n` +
        `${fields.join(' · ')} ^${entry.noteAnchor}\n<!-- project-section-header:end -->\n\n` +
        `${description.trim()}\n\n<!-- /project-section: ${key} -->\n`;
}

/** Descriptions live in editable sections; the JSON index contains only state and links. */
export class ChecklistNotes {
    constructor(private app: App) {}

    private folder(source: TFile): string { return normalizePath(source.path.replace(/\.md$/i, '') + '.tasks'); }

    async descriptions(state: ChecklistNoteState, snapshots?: Map<string, string>): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        const files = new Map<string, { sections?: Map<string, string>; body: string; rootId?: unknown }>();
        for (const entry of state.entries) {
            if (!entry.notePath) continue;
            let stored = files.get(entry.notePath);
            if (!stored) {
                const file = this.app.vault.getAbstractFileByPath(entry.notePath);
                if (!(file instanceof TFile)) {
                    if (entry.noteRootId) throw new Error(`Project note is missing: ${entry.notePath}. Restore it before syncing.`);
                    continue;
                }
                const content = await this.app.vault.read(file);
                snapshots?.set(entry.notePath, content);
                const fm = frontmatter(content);
                stored = { body: noteBody(content), sections: fm.project_root_note ? readSections(content) : undefined, rootId: fm.project_root_id };
                files.set(entry.notePath, stored);
            }
            if (entry.noteRootId && (!stored.sections || stored.rootId !== entry.noteRootId)) {
                throw new Error(`Project note properties are damaged: ${entry.notePath}. Restore project_root_note and project_root_id before syncing.`);
            }
            if (stored.sections && !stored.sections.has(sectionKey(entry))) throw new Error(`Task section is missing in ${entry.notePath}: ${entry.title}`);
            result.set(entry.id, stored.sections ? stored.sections.get(sectionKey(entry))! : stored.body);
        }
        return result;
    }

    async sync(source: TFile, state: ChecklistNoteState, overrides = new Map<string, string>(), expected?: Map<string, string>): Promise<Map<string, string>> {
        const snapshots = new Map<string, string>();
        const descriptions = await this.descriptions(state, snapshots);
        for (const value of descriptions.values()) validateTaskDescription(value);
        for (const value of overrides.values()) validateTaskDescription(value);
        for (const [id, value] of expected || []) {
            if ((descriptions.get(id) || '') !== value.trim()) throw new Error('Description changed while editing or syncing. Refresh before saving.');
        }
        for (const [id, description] of overrides) descriptions.set(id, description.trim());
        const byId = new Map(state.entries.map(entry => [entry.id, entry]));
        const roots = new Map<string, { title: string; entries: ChecklistStateEntry[] }>();
        const previousPaths = new Map(state.entries.filter(entry => entry.notePath).map(entry => [entry.id, entry.notePath!]));
        const paths = { ...(state.rootNotes || {}) };
        const pendingArchives = new Map((state.pendingNoteArchives || []).map(item => [item.path, item]));
        const pendingMoves = new Map((state.pendingSectionMoves || []).map(item => [`${item.path}:${item.key}`, item]));
        const folder = this.folder(source);
        const occupiedAnchors = new Set<string>();
        for (const entry of state.entries) {
            let root = entry;
            const visited = new Set<string>();
            while (root.parentId && byId.has(root.parentId)) {
                if (visited.has(root.id)) throw new Error('Cycle in project task hierarchy.');
                visited.add(root.id);
                root = byId.get(root.parentId)!;
            }
            if (root.kind !== 'stage' && entry.stage) root = state.entries.find(candidate => candidate.kind === 'stage' && candidate.title === entry.stage) || root;
            const rootId = root.kind === 'stage' ? root.id : 'root:unstaged';
            const title = root.kind === 'stage' ? root.title : 'Задачи без этапа';
            if (!roots.has(rootId)) roots.set(rootId, { title, entries: [] });
            roots.get(rootId)!.entries.push(entry);
            entry.noteRootId = rootId;
            entry.noteAnchor = entry.noteAnchor || anchor(sectionKey(entry));
            if (occupiedAnchors.has(entry.noteAnchor)) throw new Error('Duplicate task anchor in project notes.');
            occupiedAnchors.add(entry.noteAnchor);
            if (!paths[rootId]) paths[rootId] = normalizePath(`${folder}/${filename(rootId, title)}`);
            entry.notePath = paths[rootId];
        }

        for (const entry of state.entries) {
            const oldPath = previousPaths.get(entry.id);
            if (!oldPath || oldPath === entry.notePath) continue;
            const file = this.app.vault.getAbstractFileByPath(oldPath);
            if (!(file instanceof TFile)) continue;
            const content = snapshots.get(oldPath);
            if (content === undefined) throw new Error('Missing migration snapshot. Refresh the project.');
            const fm = frontmatter(content);
            if (fm.project_root_note) {
                const key = sectionKey(entry);
                pendingMoves.set(`${oldPath}:${key}`, { path: oldPath, key, destination: entry.notePath!, description: readSections(content).get(key) || '', anchor: entry.noteAnchor, title: entry.title });
            } else if (fm.project_task_id && file.parent?.path === folder) pendingArchives.set(oldPath, {
                path: oldPath, fingerprint: fingerprint(content), key: sectionKey(entry), destination: entry.notePath! });
        }

        if (roots.size && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        for (const [rootId, root] of roots) {
            const path = paths[rootId]!;
            const existing = this.app.vault.getAbstractFileByPath(path);
            const current = existing instanceof TFile ? await this.app.vault.read(existing) : '';
            if (existing && !(existing instanceof TFile)) throw new Error(`Project note path is occupied: ${path}`);
            const fm = frontmatter(current);
            if (existing && (!fm.project_root_note || fm.project_root_id !== rootId)) throw new Error(`Refusing to overwrite an unrelated note: ${path}`);
            const stored = readSections(current);
            let body = noteBody(current);
            body = body.replace(/^<!-- project-redirect: (\S+) -->\r?\n[\s\S]*?^<!-- \/project-redirect: \1 -->[ \t]*(?:\r?\n|$)/gm, (full, key: string) => root.entries.some(entry => encodeURIComponent(sectionKey(entry)) === key) ? '' : full);
            const header = `<!-- project-root-header:start -->\n# ${markdownTitle(root.title)}\n\n` +
                `Источник: [[${source.path.replace(/\.md$/i, '')}|${source.basename}]]\n\n` +
                '> Описания можно редактировать под заголовками задач. Статусы и даты обновляются из проекта.\n<!-- project-root-header:end -->';
            const headerPattern = /^<!-- project-root-header:start -->\r?\n[\s\S]*?^<!-- project-root-header:end -->/m;
            body = headerPattern.test(body) ? body.replace(headerPattern, () => header) : `${header}\n\n${body}`;
            // Rebuild active sections in checklist order, keeping free prose and deleted sections.
            const activeKeys = new Set(root.entries.map(sectionKey));
            const history: string[] = [];
            body = body.replace(sectionPattern(), (full, encoded: string) => {
                if (!activeKeys.has(decodeURIComponent(encoded))) history.push(full.trim());
                return '';
            }).trim();
            const sections = root.entries.map(entry => {
                const key = sectionKey(entry);
                const description = overrides.has(entry.id) ? overrides.get(entry.id)! :
                    previousPaths.get(entry.id) === path && stored.has(key) ? stored.get(key)! :
                    descriptions.get(entry.id) ?? stored.get(key) ?? '';
                if (previousPaths.has(entry.id) && previousPaths.get(entry.id) !== path && stored.has(key) &&
                    stored.get(key) !== description.trim()) {
                    throw new Error(`Moved task description changed in the destination note: ${entry.title}. Both versions were preserved; compare them before retrying.`);
                }
                validateTaskDescription(description);
                if (expected?.has(entry.id) && stored.has(key) && previousPaths.get(entry.id) === path && stored.get(key) !== expected.get(entry.id)?.trim()) throw new Error('Description changed while saving. Refresh before saving.');
                descriptions.set(entry.id, description.trim());
                return sectionContent(entry, description, entryDepth(entry, byId)).trim();
            });
            body = [body, ...sections, ...history].filter(Boolean).join('\n\n');
            const next = `---\n${stringifyYaml({ ...fm, project_root_note: true, project_root_id: rootId, source: source.path, title: root.title }).trimEnd()}\n---\n\n${body.trim()}\n`;
            if (existing instanceof TFile) {
                if (next !== current) await this.app.vault.process(existing, content => {
                    if (content !== current) throw new Error('Project note changed while saving. Refresh and try again.');
                    return next;
                });
            } else await this.app.vault.create(path, next);
        }
        for (const move of pendingMoves.values()) {
            const entry = state.entries.find(entry => sectionKey(entry) === move.key && entry.notePath === move.destination);
            if (entry) move.destinationDescription = descriptions.get(entry.id) || '';
        }
        state.rootNotes = paths;
        state.pendingNoteArchives = [...pendingArchives.values()];
        state.pendingSectionMoves = [...pendingMoves.values()];
        return descriptions;
    }

    /** Called only after the new notes, state and wikilinks have all been saved. */
    async archiveLegacy(source: TFile, state: ChecklistNoteState): Promise<boolean> {
        const folder = this.folder(source);
        let changed = false;
        for (const item of [...state.pendingNoteArchives || []]) {
            const { path } = item;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile && file.parent?.path === folder) {
                const content = await this.app.vault.read(file);
                // Leave a concurrently edited legacy note in place for manual reconciliation.
                if (!frontmatter(content).project_task_id) continue;
                if (fingerprint(content) !== item.fingerprint) {
                    // Obsidian may have updated wikilinks while earlier legacy files were archived.
                    const destination = this.app.vault.getAbstractFileByPath(item.destination);
                    if (!(destination instanceof TFile) || readSections(await this.app.vault.read(destination)).get(item.key) !== noteBody(content)) continue;
                }
                const archive = normalizePath(`${folder}/_legacy`);
                if (!this.app.vault.getAbstractFileByPath(archive)) await this.app.vault.createFolder(archive);
                let target = normalizePath(`${archive}/${file.name}`);
                let suffix = 1;
                while (this.app.vault.getAbstractFileByPath(target)) target = normalizePath(`${archive}/${file.basename}-${suffix++}.md`);
                await this.app.fileManager.renameFile(file, target);
            }
            state.pendingNoteArchives = state.pendingNoteArchives?.filter(candidate => candidate.path !== path);
            changed = true;
        }
        for (const move of [...state.pendingSectionMoves || []]) {
            if (state.entries.some(entry => entry.notePath === move.path && sectionKey(entry) === move.key)) {
                state.pendingSectionMoves = state.pendingSectionMoves?.filter(candidate => candidate !== move);
                changed = true;
                continue;
            }
            const file = this.app.vault.getAbstractFileByPath(move.path);
            const destination = this.app.vault.getAbstractFileByPath(move.destination);
            if (!(destination instanceof TFile) || readSections(await this.app.vault.read(destination)).get(move.key) !== (move.destinationDescription ?? move.description)) continue;
            if (file instanceof TFile) {
                let removed = false;
                await this.app.vault.process(file, content => {
                    const sections = readSections(content);
                    if (sections.has(move.key) && sections.get(move.key) !== move.description) return content;
                    removed = true;
                    return content.replace(sectionPattern(), (full, encoded: string) => {
                        if (decodeURIComponent(encoded) !== move.key) return full;
                        if (!move.anchor) return full;
                        return `<!-- project-redirect: ${encoded} -->\nПеренесено: [[${move.destination.replace(/\.md$/i, '')}#^${move.anchor}|${(move.title || 'Задача').replace(/[[\]|]/g, '')}]] ^${move.anchor}\n<!-- /project-redirect: ${encoded} -->\n`;
                    });
                });
                if (!removed) continue;
            }
            state.pendingSectionMoves = state.pendingSectionMoves?.filter(candidate => candidate !== move);
            changed = true;
        }
        return changed;
    }
}
