/**
 * The floating board menu (Milanote-style): where it may sit, how it snaps to the edges and how its position is stored.
 * Pure functions, so the rules are testable without a DOM.
 */
export interface Point { x: number; y: number }
export interface Size { w: number; h: number }

/** One entry of the menu. Buttons run `run`; colour and number fields report through `change`. */
export interface PaletteItem {
    id: string;
    glyph: string;
    label: string;
    title: string;
    active?: boolean;
    disabled?: boolean;
    divider?: boolean;
    kind?: 'button' | 'color' | 'number';
    value?: string | number;
    run?: () => void;
    /** Dragged from the menu and released over the board: creates the object at that screen point. */
    drop?: (clientX: number, clientY: number) => void;
    change?: (value: string) => void;
    focus?: () => void;
}

export const DOCK_MARGIN = 8;
export const DOCK_SNAP = 24;

/** Keeps the menu inside the board area with a margin. A menu taller than the area stays at the top margin. */
export function clampDock(point: Point, area: Size, panel: Size): Point {
    const maxX = Math.max(DOCK_MARGIN, area.w - panel.w - DOCK_MARGIN), maxY = Math.max(DOCK_MARGIN, area.h - panel.h - DOCK_MARGIN);
    return { x: Math.min(maxX, Math.max(DOCK_MARGIN, point.x)), y: Math.min(maxY, Math.max(DOCK_MARGIN, point.y)) };
}

/** Snaps to the left or right margin, and to the top margin, when the menu is released close to it. Left wins on a narrow area. */
export function snapDock(point: Point, area: Size, panel: Size, distance = DOCK_SNAP): Point {
    const clamped = clampDock(point, area, panel);
    const maxX = Math.max(DOCK_MARGIN, area.w - panel.w - DOCK_MARGIN);
    return {
        x: clamped.x - DOCK_MARGIN <= distance ? DOCK_MARGIN : maxX - clamped.x <= distance ? maxX : clamped.x,
        y: clamped.y - DOCK_MARGIN <= distance ? DOCK_MARGIN : clamped.y,
    };
}

export function serializeDock(point: Point): string {
    return JSON.stringify({ x: Math.round(point.x), y: Math.round(point.y) });
}

/** Reads a stored position. Anything that is not two finite numbers is ignored, so a damaged value falls back to the default. */
export function parseDock(raw: string | null | undefined): Point | undefined {
    if (!raw) return undefined;
    try {
        const value = JSON.parse(raw) as Partial<Point> | null;
        return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x as number, y: value.y as number } : undefined;
    } catch {
        return undefined;
    }
}
