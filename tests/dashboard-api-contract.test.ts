import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { DashboardApiBridge } from '../src/integration/dashboard-api';
import {
    DASHBOARD_API_READY_EVENT,
    DASHBOARD_API_REQUEST_EVENT,
    DASHBOARD_API_UNAVAILABLE_EVENT
} from '../src/integration/dashboard-api-contract';
import { buildDashboardSnapshot } from '../src/integration/dashboard-snapshot';

class FakeEventBus {
    private handlers = new Map<string, Set<(...args: unknown[]) => unknown>>();

    on(name: string, callback: (...args: unknown[]) => unknown) {
        const listeners = this.handlers.get(name) || new Set();
        listeners.add(callback);
        this.handlers.set(name, listeners);
        return { name, callback };
    }

    trigger(name: string, ...args: unknown[]): void {
        this.handlers.get(name)?.forEach(callback => callback(...args));
    }
}

function fakePlugin() {
    const workspace = new FakeEventBus();
    const metadataCache = new FakeEventBus();
    const vault = Object.assign(new FakeEventBus(), { getMarkdownFiles: vi.fn(() => []) });
    return {
        settings: {
            language: 'ru',
            properties: [],
            projectScopes: [],
            activeTimer: undefined,
            pomodoroDuration: 25,
            dailyNotesFolder: '',
            mediaCollections: [],
            telegramBotToken: 'must-not-leak',
            cloudflareApiToken: 'must-not-leak-either'
        },
        app: { workspace, metadataCache, vault },
        stateManager: { mediaItems: writable([]) },
        projectEngine: { loadTasks: vi.fn(async () => []) },
        getDailyNote: vi.fn(() => null),
        getHabitStreak: vi.fn(async () => 0),
        registerEvent: vi.fn(),
        formatTime: vi.fn((seconds: number) => String(seconds))
    };
}

describe('dashboard API contract', () => {
    it('builds an allowlisted snapshot without settings secrets', async () => {
        const plugin = fakePlugin();
        const snapshot = await buildDashboardSnapshot(plugin as never, {}, 7);
        const serialized = JSON.stringify(snapshot);

        expect(snapshot.apiVersion).toBe(1);
        expect(snapshot.revision).toBe(7);
        expect(serialized).not.toContain('must-not-leak');
        expect(serialized).not.toContain('telegramBotToken');
        expect(serialized).not.toContain('cloudflareApiToken');
    });

    it('returns bounded habit history and aggregate statistics', async () => {
        const plugin = fakePlugin();
        const snapshot = await buildDashboardSnapshot(plugin as never, {
            domains: ['habits', 'stats'],
            habitHistoryDays: 10_000,
            statsRangeDays: 14
        }, 8);

        expect(snapshot.habitHistory).toEqual([]);
        expect(snapshot.stats).toEqual({
            rangeDays: 14,
            trackedHabits: 0,
            completedHabitDays: 0,
            scoredHabitDays: 0,
            habitCompletionRate: 0,
            totalTimerSeconds: 0,
            activeTasks: 0,
            completedTasks: 0,
            activeMedia: 0,
            completedMedia: 0
        });
    });

    it('publishes the API through the workspace handshake', () => {
        const plugin = fakePlugin();
        let readyApi: unknown;
        plugin.app.workspace.on(DASHBOARD_API_READY_EVENT, api => { readyApi = api; });

        const bridge = new DashboardApiBridge(plugin as never);
        bridge.start();

        let requestedApi: unknown;
        plugin.app.workspace.trigger(DASHBOARD_API_REQUEST_EVENT, (api: unknown) => { requestedApi = api; });
        expect(readyApi).toBe(bridge.api);
        expect(requestedApi).toBe(bridge.api);
        expect(bridge.api.apiVersion).toBe(1);
    });

    it('deduplicates equal snapshot queries until data changes', async () => {
        vi.stubGlobal('window', globalThis);
        const plugin = fakePlugin();
        const bridge = new DashboardApiBridge(plugin as never);

        await bridge.api.getSnapshot({ domains: ['habits'] });
        await bridge.api.getSnapshot({ domains: ['habits'] });
        expect(plugin.getDailyNote).toHaveBeenCalledTimes(1);

        bridge.emitChanged(['habits']);
        await bridge.api.getSnapshot({ domains: ['habits'] });
        expect(plugin.getDailyNote).toHaveBeenCalledTimes(2);
        bridge.stop();
        vi.unstubAllGlobals();
    });

    it('emits debounced revisions and announces unavailability', () => {
        vi.useFakeTimers();
        vi.stubGlobal('window', globalThis);
        const plugin = fakePlugin();
        const bridge = new DashboardApiBridge(plugin as never);
        const changed = vi.fn();
        const unavailable = vi.fn();
        plugin.app.workspace.on(DASHBOARD_API_UNAVAILABLE_EVENT, unavailable);
        bridge.start();
        bridge.api.subscribe(changed);

        bridge.emitChanged(['projects']);
        bridge.emitChanged(['library']);
        vi.advanceTimersByTime(151);

        expect(changed).toHaveBeenCalledTimes(1);
        expect((changed.mock.calls[0]?.[0] as { domains: string[] }).domains).toEqual(['projects', 'library']);

        bridge.stop();
        expect(unavailable).toHaveBeenCalledWith(1);
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });
});
