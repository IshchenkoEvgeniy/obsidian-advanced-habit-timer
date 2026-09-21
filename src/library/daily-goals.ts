import type { Language } from '../i18n';
import type { MediaCollectionConfig, MediaDailyGoalUnit } from '../types';

const FALLBACKS: Record<string, { goal: number; unit: MediaDailyGoalUnit }> = {
    book: { goal: 10, unit: 'pages' },
    manga: { goal: 1, unit: 'chapters' },
    film: { goal: 1, unit: 'items' },
    anime: { goal: 1, unit: 'episodes' },
    series: { goal: 1, unit: 'episodes' },
    game: { goal: 1, unit: 'hours' },
    course: { goal: 1, unit: 'lessons' }
};

export const DAILY_GOAL_UNITS: MediaDailyGoalUnit[] = [
    'pages', 'items', 'episodes', 'chapters', 'minutes', 'hours', 'lessons', 'units'
];

export function normalizeDailyGoalUnit(value: string, fallback: MediaDailyGoalUnit = 'units'): MediaDailyGoalUnit {
    const normalized = value.trim().toLocaleLowerCase();
    if (DAILY_GOAL_UNITS.includes(normalized as MediaDailyGoalUnit)) return normalized as MediaDailyGoalUnit;
    if (/page|страниц/.test(normalized)) return 'pages';
    if (/episode|эпизод/.test(normalized)) return 'episodes';
    if (/chapter|глав/.test(normalized)) return 'chapters';
    if (/minute|минут/.test(normalized)) return 'minutes';
    if (/hour|час/.test(normalized)) return 'hours';
    if (/lesson|урок/.test(normalized)) return 'lessons';
    if (/item|произвед|штук|шт/.test(normalized)) return 'items';
    return fallback;
}

export function automaticTimerProgress(unit: MediaDailyGoalUnit, durationSec: number): number | null {
    if (unit === 'minutes') return Math.round(durationSec / 60 * 100) / 100;
    if (unit === 'hours') return Math.round(durationSec / 3600 * 100) / 100;
    return null;
}

export function quickProgressStep(unit: MediaDailyGoalUnit): number {
    if (unit === 'minutes') return 10;
    if (unit === 'hours') return 0.25;
    return 1;
}

export function mediaProgressUnit(
    explicitUnit: string,
    collectionId: string,
    format: string,
    total = 0,
    fallback: MediaDailyGoalUnit = 'units'
): MediaDailyGoalUnit {
    const normalizedFormat = format.trim().toLocaleLowerCase();
    if (normalizedFormat.includes('audio') || normalizedFormat.includes('аудио')) return 'minutes';
    const explicit = explicitUnit ? normalizeDailyGoalUnit(explicitUnit, fallback) : null;
    // Older film notes used the collection goal unit (`items`) even when Total stored runtime.
    if (collectionId.toLocaleLowerCase() === 'film' && (!explicit || (explicit === 'items' && total > 1))) return 'minutes';
    return explicit || fallback;
}

export function defaultDailyGoal(collectionId: string, legacyPagesGoal = 10): number {
    return collectionId === 'book' ? Math.max(1, legacyPagesGoal || 10) : FALLBACKS[collectionId]?.goal ?? 1;
}

export function defaultDailyGoalUnit(collectionId: string): MediaDailyGoalUnit {
    return FALLBACKS[collectionId]?.unit ?? 'units';
}

export function collectionDailyGoal(collection: MediaCollectionConfig, legacyPagesGoal = 10): number {
    return Math.max(1, collection.dailyGoal || defaultDailyGoal(collection.id, legacyPagesGoal));
}

export function collectionDailyGoalEnabled(collection: MediaCollectionConfig): boolean {
    return collection.dailyGoalEnabled !== false;
}

export function collectionDailyGoalUnit(collection: MediaCollectionConfig): MediaDailyGoalUnit {
    return collection.dailyGoalUnit || defaultDailyGoalUnit(collection.id);
}

export function dailyGoalUnitLabel(unit: MediaDailyGoalUnit, lang: Language): string {
    const labels: Record<MediaDailyGoalUnit, [string, string]> = {
        pages: ['pages', 'страниц'], items: ['items', 'произведений'], episodes: ['episodes', 'эпизодов'],
        chapters: ['chapters', 'глав'], minutes: ['minutes', 'минут'], hours: ['hours', 'часов'],
        lessons: ['lessons', 'уроков'], units: ['units', 'единиц']
    };
    return labels[unit][lang === 'ru' ? 1 : 0];
}
