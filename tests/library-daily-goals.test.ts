import { describe, expect, it } from 'vitest';
import {
    collectionDailyGoal,
    collectionDailyGoalEnabled,
    collectionDailyGoalUnit,
    dailyGoalUnitLabel,
    defaultDailyGoal,
    defaultDailyGoalUnit,
    automaticTimerProgress,
    mediaProgressUnit,
    normalizeDailyGoalUnit,
    quickProgressStep
} from '../src/library/daily-goals';
import type { MediaCollectionConfig } from '../src/types';

function collection(id: string, changes: Partial<MediaCollectionConfig> = {}): MediaCollectionConfig {
    return {
        id,
        enabled: true,
        folder: '',
        templatePath: '',
        readingStatusName: 'Active',
        finishedStatusName: 'Finished',
        ...changes
    };
}

describe('library daily goals', () => {
    it('migrates the legacy pages goal to books', () => {
        expect(defaultDailyGoal('book', 25)).toBe(25);
        expect(collectionDailyGoal(collection('book'), 25)).toBe(25);
    });

    it('uses media-specific defaults', () => {
        expect(defaultDailyGoal('film')).toBe(1);
        expect(defaultDailyGoalUnit('film')).toBe('items');
        expect(defaultDailyGoalUnit('anime')).toBe('episodes');
        expect(defaultDailyGoalUnit('course')).toBe('lessons');
    });

    it('prefers an explicitly configured collection goal', () => {
        const configured = collection('film', { dailyGoal: 2, dailyGoalUnit: 'hours' });
        expect(collectionDailyGoal(configured)).toBe(2);
        expect(collectionDailyGoalUnit(configured)).toBe('hours');
        expect(dailyGoalUnitLabel('hours', 'ru')).toBe('часов');
    });

    it('allows a collection goal to be disabled without changing existing defaults', () => {
        expect(collectionDailyGoalEnabled(collection('book'))).toBe(true);
        expect(collectionDailyGoalEnabled(collection('book', { dailyGoalEnabled: false }))).toBe(false);
    });

    it('derives automatic timer progress only for time-based units', () => {
        expect(automaticTimerProgress('minutes', 4500)).toBe(75);
        expect(automaticTimerProgress('hours', 4500)).toBe(1.25);
        expect(automaticTimerProgress('lessons', 4500)).toBeNull();
        expect(normalizeDailyGoalUnit('эпизоды')).toBe('episodes');
        expect(quickProgressStep('hours')).toBe(0.25);
    });

    it('keeps film completion goals separate from film runtime', () => {
        expect(mediaProgressUnit('items', 'film', '', 215, 'items')).toBe('minutes');
        expect(mediaProgressUnit('', 'film', '', 0, 'items')).toBe('minutes');
        expect(mediaProgressUnit('items', 'film', '', 1, 'items')).toBe('items');
    });
});
