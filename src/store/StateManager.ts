import { writable } from 'svelte/store';
import { App, TFile } from 'obsidian';
import type { CachedMetadata, EventRef } from 'obsidian';
import type HabitTimerPlugin from '../main';
import type { MediaCollectionConfig } from '../types';
import { collectionDailyGoalUnit, mediaProgressUnit } from '../library/daily-goals';
import { getString } from '../utils/frontmatter';
import type { Frontmatter } from '../utils/frontmatter';
import { readPropertyNumber, readPropertyString, readPropertyStrings } from '../library/property-schema';

export interface MediaItem {
    file: TFile;
    title: string;
    cover: string;
    status: string;
    collectionId: string;
    rating: string;
    total: number;
    progress: number;
    authors: string[];
    authorOrDirector: string;
    series: string;
    seriesIndex: number;
    genres: string[];
    genre: string;
    format: string;
    unit: string;
    startDate: string;
    endDate: string;
    season: number;
    episode: number;
    queueOrder?: number;
    targetDate?: string;
    cache: CachedMetadata;
}

export class StateManager {
    public mediaItems = writable<MediaItem[]>([]);

    /** EventRefs for cleanup on destroy(). */
    private eventRefs: EventRef[] = [];

    /**
     * mtime-based parse cache: path → { mtime, item }.
     * refreshAllMedia() skips files whose mtime hasn't changed since last parse.
     * Evicted on delete/rename via handleFileDelete/handleFileRename.
     */
    private parseCache = new Map<string, { mtime: number; item: MediaItem | null }>();
    
    constructor(private app: App, private plugin: HabitTimerPlugin) {
        this.initializeListeners();
    }

    private initializeListeners() {
        // Store EventRefs so they can be properly offref'd in destroy()
        this.eventRefs.push(
            this.app.metadataCache.on('changed', (file) => this.handleFileChange(file))
        );
        this.eventRefs.push(
            this.app.vault.on('delete', (file) => {
                if (file instanceof TFile) this.handleFileDelete(file);
            })
        );
        this.eventRefs.push(
            this.app.vault.on('rename', (file, oldPath) => {
                if (file instanceof TFile) this.handleFileRename(file, oldPath);
            })
        );
        
        // Initial load
        if (this.app.workspace.layoutReady) {
            this.refreshAllMedia();
        } else {
            this.app.workspace.onLayoutReady(() => {
                this.refreshAllMedia();
            });
        }
    }

    /**
     * Unregister all event listeners. Call from plugin.onunload() to prevent
     * duplicate handlers accumulating across plugin reloads.
     */
    public destroy() {
        for (const ref of this.eventRefs) {
            this.app.metadataCache.offref(ref);
        }
        this.eventRefs = [];
    }
    
    public refreshAllMedia() {
        const files = this.app.vault.getMarkdownFiles();
        const items: MediaItem[] = [];
        
        for (const file of files) {
            // Fast path: skip if mtime hasn't changed since last parse
            const cached = this.parseCache.get(file.path);
            if (cached && cached.mtime === file.stat.mtime) {
                if (cached.item) items.push(cached.item);
                continue;
            }
            // Slow path: re-parse and update cache
            const item = this.parseMediaFile(file);
            this.parseCache.set(file.path, { mtime: file.stat.mtime, item });
            if (item) items.push(item);
        }
        
        this.mediaItems.set(items);
    }
    
    private handleFileChange(file: TFile) {
        // Evict from mtime cache so refreshAllMedia re-parses this file
        this.parseCache.delete(file.path);
        const item = this.parseMediaFile(file);
        // Update cache with fresh parse result
        this.parseCache.set(file.path, { mtime: file.stat.mtime, item });
        this.mediaItems.update(items => {
            const idx = items.findIndex(i => i.file.path === file.path);
            if (item) {
                if (idx !== -1) items[idx] = item;
                else items.push(item);
            } else {
                if (idx !== -1) items.splice(idx, 1);
            }
            return items;
        });
    }
    
    private handleFileDelete(file: TFile) {
        this.parseCache.delete(file.path);
        this.mediaItems.update(items => items.filter(i => i.file.path !== file.path));
    }
    
    private handleFileRename(file: TFile, oldPath: string) {
        this.parseCache.delete(oldPath);
        this.handleFileChange(file);
    }
    
    private parseMediaFile(file: TFile): MediaItem | null {
        if (file.path.includes('Шаблоны') || file.path.includes('Template')) return null;
        
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache || !cache.frontmatter) return null;
        
        const fm = cache.frontmatter as Frontmatter;
        const settings = this.plugin.settings;
        const fmType = readPropertyString(fm, settings, 'libraryType') || getString(fm, 'Type');
        
        let matchedCollection: MediaCollectionConfig | undefined;
        if (fmType) {
            matchedCollection = this.plugin.settings.mediaCollections.find(
                c => c.id.toLowerCase() === fmType.toLowerCase()
            );
        }
        
        if (!matchedCollection) {
            matchedCollection = this.plugin.settings.mediaCollections.find(
                c => c.folder && file.path.startsWith(c.folder + '/')
            );
        }
        
        if (!matchedCollection) return null;
        
        const authors = readPropertyStrings(fm, settings, 'author');
        const genres = readPropertyStrings(fm, settings, 'genre');
        const format = readPropertyString(fm, settings, 'format');
        const total = readPropertyNumber(fm, settings, 'total');

        return {
            file,
            title: readPropertyString(fm, settings, 'title', file.basename),
            cover: this.resolveCover(readPropertyString(fm, settings, 'cover'), file.path),
            status: readPropertyString(fm, settings, 'status'),
            collectionId: matchedCollection.id,
            rating: readPropertyString(fm, settings, 'rating'),
            total,
            progress: readPropertyNumber(fm, settings, 'progress'),
            authors,
            authorOrDirector: authors.join(', '),
            series: readPropertyString(fm, settings, 'series'),
            seriesIndex: readPropertyNumber(fm, settings, 'seriesIndex'),
            genres,
            genre: genres.join(', '),
            format,
            unit: mediaProgressUnit(
                readPropertyString(fm, settings, 'unit'),
                matchedCollection.id,
                format,
                total,
                collectionDailyGoalUnit(matchedCollection)
            ),
            startDate: readPropertyString(fm, settings, 'startDate'),
            endDate: readPropertyString(fm, settings, 'endDate'),
            season: readPropertyNumber(fm, settings, 'season'),
            episode: readPropertyNumber(fm, settings, 'episode'),
            queueOrder: readPropertyNumber(fm, settings, 'queueOrder'),
            targetDate: readPropertyString(fm, settings, 'targetDate'),
            cache
        };
    }

    private resolveCover(coverVal: string, sourcePath: string): string {
        if (!coverVal) return '';
        if (coverVal.startsWith('http')) return coverVal;
        
        const match = coverVal.match(/\[\[(.*?)\]\]/);
        let linkpath = coverVal;
        if (match && match[1]) {
            linkpath = match[1];
        }
        
        const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
        if (file) {
            return this.app.vault.getResourcePath(file);
        }
        return coverVal;
    }
}
