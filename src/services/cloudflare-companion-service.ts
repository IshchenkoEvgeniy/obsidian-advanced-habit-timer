import { moment, normalizePath, requestUrl, TFile } from 'obsidian';
import { get as getStoreValue } from 'svelte/store';
import type HabitTimerPlugin from '../main';
import type { HabitExplicitState } from '../types';
import { getDailyNotes, getNumber, getObject, getString, parseDuration } from '../utils';
import type { Frontmatter } from '../utils/frontmatter';
import { readHabitExplicitState } from '../habits/goals';
import { readPropertyString, writeProperty } from '../library/property-schema';
import { isDone } from '../utils/status';
import { getHabitValueFromFrontmatter } from './habit-service';
import { collectionsForHabit } from '../library/habit-links';
import { collectionDailyGoal, collectionDailyGoalEnabled, collectionDailyGoalUnit, mediaProgressUnit } from '../library/daily-goals';
import { mediaProgressForDate } from '../library/daily-media-progress';
import { convertDailyProgress } from '../library/daily-goal-value';
import { CloudflareCoverService } from './cloudflare-cover-service';
import { CloudflareProjectService } from './cloudflare-project-service';

interface CompanionEvent {
    sequence: number;
    event_id: string;
    event_type: 'add_timer' | 'append_session' | 'add_count' | 'set_binary' | 'set_state' | 'library_update' | 'library_create' | 'library_delete' | 'capture' | 'project_change' | 'project_timer' | 'daily_task' | 'daily_task_session';
    habit_name: string;
    habit_date: string;
    amount: number | null;
    state: string | null;
    payload_json: string;
    created_at: number;
}

interface EventsResponse {
    ok?: boolean;
    events?: CompanionEvent[];
    nextCursor?: number;
}

export class CloudflareCompanionService {
    private interval: number | null = null;
    private syncing = false;

    private covers: CloudflareCoverService;
    constructor(private plugin: HabitTimerPlugin) { this.covers = new CloudflareCoverService(plugin); }

    start(): void {
        this.stop();
        if (!this.isConfigured()) return;
        void this.sync();
        const seconds = Math.max(30, this.plugin.settings.cloudflareSyncIntervalSec || 60);
        this.interval = window.setInterval(() => void this.sync(), seconds * 1000);
    }

    stop(): void {
        if (this.interval !== null) window.clearInterval(this.interval);
        this.interval = null;
    }

    restart(): void { this.start(); }

    isConfigured(): boolean {
        return this.plugin.settings.telegramMode === 'cloudflare'
            && Boolean(this.plugin.settings.cloudflareWorkerUrl?.trim())
            && Boolean(this.plugin.settings.cloudflareApiToken?.trim());
    }

    async setupWebhook(): Promise<{ ok: boolean; message: string }> {
        try {
            const response = await this.request('/api/setup', 'POST', {});
            const body = response.json as { ok?: boolean; webhookUrl?: string; error?: string };
            return body.ok
                ? { ok: true, message: body.webhookUrl || 'Webhook configured' }
                : { ok: false, message: body.error || `HTTP ${response.status}` };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    async discoverChatId(): Promise<{ ok: boolean; chatId?: string; message?: string }> {
        try {
            const response = await this.request('/api/discover-chat', 'POST', {});
            const body = response.json as { ok?: boolean; chatId?: string; error?: string };
            return body.ok && body.chatId
                ? { ok: true, chatId: body.chatId }
                : { ok: false, message: body.error || `HTTP ${response.status}` };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    async sync(): Promise<boolean> {
        if (!this.isConfigured() || this.syncing) return false;
        this.syncing = true;
        try {
            await this.plugin.tasks?.sync();
            const pulledLibraryEvents = await this.pullEvents();
            await this.pushSnapshot(pulledLibraryEvents);
            this.plugin.settings.cloudflareLastSyncAt = Date.now();
            this.plugin.settings.cloudflareLastSyncError = '';
            await this.plugin.saveSettings();
            return true;
        } catch (error) {
            this.plugin.settings.cloudflareLastSyncError = error instanceof Error ? error.message : String(error);
            await this.plugin.saveSettings();
            console.error('Cloudflare Companion sync error:', error);
            return false;
        } finally {
            this.syncing = false;
        }
    }

    private async pullEvents(): Promise<boolean> {
        const cursor = this.plugin.settings.cloudflareSyncCursor || 0;
        const response = await this.request(`/api/sync/events?after=${cursor}`, 'GET');
        const body = response.json as EventsResponse;
        if (!body.ok || !Array.isArray(body.events)) throw new Error(`Companion events request failed (${response.status})`);
        const applied = new Set(this.plugin.settings.cloudflareAppliedEventIds || []);
        let nextCursor = cursor;
        let libraryChanged = false;
        for (const event of body.events) {
            if (!applied.has(event.event_id)) {
                await this.applyEvent(event);
                if (event.event_type.startsWith('library_') || event.event_type.startsWith('project_')) libraryChanged = true;
                applied.add(event.event_id);
                this.plugin.settings.cloudflareAppliedEventIds = [...applied].slice(-500);
                await this.plugin.saveSettings();
            }
            nextCursor = Math.max(nextCursor, event.sequence);
        }
        if (nextCursor > cursor) {
            this.plugin.settings.cloudflareSyncCursor = nextCursor;
            this.plugin.settings.cloudflareAppliedEventIds = [...applied].slice(-500);
            await this.plugin.saveSettings();
            const ack = await this.request('/api/sync/ack', 'POST', { through: nextCursor });
            if (!(ack.json as { ok?: boolean }).ok) throw new Error(`Companion acknowledgement failed (${ack.status})`);
        }
        return libraryChanged;
    }

    private async applyEvent(event: CompanionEvent): Promise<void> {
        if(event.event_type==='daily_task_session') {
            const p=JSON.parse(event.payload_json);
            await this.plugin.tasks.session(p.task,p.seconds,p.startTime,p.endTime,p.note,p.sessionId,event.habit_date);
            return;
        }
        if (event.event_type === 'daily_task') {
            const payload = JSON.parse(event.payload_json);
            await this.plugin.tasks.apply(payload.task, payload.previous, payload.requestId || event.event_id, event.habit_date);
            return;
        }
        if (event.event_type === 'project_change' || event.event_type === 'project_timer') {
            await new CloudflareProjectService(this.plugin).apply(JSON.parse(event.payload_json), event.event_type === 'project_timer');
            return;
        }
        if (event.event_type === 'capture') {
            const payload = this.parsePayload(event.payload_json);
            const category = this.captureCategory(getString(payload.category));
            await this.plugin.dailyNotes.appendCapture(category, getString(payload.text), event.habit_date,
                getString(payload.source), getString(payload.time));
            return;
        }
        if (event.event_type === 'library_delete') {
            const payload = this.parsePayload(event.payload_json);
            const file = this.plugin.app.vault.getAbstractFileByPath(getString(payload.path, event.habit_name));
            if (file instanceof TFile) await this.plugin.app.vault.trash(file, true);
            this.plugin.stateManager.refreshAllMedia();
            return;
        }
        if (event.event_type === 'library_create') {
            await this.createLibraryItem(this.parsePayload(event.payload_json));
            return;
        }
        if (event.event_type === 'library_update') {
            await this.applyLibraryEvent(event);
            return;
        }
        const prop = this.plugin.settings.properties.find(value => value.name === event.habit_name);
        if (!prop) return;
        if (event.event_type === 'add_timer') {
            const duration = Math.round(event.amount || 0);
            const payload = this.parsePayload(event.payload_json);
            await this.plugin.dailyNotes.updateTimer(prop.name, duration, event.habit_date);
            await this.plugin.dailyNotes.appendSessionLog(prop.name, duration, event.habit_date, {
                startTime: getString(payload.startTime),
                endTime: getString(payload.endTime),
                mode: getString(payload.mode, 'Telegram'),
                note: getString(payload.note, '-')
            });
        } else if (event.event_type === 'append_session') {
            const payload = this.parsePayload(event.payload_json);
            await this.plugin.dailyNotes.appendSessionLog(prop.name, Math.round(event.amount || 0), event.habit_date, {
                startTime: getString(payload.startTime),
                endTime: getString(payload.endTime),
                mode: getString(payload.mode, 'Telegram'),
                note: getString(payload.note, '-')
            });
        } else if (event.event_type === 'add_count') {
            await this.plugin.dailyNotes.updateCount(prop.name, event.amount || 0, event.habit_date);
        } else if (event.event_type === 'set_binary') {
            await this.plugin.dailyNotes.setBinary(prop.name, Boolean(event.amount), event.habit_date);
        } else if (event.event_type === 'set_state') {
            const state = this.explicitState(event.state);
            const payload = this.parsePayload(event.payload_json);
            await this.plugin.dailyNotes.setHabitState(
                prop.name, state, event.habit_date,
                state === 'deferred' ? getString(payload.deferredTo) : undefined,
                state === 'deferred' ? getNumber(payload.deferredAmount) : 0
            );
        }
    }

    private async pushSnapshot(skipLibrary = false): Promise<void> {
        const cutoff = moment().subtract(120, 'days').format('YYYY-MM-DD');
        const values: Array<{ habitName: string; date: string; value: number; state: string | null }> = [];
        for (const file of getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder)) {
            if (file.basename < cutoff) continue;
            const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
            if (!fm) continue;
            for (const prop of this.plugin.settings.properties) {
                if (file.basename < (prop.createdAt || '0000-00-00')) continue;
                values.push({
                    habitName: prop.name,
                    date: file.basename,
                    value: getHabitValueFromFrontmatter(fm, prop),
                    state: readHabitExplicitState(fm, prop.name)
                });
            }
        }
        const library = await this.buildLibrarySnapshot();
        const libraryHash = this.hashSnapshot(library);
        // MetadataCache may still contain the pre-event value immediately after processFrontMatter.
        // Defer the library snapshot by one sync cycle instead of overwriting a freshly pulled D1 event.
        const shouldPushLibrary = !skipLibrary && libraryHash !== (this.plugin.settings.cloudflareLibrarySyncHash || '');
        const projects = await this.buildProjectSnapshot();
        const projectsHash = this.hashSnapshot(projects);
        const shouldPushProjects = projectsHash !== (this.plugin.settings.cloudflareProjectsSyncHash || '');
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: this.plugin.settings.cloudflareTimezone || 'Europe/Kyiv',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());
        const dailyValues = new Map<string, number>();
        for (const item of getStoreValue(this.plugin.stateManager.mediaItems)) {
            const collection = this.plugin.settings.mediaCollections.find(value => value.id === item.collectionId);
            if (!collection || !collectionDailyGoalEnabled(collection)) continue;
            const unit = collectionDailyGoalUnit(collection);
            if (unit === 'items') continue;
            const amount = mediaProgressForDate(await this.plugin.app.vault.read(item.file), today);
            const sourceUnit = mediaProgressUnit(item.unit, item.collectionId, item.format, item.total, unit);
            dailyValues.set(collection.id, (dailyValues.get(collection.id) || 0) + convertDailyProgress(amount, sourceUnit, unit));
        }
        const habits = this.plugin.settings.properties.map(habit => {
            const linkedCollections = collectionsForHabit(this.plugin.settings, habit);
            return {
                ...habit,
                autoDailyTaskOwner: this.plugin.settings.telegramMode === 'cloudflare' ? 'cloudflare' : 'obsidian',
                mediaCollections: linkedCollections.map(collection => collection.id),
                mediaGoals: Object.fromEntries(linkedCollections
                    .filter(collectionDailyGoalEnabled)
                    .map(collection => [collection.id, {
                        goal: collectionDailyGoal(collection, this.plugin.settings.dailyPagesGoal),
                        unit: collectionDailyGoalUnit(collection),
                        daily: { date: today, value: dailyValues.get(collection.id) || 0,
                            throughSequence: this.plugin.settings.cloudflareSyncCursor || 0 }
                    }]))
            };
        });
        const snapshot = {
            ...(!skipLibrary ? { boardTasks: await new CloudflareProjectService(this.plugin).snapshot(),
                projectScopes: this.plugin.settings.projectScopes.map(({id,name,statuses,sourceType})=>({id,name,statuses,sourceType})) } : {}),
            chatId: this.plugin.settings.telegramChatId.trim(),
            timezone: this.plugin.settings.cloudflareTimezone || 'Europe/Kyiv',
            language: this.plugin.settings.language,
            habits,
            notifications: {
                morningEnabled: this.plugin.settings.telegramMorningEnabled,
                morningTime: this.plugin.settings.telegramMorningTime,
                eveningEnabled: this.plugin.settings.telegramEveningEnabled,
                eveningTime: this.plugin.settings.telegramEveningTime,
                weeklyEnabled: this.plugin.settings.telegramWeeklyReport
            },
            values,
            ...(shouldPushLibrary ? { library } : {}),
            ...(shouldPushProjects ? { projects } : {})
        };
        let response = await this.request('/api/sync/push', 'POST', snapshot);
        let result = response.json as { ok?: boolean; libraryItemCount?: number; projectTaskCount?: number };
        if (!result.ok) throw new Error(`Companion snapshot push failed (${response.status})`);

        // A persisted local hash can outlive a cleared/recreated D1 database. Reconcile counts
        // and repair the server snapshot without making every periodic sync rewrite the library.
        const repairLibrary = !skipLibrary && !shouldPushLibrary && library.length > 0
            && Number.isFinite(result.libraryItemCount) && result.libraryItemCount !== library.length;
        const repairProjects = !shouldPushProjects && projects.length > 0
            && Number.isFinite(result.projectTaskCount) && result.projectTaskCount !== projects.length;
        if (repairLibrary || repairProjects) {
            response = await this.request('/api/sync/push', 'POST', {
                ...snapshot,
                ...(repairLibrary ? { library } : {}),
                ...(repairProjects ? { projects } : {})
            });
            result = response.json as typeof result;
            if (!result.ok) throw new Error(`Companion snapshot repair failed (${response.status})`);
        }
        if (shouldPushLibrary || repairLibrary) {
            this.plugin.settings.cloudflareLibrarySyncHash = libraryHash;
            this.plugin.settings.cloudflareLibraryLastPushAt = Date.now();
        }
        if (shouldPushProjects || repairProjects) {
            this.plugin.settings.cloudflareProjectsSyncHash = projectsHash;
            this.plugin.settings.cloudflareProjectsLastPushAt = Date.now();
        }
    }

    private async buildProjectSnapshot() {
        const tasks: Array<{
            key: string; scopeId: string; scopeName: string; path: string; name: string;
            status: string; priority: string; startDate: string; endDate: string;
            timeSpentSec: number; timeEstimatedSec: number; done: boolean;
        }> = [];
        for (const scope of this.plugin.settings.projectScopes) {
            try {
                const scopeTasks = await this.plugin.projectEngine.loadTasks(scope);
                scopeTasks.forEach((task, index) => tasks.push({
                    key: `${scope.id}:${task.file.path}:${task.name}:${index}`,
                    scopeId: scope.id,
                    scopeName: scope.name,
                    path: task.file.path,
                    name: task.name,
                    status: task.status || '',
                    priority: task.priority || '',
                    startDate: task.startDate || '',
                    endDate: task.endDate || '',
                    timeSpentSec: Math.max(0, task.timeSpentSec || 0),
                    timeEstimatedSec: Math.max(0, task.timeEstimatedSec || 0),
                    done: isDone(task.status || '')
                }));
            } catch (error) {
                console.warn(`Cloudflare project sync skipped scope ${scope.name}:`, error);
            }
        }
        return tasks.sort((a, b) => a.key.localeCompare(b.key));
    }

    private async buildLibrarySnapshot() {
        const enabled = await this.covers.available();
        const items = getStoreValue(this.plugin.stateManager.mediaItems)
            .map(item => {
                const collection = this.plugin.settings.mediaCollections.find(value => value.id === item.collectionId);
                const fm = (item.cache.frontmatter || {}) as Frontmatter;
                const cover = readPropertyString(fm, this.plugin.settings, 'cover');
                return {
                    path: item.file.path,
                    title: item.title,
                    collectionId: item.collectionId,
                    status: item.status,
                    format: item.format,
                    rating: item.rating,
                    total: item.total,
                    progress: item.progress,
                    authors: item.authors,
                    genres: item.genres,
                    series: item.series,
                    seriesIndex: item.seriesIndex,
                    unit: item.unit,
                    coverUrl: cover,
                    startDate: item.startDate,
                    endDate: item.endDate,
                    season: item.season,
                    episode: item.episode,
                    readingStatus: collection?.readingStatusName || '',
                    finishedStatus: collection?.finishedStatusName || ''
                };
            })
            .sort((a, b) => a.path.localeCompare(b.path));
        for (const item of items) item.coverUrl = await this.covers.resolve(item.coverUrl, item.path, enabled);
        return items;
    }

    private async applyLibraryEvent(event: CompanionEvent): Promise<void> {
        const payload = this.parsePayload(event.payload_json);
        const path = getString(payload.path, event.habit_name);
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            console.warn(`Cloudflare library item no longer exists: ${path}`);
            return;
        }
        await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
            const fm = frontmatter as Frontmatter;
            const timeSpentSeconds = Math.max(0, Math.round(getNumber(payload.timeSpentSeconds)));
            if (timeSpentSeconds > 0) {
                const timeKey = ['Reading time', 'Time spent'].find(key =>
                    Object.prototype.hasOwnProperty.call(fm, key)
                ) || 'Reading time';
                fm[timeKey] = this.plugin.formatTime(parseDuration(fm[timeKey]) + timeSpentSeconds);
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'progress')) {
                writeProperty(fm, this.plugin.settings, 'progress', getNumber(payload.progress));
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
                writeProperty(fm, this.plugin.settings, 'status', getString(payload.status));
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'startDate')) {
                writeProperty(fm, this.plugin.settings, 'startDate', getString(payload.startDate));
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'endDate')) {
                writeProperty(fm, this.plugin.settings, 'endDate', getString(payload.endDate));
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'authors')) writeProperty(fm, this.plugin.settings, 'author', this.payloadStrings(payload.authors));
            if (Object.prototype.hasOwnProperty.call(payload, 'genres')) writeProperty(fm, this.plugin.settings, 'genre', this.payloadStrings(payload.genres));
            if (Object.prototype.hasOwnProperty.call(payload, 'series')) writeProperty(fm, this.plugin.settings, 'series', getString(payload.series));
            if (Object.prototype.hasOwnProperty.call(payload, 'seriesIndex')) writeProperty(fm, this.plugin.settings, 'seriesIndex', getNumber(payload.seriesIndex));
            if (Object.prototype.hasOwnProperty.call(payload, 'format')) writeProperty(fm, this.plugin.settings, 'format', getString(payload.format));
            if (Object.prototype.hasOwnProperty.call(payload, 'total')) writeProperty(fm, this.plugin.settings, 'total', getNumber(payload.total));
            if (Object.prototype.hasOwnProperty.call(payload, 'rating')) writeProperty(fm, this.plugin.settings, 'rating', getString(payload.rating));
            if (Object.prototype.hasOwnProperty.call(payload, 'season')) writeProperty(fm, this.plugin.settings, 'season', getNumber(payload.season));
            if (Object.prototype.hasOwnProperty.call(payload, 'episode')) writeProperty(fm, this.plugin.settings, 'episode', getNumber(payload.episode));
            if (Object.prototype.hasOwnProperty.call(payload, 'collectionId')) writeProperty(fm, this.plugin.settings, 'libraryType', getString(payload.collectionId));
        });
        const progressLog = getObject(payload.progressLog);
        if (Object.keys(progressLog).length) await this.appendMediaProgressLog(file, progressLog);
        const nextCollectionId = getString(payload.collectionId);
        if (nextCollectionId) await this.moveLibraryFile(file, nextCollectionId);
        this.plugin.stateManager.refreshAllMedia();
    }

    private async appendMediaProgressLog(file: TFile, log: Record<string, unknown>): Promise<void> {
        const progress = getNumber(log.progress);
        const total = getNumber(log.total);
        const percent = total > 0 ? `${Math.min(100, Math.round(progress / total * 100))}%` : '-';
        const note = getString(log.note, '-').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
        const row = `| ${getString(log.date)} | ${getString(log.time)} | ${getNumber(log.delta)} | ${progress}/${total || '-'} (${percent}) | ${note} |`;
        const content = await this.plugin.app.vault.read(file);
        const lines = content.split(/\r?\n/);
        const headingIndex = lines.findIndex(line => /^###\s+📖\s+Progress\s*$/.test(line.trim()));
        if (headingIndex < 0) {
            await this.plugin.app.vault.modify(file, `${content.trimEnd()}\n\n---\n\n### 📖 Progress\n| Date | Time | Progress | % | Notes |\n|---|---|---|---|---|\n${row}\n`);
            return;
        }
        let insertAt = headingIndex + 1;
        while (insertAt < lines.length && !lines[insertAt]?.startsWith('|')) insertAt++;
        while (insertAt < lines.length && lines[insertAt]?.startsWith('|')) insertAt++;
        if (insertAt === headingIndex + 1 || !lines[headingIndex + 1]?.startsWith('|')) {
            lines.splice(headingIndex + 1, 0, '| Date | Time | Progress | % | Notes |', '|---|---|---|---|---|', row);
        } else {
            lines.splice(insertAt, 0, row);
        }
        await this.plugin.app.vault.modify(file, lines.join('\n'));
    }

    private async moveLibraryFile(file: TFile, collectionId: string): Promise<void> {
        const collection = this.plugin.settings.mediaCollections.find(value => value.id === collectionId && value.enabled);
        if (!collection || !collection.folder || file.path.startsWith(`${normalizePath(collection.folder)}/`)) return;
        const folder = normalizePath(collection.folder);
        if (!this.plugin.app.vault.getAbstractFileByPath(folder)) await this.plugin.app.vault.createFolder(folder);
        let destination = normalizePath(`${folder}/${file.name}`);
        let suffix = 2;
        while (this.plugin.app.vault.getAbstractFileByPath(destination)) destination = normalizePath(`${folder}/${file.basename} (${suffix++}).md`);
        await this.plugin.app.fileManager.renameFile(file, destination);
    }

    private async createLibraryItem(payload: Record<string, unknown>): Promise<void> {
        const collectionId = getString(payload.collectionId);
        const title = getString(payload.title).trim();
        const collection = this.plugin.settings.mediaCollections.find(value => value.id === collectionId && value.enabled);
        if (!collection || !title) throw new Error(`Invalid Telegram library item: ${collectionId || 'unknown'}`);

        let templateContent = '';
        if (collection.templatePath) {
            const templatePath = normalizePath(collection.templatePath.endsWith('.md') ? collection.templatePath : `${collection.templatePath}.md`);
            const template = this.plugin.app.vault.getAbstractFileByPath(templatePath);
            if (template instanceof TFile) templateContent = await this.plugin.app.vault.read(template);
        }
        if (collection.folder && !this.plugin.app.vault.getAbstractFileByPath(normalizePath(collection.folder))) {
            await this.plugin.app.vault.createFolder(normalizePath(collection.folder));
        }
        const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
        const folder = collection.folder ? `${normalizePath(collection.folder)}/` : '';
        let path = normalizePath(`${folder}${safeTitle}.md`);
        let suffix = 2;
        while (this.plugin.app.vault.getAbstractFileByPath(path)) {
            path = normalizePath(`${folder}${safeTitle} (${suffix++}).md`);
        }
        const file = await this.plugin.app.vault.create(path, templateContent);
        await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
            const fm = frontmatter as Frontmatter;
            writeProperty(fm, this.plugin.settings, 'title', title);
            writeProperty(fm, this.plugin.settings, 'author', this.payloadStrings(payload.authors));
            writeProperty(fm, this.plugin.settings, 'genre', this.payloadStrings(payload.genres));
            writeProperty(fm, this.plugin.settings, 'series', getString(payload.series));
            const seriesIndex = getNumber(payload.seriesIndex);
            if (seriesIndex > 0) writeProperty(fm, this.plugin.settings, 'seriesIndex', seriesIndex);
            writeProperty(fm, this.plugin.settings, 'status', getString(payload.status, this.plugin.settings.language === 'ru' ? 'В планах' : 'Planned'));
            const coverUrl = getString(payload.coverUrl);
            if (/^https?:\/\//i.test(coverUrl)) writeProperty(fm, this.plugin.settings, 'cover', coverUrl);
            if (collectionId === 'book') writeProperty(fm, this.plugin.settings, 'format', getString(payload.format, 'Paper'));
            else writeProperty(fm, this.plugin.settings, 'libraryType', collectionId);
            if (collectionId !== 'book' && getString(payload.format)) writeProperty(fm, this.plugin.settings, 'format', getString(payload.format));
            if (getString(payload.unit)) writeProperty(fm, this.plugin.settings, 'unit', getString(payload.unit));
            const total = getNumber(payload.total);
            if (total > 0) writeProperty(fm, this.plugin.settings, 'total', total);
            writeProperty(fm, this.plugin.settings, 'progress', 0);
        });
        this.plugin.stateManager.refreshAllMedia();
    }

    private payloadStrings(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))];
    }

    private captureCategory(value: string): 'thought' | 'link' | 'idea' | 'task' | 'quote' {
        return value === 'link' || value === 'idea' || value === 'task' || value === 'quote' ? value : 'thought';
    }

    private hashSnapshot(value: unknown): string {
        const text = JSON.stringify(value);
        let hash = 2166136261;
        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    private request(path: string, method: 'GET' | 'POST', body?: unknown) {
        const baseUrl = (this.plugin.settings.cloudflareWorkerUrl || '').trim().replace(/\/+$/, '');
        const token = (this.plugin.settings.cloudflareApiToken || '').trim();
        return requestUrl({
            url: `${baseUrl}${path}`,
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
            },
            ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {})
        });
    }

    private explicitState(value: string | null): HabitExplicitState | null {
        return value === 'completed' || value === 'partial' || value === 'skipped' || value === 'excused' || value === 'deferred'
            ? value
            : null;
    }

    private parsePayload(raw: string): Record<string, unknown> {
        try { return getObject(JSON.parse(raw)); } catch { return {}; }
    }
}
