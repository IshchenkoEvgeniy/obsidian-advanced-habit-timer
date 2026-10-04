import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { TFile } from 'obsidian';
import { StateManager } from '../src/store/StateManager';
import { DEFAULT_SETTINGS } from '../src/types';

function fixture() {
    const file = new TFile('Books/Example.md');
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const metadataOff = vi.fn(), vaultOff = vi.fn();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.mediaCollections = [{ id: 'book', enabled: true, folder: 'Books', templatePath: '',
        readingStatusName: 'Reading', finishedStatusName: 'Done', dailyGoalUnit: 'pages' }];
    const fm: Record<string, unknown> = { Title: 'Example', AlternativeTitle: 'New title', Total: 100 };
    const app = {
        workspace: { layoutReady: true },
        vault: { getMarkdownFiles: () => [file], on: (name: string, callback: (...args: unknown[]) => void) => {
            listeners.set(name, callback); return { name };
        }, offref: vaultOff },
        metadataCache: { getFileCache: () => ({ frontmatter: fm }),
            on: (name: string, callback: (...args: unknown[]) => void) => { listeners.set(name, callback); return { name }; },
            offref: metadataOff }
    };
    const manager = new StateManager(app as never, { settings } as never);
    return { manager, settings, file, listeners, metadataOff, vaultOff };
}

describe('library state cache', () => {
    it('reparses unchanged files when property aliases change', () => {
        const { manager, settings } = fixture();
        expect(get(manager.mediaItems)[0]?.title).toBe('Example');
        settings.libraryPropertyAliases.title = ['AlternativeTitle'];
        manager.refreshAllMedia();
        expect(get(manager.mediaItems)[0]?.title).toBe('New title');
    });

    it('removes an item moved out of its collection folder', () => {
        const { manager, file, listeners } = fixture();
        const oldPath = file.path;
        file.path = 'Archive/Example.md';
        listeners.get('rename')!(file, oldPath);
        expect(get(manager.mediaItems)).toHaveLength(0);
    });

    it('unsubscribes each listener from the emitter that registered it', () => {
        const { manager, metadataOff, vaultOff } = fixture();
        manager.destroy();
        expect(metadataOff).toHaveBeenCalledTimes(1);
        expect(vaultOff).toHaveBeenCalledTimes(2);
    });
});
