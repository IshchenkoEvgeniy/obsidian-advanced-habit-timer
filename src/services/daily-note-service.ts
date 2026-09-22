import { App, TFile, moment, normalizePath, Notice } from 'obsidian';
import { formatDuration, parseDuration } from '../utils';
import { upsertSessionLog } from './session-log';
import { isDone, isInProgress } from '../utils/status';
import type HabitTimerPlugin from '../main';
import type { HabitExplicitState } from '../types';
import { getHabitDeferredAmountKey, getHabitDeferredToKey, getHabitStateKey } from '../habits/goals';

/**
 * Service to manage daily notes, including ensuring properties,
 * toggling habit statuses, incrementing counts, and updating project logs.
 */
export class DailyNoteService {
    constructor(private app: App, private plugin: HabitTimerPlugin) {}

    /** Find or return the daily note file for the given date. */
    getNote(date: string): TFile | null {
        let folder = this.plugin.settings.dailyNotesFolder ? this.plugin.settings.dailyNotesFolder.trim() : '';
        if (folder && !folder.endsWith('/')) folder += '/';
        let path = `${folder}${date}.md`;
        if (path.startsWith('/')) path = path.substring(1);

        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }

    async ensureNote(date: string = moment().format('YYYY-MM-DD')): Promise<TFile | null> {
        const existing = this.getNote(date);
        if (existing) return existing;
        const folder = this.plugin.settings.dailyNotesFolder.trim();
        const path = normalizePath(folder ? `${folder}/${date}.md` : `${date}.md`);
        try {
            return await this.app.vault.create(path, '---\n---\n');
        } catch {
            const retry = this.app.vault.getAbstractFileByPath(path);
            return retry instanceof TFile ? retry : null;
        }
    }

    async normalizeSessionLog(date: string = moment().format('YYYY-MM-DD')): Promise<void> {
        const file = this.getNote(date);
        if (!file) return;
        await this.app.vault.process(file, content => upsertSessionLog(content));
    }

    /** Ensure all defined habits have their frontmatter properties initialized. */
    async ensureProperties(date: string = moment().format('YYYY-MM-DD')): Promise<void> {
        const file = await this.ensureNote(date);
        if (!file) return;
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            for (const prop of this.plugin.settings.properties) {
                if (fm[prop.name] === undefined) {
                    if (prop.type === 'timer') fm[prop.name] = "00:00:00";
                    else if (prop.type === 'count') fm[prop.name] = 0;
                    else if (prop.type === 'binary') fm[prop.name] = false;
                }
            }
        });
    }

    /** Toggle a binary (checklist) habit. */
    async toggleBinary(habitName: string, date: string = moment().format('YYYY-MM-DD')): Promise<void> {
        const file = await this.ensureNote(date);
        if (!file) {
            new Notice("Daily note not found! Please create it first.");
            return;
        }
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm[habitName] = !fm[habitName];
        });
    }

    async setBinary(habitName: string, value: boolean, date: string = moment().format('YYYY-MM-DD')): Promise<void> {
        const file = await this.ensureNote(date);
        if (!file) return;
        await this.app.fileManager.processFrontMatter(file, frontmatter => {
            const fm = frontmatter as Record<string, unknown>;
            fm[habitName] = value;
        });
    }

    async appendCapture(
        category: 'thought' | 'link' | 'idea' | 'task' | 'quote', text: string,
        date: string = moment().format('YYYY-MM-DD'), source = '', time = moment().format('HH:mm')
    ): Promise<void> {
        const file = await this.ensureNote(date);
        if (!file || !text.trim()) return;
        const headings: Record<typeof category, string> = {
            thought: '### 💭 Мысли', link: '### 🔗 Ссылки', idea: '### 💡 Идеи',
            task: '### ✅ Задачи', quote: '### 💬 Цитаты'
        };
        const heading = headings[category];
        const cleanText = text.replace(/\r?\n/g, ' ').trim();
        const cleanSource = source.replace(/\r?\n/g, ' ').trim();
        const prefix = category === 'task' ? '- [ ]' : '-';
        const entry = `${prefix} ${time ? `${time} ` : ''}${cleanText}${cleanSource ? ` — ${cleanSource}` : ''}`;
        const content = await this.app.vault.read(file);
        const lines = content.split(/\r?\n/);
        const headingIndex = lines.findIndex(line => line.trim() === heading);
        if (headingIndex < 0) {
            await this.app.vault.modify(file, `${content.trimEnd()}\n\n${heading}\n${entry}\n`);
            return;
        }
        let insertAt = headingIndex + 1;
        while (insertAt < lines.length && !/^#{1,3}\s/.test(lines[insertAt] || '')) insertAt++;
        while (insertAt > headingIndex + 1 && !(lines[insertAt - 1] || '').trim()) insertAt--;
        lines.splice(insertAt, 0, entry);
        await this.app.vault.modify(file, lines.join('\n'));
    }

    /** Log a relapse for avoidance (negative) habits. */
    async logRelapse(habitName: string, date: string = moment().format('YYYY-MM-DD')): Promise<void> {
        const file = await this.ensureNote(date);
        if (!file) {
            new Notice("Daily note not found! Please create it first.");
            return;
        }
        const key = `${habitName}-Relapse`;
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm[key] = !fm[key];
        });
    }

    /** Increment or decrement a count-based habit. */
    async updateCount(habitName: string, delta: number, date: string = moment().format('YYYY-MM-DD')): Promise<void> {
        const file = await this.ensureNote(date);
        if (!file) {
            new Notice("Daily note not found! Please create it first.");
            return;
        }
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            const current = Number(fm[habitName]) || 0;
            fm[habitName] = Math.max(0, current + delta);
        });
    }

    /** Add seconds to a timer habit without creating a running timer session. */
    async updateTimer(habitName: string, seconds: number, date: string = moment().format('YYYY-MM-DD')): Promise<void> {
        const file = await this.ensureNote(date);
        if (!file) {
            new Notice('Daily note not found! Please create it first.');
            return;
        }
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            const current = parseDuration(fm[habitName]);
            fm[habitName] = formatDuration(Math.max(0, current + seconds));
        });
    }

    async appendSessionLog(
        habitName: string,
        durationSeconds: number,
        date: string = moment().format('YYYY-MM-DD'),
        options: { startTime?: string; endTime?: string; mode?: string; note?: string } = {}
    ): Promise<void> {
        const file = await this.ensureNote(date);
        if (!file || durationSeconds <= 0) return;
        const endTime = this.safeSessionTime(options.endTime) || moment().format('HH:mm');
        const startTime = this.safeSessionTime(options.startTime) || endTime;
        const mode = this.escapeTableCell(options.mode || 'Telegram');
        const property = this.escapeTableCell(habitName);
        const note = this.escapeTableCell(options.note || '-');
        const row = `| ${startTime} - ${endTime} | ${mode} | ${property} | ${formatDuration(durationSeconds)} | - | ${note} |`;
        await this.app.vault.process(file, content => {
            return upsertSessionLog(content, row);
        });
    }

    /** Store an explicit daily state. Passing null restores automatic evaluation. */
    async setHabitState(
        habitName: string,
        state: HabitExplicitState | null,
        date: string = moment().format('YYYY-MM-DD'),
        deferredTo?: string,
        deferredAmount = 0
    ): Promise<void> {
        const file = await this.ensureNote(date);
        if (!file) {
            new Notice('Daily note not found! Please create it first.');
            return;
        }
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            const stateKey = getHabitStateKey(habitName);
            const deferredToKey = getHabitDeferredToKey(habitName);
            const deferredAmountKey = getHabitDeferredAmountKey(habitName);
            if (state) fm[stateKey] = state;
            else delete fm[stateKey];
            if (state === 'deferred' && deferredTo) {
                fm[deferredToKey] = deferredTo;
                fm[deferredAmountKey] = Math.max(0, deferredAmount);
            } else {
                delete fm[deferredToKey];
                delete fm[deferredAmountKey];
            }
        });
    }

    /** Update the project log block inside the daily note based on active tasks. */
    async updateProjectLog(dateStr: string = moment().format('YYYY-MM-DD')): Promise<void> {
        const file = this.getNote(dateStr);
        if (!file) return;

        // Reuse shared engine from plugin to preserve file-level cache
        const engine = this.plugin.projectEngine;
        const logLines: string[] = [];

        for (const scope of this.plugin.settings.projectScopes) {
            try {
                const tasks = await engine.loadTasks(scope);
                for (const t of tasks) {
                    const status = t.status || '';
                    const isDoneStatus = isDone(status);
                    
                    if (isDoneStatus && t.endDate === dateStr) {
                        const timeSpentStr = t.timeSpentSec > 0 ? ` (⏱️ ${formatDuration(t.timeSpentSec)})` : '';
                        logLines.push(`- [x] **[${scope.name}]** ${t.name} — *Done*${timeSpentStr}`);
                    } else if (!isDoneStatus) {
                        const isStartToday = t.startDate === dateStr;
                        const isBeforeOrActive = t.startDate && t.startDate <= dateStr && (!t.endDate || t.endDate >= dateStr);
                        if (isStartToday || isBeforeOrActive || isInProgress(status)) {
                            const timeSpentStr = t.timeSpentSec > 0 ? ` (⏱️ ${formatDuration(t.timeSpentSec)})` : '';
                            const marker = isInProgress(status) ? '/' : ' ';
                            logLines.push(`- [${marker}] **[${scope.name}]** ${t.name} — *${status}*${timeSpentStr}`);
                        }
                    }
                }
            } catch (e) {
                console.error("Error loading tasks for daily log: ", e);
            }
        }

        let newBlock = `%%HT-PROJECT-LOG-START%%\n`;
        if (logLines.length > 0) {
            newBlock += logLines.join('\n') + `\n`;
        } else {
            newBlock += `*No project task updates logged for today.*\n`;
        }
        newBlock += `%%HT-PROJECT-LOG-END%%`;

        const content = await this.app.vault.read(file);
        const startTag = "%%HT-PROJECT-LOG-START%%";
        const endTag = "%%HT-PROJECT-LOG-END%%";

        if (content.includes(startTag) && content.includes(endTag)) {
            const regex = new RegExp(`${startTag}[\\s\\S]*?${endTag}`, 'g');
            const newContent = content.replace(regex, newBlock);
            await this.app.vault.modify(file, newContent);
        } else {
            const newContent = content.trimEnd() + `\n\n### 📂 Project Tasks Log\n` + newBlock + `\n`;
            await this.app.vault.modify(file, newContent);
        }
    }

    private safeSessionTime(value: string | undefined): string {
        return value && /^\d{2}:\d{2}$/.test(value) ? value : '';
    }

    private escapeTableCell(value: string): string {
        return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
    }
}
