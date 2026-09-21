import { describe, expect, it } from 'vitest';
import { collectionsForHabit, habitForCollection } from '../src/library/habit-links';
import type { HabitTimerSettings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';

describe('library habit links', () => {
    it('resolves links configured on the habit', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            mediaCollections: DEFAULT_SETTINGS.mediaCollections.map(collection => ({ ...collection }))
        } satisfies HabitTimerSettings;
        const linked = collectionsForHabit(settings, { name: 'Read', mediaCollections: ['book'] });
        expect(linked.map(collection => collection.id)).toEqual(['book']);
    });

    it('resolves reverse targetHabit links from a collection', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            mediaCollections: DEFAULT_SETTINGS.mediaCollections.map(collection => ({
                ...collection,
                targetHabit: collection.id === 'course' ? 'Habit-English' : undefined
            }))
        } satisfies HabitTimerSettings;
        const linked = collectionsForHabit(settings, { name: 'Habit-English' });
        expect(linked.map(collection => collection.id)).toEqual(['course']);
    });

    it('deduplicates a link configured in both directions', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            mediaCollections: DEFAULT_SETTINGS.mediaCollections.map(collection => ({
                ...collection,
                targetHabit: collection.id === 'course' ? 'English' : undefined
            }))
        } satisfies HabitTimerSettings;
        const linked = collectionsForHabit(settings, { name: 'English', mediaCollections: ['course'] });
        expect(linked.filter(collection => collection.id === 'course')).toHaveLength(1);
    });

    it('finds the habit linked to a collection from habit settings', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            properties: [
                { name: 'Habit-Read', goalMinutes: 15, globalGoalHours: 100, mediaCollections: ['BOOK'] }
            ],
            mediaCollections: DEFAULT_SETTINGS.mediaCollections.map(collection => ({ ...collection }))
        } satisfies HabitTimerSettings;

        expect(habitForCollection(settings, 'book')?.name).toBe('Habit-Read');
    });

    it('falls back to the collection target habit', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            properties: [
                { name: 'Habit-English', goalMinutes: 60, globalGoalHours: 100 }
            ],
            mediaCollections: DEFAULT_SETTINGS.mediaCollections.map(collection => ({
                ...collection,
                targetHabit: collection.id === 'course' ? 'habit-english' : undefined
            }))
        } satisfies HabitTimerSettings;

        expect(habitForCollection(settings, 'COURSE')?.name).toBe('Habit-English');
    });
});
