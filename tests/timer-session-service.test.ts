import { writable } from 'svelte/store';
import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
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
            libraryPropertyAliases: {}
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
    return { plugin, daily, book, frontmatter, contents };
}

describe('TimerSessionService', () => {
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
});
