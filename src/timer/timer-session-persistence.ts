import { TFile, moment } from 'obsidian';
import type HabitTimerPlugin from '../main';
import { collectionDailyGoalUnit } from '../library/daily-goals';
import { appendMediaProgressRow } from '../library/daily-media-progress';
import { readPropertyNumber, readPropertyString, writeProperty } from '../library/property-schema';
import { getHabitDeferredAmountKey, getHabitDeferredToKey, getHabitStateKey } from '../habits/goals';
import { upsertSessionLog } from '../services/session-log';
import { parseDuration } from '../utils';
import { getString, type Frontmatter } from '../utils/frontmatter';
import { clampProgress } from './timer-state';
import { taskDisplayTitle } from '../projects/engine/task-identity';
import { readWriteReceipt, writeReceipt } from '../services/write-receipts';

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
    sessionId?: string;
    endTime?: string;
    logMode?: string;
}

export interface PendingTimerCommit extends Omit<CommitTimerSessionInput, 'dailyNote'> {
    dailyNotePath: string;
    sessionId: string;
    endTime: string;
}

export interface CommitTimerSessionResult {
    savedProgress: number | null;
    durationSeconds: number;
}

function escapeTableCell(value: string): string {
    return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function getExistingProperty(frontmatter: Record<string, unknown>, keys: string[], fallback: string): string {
    return keys.find(key => Object.prototype.hasOwnProperty.call(frontmatter, key)) || fallback;
}

function isTargetTaskLine(line: string, taskName: string): boolean {
    const match = line.match(/^[ \t]*[-*+][ \t]+(?:\[[ xX-]\][ \t]+)?(.*)$/);
    return Boolean(match && taskDisplayTitle(match[1] || '') === taskDisplayTitle(taskName));
}

export async function commitTimerSession(
    plugin: HabitTimerPlugin,
    input: CommitTimerSessionInput
): Promise<CommitTimerSessionResult> {
    const active = plugin.settings.activeTimer;
    if (active?.pendingCommit) {
        const frozen = active.pendingCommit;
        const dailyNote = plugin.app.vault.getAbstractFileByPath(frozen.dailyNotePath);
        if (!(dailyNote instanceof TFile)) throw new Error(`Session daily note missing: ${frozen.dailyNotePath}`);
        input = { ...frozen, dailyNote };
    } else {
        input = { ...input, sessionId: input.sessionId || active?.sessionId || crypto.randomUUID(), endTime: input.endTime || moment().format('HH:mm') };
        if (active) {
            const { dailyNote, ...details } = input;
            active.sessionId = input.sessionId;
            active.pendingCommit = { ...details, dailyNotePath: dailyNote.path, sessionId: input.sessionId!, endTime: input.endTime! };
            await plugin.saveSettings();
        }
    }
    const id = `timer:${input.sessionId}:habit`;
    const mediaId = `timer:${input.sessionId}:media`;
    const projectId = `timer:${input.sessionId}:project`;
    const marker = `<!-- timer-session:${input.sessionId} -->`;
    const mediaMarker = `<!-- timer-media:${input.sessionId} -->`;
    const projectMarker = `<!-- timer-project:${input.sessionId} -->`;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.dailyNote.basename) ? input.dailyNote.basename : moment().format('YYYY-MM-DD');
    const mediaFile = input.mediaPath ? plugin.app.vault.getAbstractFileByPath(input.mediaPath) : null;
    if (input.mediaPath && !(mediaFile instanceof TFile)) throw new Error(`Session media file missing: ${input.mediaPath}`);
    await plugin.app.fileManager.processFrontMatter(input.dailyNote, frontmatter => {
        const fm = frontmatter as Record<string, unknown>;
        if (readWriteReceipt(fm, id)) return;
        const current = parseDuration(getString(fm as Frontmatter, input.habitName, '00:00:00'));
        fm[input.habitName] = plugin.formatTime(current + input.durationSeconds);
        delete fm[getHabitStateKey(input.habitName)];
        delete fm[getHabitDeferredToKey(input.habitName)];
        delete fm[getHabitDeferredAmountKey(input.habitName)];
        writeReceipt(fm, id);
    });

    let savedProgress = input.mediaPath ? null : input.progressAdded;
    if (input.mediaPath) {
        let progressText = '-';
        if (mediaFile instanceof TFile) {
            await plugin.app.fileManager.processFrontMatter(mediaFile, frontmatter => {
                const fm = frontmatter as Record<string, unknown>;
                const receipt = readWriteReceipt(fm, mediaId);
                if (receipt) {
                    savedProgress = typeof receipt.savedProgress === 'number' ? receipt.savedProgress : null;
                    progressText = typeof receipt.progressText === 'string' ? receipt.progressText : '-';
                    return;
                }
                const timeKey = getExistingProperty(fm, ['Reading time', 'Time spent'], 'Reading time');
                const currentTime = parseDuration(getString(fm as Frontmatter, timeKey, '00:00:00'));
                fm[timeKey] = plugin.formatTime(currentTime + input.durationSeconds);

                const typedFm = fm as Frontmatter;
                if (!readPropertyString(typedFm, plugin.settings, 'startDate')) {
                    writeProperty(typedFm, plugin.settings, 'startDate', date);
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
                writeReceipt(fm, mediaId, { savedProgress, progressText });
            });

            await plugin.app.vault.process(mediaFile, content => {
                if (content.includes(mediaMarker)) return content;
                let next = content;
                if (next.includes('| Прочитано страниц | Заметки |')) {
                    next = next.replace('| Прочитано страниц | Заметки |', '| Прогресс | Заметки |');
                }
                if (next.includes('| Прочитано страниц | Прогресс | Заметки |')) {
                    next = next.replace('| Прочитано страниц | Прогресс | Заметки |', '| Прогресс | % | Заметки |');
                }
                return appendMediaProgressRow(next, `| ${date} | ${plugin.formatTime(input.durationSeconds)} | ${savedProgress ?? 0} | ${progressText} | ${escapeTableCell(input.note || '-')} ${mediaMarker} |`);
            });
        }
    }

    await plugin.app.vault.process(input.dailyNote, content => {
        if (content.includes(marker)) return content;
        const timeEnd = input.endTime!;
        const timeStart = input.sessionStartTime || timeEnd;
        const progress = savedProgress !== null ? String(savedProgress) : '-';
        const note = escapeTableCell(input.note || '-');
        const display = escapeTableCell(input.displayProperty);
        const mode = escapeTableCell(input.logMode || (input.mode === 'pm' ? '🍅' : '⏱️'));
        const row = `| ${timeStart} - ${timeEnd} | ${mode} | ${display} | ${plugin.formatTime(input.durationSeconds)} | ${progress} | ${note} ${marker} |`;
        return upsertSessionLog(content, row);
    });

    const projectFile = input.projectTaskPath
        ? plugin.app.vault.getAbstractFileByPath(input.projectTaskPath)
        : null;
    if (projectFile instanceof TFile) {
        const targetLineName = input.isSingleFileTask
            ? input.projectTaskName
            : input.projectSubTask;

        if (targetLineName) {
            await plugin.app.vault.process(projectFile, content => {
                if (content.includes(projectMarker)) return content;
                const lines = content.split('\n');
                const timerRegex = /⏱️[ \t]*(\d+:\d{2}(?::\d{2})?)/;
                const lineIndex = lines.findIndex(line => isTargetTaskLine(line, targetLineName));
                if (lineIndex < 0) return content;
                const line = lines[lineIndex] || '';
                const match = line.match(timerRegex);
                const elapsed = match?.[1] ? parseDuration(match[1]) : 0;
                const newTimerTag = `⏱️ ${plugin.formatTime(elapsed + input.durationSeconds)}`;
                lines[lineIndex] = match
                    ? line.replace(timerRegex, newTimerTag)
                    : line.trimEnd().replace(/(\s+\^[A-Za-z0-9-]+)?$/, ` ${newTimerTag}$1`);
                return `${lines.join('\n').trimEnd()}\n\n${projectMarker}\n`;
            });
        }

        if (!input.isSingleFileTask) {
            await plugin.app.fileManager.processFrontMatter(projectFile, frontmatter => {
                const fm = frontmatter as Record<string, unknown>;
                if (readWriteReceipt(fm, projectId)) return;
                const current = parseDuration(getString(fm as Frontmatter, 'time_spent', '00:00:00'));
                fm['time_spent'] = plugin.formatTime(current + input.durationSeconds);
                writeReceipt(fm, projectId);
            });
        }
    }

    if (plugin.settings.telegramLiveNotifications) {
        void plugin.telegram.send(`⏹ Timer stopped: ${input.habitName}. Logged: ${plugin.formatTime(input.durationSeconds)}`);
    }

    await plugin.updateDailyNoteProjectLog(date);
    return { savedProgress, durationSeconds: input.durationSeconds };
}
