import { TFile, moment } from 'obsidian';
import type HabitTimerPlugin from '../main';
import { collectionDailyGoalUnit } from '../library/daily-goals';
import { readPropertyNumber, readPropertyString, writeProperty } from '../library/property-schema';
import { getHabitDeferredAmountKey, getHabitDeferredToKey, getHabitStateKey } from '../habits/goals';
import { upsertSessionLog } from '../services/session-log';
import { parseDuration } from '../utils';
import { getString, type Frontmatter } from '../utils/frontmatter';
import { clampProgress } from './timer-state';

export interface CommitTimerSessionInput {
    dailyNote: TFile;
    habitName: string;
    displayProperty: string;
    durationSeconds: number;
    progressAdded: number | null;
    note: string;
    mediaPath: string | null;
    mode: 'timer' | 'pm';
    sessionStartTime: string;
    projectTaskPath?: string;
    projectTaskName?: string;
    projectSubTask?: string;
    isSingleFileTask?: boolean;
}

export interface CommitTimerSessionResult {
    savedProgress: number | null;
}

function escapeTableCell(value: string): string {
    return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function getExistingProperty(frontmatter: Record<string, unknown>, keys: string[], fallback: string): string {
    return keys.find(key => Object.prototype.hasOwnProperty.call(frontmatter, key)) || fallback;
}

function isTargetTaskLine(line: string, taskName: string): boolean {
    const escaped = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^[ \\t]*[-*+][ \\t]+(?:\\[[ xX-]\\][ \\t]+)?${escaped}(?=[ \\t]|$)`).test(line);
}

export async function commitTimerSession(
    plugin: HabitTimerPlugin,
    input: CommitTimerSessionInput
): Promise<CommitTimerSessionResult> {
    await plugin.app.fileManager.processFrontMatter(input.dailyNote, frontmatter => {
        const fm = frontmatter as Record<string, unknown>;
        const current = parseDuration(getString(fm as Frontmatter, input.habitName, '00:00:00'));
        fm[input.habitName] = plugin.formatTime(current + input.durationSeconds);
        delete fm[getHabitStateKey(input.habitName)];
        delete fm[getHabitDeferredToKey(input.habitName)];
        delete fm[getHabitDeferredAmountKey(input.habitName)];
    });

    await plugin.app.vault.process(input.dailyNote, content => {
        const timeEnd = moment().format('HH:mm');
        const timeStart = input.sessionStartTime || timeEnd;
        const progress = input.progressAdded !== null ? String(input.progressAdded) : '-';
        const note = escapeTableCell(input.note || '-');
        const display = escapeTableCell(input.displayProperty);
        const row = `| ${timeStart} - ${timeEnd} | ${input.mode === 'pm' ? '🍅' : '⏱️'} | ${display} | ${plugin.formatTime(input.durationSeconds)} | ${progress} | ${note} |`;
        return upsertSessionLog(content, row);
    });

    let savedProgress = input.progressAdded;
    if (input.mediaPath) {
        let progressText = '-';
        const mediaFile = plugin.app.vault.getAbstractFileByPath(input.mediaPath);
        if (mediaFile instanceof TFile) {
            await plugin.app.fileManager.processFrontMatter(mediaFile, frontmatter => {
                const fm = frontmatter as Record<string, unknown>;
                const timeKey = getExistingProperty(fm, ['Reading time', 'Time spent'], 'Reading time');
                const currentTime = parseDuration(getString(fm as Frontmatter, timeKey, '00:00:00'));
                fm[timeKey] = plugin.formatTime(currentTime + input.durationSeconds);

                const typedFm = fm as Frontmatter;
                if (!readPropertyString(typedFm, plugin.settings, 'startDate')) {
                    writeProperty(typedFm, plugin.settings, 'startDate', moment().format('YYYY-MM-DD'));
                }

                const libraryType = readPropertyString(typedFm, plugin.settings, 'libraryType');
                const collection = plugin.settings.mediaCollections.find(item =>
                    (libraryType && item.id.toLowerCase() === libraryType.toLowerCase()) ||
                    (item.folder && mediaFile.path.startsWith(item.folder + '/'))
                );
                if (collection) {
                    const status = readPropertyString(typedFm, plugin.settings, 'status');
                    if (status !== collection.readingStatusName && status !== collection.finishedStatusName) {
                        writeProperty(typedFm, plugin.settings, 'status', collection.readingStatusName);
                    }
                    if (!readPropertyString(typedFm, plugin.settings, 'unit')) {
                        writeProperty(typedFm, plugin.settings, 'unit', collectionDailyGoalUnit(collection));
                    }
                }

                if (input.progressAdded !== null) {
                    const currentProgress = readPropertyNumber(typedFm, plugin.settings, 'progress');
                    const total = readPropertyNumber(typedFm, plugin.settings, 'total');
                    const nextProgress = clampProgress(currentProgress, input.progressAdded, total);
                    writeProperty(typedFm, plugin.settings, 'progress', nextProgress);
                    savedProgress = Math.max(0, nextProgress - currentProgress);
                    progressText = total > 0
                        ? `(Total: ${nextProgress}/${total} - ${Math.round((nextProgress / total) * 100)}%)`
                        : `(Total: ${nextProgress})`;
                }
            });

            await plugin.app.vault.process(mediaFile, content => {
                let next = content;
                if (next.includes('| Прочитано страниц | Заметки |')) {
                    next = next.replace('| Прочитано страниц | Заметки |', '| Прогресс | Заметки |');
                }
                if (next.includes('| Прочитано страниц | Прогресс | Заметки |')) {
                    next = next.replace('| Прочитано страниц | Прогресс | Заметки |', '| Прогресс | % | Заметки |');
                }
                if (!next.includes('### 📖 Progress')) {
                    next += '\n\n---\n\n### 📖 Progress\n| Date | Time | Progress | % | Notes |\n|---|---|---|---|---|\n';
                }
                const date = moment().format('YYYY-MM-DD');
                return next + `| ${date} | ${plugin.formatTime(input.durationSeconds)} | ${savedProgress ?? 0} | ${progressText} | ${escapeTableCell(input.note || '-')} |\n`;
            });
        }
    }

    const projectFile = input.projectTaskPath
        ? plugin.app.vault.getAbstractFileByPath(input.projectTaskPath)
        : null;
    if (projectFile instanceof TFile) {
        const targetLineName = input.isSingleFileTask
            ? input.projectTaskName
            : input.projectSubTask;

        if (targetLineName) {
            const content = await plugin.app.vault.read(projectFile);
            const lines = content.split('\n');
            const timerRegex = /⏱️[ \t]*(\d{1,2}:\d{2}(?::\d{2})?)/;
            const lineIndex = lines.findIndex(line => isTargetTaskLine(line, targetLineName));
            if (lineIndex >= 0) {
                const line = lines[lineIndex] || '';
                const match = line.match(timerRegex);
                const elapsed = match?.[1] ? parseDuration(match[1]) : 0;
                const newTimerTag = `⏱️ ${plugin.formatTime(elapsed + input.durationSeconds)}`;
                lines[lineIndex] = match
                    ? line.replace(timerRegex, newTimerTag)
                    : line.trimEnd() + ` ${newTimerTag}`;
                await plugin.app.vault.modify(projectFile, lines.join('\n'));
            }
        }

        if (!input.isSingleFileTask) {
            await plugin.app.fileManager.processFrontMatter(projectFile, frontmatter => {
                const fm = frontmatter as Record<string, unknown>;
                const current = parseDuration(getString(fm as Frontmatter, 'time_spent', '00:00:00'));
                fm['time_spent'] = plugin.formatTime(current + input.durationSeconds);
            });
        }
    }

    if (plugin.settings.telegramLiveNotifications) {
        void plugin.telegram.send(`⏹ Timer stopped: ${input.habitName}. Logged: ${plugin.formatTime(input.durationSeconds)}`);
    }

    await plugin.updateDailyNoteProjectLog(moment().format('YYYY-MM-DD'));
    return { savedProgress };
}
