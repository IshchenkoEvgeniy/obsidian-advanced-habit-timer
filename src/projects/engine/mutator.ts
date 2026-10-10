import { App, TFile, Notice, moment, parseYaml } from 'obsidian';
import type HabitTimerPlugin from '../../main';
import type { ProjectScopeDefinition, ProjectTask, ProjectSubtask, TaskData } from '../types';
import { validateTaskData, frontmatterVersion } from '../task-validation';
import { isDone } from '../../utils/status';
import type { ProjectParser } from './parser';
import { findTaskBlockEnd, isStructuredChecklist } from './task-block';
import { blockIdFromTaskLine, newTaskBlockId, stripChecklistNodeId, taskDisplayTitle, taskMarkdownTitle } from './task-identity';
import { projectMarkdownLinks } from '../image-utils';
import type { TimerView } from '../../timer/timer-view';
import { getCommunityPlugin, getTemplaterPlugin } from '../community-plugins';
import { PROJECT_ROOT_HEADING } from '../native-checklist';
import { projectTaskId } from '../types';
import { readTaskMetadata, replaceTaskMetadata, taskMetadataMarker } from './task-metadata';
import { markdownContentLines } from './markdown-lines';

export interface TaskWriteResult { file: TFile; blockId?: string; }

function preserveRenamedTitleLinks(title: string, sourceTitle: string): string {
    for (const link of projectMarkdownLinks(sourceTitle)) {
        const currentLinks = projectMarkdownLinks(title);
        if (currentLinks.some(current => current.raw === link.raw)) continue;
        const protectedSpans = [...currentLinks, ...Array.from(title.matchAll(/(`+)[^`]*?\1/g), match =>
            ({ start: match.index, end: match.index + match[0].length }))];
        const label = taskDisplayTitle(link.raw);
        const boundary = (index: number): boolean => index < 0 || index >= title.length || !/[\p{L}\p{N}_]/u.test(title[index]!);
        let at = label ? title.indexOf(label) : -1;
        while (at >= 0) {
            const end = at + label.length;
            // Do not replace part of a word or text inside an already restored link.
            if (boundary(at - 1) && boundary(end) && protectedSpans.every(span => span.end <= at || span.start >= end)) break;
            at = title.indexOf(label, at + 1);
        }
        title = at >= 0 ? title.slice(0, at) + link.raw + title.slice(at + label.length) : `${title} ${link.raw}`;
    }
    return title;
}

export class ProjectMutator {
    constructor(
        private app: App,
        private plugin: HabitTimerPlugin,
        private parser: ProjectParser
    ) {}

    async moveTaskBefore(scope: ProjectScopeDefinition, source: ProjectTask, target: ProjectTask, after = false): Promise<void> {
        if (source.id === target.id) return;
        if (scope.sourceType === 'file') {
            if (source.file.path !== target.file.path || source.section !== target.section) throw new Error('Move tasks within the same project stage.');
            if (source.parentId !== target.parentId || source.indent !== target.indent ||
                JSON.stringify(source.checklistAncestors?.map(item => item.id) || []) !==
                JSON.stringify(target.checklistAncestors?.map(item => item.id) || [])) {
                throw new Error('Move tasks within the same parent. A subtask cannot become its own parent.');
            }
            await this.app.vault.process(source.file, content => {
            const lines = content.split('\n');
            const sourceMatch = this.parser.findTaskLineIndex(lines, source.name, source.blockId, source.sourceLine);
            const targetMatch = this.parser.findTaskLineIndex(lines, target.name, target.blockId, target.sourceLine);
            if (sourceMatch.lineIdx < 0 || targetMatch.lineIdx < 0) throw new Error('The task moved. Refresh the project.');
            const end = findTaskBlockEnd(lines, sourceMatch.lineIdx, sourceMatch.indent);
            if (source.sourceBlock !== undefined && lines.slice(sourceMatch.lineIdx, end).join('\n') !== source.sourceBlock ||
                target.sourceText !== undefined && lines[targetMatch.lineIdx] !== target.sourceText) throw new Error('Task changed before moving. Refresh the project.');
            if (targetMatch.lineIdx >= sourceMatch.lineIdx && targetMatch.lineIdx < end) {
                throw new Error('Cannot move a task into its own subtasks.');
            }
            const insertion = after ? findTaskBlockEnd(lines, targetMatch.lineIdx, targetMatch.indent) : targetMatch.lineIdx;
            if (after && target.sourceBlock !== undefined && lines.slice(targetMatch.lineIdx, insertion).join('\n') !== target.sourceBlock) throw new Error('Target task changed before moving. Refresh the project.');
            const block = lines.splice(sourceMatch.lineIdx, end - sourceMatch.lineIdx);
            const destination = insertion > sourceMatch.lineIdx ? insertion - block.length : insertion;
            lines.splice(destination, 0, ...block);
            return lines.join('\n');
            });
        }
    }

    async toggleSubtask(file: TFile, subtask: ProjectSubtask, checked: boolean): Promise<void> {
        if (!subtask.sourceText) throw new Error('Refresh the project before changing this subtask.');
        await this.app.vault.process(file, content => {
        const lines = content.split('\n');
        const contentLines = markdownContentLines(lines);
        let lineNum = subtask.line;
        if (subtask.blockId) {
            const matches = lines.flatMap((line, index) => contentLines[index] && blockIdFromTaskLine(line) === subtask.blockId ? [index] : []);
            if (matches.length !== 1) throw new Error('Subtask moved or was deleted. Refresh the project.');
            lineNum = matches[0]!;
        }
        if (lines[lineNum] !== subtask.sourceText) throw new Error('Subtask changed. Refresh the project.');
        if (!contentLines[lineNum]) throw new Error('Task checkbox is inside code or metadata.');
        if (lines[lineNum]) {
            const original = lines[lineNum]!;
            if (!/^[ \t]*-[ \t]+\[[ xX]\]/.test(original)) throw new Error('Task checkbox not found.');
            const metadata = readTaskMetadata(original);
            const wasChecked = /^[ \t]*-[ \t]+\[[xX]\]/.test(original);
            metadata.completedAt = checked ? (wasChecked ? metadata.completedAt : new Date().toISOString()) : null;
            lines[lineNum] = replaceTaskMetadata(original.replace(/\[([ xX])\]/, checked ? '[x]' : '[ ]'), metadata);
            return lines.join('\n');
        }
        return content;
        });
    }

    async addSubtask(file: TFile, text: string, isSingleFileTask?: boolean, taskName?: string): Promise<void> {
        text = validateTaskData({ name: text }).name!;
        await this.app.vault.process(file, content => {
        const lines = content.split('\n');
        const contentLines = markdownContentLines(lines);
        
        if (isSingleFileTask && taskName) {
            const { lineIdx: taskLineIdx, indent } = this.parser.findTaskLineIndex(lines, taskName);
            if (taskLineIdx !== -1) {
                const insertIdx = findTaskBlockEnd(lines, taskLineIdx, indent);
                const pad = " ".repeat(indent + 2);
                lines.splice(insertIdx, 0, `${pad}- [ ] ${text}`);
                return lines.join('\n');
            }
            throw new Error('Parent task not found. Refresh the project.');
        }

        let lastSubtaskLine = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line && contentLines[i] && line.match(/^[ \t]*-[ \t]+\[([ xX])\](.*)$/)) {
                lastSubtaskLine = i;
                break;
            }
        }
        
        if (lastSubtaskLine !== -1) {
            const end = findTaskBlockEnd(lines, lastSubtaskLine, lines[lastSubtaskLine]!.match(/^[ \t]*/)?.[0].length || 0);
            lines.splice(end, 0, `- [ ] ${text}`);
        } else {
            const lastLine = lines.length > 0 ? lines[lines.length - 1] : undefined;
            if (lastLine !== undefined && lastLine.trim() === '') {
                lines[lines.length - 1] = `- [ ] ${text}`;
            } else {
                lines.push(`- [ ] ${text}`);
            }
        }
        
        return lines.join('\n');
        });
    }

    async saveTask(taskFile: TFile, data: TaskData, isSingleFileTask?: boolean, oldTaskName?: string, columns?: string[], blockId?: string, sourceLine?: number,
        identity?: Pick<ProjectTask, 'id' | 'completedAt'>): Promise<TaskWriteResult> {
        data = validateTaskData(data, columns, !isSingleFileTask);
        if (isSingleFileTask && oldTaskName) {
            let savedBlockId: string | undefined;
            await this.app.vault.process(taskFile, content => {
            let lines = content.split('\n');
            let contentLines = markdownContentLines(lines);
            
            const { lineIdx: taskLineIdx, indent: _indent, checked: taskChecked } = this.parser.findTaskLineIndex(lines, oldTaskName, blockId, sourceLine);
            if (taskLineIdx < 0) throw new Error(`Checklist task moved or was deleted: ${oldTaskName}`);
            let taskIndent = " ".repeat(_indent);
            if (data.expectedLine !== undefined && lines[taskLineIdx] !== data.expectedLine) throw new Error('Task changed in another window. Refresh before saving.');
            if (taskLineIdx !== -1) {
                const blockId = blockIdFromTaskLine(lines[taskLineIdx]!) || newTaskBlockId(content);
                savedBlockId = blockId;
                const sourceTitle = taskMarkdownTitle(lines[taskLineIdx]!.replace(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*/, ''));
                const title = data.name === taskDisplayTitle(sourceTitle) ? sourceTitle : preserveRenamedTitleLinks(data.name, sourceTitle);
                const metadata = readTaskMetadata(lines[taskLineIdx]!);
                const githubMarker = lines[taskLineIdx]!.match(/<!-- github-project-item: [^>]+ -->/)?.[0];
                const archiveStr = lines[taskLineIdx]!.includes('<!-- project-archived -->') ? ' <!-- project-archived -->' : '';
                let markers = "";
                if (data.timeEstimated) markers += ` ⏳ ${data.timeEstimated}`;
                if (data.habitName) markers += ` 🏷️ [[Habits/${data.habitName}]]`;
                if (data.startDate) markers += ` 📅 ${data.startDate}`;
                if (data.endDate) markers += ` 🏁 ${data.endDate}`;
                if (data.tags) {
                    const tagString = data.tags.split(',').map(t => `#${t.trim()}`).join(' ');
                    markers += ` ${tagString}`;
                }
                
                let pIcon = "";
                if (data.priority) {
                    if (data.priority.toLowerCase() === 'high' || data.priority.toLowerCase() === 'высокий') pIcon = " ⏫";
                    else if (data.priority.toLowerCase() === 'medium' || data.priority.toLowerCase() === 'средний') pIcon = " 🔼";
                    else if (data.priority.toLowerCase() === 'low' || data.priority.toLowerCase() === 'низкий') pIcon = " 🔽";
                }

                let spentStr = "";
                const spentMatch = lines[taskLineIdx]!.match(/⏱️[ \t]*([\d:]+)/);
                if (spentMatch) spentStr = ` ⏱️ ${spentMatch[1]}`;

                const structuredSource = isStructuredChecklist(lines);
                const completed = columns?.length ? data.status === columns.at(-1) : isDone(data.status);
                metadata.id = identity?.id || metadata.id || projectTaskId(taskFile.path, taskLineIdx, blockId);
                metadata.cover = data.cover || '';
                metadata.color = data.color || '';
                metadata.habitName = data.habitName || '';
                metadata.completedAt = completed ? (taskChecked
                    ? metadata.completedAt ?? identity?.completedAt ?? null : new Date().toISOString()) : null;
                const isSectionDone = completed;
                const box = completed ? '[x]' : '[ ]';
                const inlineStatus = (data.section || structuredSource) && (data.status !== columns?.[0] || githubMarker) && !isSectionDone
                    ? ` <!-- project-status: ${data.status.replace(/-->/g, '')} -->` : '';
                lines[taskLineIdx] = `${taskIndent}- ${box} ${title}${markers}${pIcon}${spentStr}${inlineStatus}${archiveStr}${githubMarker ? ` ${githubMarker}` : ''}${taskMetadataMarker(metadata)} ^${blockId}`;

                let currentLineStatus = columns ? columns[0] : 'Backlog';
                for (let j = 0; j < taskLineIdx; j++) {
                    if (!contentLines[j]) continue;
                    const headMatch = stripChecklistNodeId(lines[j] || '').match(/^(#{1,6})[ \t]+(.*)$/);
                    if (headMatch && columns) {
                        const hText = (headMatch[2] || "").trim();
                        const matched = columns.find(c => c.toLowerCase() === hText.toLowerCase());
                        if (matched) currentLineStatus = matched;
                    }
                }

                if (columns && data.status !== currentLineStatus && !data.section && !structuredSource) {
                    const indentSize = taskIndent.length;
                    const blockEnd = findTaskBlockEnd(lines, taskLineIdx, indentSize);
                    const blockLines = lines.slice(taskLineIdx, blockEnd);
                    lines.splice(taskLineIdx, blockEnd - taskLineIdx);
                    contentLines = markdownContentLines(lines);

                    let targetHeadingIdx = -1;
                    for (let j = 0; j < lines.length; j++) {
                        if (!contentLines[j]) continue;
                        const headMatch = stripChecklistNodeId(lines[j] || '').match(/^(#{1,6})[ \t]+(.*)$/);
                        if (headMatch) {
                            const hText = (headMatch[2] || "").trim();
                            if (hText.toLowerCase() === data.status.toLowerCase()) {
                                targetHeadingIdx = j;
                                break;
                            }
                        }
                    }

                    if (targetHeadingIdx !== -1) {
                        lines.splice(targetHeadingIdx + 1, 0, ...blockLines);
                    } else {
                        lines.push(`\n## ${data.status}`);
                        lines.push(...blockLines);
                    }

                    const isDoneCol = completed;
                    const insertedAt = targetHeadingIdx !== -1 ? targetHeadingIdx + 1 : lines.length - blockLines.length;
                    lines[insertedAt] = lines[insertedAt]!.replace(/\[([ xX])\]/, isDoneCol ? '[x]' : '[ ]');
                }

                return lines.join('\n');
            }
            return content;
            });
            return { file: taskFile, blockId: savedBlockId };
        }

        if (data.name !== oldTaskName) {
            const folder = taskFile.parent?.path;
            const newPath = folder ? `${folder}/${data.name}.md` : `${data.name}.md`;
            if (this.app.vault.getAbstractFileByPath(newPath)) {
                throw new Error('A file with this name already exists.');
            }
            if (data.expectedFrontmatter !== undefined) {
                const current = await this.app.vault.read(taskFile);
                const yaml = current.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
                const properties = yaml === undefined ? {} : parseYaml(yaml) as Record<string, unknown>;
                if (frontmatterVersion(properties || {}) !== data.expectedFrontmatter) throw new Error('Task properties changed. Refresh before renaming.');
            }
            await this.app.fileManager.renameFile(taskFile, newPath);
        }
        
        await this.app.fileManager.processFrontMatter(taskFile, (frontmatter) => {
            const fm = frontmatter as Record<string, unknown>;
            if (data.expectedFrontmatter !== undefined && frontmatterVersion(fm) !== data.expectedFrontmatter) throw new Error('Task properties changed. Refresh before saving.');
            const wasDone = columns?.length ? fm['status'] === columns.at(-1) : isDone(typeof fm['status'] === 'string' ? fm['status'] : '');
            const completed = columns?.length ? data.status === columns.at(-1) : isDone(data.status);
            fm['completed_at'] = completed ? (wasDone ? fm['completed_at'] ?? null : new Date().toISOString()) : null;
            fm['status'] = data.status;
            if (data.habitName) fm['associated_habit'] = data.habitName; else delete fm['associated_habit'];
            if (data.timeEstimated) fm['time_estimated'] = data.timeEstimated; else delete fm['time_estimated'];
            if (data.startDate) { fm['start_date'] = data.startDate; fm['date'] = data.startDate; } else { delete fm['start_date']; delete fm['date']; }
            if (data.endDate) { fm['end_date'] = data.endDate; fm['due_date'] = data.endDate; } else { delete fm['end_date']; delete fm['due_date']; }
            if (data.cover) fm['cover'] = data.cover; else { delete fm['cover']; delete fm['image']; }
            if (data.color) fm['color'] = data.color; else delete fm['color'];
            if (data.priority !== undefined) fm['priority'] = data.priority; else delete fm['priority'];
            if (data.order !== undefined) fm['order'] = data.order;
            
            if (data.tags !== undefined) {
                const tArr = data.tags.split(',').map(s => s.trim()).filter(Boolean);
                if (tArr.length > 0) fm['tags'] = tArr; else delete fm['tags'];
            }
        });
        void this.plugin.updateDailyNoteProjectLog().catch(error => console.error('Project daily note update failed', error));
        return { file: taskFile };
    }

    async createTask(scope: ProjectScopeDefinition, data: Partial<TaskData>): Promise<TaskWriteResult> {
        data = validateTaskData(data, scope.statuses.split(',').map(value => value.trim()).filter(Boolean), scope.sourceType !== 'file');
        const columns = scope.statuses.split(',').map(s => s.trim()).filter(Boolean);
        const firstCol = columns[0] || 'Backlog';

        if (scope.sourceType === 'file') {
            const file = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
            if (file && file instanceof TFile) {
                let createdBlockId: string | undefined;
                await this.app.vault.process(file, content => {
                const lines = content.split('\n');
                const contentLines = markdownContentLines(lines);

                const targetStatus = data.status || firstCol;

                let targetIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (!contentLines[i]) continue;
                    const headMatch = stripChecklistNodeId(lines[i] || '').match(/^(#{1,6})[ \t]+(.*)$/);
                    if (headMatch) {
                        const hText = (headMatch[2] || "").trim();
                        if (hText.toLowerCase() === targetStatus.toLowerCase()) {
                            targetIdx = i;
                            break;
                        }
                    }
                }

                let markers = "";
                if (data.timeEstimated) markers += ` ⏳ ${data.timeEstimated}`;
                if (data.habitName) markers += ` 🏷️ [[Habits/${data.habitName}]]`;
                if (data.startDate) markers += ` 📅 ${data.startDate}`;
                if (data.endDate) markers += ` 🏁 ${data.endDate}`;
                if (data.tags) {
                    const tagString = data.tags.split(',').map(t => `#${t.trim()}`).join(' ');
                    markers += ` ${tagString}`;
                }
                
                let pIcon = "";
                if (data.priority) {
                    if (data.priority.toLowerCase() === 'high' || data.priority.toLowerCase() === 'высокий') pIcon = " ⏫";
                    else if (data.priority.toLowerCase() === 'medium' || data.priority.toLowerCase() === 'средний') pIcon = " 🔼";
                    else if (data.priority.toLowerCase() === 'low' || data.priority.toLowerCase() === 'низкий') pIcon = " 🔽";
                }

                const isNewDone = targetStatus === columns.at(-1);
                const structuredSource = isStructuredChecklist(lines);
                const inlineStatus = (data.section || structuredSource) && data.status && data.status !== firstCol && !isNewDone
                    ? ` <!-- project-status: ${data.status.replace(/-->/g, '')} -->` : '';
                const blockId = newTaskBlockId(content);
                createdBlockId = blockId;
                const metadata = taskMetadataMarker({ id: projectTaskId(file.path, undefined, blockId),
                    cover: data.cover || '', color: data.color ?? scope.color ?? '', habitName: data.habitName || '',
                    completedAt: isNewDone ? new Date().toISOString() : null });
                const newTaskLine = `- ${isNewDone ? '[x]' : '[ ]'} ${data.name}${markers}${pIcon}${inlineStatus}${metadata} ^${blockId}`;

                if (data.section) {
                    const sectionIdx = lines.findIndex((line, row) => {
                        if (!contentLines[row]) return false;
                        const heading = stripChecklistNodeId(line).match(/^##[ \t]+(.*)$/);
                        return heading?.[1]?.trim() === data.section;
                    });
                    if (sectionIdx !== -1) {
                        lines.splice(sectionIdx + 1, 0, newTaskLine);
                    } else {
                        throw new Error(`Stage heading was not found: ${data.section}`);
                    }
                } else if (structuredSource) {
                    const rootHeading = lines.findIndex((line, row) => contentLines[row] && line.trim() === `# ${PROJECT_ROOT_HEADING}`);
                    if (rootHeading < 0) lines.push('', `# ${PROJECT_ROOT_HEADING}`, newTaskLine);
                    else lines.splice(rootHeading + 1, 0, newTaskLine);
                } else if (targetIdx !== -1) {
                    let lastTaskLineInSection = targetIdx;
                    let scanIdx = targetIdx + 1;
                    while (scanIdx < lines.length) {
                        if (!contentLines[scanIdx]) { scanIdx++; continue; }
                        const l = lines[scanIdx];
                        if (l && l.match(/^#{1,6}[ \t]+/)) break;
                        if (l && l.match(/^[ \t]*-[ \t]+\[[ xX]\]/)) {
                            lastTaskLineInSection = scanIdx;
                        }
                        scanIdx++;
                    }
                    const insertion = lastTaskLineInSection === targetIdx ? targetIdx + 1 :
                        findTaskBlockEnd(lines, lastTaskLineInSection, 0);
                    lines.splice(insertion, 0, newTaskLine);
                } else {
                    lines.push(`\n## ${targetStatus}`);
                    lines.push(newTaskLine);
                }

                return lines.join('\n');
                });
                // A secondary daily-note failure must not make the user recreate an existing task.
                void this.plugin.updateDailyNoteProjectLog().catch(error => console.error('Project daily note update failed', error));
                return { file, blockId: createdBlockId };
            } else {
                throw new Error('Scope file not found: ' + scope.sourceValue);
            }
        }

        let targetFolder = scope.sourceType === 'folder' ? scope.sourceValue.trim() : (scope.targetFolder?.trim() || "");
        targetFolder = targetFolder.replace(/^\/+|\/+$/g, "");
        
        const filePath = targetFolder ? `${targetFolder}/${data.name}.md` : `${data.name}.md`;
        const cleanPath = filePath.replace(/\/\//g, '/');
        
        if (this.app.vault.getAbstractFileByPath(cleanPath)) {
            throw new Error('A file with this name already exists.');
        }
        
        let initialBody = "";
        if (scope.templatePath) {
            const templateFile = this.app.vault.getAbstractFileByPath(scope.templatePath.trim());
            if (templateFile && templateFile instanceof TFile) {
                initialBody = await this.app.vault.read(templateFile);
            }
        }

        const todayStr = moment().format('YYYY-MM-DD');
        initialBody = initialBody
            .replace(/\{\{date\}\}/g, todayStr)
            .replace(/\{\{creation_date\}\}/g, todayStr)
            .replace(/\{\{project_name\}\}/g, scope.name)
            .replace(/\{\{habit_link\}\}/g, data.habitName ? `[[Habits/${data.habitName}]]` : "")
            .replace(/\{\{associated_habit\}\}/g, data.habitName || "");

        if (scope.defaultSubtasks && scope.defaultSubtasks.trim()) {
            const subLines = scope.defaultSubtasks.split('\n').map(l => l.trim()).filter(Boolean);
            if (subLines.length > 0) {
                if (initialBody && !initialBody.endsWith('\n')) initialBody += '\n';
                if (initialBody && !initialBody.endsWith('\n\n')) initialBody += '\n';
                subLines.forEach(sub => {
                    initialBody += `- [ ] ${sub}\n`;
                });
            }
        }

        const createdFile = await this.app.vault.create(cleanPath, initialBody);

        await this.app.fileManager.processFrontMatter(createdFile, (frontmatter) => {
            const fm = frontmatter as Record<string, unknown>;
            fm['status'] = data.status || firstCol;
            fm['completed_at'] = (data.status || firstCol) === columns.at(-1) ? new Date().toISOString() : null;
            fm['time_spent'] = "00:00:00";
            fm['start_date'] = data.startDate || todayStr;
            if (data.habitName) fm['associated_habit'] = data.habitName;
            if (data.timeEstimated) fm['time_estimated'] = data.timeEstimated;
            if (data.endDate) { fm['end_date'] = data.endDate; fm['due_date'] = data.endDate; }
            if (data.cover) fm['cover'] = data.cover;
            if (data.color || scope.color) fm['color'] = data.color || scope.color;
            if (data.priority) fm['priority'] = data.priority;
            fm['order'] = 0;
            
            const mergedTags: string[] = [];
            if (data.tags) {
                data.tags.split(',').map(s => s.trim()).filter(Boolean).forEach(t => mergedTags.push(t));
            }
            if (scope.sourceType === 'tag') {
                const tagVal = scope.sourceValue.trim().replace(/^#/, '');
                if (!mergedTags.includes(tagVal)) mergedTags.push(tagVal);
            }
            if (mergedTags.length > 0) {
                fm['tags'] = mergedTags;
            }
        });

        const templaterPlugin = getTemplaterPlugin(getCommunityPlugin(this.app, 'templater-obsidian'));
        if (templaterPlugin) {
            try {
                if (templaterPlugin.templater?.overwrite_file_commands) {
                    await templaterPlugin.templater.overwrite_file_commands(createdFile);
                }
            } catch (error: unknown) {
                console.error('Templater plugin execution error:', error);
            }
        }
        void this.plugin.updateDailyNoteProjectLog().catch(error => console.error('Project daily note update failed', error));
        return { file: createdFile };
    }

    async deleteTask(task: ProjectTask, isSingleFileTask?: boolean): Promise<void> {
        return this.deleteTasks([task], isSingleFileTask);
    }

    async deleteTasks(tasks: ProjectTask[], isSingleFileTask?: boolean): Promise<void> {
        if (!tasks.length) return;
        if (isSingleFileTask) {
            const file = tasks[0]!.file;
            if (tasks.some(task => task.file.path !== file.path)) throw new Error('Selected tasks belong to different checklists.');
            await this.app.vault.process(file, content => {
                const lines = content.split('\n');
                const ranges = tasks.map(task => {
                    const { lineIdx, indent } = this.parser.findTaskLineIndex(lines, task.name, task.blockId);
                    if (lineIdx < 0) throw new Error('Task not found. Refresh the project.');
                    const end = findTaskBlockEnd(lines, lineIdx, indent);
                    if (task.sourceBlock !== undefined && lines.slice(lineIdx, end).join('\n') !== task.sourceBlock) throw new Error('Task or its subtasks changed before deletion. Refresh the project.');
                    return { start: lineIdx, end };
                }).sort((a, b) => a.start - b.start);
                const merged: { start: number; end: number }[] = [];
                for (const range of ranges) {
                    const last = merged.at(-1);
                    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
                    else merged.push({ ...range });
                }
                for (const range of merged.reverse()) lines.splice(range.start, range.end - range.start);
                return lines.join('\n');
            });
        } else {
            for (const task of tasks) {
                if (task.sourceContent !== undefined && await this.app.vault.read(task.file) !== task.sourceContent) throw new Error('Task note changed before deletion. Refresh the project.');
                await this.app.fileManager.trashFile(task.file);
            }
        }
        void this.plugin.updateDailyNoteProjectLog().catch(error => console.error('Project daily note update failed', error));
    }

    async setArchived(task: ProjectTask, archived: boolean, isSingleFileTask?: boolean): Promise<void> {
        if (isSingleFileTask) {
            await this.app.vault.process(task.file, content => {
            const lines = content.split('\n');
            const { lineIdx } = this.parser.findTaskLineIndex(lines, task.name, task.blockId);
            if (lineIdx < 0) throw new Error(`Task not found: ${task.name}`);
            const original = lines[lineIdx]!;
            if (task.sourceText !== undefined && original !== task.sourceText) throw new Error('Task changed before archiving. Refresh the project.');
            const marker = ' <!-- project-archived -->';
            let updated = original.replace(marker, '');
            if (archived) {
                const blockId = blockIdFromTaskLine(updated);
                if (blockId) updated = updated.replace(/\s+\^[A-Za-z0-9-]+\s*$/, `${marker} ^${blockId}`);
                else updated = `${updated.trimEnd()}${marker} ^${newTaskBlockId(content)}`;
            }
            lines[lineIdx] = updated;
            return lines.join('\n');
            });
        } else {
            await this.app.fileManager.processFrontMatter(task.file, frontmatter => {
                const properties = frontmatter as Record<string, unknown>;
                if (task.sourceFrontmatter !== undefined && frontmatterVersion(properties) !== task.sourceFrontmatter) throw new Error('Task properties changed before archiving. Refresh the project.');
                if (archived) properties['project_archived'] = true;
                else delete properties['project_archived'];
            });
        }
    }

    async startTimerForTask(task: ProjectTask, isSingleFileTask?: boolean) {
        if (!task.habitName) {
            new Notice("Please associate a habit first!");
            return;
        }

        new Notice(`Syncing timer with task: ${task.name}...`);
        await this.plugin.activateView("habit-timer-view");
        
        const leaves = this.app.workspace.getLeavesOfType("habit-timer-view");
        if (leaves.length > 0) {
            const timerView = leaves[0]!.view as TimerView;
            await timerView.setProjectTask(task.file, task.name, task.habitName, isSingleFileTask);
        }
    }
}
