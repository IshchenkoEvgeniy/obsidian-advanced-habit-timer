import type { DesignEntity } from './types';

/** Duplicate IDs are ambiguous: never silently attach a board to the wrong note. */
export class DesignIndex {
    private paths = new Map<string, DesignEntity>(); private ids = new Map<string, Set<string>>();
    upsert(entity: DesignEntity): void { this.remove(entity.path); this.paths.set(entity.path, entity); const paths = this.ids.get(entity.id) || new Set<string>(); paths.add(entity.path); this.ids.set(entity.id, paths); }
    remove(path: string): void { const entity = this.paths.get(path); if (!entity) return; this.paths.delete(path); const paths = this.ids.get(entity.id)!; paths.delete(path); if (!paths.size) this.ids.delete(entity.id); }
    resolve(id: string): DesignEntity | undefined { const paths = this.ids.get(id); return paths?.size === 1 ? this.paths.get([...paths][0]!) : undefined; }
    all(): DesignEntity[] { return [...this.paths.values()]; }
    duplicates(): string[] { return [...this.ids].filter(([, paths]) => paths.size > 1).map(([id]) => id); }
}
