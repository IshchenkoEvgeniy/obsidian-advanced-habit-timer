export interface BoardScrollMetrics {
    limit: number;
    position: number;
    thumbSize: number;
}

export interface BoardScrollController {
    measure(): void;
    schedule(): void;
    destroy(): void;
}

/** Measure in the pane's own window, including Obsidian pop-out windows. */
export function observeBoardScroll(viewport: HTMLElement, canvas: HTMLElement,
    onMeasure: (metrics: BoardScrollMetrics) => void): BoardScrollController {
    const ownerDocument = viewport.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) throw new Error('Board window is unavailable.');
    let frame = 0;
    let active = true;
    const measure = (): void => {
        if (!active || !viewport.clientWidth) return;
        const visible = viewport.clientWidth;
        const content = Math.max(viewport.scrollWidth, canvas.scrollWidth, visible);
        const limit = Math.max(0, content - visible);
        onMeasure({ limit, position: Math.max(0, Math.min(limit, viewport.scrollLeft)),
            thumbSize: Math.min(100, Math.max(8, visible / content * 100)) });
    };
    const schedule = (): void => {
        if (!active || frame) return;
        frame = ownerWindow.requestAnimationFrame(() => { frame = 0; measure(); });
    };
    const observer = typeof ownerWindow.ResizeObserver === 'function' ? new ownerWindow.ResizeObserver(schedule) : undefined;
    observer?.observe(viewport);
    observer?.observe(canvas);
    viewport.addEventListener('scroll', schedule, { passive: true });
    ownerWindow.addEventListener('resize', schedule);
    ownerWindow.addEventListener('focus', schedule);
    ownerWindow.addEventListener('pageshow', schedule);
    ownerDocument.addEventListener('visibilitychange', schedule);
    // The initial layout can already be visible; a second read follows style/layout work.
    measure();
    schedule();
    return { measure, schedule, destroy(): void {
        if (!active) return;
        active = false;
        observer?.disconnect();
        if (frame) ownerWindow.cancelAnimationFrame(frame);
        viewport.removeEventListener('scroll', schedule);
        ownerWindow.removeEventListener('resize', schedule);
        ownerWindow.removeEventListener('focus', schedule);
        ownerWindow.removeEventListener('pageshow', schedule);
        ownerDocument.removeEventListener('visibilitychange', schedule);
    } };
}
