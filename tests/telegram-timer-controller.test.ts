import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { TelegramTimerController } from '../src/services/telegram-timer-controller';
import { formatDuration } from '../src/utils';

vi.mock('../src/timer/timer-view', () => ({ TimerView: class {}, VIEW_TYPE_TIMER: 'habit-timer-view' }));

function createHarness() {
    const file = new TFile('Daily/2026-10-04.md');
    const frontmatter: Record<string, unknown> = {};
    let content = '### 📝 Session Log\n| Time | Mode | Property | Duration | Progress | Task |\n|---|---|---|---|---|---|\n\n## Notes\nKeep these notes\n';
    const plugin = {
        settings: {
            properties: [{ name: 'Read', type: 'timer' }],
            activeTimer: undefined
        },
        dailyNotes: { ensureNote: vi.fn(async () => file) },
        app: {
            workspace: { getLeavesOfType: () => [] },
            vault: {
                getAbstractFileByPath: () => file,
                process: vi.fn(async (_file: TFile, update: (text: string) => string) => { content = update(content); })
            },
            fileManager: {
                processFrontMatter: vi.fn(async (_file: TFile, update: (fm: Record<string, unknown>) => void) => update(frontmatter))
            }
        },
        saveSettings: vi.fn(async () => undefined),
        formatTime: formatDuration,
        updateDailyNoteProjectLog: vi.fn(async () => undefined)
    };
    return { plugin, frontmatter, controller: new TelegramTimerController(plugin as never), content: () => content };
}

afterEach(() => vi.restoreAllMocks());

describe('Telegram timer commands', () => {
    it('accepts only one concurrent start',async()=>{
        const {controller}=createHarness();
        const results=await Promise.all([controller.start('Read'),controller.start('Read')]);
        expect(results.filter(r=>r.ok)).toHaveLength(1);
    });

    it('retries a failed log write without losing or doubling the Telegram session',async()=>{
        const {controller,plugin,frontmatter,content}=createHarness();
        vi.spyOn(Date,'now').mockReturnValue(1_000_000);
        await controller.start('Read');vi.mocked(Date.now).mockReturnValue(1_060_000);
        plugin.app.vault.process.mockRejectedValueOnce(new Error('disk failure'));
        await expect(controller.finish()).rejects.toThrow();
        expect(frontmatter.timer_active).toBe(true);
        vi.mocked(Date.now).mockReturnValue(1_120_000);
        expect((await controller.finish()).ok).toBe(true);
        expect(frontmatter.Read).toBe('00:01:00');
        expect(content().match(/\| Telegram \|/g)).toHaveLength(1);
    });
    it('preserves elapsed time when resume is repeated on a running session', async () => {
        const { controller } = createHarness();
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await controller.start('Read');
        vi.mocked(Date.now).mockReturnValue(1_120_000);
        expect(controller.getStatus()?.elapsedSeconds).toBe(120);
        await controller.resume();
        expect(controller.getStatus()?.elapsedSeconds).toBe(120);
    });

    it('writes a Telegram session into the existing journal before following notes', async () => {
        const { controller, content } = createHarness();
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await controller.start('Read');
        vi.mocked(Date.now).mockReturnValue(1_060_000);
        expect((await controller.finish()).ok).toBe(true);
        expect(content().match(/Session Log/g)).toHaveLength(1);
        expect(content().indexOf('| Telegram |')).toBeLessThan(content().indexOf('## Notes'));
        expect(content()).toContain('## Notes\nKeep these notes');
    });
});
