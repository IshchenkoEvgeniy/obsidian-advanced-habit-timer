import { App, TFile, Notice, parseYaml } from 'obsidian';
import { projectTaskId, type ProjectScopeDefinition, type ProjectTask, type ProjectSubtask } from '../types';
import { parseDuration, getObject, getString, getStringOpt, getNumber } from '../../utils';
import { projectScopeCacheSignature, type ProjectCache } from './cache';
import { blockIdFromTaskLine, checklistHabitName, taskDisplayTitle, virtualTaskId, checklistNodeId, stripChecklistNodeId } from './task-identity';
import { frontmatterVersion } from '../task-validation';
import { readTaskMetadata } from './task-metadata';
import { findTaskBlockEnd } from './task-block';
import { markdownContentLines, markdownIndent } from './markdown-lines';
import { extractProjectImageReferences } from '../image-utils';
import { GITHUB_IMPORT_SECTION, PROJECT_ROOT_HEADING } from '../native-checklist';
import { getCommunityPlugin, getDataviewApi } from '../community-plugins';

function projectDate(value: unknown): string | undefined {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : getStringOpt(value);
}

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
    findTaskLineIndex(lines: string[], taskName: string, blockId?: string, expectedLine?: number): { lineIdx: number; indent: number; checked: boolean } {
        const checkboxRe = /^([ \t]*)-[ \t]+\[([ xX])\][ \t]*(.*)/;
        const contentLines = markdownContentLines(lines);
        if (expectedLine !== undefined) {
            const line = lines[expectedLine];
            const match = line?.match(checkboxRe);
            if (contentLines[expectedLine] && match && (!blockId || blockIdFromTaskLine(line!) === blockId) &&
                taskDisplayTitle(match[3] || '') === taskName) {
                return { lineIdx: expectedLine, indent: markdownIndent(line!), checked: match[2] !== ' ' };
            }
        }
        let found: { lineIdx: number; indent: number; checked: boolean } | undefined;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !contentLines[i]) continue;
            const m = line.match(checkboxRe);
            if (!m) continue;
            if (blockId && blockIdFromTaskLine(line) !== blockId) continue;
            const rawText = m[3] || '';
            const cleanName = taskDisplayTitle(rawText);
            if (blockId || cleanName === taskName) {
                if (found) throw new Error(`More than one checklist task matches “${taskName}”. Refresh the project and use its exact row.`);
                found = {
                    lineIdx: i,
                    indent: markdownIndent(line),
                    checked: (m[2] || ' ') !== ' '
                };
            }
        }
        return found || { lineIdx: -1, indent: 0, checked: false };
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
            const folderPath = scope.sourceValue.trim().replace(/^\/+|\/+$/g, '');
            files = applyExclude(allFiles.filter(f => !folderPath || f.path.startsWith(`${folderPath}/`)));
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
        const signature = projectScopeCacheSignature(scope);
        const parsed = await Promise.all(files.map(async file => {
            const mtime = file.stat.mtime;
            const cacheKey = `${scope.id}\u0000${file.path}`;
            const cached = this.cache.get(cacheKey);
            if (cached && cached.mtime === mtime && cached.signature === signature && cached.tasks.length > 0) {
                return cached.tasks[0]!;
            }

            const content = await this.app.vault.cachedRead(file);
            const yaml = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
            const fm = yaml === undefined ? {} : getObject(parseYaml(yaml));
            if (fm['design_id'] || fm['project_task_id'] || fm['project_task_index'] || fm['project_root_note'] ||
                /^---\r?\n(?:(?!---\r?\n)[\s\S])*?(?:project_task_id|project_task_index|project_root_note):/m.test(content)) return null;
            const lines = content.split('\n');
            const contentLines = markdownContentLines(lines);
            const subtasks: ProjectSubtask[] = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line || !contentLines[i]) continue;
                const match = line.match(/^[ \t]*-[ \t]+\[([ xX])\](.*)$/);
                if (match) {
                    subtasks.push({
                        line: i,
                        sourceText: line,
                        blockId: blockIdFromTaskLine(line),
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
            
            images.push(...extractProjectImageReferences(content));
            
            const task: ProjectTask = {
                id: projectTaskId(file.path),
                sourceFrontmatter: frontmatterVersion(fm),
                sourceContent: content,
                file,
                name: file.basename,
                status: getString(fm['status']) || columns[0] || 'Backlog',
                completedAt: fm['completed_at'] instanceof Date ? fm['completed_at'].toISOString() :
                    typeof fm['completed_at'] === 'string' && !Number.isNaN(Date.parse(fm['completed_at'])) ? fm['completed_at'] : null,
                timeSpentSec: parseDuration(fm['time_spent'] || "00:00:00"),
                timeEstimatedSec: parseDuration(fm['time_estimated']),
                habitName: getStringOpt(fm['associated_habit']),
                startDate: projectDate(fm['start_date']) || projectDate(fm['date']),
                endDate: projectDate(fm['end_date']) || projectDate(fm['due_date']),
                cover: getStringOpt(coverImg),
                color: getString(fm['color']) || scope.color,
                tags: tagsStr,
                priority: getStringOpt(fm['priority'])?.toLowerCase(),
                archived: fm['project_archived'] === true,
                section: scope.sourceType === 'folder'
                    ? (scope.sourceValue.trim().replace(/^\/+|\/+$/g, '') ? file.path.slice(scope.sourceValue.trim().replace(/^\/+|\/+$/g, '').length + 1) : file.path).split('/').slice(0, -1).join('/') || undefined
                    : undefined,
                order: getNumber(fm['order'], 0),
                images,
                subtasks,
                description: content.match(/<!-- project-description:start -->\r?\n([\s\S]*?)\r?\n<!-- project-description:end -->/)?.[1]?.trim()
            };

            this.cache.set(cacheKey, { mtime, signature, tasks: [task] });
            return task;
        }));
        return parsed.filter((task): task is ProjectTask => task !== null);
    }

    private async parseSingleFile(file: TFile, columns: string[], scope: ProjectScopeDefinition): Promise<ProjectTask[]> {
        const signature = projectScopeCacheSignature(scope);
        const mtime = file.stat.mtime;
        const cacheKey = `${scope.id}\u0000${file.path}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.mtime === mtime && cached.signature === signature) {
            return cached.tasks;
        }

        const content = await this.app.vault.read(file);
        // Game-world notes have their own dataset source. Checklists in their bodies are not development tasks.
        const worldYaml = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
        if (worldYaml && getObject(parseYaml(worldYaml))['design_id']) return [];
        const lines = content.split('\n');
        const contentLines = markdownContentLines(lines);
        const tasks: ProjectTask[] = [];
        const virtualOccurrences = new Map<string, number>();
        
        let currentStatus = columns[0] || 'Backlog';
        let currentSection: string | undefined;
        let currentSectionKey: string | undefined;
        let currentTask: ProjectTask | null = null;
        let activeGroup: { id: string; title: string; sourceLine: number; number: string } | undefined;
        let activeNestedGroup: { id: string; title: string; sourceLine: number; number: string } | undefined;
        const checkboxParents: { task: ProjectTask; indent: number }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !contentLines[i]) continue;

            const headMatch = stripChecklistNodeId(line).match(/^(#{1,6})[ \t]+(.*)$/);
            if (headMatch) {
                const headerText = (headMatch[2] || "").trim();
                const matchedCol = columns.find(c => c.toLowerCase() === headerText.toLowerCase());
                if (matchedCol) {
                    currentStatus = matchedCol;
                }
                if (headMatch[1]?.length === 1) {
                    currentSection = undefined;
                    currentSectionKey = undefined;
                    if (headerText === PROJECT_ROOT_HEADING) currentStatus = columns[0] || 'Backlog';
                }
                if (headMatch[1]?.length === 2) {
                    currentSection = matchedCol ? undefined : headerText;
                    currentSectionKey = matchedCol ? undefined : checklistNodeId(line);
                    if (headerText === GITHUB_IMPORT_SECTION) {
                        currentStatus = columns[0] || 'Backlog';
                    }
                }
                activeGroup = undefined;
                activeNestedGroup = undefined;
                currentTask = null;
                checkboxParents.length = 0;
                continue;
            }

            const groupMatch = currentSection?.startsWith('Этап ') && stripChecklistNodeId(line).match(/^(\d+)\.[ \t]+\*\*(.+?)\*\*[ \t]*$/);
            if (groupMatch) {
                activeGroup = { id: checklistNodeId(line)?.replace(/^group:/, '') || `${currentSection}/${groupMatch[1]}`, number: groupMatch[1]!,
                    title: `${groupMatch[1]}. ${taskDisplayTitle(groupMatch[2] || '')}`, sourceLine: i };
                activeNestedGroup = undefined;
                currentTask = null;
                checkboxParents.length = 0;
                continue;
            }
            const nestedGroupMatch = currentSection?.startsWith('Этап ') && stripChecklistNodeId(line).match(/^[ \t]+-[ \t]+\*\*((?:\d+\.)+\d+)[ \t]+(.+?)\*\*[ \t]*$/);
            if (nestedGroupMatch && activeGroup && nestedGroupMatch[1]?.startsWith(`${activeGroup.number}.`)) {
                activeNestedGroup = { id: checklistNodeId(line)?.replace(/^group:/, '') || `${currentSection}/${nestedGroupMatch[1]}`, number: nestedGroupMatch[1],
                    title: `${nestedGroupMatch[1]} ${taskDisplayTitle(nestedGroupMatch[2] || '')}`, sourceLine: i };
                currentTask = null;
                checkboxParents.length = 0;
                continue;
            }

            const listMatch = line.match(/^([ \t]*)-[ \t]+\[([ xX])\](.*)$/);
            if (listMatch) {
                const indentStr = listMatch[1] || "";
                const indent = markdownIndent(indentStr);
                const checked = listMatch[2] !== ' ';
                const rawText = listMatch[3] ? listMatch[3].trim() : "";

                {
                    while (checkboxParents.length && checkboxParents[checkboxParents.length - 1]!.indent >= indent) checkboxParents.pop();
                    const parentTask = checkboxParents[checkboxParents.length - 1]?.task || null;
                    
                    let spent = 0;
                    const spentMatch = rawText.match(/⏱️[ \t]*([\d:]+)/);
                    if (spentMatch && spentMatch[1]) spent = parseDuration(spentMatch[1]);

                    let estimated = 0;
                    const estMatch = rawText.match(/⏳[ \t]*([\d:]+)/);
                    if (estMatch && estMatch[1]) estimated = parseDuration(estMatch[1]);

                    let habit: string | undefined = undefined;
                    const metadata = readTaskMetadata(rawText);
                    habit = checklistHabitName(rawText);
                    if (metadata.habitName !== undefined) habit = metadata.habitName || undefined;

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
                    const githubItemId = rawText.match(/<!-- github-project-item: ([^>]+) -->/)?.[1]?.trim();
                    const inlineStatus = rawText.match(/<!-- project-status: ([^>]+) -->/)?.[1]?.trim();
                    const name = taskDisplayTitle(rawText);
                    const numbered = rawText.match(/^\*{0,2}(\d+(?:\.\d+)+)\*{0,2}(?:\s|$)/)?.[1];
                    const checklistAncestors = activeGroup && (!numbered || numbered.startsWith(`${activeGroup.number}.`))
                        ? [activeGroup, ...(activeNestedGroup &&
                            (!numbered || numbered.startsWith(`${activeNestedGroup.number}.`)) ? [activeNestedGroup] : [])]
                            .map(({ id, title, sourceLine }) => ({ id, title, sourceLine }))
                        : undefined;

                    const images = extractProjectImageReferences(rawText);

                    const tagsList: string[] = [];
                    const tagsMatches = rawText.matchAll(/(?:^|\s)#([\p{L}\p{M}\p{N}_/-]+)/gu);
                    for (const tm of tagsMatches) {
                        if (tm[1] && !/^\d+$/.test(tm[1])) tagsList.push(tm[1]);
                    }

                    const virtualBase = virtualTaskId(file.path, currentSection, rawText, 0);
                    const occurrence = (virtualOccurrences.get(virtualBase) || 0) + 1;
                    virtualOccurrences.set(virtualBase, occurrence);
                    const hasNumber = /^\*{0,2}\d+(?:\.\d+)+\*{0,2}(?:\s|$)/.test(rawText);
                    const taskId = metadata.id || (blockId && !hasNumber ? projectTaskId(file.path, i, blockId)
                        : virtualTaskId(file.path, currentSection, rawText, occurrence));
                    currentTask = {
                        id: taskId,
                        file,
                        name,
                        status: checked ? (columns[columns.length - 1] || 'Done') :
                            (inlineStatus || currentStatus) === columns.at(-1) ? columns[0] || 'Backlog' : inlineStatus || currentStatus,
                        timeSpentSec: spent,
                        timeEstimatedSec: estimated,
                        habitName: habit,
                        startDate,
                        endDate,
                        cover: metadata.cover !== undefined ? metadata.cover || undefined : images[0],
                        color: metadata.color !== undefined ? metadata.color || undefined : scope.color,
                        completedAt: metadata.completedAt,
                        tags: tagsList.join(', '),
                        priority,
                        section: currentSection,
                        order: i,
                        sourceLine: i,
                        sourceText: line,
                        sectionKey: currentSectionKey,
                        blockId,
                        githubItemId,
                        parentId: parentTask?.id,
                        checklistAncestors,
                        indent,
                        archived: rawText.includes('<!-- project-archived -->') || Boolean(parentTask?.archived),
                        images,
                        subtasks: []
                    };

                    if (tagsList.includes('no-project')) {
                        currentTask = null;
                        continue;
                    }

                    tasks.push(currentTask);
                    checkboxParents.push({ task: currentTask, indent });
                    if (parentTask) parentTask.subtasks!.push({
                        line: i,
                        sourceText: line,
                        blockId,
                        checked,
                        text: rawText
                    });
                }
            } else if (/^[ \t]*-[ \t]+/.test(line)) {
                // An unchecked list heading can own nested checkboxes. Do not attach them
                // to the previous checkbox merely because they are indented further.
                currentTask = null;
                checkboxParents.length = 0;
            } else if (line.trim()) {
                // A dedented paragraph ends list ancestry; a later indented checkbox
                // must not become a child of a task whose Markdown block already ended.
                while (checkboxParents.length && checkboxParents.at(-1)!.indent >= markdownIndent(line)) checkboxParents.pop();
            }
        }

        for (const task of tasks) if (task.sourceLine !== undefined) {
            task.sourceBlock = lines.slice(task.sourceLine, findTaskBlockEnd(lines, task.sourceLine, task.indent || 0)).join('\n');
        }
        this.cache.set(cacheKey, { mtime: file.stat.mtime, signature, tasks });
        return tasks;
    }
}
