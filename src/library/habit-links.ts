import type { HabitProperty, HabitTimerSettings, MediaCollectionConfig } from '../types';

function normalized(value: string | undefined): string {
    return (value || '').trim().toLocaleLowerCase();
}

export function collectionsForHabit(
    settings: Pick<HabitTimerSettings, 'mediaCollections'>,
    habit: Pick<HabitProperty, 'name' | 'mediaCollections'> | undefined
): MediaCollectionConfig[] {
    if (!habit) return [];
    const configured = new Set((habit.mediaCollections || []).map(normalized));
    const habitName = normalized(habit.name);
    return settings.mediaCollections.filter(collection =>
        collection.enabled && (
            configured.has(normalized(collection.id)) ||
            normalized(collection.targetHabit) === habitName
        )
    );
}

export function habitForCollection(
    settings: Pick<HabitTimerSettings, 'mediaCollections' | 'properties'>,
    collectionId: string
): HabitProperty | undefined {
    const targetCollection = settings.mediaCollections.find(
        collection => collection.enabled && normalized(collection.id) === normalized(collectionId)
    );
    if (!targetCollection) return undefined;

    const configuredOnHabit = settings.properties.find(habit =>
        (habit.mediaCollections || []).some(id => normalized(id) === normalized(targetCollection.id))
    );
    if (configuredOnHabit) return configuredOnHabit;

    const targetHabit = normalized(targetCollection.targetHabit);
    return targetHabit
        ? settings.properties.find(habit => normalized(habit.name) === targetHabit)
        : undefined;
}
