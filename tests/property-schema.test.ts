import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { analyzeLibraryData, buildMigrationPreview } from '../src/library/data-health';
import { normalizeAliases, primaryProperty, readPropertyNumber, readPropertyString, readPropertyStrings } from '../src/library/property-schema';
import { DEFAULT_SETTINGS } from '../src/types';
import type { HabitTimerSettings } from '../src/types';
import type { MediaItem } from '../src/store/StateManager';
import type { Frontmatter } from '../src/utils/frontmatter';

function settings(): HabitTimerSettings {
    return {
        ...DEFAULT_SETTINGS,
        mediaCollections: [{
            id: 'book', enabled: true, folder: 'Books', templatePath: '',
            readingStatusName: 'Reading', pausedStatusName: 'Paused', finishedStatusName: 'Read'
        }],
        libraryPropertyAliases: normalizeAliases(undefined)
    };
}

function item(fm: Frontmatter, overrides: Partial<MediaItem> = {}): MediaItem {
    const file = new TFile(`Books/${String(fm.Title || 'Book')}.md`) as unknown as MediaItem['file'];
    return {
        file,
        title: String(fm.Title || 'Book'),
        cover: '',
        status: String(fm.Status || ''),
        collectionId: 'book',
        rating: String(fm.Rating || ''),
        total: Number(fm.Total || 0),
        progress: Number(fm.Progress || 0),
        authors: [],
        authorOrDirector: '',
        series: '',
        seriesIndex: 0,
        genres: [],
        genre: '',
        format: 'Paper',
        unit: '',
        startDate: '',
        endDate: '',
        cache: { frontmatter: fm },
        ...overrides
    } as MediaItem;
}

describe('library property schema', () => {
    it('reads configured aliases and uses the first alias for writing', () => {
        const config = settings();
        config.libraryPropertyAliases.author = ['Authors', 'Author', 'Автор'];
        const fm: Frontmatter = { Автор: ['Илья Ильф', 'Евгений Петров'] };
        expect(primaryProperty(config, 'author')).toBe('Authors');
        expect(readPropertyStrings(fm, config, 'author')).toEqual(['Илья Ильф', 'Евгений Петров']);
    });

    it('falls back to defaults for missing alias groups', () => {
        const aliases = normalizeAliases({ title: ['Heading'] });
        expect(aliases.title).toEqual(['Heading']);
        expect(aliases.genre).toContain('Genre');
        expect(readPropertyString({ Heading: 'Dune' }, { ...settings(), libraryPropertyAliases: aliases }, 'title')).toBe('Dune');
    });

    it('reads queue order and target date from Obsidian properties', () => {
        const config = settings();
        const fm: Frontmatter = { 'Queue Order': 3, 'Target Date': '2026-08-15' };
        expect(readPropertyNumber(fm, config, 'queueOrder')).toBe(3);
        expect(readPropertyString(fm, config, 'targetDate')).toBe('2026-08-15');
    });

    it('reads the progress unit from canonical and localized properties', () => {
        const config = settings();
        expect(readPropertyString({ Unit: 'lessons' }, config, 'unit')).toBe('lessons');
        expect(readPropertyString({ 'Единица прогресса': 'эпизоды' }, config, 'unit')).toBe('эпизоды');
    });
});

describe('library data health', () => {
    it('reports missing total, unknown status, bad rating and duplicate genres', () => {
        const config = settings();
        const media = item({
            Title: 'Broken', Status: 'Mystery', Rating: '12+', Genre: ['Fantasy', 'fantasy']
        }, { genres: ['Fantasy', 'fantasy'] });
        const kinds = analyzeLibraryData([media], config).map(issue => issue.kind);
        expect(kinds).toContain('missing-total');
        expect(kinds).toContain('unknown-status');
        expect(kinds).toContain('invalid-rating');
        expect(kinds).toContain('duplicate-genres');
    });

    it('accepts configured active, paused, finished and planned statuses', () => {
        const config = settings();
        const items = [
            item({ Title: 'A', Total: 1, Status: 'Reading' }, { total: 1, status: 'Reading' }),
            item({ Title: 'B', Total: 1, Status: 'Read' }, { total: 1, status: 'Read' }),
            item({ Title: 'C', Total: 1, Status: 'В планах' }, { total: 1, status: 'В планах' }),
            item({ Title: 'D', Total: 1, Status: 'Paused' }, { total: 1, status: 'Paused' })
        ];
        expect(analyzeLibraryData(items, config).filter(issue => issue.kind === 'unknown-status')).toHaveLength(0);
    });

    it('previews consolidation of aliases into list properties', () => {
        const config = settings();
        config.libraryPropertyAliases.author = ['Authors', 'Author', 'Автор'];
        const fm: Frontmatter = {
            Title: 'Twelve Chairs', Total: 100, Status: 'Planned',
            Author: 'Илья Ильф, Евгений Петров', Автор: ['Илья Ильф'],
            Genre: 'Роман, Классика'
        };
        const changes = buildMigrationPreview([item(fm, { total: 100, status: 'Planned' })], config);
        const author = changes.find(change => change.field === 'author');
        expect(author?.target).toBe('Authors');
        expect(author?.sources).toEqual(['Author', 'Автор']);
        expect(author?.values).toEqual(['Илья Ильф', 'Евгений Петров']);
        expect(changes.find(change => change.field === 'genre')?.values).toEqual(['Роман', 'Классика']);
    });

    it('suggests the configured collection unit for legacy notes', () => {
        const config = settings();
        config.mediaCollections[0]!.dailyGoalUnit = 'pages';
        const media = item({ Title: 'Legacy', Total: 100, Status: 'Reading' }, { total: 100, status: 'Reading' });
        const changes = buildMigrationPreview([media], config);
        expect(changes.find(change => change.field === 'unit')).toMatchObject({ target: 'Unit', values: ['pages'] });
        expect(analyzeLibraryData([media], config).map(issue => issue.kind)).toContain('missing-unit');
    });
});
