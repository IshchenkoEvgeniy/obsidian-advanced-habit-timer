export interface CanvasScrollOptions { enabled: boolean; zoom: number }

/** A nested viewport inside the board's touch-action:none canvas. Taps keep their native focus/click behavior. */
export function canvasScroll(node: HTMLElement, options: CanvasScrollOptions) {
    let active: { id: number; x: number; y: number; moved: boolean; win: Window; target: HTMLElement } | undefined;
    let suppressUntil = 0;
    function end() {
        const previous = active; active = undefined;
        if (!previous) return;
        previous.win.removeEventListener('pointermove', move, true);
        previous.win.removeEventListener('pointerup', finish, true);
        previous.win.removeEventListener('pointercancel', cancel, true);
        previous.win.removeEventListener('blur', end);
        if (node.hasPointerCapture(previous.id)) node.releasePointerCapture(previous.id);
    }
    function start(event: PointerEvent) {
        if (!options.enabled) return;
        const target = event.target as HTMLElement;
        if (target.closest('.design-widget-heading') && !target.closest('input,textarea,select,button')) return;
        // Android/Chromium may reuse a touch pointer ID; a new press must never inherit the prior swipe's click suppression.
        suppressUntil = 0;
        event.stopPropagation();
        if (event.pointerType !== 'touch' || event.button !== 0 || active) return;
        const win = node.ownerDocument.defaultView; if (!win) return;
        active = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, win, target };
        win.addEventListener('pointermove', move, { capture: true, passive: false });
        win.addEventListener('pointerup', finish, true); win.addEventListener('pointercancel', cancel, true);
        win.addEventListener('blur', end);
    }
    function scrollable(target: HTMLElement, horizontal: boolean): HTMLElement | undefined {
        let current: HTMLElement | null = target;
        while (current && node.contains(current)) {
            if (horizontal ? current.scrollWidth > current.clientWidth + 1 : current.scrollHeight > current.clientHeight + 1) {
                const overflow = current.ownerDocument.defaultView?.getComputedStyle(current)[horizontal ? 'overflowX' : 'overflowY'];
                if (current === node || overflow === 'auto' || overflow === 'scroll') return current;
            }
            if (current === node) break; current = current.parentElement;
        }
        return undefined;
    }
    function move(event: PointerEvent) {
        if (!active || active.id !== event.pointerId) return;
        const dx = event.clientX - active.x, dy = event.clientY - active.y;
        if (!active.moved && Math.hypot(dx, dy) < 7) return;
        const horizontal = Math.abs(dx) > Math.abs(dy), target = scrollable(active.target, horizontal);
        if (!target) return;
        if (!active.moved) { active.moved = true; node.setPointerCapture(active.id); }
        event.preventDefault();
        const scale = Math.max(.05, options.zoom);
        if (horizontal) target.scrollLeft -= dx / scale; else target.scrollTop -= dy / scale;
        active.x = event.clientX; active.y = event.clientY;
    }
    function finish(event: PointerEvent) {
        if (event.pointerId !== active?.id) return;
        const released = active;
        end();
        if (released.moved) { suppressUntil = Date.now() + 500; return; }
        const button = released.target.closest<HTMLButtonElement | HTMLInputElement>('button,input[type="checkbox"]');
        if (button && !button.disabled) {
            const rect = button.getBoundingClientRect();
            if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
                // WebViews can omit the compatibility click after a canvas swipe. Run a tap once, and suppress its native duplicate.
                button.click(); suppressUntil = Date.now() + 500;
            }
        } else released.target.closest<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')?.focus();
    }
    function cancel(event: PointerEvent) { if (event.pointerId === active?.id) end(); }
    function click(event: MouseEvent) { if (event.detail && Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); suppressUntil = 0; } }
    function wheel(event: WheelEvent) { if (options.enabled && !event.ctrlKey && !event.metaKey && !(event.target as HTMLElement).closest('.design-widget-heading')) event.stopPropagation(); }
    node.addEventListener('pointerdown', start); node.addEventListener('click', click, true); node.addEventListener('wheel', wheel);
    return { update(next: CanvasScrollOptions) { options = next; if (!next.enabled) end(); }, destroy() { end(); node.removeEventListener('pointerdown', start); node.removeEventListener('click', click, true); node.removeEventListener('wheel', wheel); } };
}
