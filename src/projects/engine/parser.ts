import { App, TFile, Notice } from 'obsidian';
import { projectTaskId, type ProjectScopeDefinition, type ProjectTask, type ProjectSubtask } from '../types';
import { parseDuration, getObject, getString, getStringOpt, getNumber } from '../../utils';
import type { ProjectCache } from './cache';
import { blockIdFromTaskLine, ensureTaskBlockIds, stripTaskBlockId } from './task-identity';
import { getCommunityPlugin, getDataviewApi } from '../community-plugins';

export class ProjectParser {
    constructor(private app: App, private cache: ProjectCache) {}

    /**
     * Returns true if the file should be EXCLUDED from the scope.
     */
    matchesExcludePatterns(filePath: string, excludePatterns: string): boolean {
        const patterns = excludePatterns
            .split(',')
            .map(p => p.trim())
            .filter(Boolean);

        if (patterns.length === 0) return false;

        const positives = patterns.filter(p => !p.startsWith('!'));
        const negations = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1).trim());

        const fileName = filePath.split('/').pop() || '';

        const matchesSingle = (p: string): boolean => {
            if (p.endsWith('/')) return filePath.startsWith(p);
            if (filePath === p) return true;
            if (filePath.startsWith(p + '/')) return true;
            if (fileName.includes(p)) return true;
            return false;
        };

        const excluded = positives.some(p => matchesSingle(p));
        if (!excluded) return false;

        const reIncluded = negations.some(p => matchesSingle(p));
        return !reIncluded;
    }

    /**
     * Finds the line index of a task in single-file mode using an exact match.
     */
    findTaskLineIndex(lines: string[], taskName: string, blockId?: string): { lineIdx: number; indent: number; checked: boolean } {
        const checkboxRe = /^([ \t]*)-[ \t]+\[([ xX])\][ \t]*(.*)/;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const m = line.match(checkboxRe);
            if (!m) continue;
            if (blockId && blockIdFromTaskLine(line) !== blockId) continue;
            const rawText = m[3] || '';
            const cleanName = stripTaskBlockId(rawText)
                .replace(/⏱️[ \t]*[\d:]+/g, '')
                .replace(/⏳[ \t]*[\d:]+/g, '')
                .replace(/🏷️[ \t]*(?:(?!\s|,|⏱️|⏳|📅|🏁).)+/g, '')
                .replace(/\[\[Habits\/[^\]]+\]\]/g, '')
                .replace(/(?:⏫|🔼|🔽)/g, '')
                .replace(/(?:📅|🏁)[ \t]*[\d-]{10}/g, '')
                .replace(/#[a-zA-Z0-9_-]+/g, '')
                .trim();
            if (blockId || cleanName === taskName) {
                return {
                    lineIdx: i,
                    indent: (m[1] || '').length,
                    checked: (m[2] || ' ') !== ' '
                };
            }
        }
        return { lineIdx: -1, indent: 0, checked: false };
    }

    async loadTasks(scope: ProjectScopeDefinition): Promise<ProjectTask[]> {
        const statuses = scope.statuses.split(',').map(s => s.trim()).filter(Boolean);
        const columns = statuses.length > 0 ? statuses : ['Backlog', 'To Do', 'In Progress', 'Done'];
        const excludePatterns = scope.excludePatterns || '';

        const allFiles = this.app.vault.getMarkdownFiles();
        let files: TFile[] = [];

        const applyExclude = (list: TFile[]): TFile[] =>
            excludePatterns
                ? list.filter(f => !this.matchesExcludePatterns(f.path, excludePatterns))
                : list;

        if (scope.sourceType === 'folder') {
            const folderPath = scope.sourceValue.trim().replace(/\/$/, '');
            files = applyExclude(allFiles.filter(f => f.path === folderPath || f.path.startsWith(`${folderPath}/`)));
            return this.parseSeparateFiles(files, columns, scope);
        } else if (scope.sourceType === 'tag') {
            const tagToFind = scope.sourceValue.trim().toLowerCase();
            const cleanTag = tagToFind.startsWith('#') ? tagToFind : '#' + tagToFind;
            
            files = allFiles.filter(f => {
                const fileCache = this.app.metadataCache.getFileCache(f);
                if (fileCache?.tags?.some(t => t.tag.toLowerCase() === cleanTag)) return true;
                const fm = getObject(fileCache?.frontmatter);
                if (fm) {
                    const tags = fm['tags'] || fm['tag'];
                    if (Array.isArray(tags)) {
                        if (tags.some(t => ('#' + String(t).replace(/^#/, '')).toLowerCase() === cleanTag)) return true;
                    } else if (typeof tags === 'string') {
                        if (tags.toLowerCase().includes(cleanTag) || tags.toLowerCase().includes(cleanTag.replace(/^#/, ''))) return true;
                    }
                }
                return false;
            });
            files = applyExclude(files);
            return this.parseSeparateFiles(files, columns, scope);
        } else if (scope.sourceType === 'dataview') {
            const dv = getDataviewApi(getCommunityPlugin(this.app, 'dataview'));
            if (dv) {
                try {
                    const paths = Array.from(dv.pages(scope.sourceValue))
                        .map((p) => p.file?.path)
                        .filter((path): path is string => typeof path === 'string');
                    files = allFiles.filter(f => paths.includes(f.path));
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    new Notice('Error in Dataview query: ' + message);
                }
            } else {
                new Notice("Dataview plugin is required for this scope!");
            }
            files = applyExclude(files);
            return this.parseSeparateFiles(files, columns, scope);
        } else if (scope.sourceType === 'file') {
            const filePath = scope.sourceValue.trim();
            const hubFile = this.app.vault.getAbstractFileByPath(filePath);
            if (hubFile && hubFile instanceof TFile) {
                return this.parseSingleFile(hubFile, columns, scope);
            } else {
                return [];
            }
        }

        return [];
    }

    private async parseSeparateFiles(files: TFile[], columns: string[], scope: ProjectScopeDefinition): Promise<ProjectTask[]> {
        return Promise.all(files.map(async file => {
            const mtime = file.stat.mtime;
            const cacheKey = `${scope.id}\u0000${file.path}`;
            const cached = this.cache.get(cacheKey);
            if (cached && cached.mtime === mtime && cached.tasks.length > 0) {
                return cached.tasks[0]!;
            }

            const fileCache = this.app.metadataCache.getFileCache(file);
            const fm = getObject(fileCache?.frontmatter);
            
            const content = await this.app.vault.cachedRead(file);
            const lines = content.split('\n');
            const subtasks: ProjectSubtask[] = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line) continue;
                const match = line.match(/^[ \t]*-[ \t]+\[([ xX])\](.*)$/);
                if (match) {
                    subtasks.push({
                        line: i,
                        checked: match[1] !== ' ',
                        text: match[2] ? match[2].trim() : ""
                    });
                }
            }
            
            const rawTags = fm['tags'] || fm['tag'];
            let tagsStr = "";
            if (Array.isArray(rawTags)) {
                tagsStr = rawTags.map(String).join(', ');
            } else if (typeof rawTags === 'string') {
                tagsStr = rawTags;
            }
            
            const images: string[] = [];
            const coverImg = fm['cover'] || fm['image'];
            if (coverImg && typeof coverImg === 'string') images.push(coverImg);
            
            const mdImgMatches = content.matchAll(/!\[.*?\]\((.*?)\)/g);
            for (const m of mdImgMatches) {
                if (m[1]) images.push(m[1].trim());
            }
            const wikiImgMatches = content.matchAll(/!\[\[(.*?)\]\]/g);
            for (const m of wikiImgMatches) {
                if (m[1]) {
                    const cleanName = m[1].split('|')[0]?.trim();
                    if (cleanName) images.push(cleanName);
                }
            }
            
            const task: ProjectTask = {
                id: projectTaskId(file.path),
                file,
                name: file.basename,
                status: getString(fm['status']) || columns[0] || 'Backlog',
                timeSpentSec: parseDuration(fm['time_spent'] || "00:00:00"),
                timeEstimatedSec: parseDuration(fm['time_estimated']),
                habitName: getStringOpt(fm['associated_habit']),
                startDate: getStringOpt(fm['start_date']) || getStringOpt(fm['date']),
                endDate: getStringOpt(fm['end_date']) || getStringOpt(fm['due_date']),
                cover: getStringOpt(coverImg),
                color: getString(fm['color']) || scope.color,
                tags: tagsStr,
                priority: getStringOpt(fm['priority'])?.toLowerCase(),
                order: getNumber(fm['order'], 0),
                images,
                subtasks
            };

            this.cache.set(cacheKey, { mtime, tasks: [task] });
            return task;
        }));
    }

    private async parseSingleFile(file: TFile, columns: string[], scope: ProjectScopeDefinition): Promise<ProjectTask[]> {
        const mtime = file.stat.mtime;
        const cacheKey = `${scope.id}\u0000${file.path}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.mtime === mtime) {
            return cached.tasks;
        }

        let content = await this.app.vault.read(file);
        const identified = ensureTaskBlockIds(content, file.path);
        if (identified.changed) {
            content = identified.content;
            await this.app.vault.modify(file, content);
        }
        const lines = content.split('\n');
        const tasks: ProjectTask[] = [];
        
        let currentStatus = columns[0] || 'Backlog';
        let currentTask: ProjectTask | null = null;
        let lastParentIndent = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;

            const headMatch = line.match(/^(#{1,6})[ \t]+(.*)$/);
            if (headMatch) {
                const headerText = (headMatch[2] || "").trim();
                const matchedCol = columns.find(c => c.toLowerCase() === headerText.toLowerCase());
                if (matchedCol) {
                    currentStatus = matchedCol;
                }
                currentTask = null;
                continue;
            }

            const listMatch = line.match(/^([ \t]*)-[ \t]+\[([ xX])\](.*)$/);
            if (listMatch) {
                const indentStr = listMatch[1] || "";
                const indent = indentStr.length;
                const checked = listMatch[2] !== ' ';
                const rawText = listMatch[3] ? listMatch[3].trim() : "";

                if (indent === 0 || !currentTask || indent <= lastParentIndent) {
                    lastParentIndent = indent;
                    
                    let spent = 0;
                    const spentMatch = rawText.match(/⏱️[ \t]*([\d:]+)/);
                    if (spentMatch && spentMatch[1]) spent = parseDuration(spentMatch[1]);

                    let estimated = 0;
                    const estMatch = rawText.match(/⏳[ \t]*([\d:]+)/);
                    if (estMatch && estMatch[1]) estimated = parseDuration(estMatch[1]);

                    let habit: string | undefined = undefined;
                    const habitMatch = rawText.match(/🏷️[ \t]*((?:(?!\s|,|⏱️|⏳|📅|🏁).)+)/) || rawText.match(/\[\[Habits\/([^\]]+)\]\]/);
                    if (habitMatch && habitMatch[1]) habit = habitMatch[1].trim();

                    let priority: string | undefined = undefined;
                    if (rawText.includes('⏫')) priority = 'high';
                    else if (rawText.includes('🔼')) priority = 'medium';
                    else if (rawText.includes('🔽')) priority = 'low';

                    let startDate: string | undefined = undefined;
                    const startMatch = rawText.match(/📅[ \t]*([\d-]{10})/);
                    if (startMatch && startMatch[1]) startDate = startMatch[1];

                    let endDate: string | undefined = undefined;
                    const endMatch = rawText.match(/🏁[ \t]*([\d-]{10})/);
                    if (endMatch && endMatch[1]) endDate = endMatch[1];

                    const blockId = blockIdFromTaskLine(line);
                    let name = stripTaskBlockId(rawText)
                        .replace(/⏱️[ \t]*[\d:]+/g, '')
                        .replace(/⏳[ \t]*[\d:]+/g, '')
                        .replace(/🏷️[ \t]*(?:(?!\s|,|⏱️|⏳|📅|🏁).)+/g, '')
                        .replace(/\[\[Habits\/[^\]]+\]\]/g, '')
                        .replace(/(?:⏫|🔼|🔽)/g, '')
                        .replace(/(?:📅|🏁)[ \t]*[\d-]{10}/g, '')
                        .replace(/#[a-zA-Z0-9_-]+/g, '')
                        .trim();

                    const images: string[] = [];
                    const imgMatch = rawText.match(/!\[.*?\]\((.*?)\)/);
                    if (imgMatch && imgMatch[1]) images.push(imgMatch[1].trim());

                    const wikiImgMatch = rawText.match(/!\[\[(.*?)\]\]/);
                    if (wikiImgMatch && wikiImgMatch[1]) {
                        const cleanWiki = wikiImgMatch[1].split('|')[0]?.trim();
                        if (cleanWiki) images.push(cleanWiki);
                    }

                    const tagsList: string[] = [];
                    const tagsMatches = rawText.matchAll(/#([a-zA-Z0-9_-]+)/g);
                    for (const tm of tagsMatches) {
                        if (tm[1]) tagsList.push(tm[1]);
                    }

                    currentTask = {
                        id: projectTaskId(file.path, i, blockId),
                        file,
                        name,
                        status: checked ? (columns[columns.length - 1] || 'Done') : currentStatus,
                        timeSpentSec: spent,
                        timeEstimatedSec: estimated,
                        habitName: habit,
                        startDate,
                        endDate,
                        cover: images[0],
                        color: scope.color,
                        tags: tagsList.join(', '),
                        priority,
                        order: i,
                        sourceLine: i,
                        blockId,
                        images,
                        subtasks: []
                    };

                    if (tagsList.includes('no-project')) {
                        currentTask = null;
                        continue;
                    }

                    tasks.push(currentTask);
                } else {
                    currentTask.subtasks!.push({
                        line: i,
                        checked,
                        text: rawText
                    });
                }
            }
        }

        this.cache.set(cacheKey, { mtime: file.stat.mtime, tasks });
        return tasks;
    }
}
