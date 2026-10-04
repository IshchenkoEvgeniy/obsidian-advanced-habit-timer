import { writable } from 'svelte/store';
import { TFile } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIBRARY_PROPERTY_ALIASES } from '../src/types';
import { formatDuration } from '../src/utils';
import { TimerSessionService } from '../src/timer/timer-session-service';

function createHarness() {
    const daily = new TFile('Daily/2026-08-01.md');
    const book = new TFile('Books/Example.md');
    const files = new Map<string, TFile>([[daily.path, daily], [book.path, book]]);
    const frontmatter = new Map<string, Record<string, unknown>>();
    const contents = new Map<string, string>([[daily.path, '---\n---\n'], [book.path, '---\n---\n']]);
    const plugin = {
        settings: {
            properties: [{ id: 'habit-read', name: 'Read', goalMinutes: 15, globalGoalHours: 10 }],
            activeTimer: undefined,
            pomodoroDuration: 25,
            dailyNotesFolder: 'Daily',
            telegramLiveNotifications: false,
            mediaCollections: [],
            language: 'en',
            libraryPropertyAliases: DEFAULT_LIBRARY_PROPERTY_ALIASES
        },
        app: {
            vault: {
                create: vi.fn(async (path: string) => {
                    const file = new TFile(path);
                    files.set(path, file);
                    return file;
                }),
                getAbstractFileByPath: vi.fn((path: string) => files.get(path) || null),
                process: vi.fn(async (file: TFile, update: (content: string) => string) => {
                    const next = update(contents.get(file.path) || '');
                    contents.set(file.path, next);
                    return next;
                }),
                read: vi.fn(async (file: TFile) => contents.get(file.path) || ''),
                modify: vi.fn(async (file: TFile, content: string) => { contents.set(file.path, content); })
            },
            fileManager: {
                processFrontMatter: vi.fn(async (file: TFile, update: (fm: Record<string, unknown>) => void) => {
                    const fm = frontmatter.get(file.path) || {};
                    update(fm);
                    frontmatter.set(file.path, fm);
                })
            }
        },
        stateManager: {
            mediaItems: writable([{
                file: book,
                title: 'Example',
                collectionId: 'book',
                status: 'Reading',
                cover: '',
                progress: 12,
                total: 100,
                rating: '',
                authorOrDirector: '',
                series: '',
                genre: '',
                unit: 'pages',
                startDate: '',
                endDate: '',
                cache: {}
            }])
        },
        getDailyNote: vi.fn(() => daily),
        saveSettings: vi.fn(async () => undefined),
        updateDailyNoteProjectLog: vi.fn(async () => undefined),
        formatTime: vi.fn((seconds: number) => `seconds:${seconds}`),
        telegram: { send: vi.fn(async () => true) }
    };
    return { plugin, daily, book, files, frontmatter, contents };
}

afterEach(() => vi.restoreAllMocks());

describe('TimerSessionService', () => {
    it('accounts for both media and project work when they use the same note',async()=>{
        const {plugin,book,frontmatter,contents}=createHarness();
        plugin.formatTime.mockImplementation(formatDuration);
        const service=new TimerSessionService(plugin as never);
        vi.spyOn(Date,'now').mockReturnValue(1_000_000);
        await service.start({habitName:'Read',mediaPath:book.path,taskPath:book.path,taskName:'Example'});
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        await service.finish({progressAdded:5});
        expect(frontmatter.get(book.path)?.['Reading time']).toBe('00:01:00');
        expect(frontmatter.get(book.path)?.time_spent).toBe('00:01:00');
        expect(contents.get(book.path)).toContain('| 5 |');
    });
    it('retries a partially written session after reload without adding time twice', async () => {
        const { plugin, daily, frontmatter, contents } = createHarness();
        plugin.formatTime.mockImplementation(formatDuration);
        const service = new TimerSessionService(plugin as never);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await service.start({ habitName: 'Read' });
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        plugin.app.vault.process.mockRejectedValueOnce(new Error('disk failure'));
        await expect(service.finish({note:'Original note'})).rejects.toThrow('disk failure');
        expect(frontmatter.get(daily.path)?.Read).toBe('00:01:00');
        const reloaded = new TimerSessionService(plugin as never);
        await reloaded.finish({note:'Changed on retry'});
        expect(frontmatter.get(daily.path)?.Read).toBe('00:01:00');
        expect(contents.get(daily.path)).toContain('Original note');
        expect(contents.get(daily.path)).not.toContain('Changed on retry');
    });

    it('retries media logging without adding progress or reading time twice', async () => {
        const { plugin, book, daily, frontmatter, contents } = createHarness();
        plugin.formatTime.mockImplementation(formatDuration);
        frontmatter.set(book.path,{Progress:98,Total:100});
        const service = new TimerSessionService(plugin as never);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await service.start({habitName:'Read',mediaPath:book.path});
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        plugin.app.vault.process.mockRejectedValueOnce(new Error('disk failure'));
        await expect(service.finish({progressAdded:10})).rejects.toThrow('disk failure');
        expect(await service.resume()).toBe(false);
        const result=await new TimerSessionService(plugin as never).finish({progressAdded:1});
        expect(result?.savedProgress).toBe(2);
        expect(frontmatter.get(book.path)?.['Reading time']).toBe('00:01:00');
        expect(frontmatter.get(book.path)?.Progress).toBe(100);
        expect(contents.get(daily.path)).toContain('| 2 |');
        expect(contents.get(book.path)?.match(/\| 00:01:00 \|/g)).toHaveLength(1);
    });

    it('starts, pauses, resumes and cancels without a TimerView', async () => {
        const { plugin, daily, frontmatter } = createHarness();
        const service = new TimerSessionService(plugin as never);

        expect(await service.start({ habitName: 'Read', mode: 'timer' })).toBe(true);
        expect(plugin.settings.activeTimer?.habitName).toBe('Read');
        expect(frontmatter.get(daily.path)?.timer_active).toBe(true);

        plugin.settings.activeTimer!.lastStartedAt = Date.now() - 3_200;
        expect(await service.pause()).toBe(true);
        expect(plugin.settings.activeTimer?.timerState).toBe('paused');
        expect(plugin.settings.activeTimer?.elapsedSeconds).toBeGreaterThanOrEqual(3);

        expect(await service.resume()).toBe(true);
        expect(plugin.settings.activeTimer?.timerState).toBe('running');
        expect(plugin.settings.activeTimer?.lastStartedAt).toBeTypeOf('number');

        expect(await service.cancel()).toBe(true);
        expect(plugin.settings.activeTimer).toBeUndefined();
        expect(frontmatter.get(daily.path)?.timer_active).toBeUndefined();
    });

    it('returns media finish requirements without mutating the session', async () => {
        const { plugin, book } = createHarness();
        const service = new TimerSessionService(plugin as never);
        expect(await service.start({ habitName: 'Read', mediaPath: book.path })).toBe(true);
        plugin.settings.activeTimer!.lastStartedAt = Date.now() - 65_000;

        const requirements = await service.prepareFinish();
        expect(requirements?.mediaPath).toBe(book.path);
        expect(requirements?.mediaTitle).toBe('Example');
        expect(requirements?.currentProgress).toBe(12);
        expect(requirements?.elapsedSeconds).toBeGreaterThanOrEqual(65);
        expect(plugin.settings.activeTimer?.timerState).toBe('running');
    });

    it('finishes and logs a headless timer session', async () => {
        const { plugin, daily, frontmatter, contents } = createHarness();
        const service = new TimerSessionService(plugin as never);
        expect(await service.start({ habitName: 'Read' })).toBe(true);
        plugin.settings.activeTimer!.lastStartedAt = Date.now() - 120_000;

        const result = await service.finish({ note: 'Focused reading' });
        expect(result?.durationSeconds).toBeGreaterThanOrEqual(120);
        expect(plugin.settings.activeTimer).toBeUndefined();
        expect(frontmatter.get(daily.path)?.Read).toContain('seconds:');
        expect(contents.get(daily.path)).toContain('Focused reading');
        expect(plugin.updateDailyNoteProjectLog).toHaveBeenCalled();
    });

    it('caps an expired headless pomodoro at its remaining work time', async () => {
        const { plugin } = createHarness();
        const service = new TimerSessionService(plugin as never);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await service.start({ habitName: 'Read', mode: 'pm' });
        plugin.settings.activeTimer!.elapsedSeconds = 600;
        plugin.settings.activeTimer!.remainingSeconds = 900;
        vi.mocked(Date.now).mockReturnValue(4_600_000);
        expect((await service.prepareFinish())?.elapsedSeconds).toBe(1500);
        expect((await service.finish())?.durationSeconds).toBe(1500);
    });

    it('treats a legacy session without timerState as running', async () => {
        const { plugin } = createHarness();
        const service = new TimerSessionService(plugin as never);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await service.start({ habitName: 'Read' });
        delete plugin.settings.activeTimer!.timerState;
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        expect((await service.prepareFinish())?.elapsedSeconds).toBe(60);
    });

    it('accepts only one of two simultaneous start requests', async () => {
        const { plugin } = createHarness();
        const service = new TimerSessionService(plugin as never);
        expect(await Promise.all([
            service.start({ habitName: 'Read' }),
            service.start({ habitName: 'Read' })
        ])).toEqual([true, false]);
    });

    it('logs a session once when two finish requests arrive together', async () => {
        const { plugin, contents, daily } = createHarness();
        const service = new TimerSessionService(plugin as never);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await service.start({ habitName: 'Read' });
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        const results = await Promise.all([service.finish(), service.finish()]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(contents.get(daily.path)?.match(/seconds:60/g)).toHaveLength(1);
    });

    it('logs the actual media progress after clamping to its total', async () => {
        const { plugin, book, daily, frontmatter, contents } = createHarness();
        frontmatter.set(book.path, { Progress: 98, Total: 100 });
        const service = new TimerSessionService(plugin as never);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await service.start({ habitName: 'Read', mediaPath: book.path });
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        const result = await service.finish({ progressAdded: 10 });
        expect(result?.savedProgress).toBe(2);
        expect(contents.get(daily.path)).toContain('| 2 |');
        expect(contents.get(daily.path)).not.toContain('| 10 |');
    });

    it('keeps new progress rows inside the media progress section', async () => {
        const { plugin, book, frontmatter, contents } = createHarness();
        frontmatter.set(book.path, { Progress: 12, Total: 100 });
        contents.set(book.path, '### 📖 Progress\n| Date | Time | Progress | % | Notes |\n|---|---|---|---|---|\n\n## Review\nKeep this review\n');
        const service = new TimerSessionService(plugin as never);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await service.start({ habitName: 'Read', mediaPath: book.path });
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        await service.finish({ progressAdded: 5 });
        const content = contents.get(book.path)!;
        expect(content.indexOf('seconds:60')).toBeLessThan(content.indexOf('## Review'));
        expect(content).toContain('## Review\nKeep this review');
    });

    it('adds time to the exact checklist task and preserves its block anchor', async () => {
        const { plugin, book, contents } = createHarness();
        plugin.formatTime.mockImplementation(formatDuration);
        contents.set(book.path, '- [ ] Task extended ^ht-other\n- [ ] **Task** ^ht-target\n');
        const service = new TimerSessionService(plugin as never);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await service.start({ habitName: 'Read', taskPath: book.path, taskName: 'Task', isSingleFileTask: true });
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        await service.finish();
        expect(contents.get(book.path)).toContain('- [ ] Task extended ^ht-other');
        expect(contents.get(book.path)).toContain('- [ ] **Task** ⏱️ 00:01:00 ^ht-target');
    });

    it('retains the selected project subtask for headless saves', async () => {
        const { plugin, book, contents } = createHarness();
        plugin.formatTime.mockImplementation(formatDuration);
        contents.set(book.path, '- [ ] Chapter one ⏱️ 00:01:00\n');
        const service = new TimerSessionService(plugin as never);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await service.start({ habitName: 'Read', taskPath: book.path, taskName: 'Example', subTask: 'Chapter one' });
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        await service.finish();
        expect(contents.get(book.path)).toContain('- [ ] Chapter one ⏱️ 00:02:00');
    });
});
