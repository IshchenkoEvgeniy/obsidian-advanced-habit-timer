import type { ProjectScopeDefinition, ProjectTask } from '../types';

/** Settings that affect parsed tasks, independent of the Markdown file's mtime. */
export function projectScopeCacheSignature(scope: ProjectScopeDefinition): string {
    return JSON.stringify([scope.sourceType, scope.sourceValue, scope.statuses, scope.color || '', scope.excludePatterns || '']);
}

type CacheEntry = { mtime: number; tasks: ProjectTask[]; signature?: string };

export class ProjectCache {
    /** Per-instance cache: path → { mtime, tasks }. */
    private fileCache = new Map<string, CacheEntry>();

    /** Remove one entry (call on file rename/delete). */
    invalidateCacheEntry(path: string) {
        for (const key of this.fileCache.keys()) {
            if (key === path || key.endsWith(`\u0000${path}`)) this.fileCache.delete(key);
        }
    }

    /** Remove all entries whose paths start with a prefix (call on folder delete). */
    invalidateCachePrefix(prefix: string) {
        for (const key of this.fileCache.keys()) {
            const path = key.includes('\u0000') ? key.slice(key.indexOf('\u0000') + 1) : key;
            if (path.startsWith(prefix)) this.fileCache.delete(key);
        }
    }

    get(path: string) {
        return this.fileCache.get(path);
    }

    set(path: string, data: CacheEntry) {
        this.fileCache.set(path, data);
    }
}
