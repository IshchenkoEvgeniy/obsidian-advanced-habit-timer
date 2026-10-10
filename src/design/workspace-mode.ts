import { Platform } from 'obsidian';

/** Move the same editor outside Obsidian's clipped leaf; return it without remounting or losing its draft. */
export function boardWorkspace(node: HTMLElement, enabled: boolean) {
    const doc = node.ownerDocument, win = doc.defaultView;
    let marker: Comment | undefined, previousFocus: Element | null = null;
    const viewport = win?.visualViewport;
    let insetProbe: HTMLDivElement | undefined;
    function resize() {
        node.style.setProperty('--design-screen-x', `${viewport?.offsetLeft || 0}px`);
        node.style.setProperty('--design-screen-y', `${viewport?.offsetTop || 0}px`);
        node.style.setProperty('--design-screen-width', `${viewport?.width || win?.innerWidth || 0}px`);
        node.style.setProperty('--design-screen-height', `${viewport?.height || win?.innerHeight || 0}px`);
        if (insetProbe && win) {
            const style = win.getComputedStyle(insetProbe);
            const keyboard = (viewport?.height || win.innerHeight) < win.innerHeight * .75;
            const landscape = win.innerWidth > win.innerHeight;
            const horizontal = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
            for (const side of ['top', 'right', 'bottom', 'left'] as const) {
                const native = parseFloat(style.getPropertyValue(`padding-${side}`)) || 0;
                // Android WebViews can report zero env() insets even while system bars overlay the page.
                const fallback = !Platform.isAndroidApp || keyboard && side === 'bottom' ? 0 : side === 'top' ? 48 : side === 'bottom' || (side === 'right' || side === 'left') && landscape && !horizontal ? 48 : 0;
                node.style.setProperty(`--design-safe-${side}`, `${native || fallback}px`);
            }
        }
    }
    function leave() {
        win?.removeEventListener('resize', resize);
        viewport?.removeEventListener('resize', resize);
        viewport?.removeEventListener('scroll', resize);
        if (marker?.parentNode) marker.parentNode.replaceChild(node, marker);
        marker = undefined;
        insetProbe?.remove(); insetProbe = undefined;
        for (const name of ['x', 'y', 'width', 'height']) node.style.removeProperty(`--design-screen-${name}`);
        for (const side of ['top', 'right', 'bottom', 'left']) node.style.removeProperty(`--design-safe-${side}`);
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        previousFocus = null;
    }
    function update(value: boolean) {
        if (value && !marker && node.parentNode) {
            previousFocus = doc.activeElement;
            marker = doc.createComment('Board workspace');
            node.parentNode.insertBefore(marker, node);
            doc.body.appendChild(node);
            insetProbe = doc.createElement('div'); insetProbe.setAttribute('aria-hidden', 'true');
            insetProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;';
            for (const side of ['top', 'right', 'bottom', 'left']) insetProbe.style.setProperty(`padding-${side}`, `max(env(safe-area-inset-${side}, 0px), var(--safe-area-inset-${side}, 0px))`);
            doc.body.appendChild(insetProbe);
            resize();
            win?.addEventListener('resize', resize);
            viewport?.addEventListener('resize', resize);
            viewport?.addEventListener('scroll', resize);
        } else if (!value && marker) leave();
    }
    update(enabled);
    return { update, destroy: leave };
}
