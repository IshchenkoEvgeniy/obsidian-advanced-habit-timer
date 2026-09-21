import { App, TFile, Notice, moment } from 'obsidian';
import HabitTimerPlugin from '../../main';
import type { ProjectScopeDefinition, ProjectTask, TaskData } from '../types';
import { isDone } from '../../utils/status';
import type { ProjectParser } from './parser';
import { findTaskBlockEnd } from './task-block';
import { blockIdFromTaskLine, ensureTaskBlockIds } from './task-identity';
import type { TimerView } from '../../timer/timer-view';
import { getCommunityPlugin, getTemplaterPlugin } from '../community-plugins';

export class ProjectMutator {
    constructor(
        private app: App,
        private plugin: HabitTimerPlugin,
        private parser: ProjectParser
    ) {}

    async toggleSubtask(file: TFile, lineNum: number, checked: boolean): Promise<void> {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        if (lines[lineNum]) {
            lines[lineNum] = lines[lineNum].replace(/\[([ xX])\]/, checked ? '[x]' : '[ ]');
            await this.app.vault.modify(file, lines.join('\n'));
        }
    }

    async addSubtask(file: TFile, text: string, isSingleFileTask?: boolean, taskName?: string): Promise<void> {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        
        if (isSingleFileTask && taskName) {
            const { lineIdx: taskLineIdx, indent } = this.parser.findTaskLineIndex(lines, taskName);
            if (taskLineIdx !== -1) {
                let insertIdx = taskLineIdx + 1;
                while (insertIdx < lines.length) {
                    const l = lines[insertIdx];
                    if (!l) { insertIdx++; continue; }
                    const m = l.match(/^([ \t]*)-/);
                    if (m) {
                        const curIndent = m[1]?.length || 0;
                        if (curIndent <= indent) {
                            break;
                        }
                    } else if (l.match(/^#/)) {
                        break;
                    }
                    insertIdx++;
                }
                const pad = " ".repeat(indent + 2);
                lines.splice(insertIdx, 0, `${pad}- [ ] ${text}`);
                await this.app.vault.modify(file, lines.join('\n'));
            }
            return;
        }

        let lastSubtaskLine = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line && line.match(/^[ \t]*-[ \t]+\[([ xX])\](.*)$/)) {
                lastSubtaskLine = i;
                break;
            }
        }
        
        if (lastSubtaskLine !== -1) {
            lines.splice(lastSubtaskLine + 1, 0, `- [ ] ${text}`);
        } else {
            const lastLine = lines.length > 0 ? lines[lines.length - 1] : undefined;
            if (lastLine !== undefined && lastLine.trim() === '') {
                lines[lines.length - 1] = `- [ ] ${text}`;
            } else {
                lines.push(`- [ ] ${text}`);
            }
        }
        
        await this.app.vault.modify(file, lines.join('\n'));
    }

    async saveTask(taskFile: TFile, data: TaskData, isSingleFileTask?: boolean, oldTaskName?: string, columns?: string[], blockId?: string): Promise<void> {
        if (isSingleFileTask && oldTaskName) {
            const content = await this.app.vault.read(taskFile);
            let lines = content.split('\n');
            
            const { lineIdx: taskLineIdx, indent: _indent, checked: taskChecked } = this.parser.findTaskLineIndex(lines, oldTaskName, blockId);
            let taskIndent = " ".repeat(_indent);

            if (taskLineIdx !== -1) {
                const blockId = blockIdFromTaskLine(lines[taskLineIdx]!);
                let markers = "";
                if (data.timeEstimated) markers += ` ⏳ ${data.timeEstimated}`;
                if (data.habitName) markers += ` 🏷️ ${data.habitName}`;
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

                const box = taskChecked ? '[x]' : '[ ]';
                lines[taskLineIdx] = `${taskIndent}- ${box} ${data.name}${markers}${pIcon}${spentStr}${blockId ? ` ^${blockId}` : ''}`;

                let currentLineStatus = columns ? columns[0] : 'Backlog';
                for (let j = 0; j < taskLineIdx; j++) {
                    const headMatch = lines[j]?.match(/^(#{1,6})[ \t]+(.*)$/);
                    if (headMatch && columns) {
                        const hText = (headMatch[2] || "").trim();
                        const matched = columns.find(c => c.toLowerCase() === hText.toLowerCase());
                        if (matched) currentLineStatus = matched;
                    }
                }

                if (columns && data.status !== currentLineStatus) {
                    const indentSize = taskIndent.length;
                    const blockEnd = findTaskBlockEnd(lines, taskLineIdx, indentSize);
                    const blockLines = lines.slice(taskLineIdx, blockEnd);
                    lines.splice(taskLineIdx, blockEnd - taskLineIdx);

                    let targetHeadingIdx = -1;
                    for (let j = 0; j < lines.length; j++) {
                        const headMatch = lines[j]?.match(/^(#{1,6})[ \t]+(.*)$/);
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

                    const isDoneCol = isDone(data.status) || data.status === columns[columns.length - 1];
                    const insertedAt = targetHeadingIdx !== -1 ? targetHeadingIdx + 1 : lines.length - blockLines.length;
                    lines[insertedAt] = lines[insertedAt]!.replace(/\[([ xX])\]/, isDoneCol ? '[x]' : '[ ]');
                }

                await this.app.vault.modify(taskFile, lines.join('\n'));
            }
            return;
        }

        if (data.name !== oldTaskName) {
            const newPath = `${taskFile.parent?.path}/${data.name}.md`;
            if (this.app.vault.getAbstractFileByPath(newPath)) {
                new Notice("A file with this name already exists!");
                return;
            }
            await this.app.fileManager.renameFile(taskFile, newPath);
        }
        
        await this.app.fileManager.processFrontMatter(taskFile, (frontmatter) => {
            const fm = frontmatter as Record<string, unknown>;
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
        await this.plugin.updateDailyNoteProjectLog();
    }

    async createTask(scope: ProjectScopeDefinition, data: Partial<TaskData>): Promise<void> {
        const columns = scope.statuses.split(',').map(s => s.trim()).filter(Boolean);
        const firstCol = columns[0] || 'Backlog';

        if (scope.sourceType === 'file') {
            const file = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
            if (file && file instanceof TFile) {
                const content = await this.app.vault.read(file);
                const lines = content.split('\n');

                const targetStatus = data.status || firstCol;

                let targetIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                    const headMatch = lines[i]?.match(/^(#{1,6})[ \t]+(.*)$/);
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
                if (data.habitName) markers += ` 🏷️ ${data.habitName}`;
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

                const newTaskLine = `- [ ] ${data.name}${markers}${pIcon}`;

                if (targetIdx !== -1) {
                    let lastTaskLineInSection = targetIdx;
                    let scanIdx = targetIdx + 1;
                    while (scanIdx < lines.length) {
                        const l = lines[scanIdx];
                        if (l && l.match(/^#{1,6}[ \t]+/)) break;
                        if (l && l.match(/^[ \t]*-[ \t]+\[[ xX]\]/)) {
                            lastTaskLineInSection = scanIdx;
                        }
                        scanIdx++;
                    }
                    lines.splice(lastTaskLineInSection + 1, 0, newTaskLine);
                } else {
                    lines.push(`\n## ${targetStatus}`);
                    lines.push(newTaskLine);
                }

                const identified = ensureTaskBlockIds(lines.join('\n'), file.path);
                await this.app.vault.modify(file, identified.content);
                await this.plugin.updateDailyNoteProjectLog();
            } else {
                new Notice("Scope file not found: " + scope.sourceValue);
            }
            return;
        }

        let targetFolder = scope.sourceType === 'folder' ? scope.sourceValue.trim() : (scope.targetFolder?.trim() || "");
        targetFolder = targetFolder.replace(/\/$/, "");
        
        const filePath = targetFolder ? `${targetFolder}/${data.name}.md` : `${data.name}.md`;
        const cleanPath = filePath.replace(/\/\//g, '/');
        
        if (this.app.vault.getAbstractFileByPath(cleanPath)) {
            new Notice("A file with this name already exists!");
            return;
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
        await this.plugin.updateDailyNoteProjectLog();
    }

    async deleteTask(task: ProjectTask, isSingleFileTask?: boolean): Promise<void> {
        if (isSingleFileTask) {
            const content = await this.app.vault.read(task.file);
            const lines = content.split('\n');
            const { lineIdx: taskLineIdx, indent } = this.parser.findTaskLineIndex(lines, task.name, task.blockId);
            if (taskLineIdx !== -1) {
                const blockEnd = findTaskBlockEnd(lines, taskLineIdx, indent);
                lines.splice(taskLineIdx, blockEnd - taskLineIdx);
                await this.app.vault.modify(task.file, lines.join('\n'));
            }
        } else {
            await this.app.fileManager.trashFile(task.file);
        }
        await this.plugin.updateDailyNoteProjectLog();
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
