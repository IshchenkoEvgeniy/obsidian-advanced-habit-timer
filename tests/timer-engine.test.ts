import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { get } from 'svelte/store';
import { TimerEngine } from '../src/timer/timer-engine';
import { activeProjectTaskFile, activeProjectTaskName, isSingleFileTask, selectedHabit, selectedSubTask,
    sessionStartTime, timerMode, timerSeconds, isRunning } from '../src/store/TimerStore';

function createHarness() {
    const file = new TFile('Daily/2026-10-04.md');
    const settings = { dailyNotesFolder: 'Daily', pomodoroDuration: 25, telegramLiveNotifications: false,
        language: 'en', activeTimer: undefined };
    const plugin = { settings, saveSettings: vi.fn(async () => undefined) };
    const app = {
        vault: { getAbstractFileByPath: () => file },
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
        fileManager: { processFrontMatter: vi.fn(async (_file: TFile, update: (fm: Record<string, unknown>) => void) => update({})) }
    };
    const view = { plugin, app, ensureDailyNote: vi.fn(async () => file),
        musicPlayer: { playIfReady: vi.fn(), pause: vi.fn() }, save: vi.fn(async () => undefined) };
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), setTimeout: vi.fn() });
    selectedHabit.set('Read'); selectedSubTask.set(''); sessionStartTime.set(null);
    timerMode.set('timer'); timerSeconds.set(0); isRunning.set(false);
    activeProjectTaskFile.set(null); activeProjectTaskName.set(null); isSingleFileTask.set(false);
    return { engine: new TimerEngine(view as never), plugin, file };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('TimerEngine wall-clock persistence', () => {
    it('includes time since the last interval tick when pausing after throttling', async () => {
        const { engine, plugin } = createHarness();
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await engine.start();
        // Browser intervals can be delayed while the app is in the background.
        vi.mocked(Date.now).mockReturnValue(1_065_000);
        await engine.pause();
        expect(get(timerSeconds)).toBe(65);
        expect(plugin.settings.activeTimer?.elapsedSeconds).toBe(65);
    });

    it('keeps the same elapsed time in stores and persisted settings when taking a snapshot', async () => {
        const { engine, plugin } = createHarness();
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await engine.start();
        vi.mocked(Date.now).mockReturnValue(1_012_000);
        await engine.syncSnapshot('running');
        expect(get(timerSeconds)).toBe(12);
        expect(plugin.settings.activeTimer?.elapsedSeconds).toBe(12);
    });

    it('still schedules completion if a pomodoro expires while saving its snapshot', async () => {
        const { engine } = createHarness();
        timerMode.set('pm'); timerSeconds.set(1500);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await engine.start();
        vi.mocked(Date.now).mockReturnValue(2_600_000);
        await engine.syncSnapshot('running');
        expect(get(timerSeconds)).toBe(0);
        expect(window.setTimeout).toHaveBeenCalledTimes(1);
    });

    it('clears stale project context when recovering a daily habit session', async () => {
        const { engine, plugin, file } = createHarness();
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await engine.start();
        await engine.pause();
        activeProjectTaskFile.set(new TFile('Projects/Old.md'));
        activeProjectTaskName.set('Old'); isSingleFileTask.set(true);
        await engine.recoverActiveTimer();
        expect(plugin.settings.activeTimer?.path).toBe(file.path);
        expect(get(activeProjectTaskFile)).toBeNull();
        expect(get(activeProjectTaskName)).toBeNull();
        expect(get(isSingleFileTask)).toBe(false);
    });
});
