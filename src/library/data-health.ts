import { App, Modal, Notice, Setting } from 'obsidian';
import type HabitTimerPlugin from '../main';
import type { MediaItem } from '../store/StateManager';
import type { HabitTimerSettings, LibraryPropertyField } from '../types';
import type { Frontmatter } from '../utils/frontmatter';
import { getStringArray } from '../utils/frontmatter';
import { parseRating } from '../utils/rating';
import { aliasesFor, primaryProperty, writeProperty } from './property-schema';
import { collectionDailyGoalUnit, mediaProgressUnit } from './daily-goals';

export type DataIssueKind =
    | 'missing-total' | 'unknown-status' | 'invalid-rating'
    | 'duplicate-genres' | 'legacy-list' | 'alias-conflict' | 'missing-unit';

export interface DataHealthIssue {
    kind: DataIssueKind;
    item: MediaItem;
    detail: string;
}

export interface MigrationChange {
    item: MediaItem;
    field: 'author' | 'genre' | 'unit';
    sources: string[];
    target: string;
    values: string[];
}

const PLANNED_STATUSES = new Set(['planned', 'plan', 'в планах', 'запланировано', 'запланирован']);

function presentAliases(fm: Frontmatter, settings: HabitTimerSettings, field: LibraryPropertyField): string[] {
    return aliasesFor(settings, field).filter(key => fm[key] !== null && fm[key] !== undefined);
}

function collectValues(fm: Frontmatter, settings: HabitTimerSettings, field: 'author' | 'genre'): string[] {
    const values = presentAliases(fm, settings, field).flatMap(key => getStringArray(fm, key));
    const seen = new Set<string>();
    return values.map(value => value.trim()).filter(value => {
        const normalized = value.toLocaleLowerCase();
        if (!value || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}

function inferredUnit(item: MediaItem, settings: HabitTimerSettings): string {
    const collection = settings.mediaCollections.find(value => value.id === item.collectionId);
    return mediaProgressUnit(
        '', item.collectionId, item.format, item.total,
        collection ? collectionDailyGoalUnit(collection) : 'units'
    );
}

export function analyzeLibraryData(items: MediaItem[], settings: HabitTimerSettings): DataHealthIssue[] {
    const issues: DataHealthIssue[] = [];
    items.forEach(item => {
        const fm = item.cache.frontmatter as Frontmatter | undefined;
        if (!fm) return;
        const collection = settings.mediaCollections.find(value => value.id === item.collectionId);

        if (item.total <= 0) {
            issues.push({ kind: 'missing-total', item, detail: 'Total' });
        }

        const normalizedStatus = item.status.trim().toLocaleLowerCase();
        const knownStatus = Boolean(collection && (
            item.status === collection.readingStatusName ||
            item.status === collection.pausedStatusName ||
            item.status === collection.finishedStatusName ||
            PLANNED_STATUSES.has(normalizedStatus)
        ));
        if (!knownStatus) {
            issues.push({ kind: 'unknown-status', item, detail: item.status || 'empty' });
        }

        if (item.rating && !parseRating(item.rating)) {
            issues.push({ kind: 'invalid-rating', item, detail: item.rating });
        }

        if (collection && presentAliases(fm, settings, 'unit').length === 0) {
            issues.push({ kind: 'missing-unit', item, detail: inferredUnit(item, settings) });
        }

        const rawGenres = presentAliases(fm, settings, 'genre').flatMap(key => getStringArray(fm, key));
        const genreKeys = rawGenres.map(value => value.trim().toLocaleLowerCase()).filter(Boolean);
        const duplicateGenres = [...new Set(genreKeys.filter((value, index) => genreKeys.indexOf(value) !== index))];
        if (duplicateGenres.length) {
            issues.push({ kind: 'duplicate-genres', item, detail: duplicateGenres.join(', ') });
        }

        (['author', 'genre'] as const).forEach(field => {
            const sources = presentAliases(fm, settings, field);
            const hasScalar = sources.some(key => !Array.isArray(fm[key]) && String(fm[key] ?? '').trim());
            if (hasScalar) {
                issues.push({ kind: 'legacy-list', item, detail: aliasesFor(settings, field)[0] || field });
            }
        });
        (Object.keys(settings.libraryPropertyAliases) as LibraryPropertyField[]).forEach(field => {
            const sources = presentAliases(fm, settings, field);
            if (sources.length > 1) {
                issues.push({ kind: 'alias-conflict', item, detail: sources.join(' + ') });
            }
        });
    });
    return issues;
}

export function buildMigrationPreview(items: MediaItem[], settings: HabitTimerSettings): MigrationChange[] {
    const changes: MigrationChange[] = [];
    items.forEach(item => {
        const fm = item.cache.frontmatter as Frontmatter | undefined;
        if (!fm) return;
        (['author', 'genre'] as const).forEach(field => {
            const sources = presentAliases(fm, settings, field);
            const values = collectValues(fm, settings, field);
            const target = primaryProperty(settings, field);
            const alreadyCanonical = sources.length === 1 && sources[0] === target && Array.isArray(fm[target]);
            if (values.length && !alreadyCanonical) changes.push({ item, field, sources, target, values });
        });
        const collection = settings.mediaCollections.find(value => value.id === item.collectionId);
        if (collection && presentAliases(fm, settings, 'unit').length === 0) {
            changes.push({
                item,
                field: 'unit',
                sources: [],
                target: primaryProperty(settings, 'unit'),
                values: [inferredUnit(item, settings)]
            });
        }
    });
    return changes;
}

export async function applyPropertyMigration(
    app: App,
    plugin: HabitTimerPlugin,
    changes: MigrationChange[]
): Promise<number> {
    const grouped = new Map<string, MigrationChange[]>();
    changes.forEach(change => grouped.set(change.item.file.path, [
        ...(grouped.get(change.item.file.path) || []), change
    ]));
    let migrated = 0;
    for (const fileChanges of grouped.values()) {
        const item = fileChanges[0]?.item;
        if (!item) continue;
        await app.fileManager.processFrontMatter(item.file, frontmatter => {
            const fm = frontmatter as Frontmatter;
            fileChanges.forEach(change => writeProperty(
                fm, plugin.settings, change.field,
                change.field === 'unit' ? change.values[0] || 'units' : change.values
            ));
        });
        migrated++;
    }
    plugin.stateManager.refreshAllMedia();
    return migrated;
}

export class PropertyMigrationModal extends Modal {
    constructor(
        app: App,
        private plugin: HabitTimerPlugin,
        private changes: MigrationChange[],
        private onComplete: () => void
    ) {
        super(app);
    }

    onOpen(): void {
        const lang = this.plugin.settings.language;
        this.contentEl.empty();
        this.contentEl.createEl('h2', { text: lang === 'ru' ? 'Миграция свойств' : 'Property migration' });
        const files = new Set(this.changes.map(change => change.item.file.path)).size;
        this.contentEl.createEl('p', {
            text: lang === 'ru'
                ? `${files} заметок будут обновлены. Текст заметок не изменяется.`
                : `${files} notes will be updated. Note content will not be changed.`
        });
        const list = this.contentEl.createDiv({ cls: 'ht-migration-preview' });
        this.changes.slice(0, 30).forEach(change => {
            const row = list.createDiv({ cls: 'ht-migration-row' });
            row.createEl('strong', { text: change.item.title });
            row.createEl('span', { text: `${change.sources.join(', ')} → ${change.target}` });
            row.createEl('small', { text: change.values.join(' · ') });
        });
        if (this.changes.length > 30) {
            list.createEl('p', { text: `+${this.changes.length - 30}` });
        }
        new Setting(this.contentEl)
            .addButton(button => button.setButtonText(lang === 'ru' ? 'Отмена' : 'Cancel').onClick(() => this.close()))
            .addButton(button => button
                .setButtonText(lang === 'ru' ? 'Применить миграцию' : 'Apply migration')
                .setCta()
                .onClick(async () => {
                    button.setDisabled(true);
                    const count = await applyPropertyMigration(this.app, this.plugin, this.changes);
                    new Notice(lang === 'ru' ? `Обновлено заметок: ${count}` : `Updated notes: ${count}`);
                    this.onComplete();
                    this.close();
                }));
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
