import type { ProjectTask } from '../types';

export class ProjectCache {
    /** Per-instance cache: path → { mtime, tasks }. */
    private fileCache = new Map<string, { mtime: number, tasks: ProjectTask[] }>();

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

    set(path: string, data: { mtime: number, tasks: ProjectTask[] }) {
        this.fileCache.set(path, data);
    }
}
