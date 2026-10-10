import { describe, expect, it, vi } from 'vitest';
import { observeBoardScroll } from '../src/projects/board-scroll';

function fixture(width = 700, content = 1700, resizeObserver = true) {
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    let resized: (() => void) | undefined;
    const disconnect = vi.fn();
    class PaneResizeObserver {
        constructor(callback: () => void) { resized = callback; }
        observe = vi.fn();
        disconnect = disconnect;
    }
    const pane = Object.assign(new EventTarget(), {
        requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }),
        cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
        ResizeObserver: resizeObserver ? PaneResizeObserver : undefined,
    });
    const ownerDocument = Object.assign(new EventTarget(), { defaultView: pane });
    const viewport = Object.assign(new EventTarget(), { ownerDocument, clientWidth: width, scrollWidth: content, scrollLeft: 0 });
    const canvas = Object.assign(new EventTarget(), { scrollWidth: content });
    const onMeasure = vi.fn();
    const controller = observeBoardScroll(viewport as unknown as HTMLElement, canvas as unknown as HTMLElement, onMeasure);
    const flush = (): void => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(0);
    };
    return { pane, ownerDocument, viewport, canvas, frames, flush, onMeasure, controller, disconnect,
        resize: () => resized?.() };
}

describe('board scrollbar lifecycle', () => {
    it('measures immediately in the pane window', () => {
        const state = fixture();
        expect(state.onMeasure).toHaveBeenCalledWith({ limit: 1000, position: 0, thumbSize: 700 / 1700 * 100 });
        expect(state.pane.requestAnimationFrame).toHaveBeenCalledOnce();
        state.controller.destroy();
    });
    it('recovers after mounting in a hidden pane and receiving focus', () => {
        const state = fixture(0);
        state.flush();
        expect(state.onMeasure).not.toHaveBeenCalled();
        state.viewport.clientWidth = 700;
        state.pane.dispatchEvent(new Event('focus'));
        state.flush();
        expect(state.onMeasure).toHaveBeenLastCalledWith({ limit: 1000, position: 0, thumbSize: 700 / 1700 * 100 });
        state.controller.destroy();
    });
    it('recovers on document visibility and pop-out window pageshow', () => {
        const state = fixture(0);
        state.flush();
        state.viewport.clientWidth = 600;
        state.ownerDocument.dispatchEvent(new Event('visibilitychange'));
        state.flush();
        expect(state.onMeasure).toHaveBeenLastCalledWith({ limit: 1100, position: 0, thumbSize: 600 / 1700 * 100 });
        state.viewport.clientWidth = 900;
        state.pane.dispatchEvent(new Event('pageshow'));
        state.flush();
        expect(state.onMeasure).toHaveBeenLastCalledWith({ limit: 800, position: 0, thumbSize: 900 / 1700 * 100 });
        state.controller.destroy();
    });
    it('coalesces dimension and content updates into one frame', () => {
        const state = fixture();
        state.flush();
        state.onMeasure.mockClear();
        state.viewport.clientWidth = 900;
        state.canvas.scrollWidth = 2100;
        state.resize();
        state.controller.schedule();
        state.pane.dispatchEvent(new Event('resize'));
        expect(state.frames.size).toBe(1);
        state.flush();
        expect(state.onMeasure).toHaveBeenCalledOnce();
        expect(state.onMeasure).toHaveBeenLastCalledWith({ limit: 1200, position: 0, thumbSize: 900 / 2100 * 100 });
        state.controller.destroy();
    });
    it('updates thumb position and clamps it when columns fit', () => {
        const state = fixture();
        state.flush();
        state.viewport.scrollLeft = 1000;
        state.viewport.dispatchEvent(new Event('scroll'));
        state.flush();
        expect(state.onMeasure).toHaveBeenLastCalledWith({ limit: 1000, position: 1000, thumbSize: 700 / 1700 * 100 });
        state.viewport.scrollWidth = 700;
        state.canvas.scrollWidth = 700;
        state.controller.measure();
        expect(state.onMeasure).toHaveBeenLastCalledWith({ limit: 0, position: 0, thumbSize: 100 });
        state.controller.destroy();
    });
    it('can update without a ResizeObserver', () => {
        const state = fixture(0, 1700, false);
        state.flush();
        state.viewport.clientWidth = 700;
        state.pane.dispatchEvent(new Event('resize'));
        state.flush();
        expect(state.onMeasure).toHaveBeenCalledOnce();
        state.controller.destroy();
    });
    it('cleans up pending frames and listeners before the next mount', () => {
        const state = fixture();
        state.controller.destroy();
        state.controller.destroy();
        expect(state.frames.size).toBe(0);
        expect(state.disconnect).toHaveBeenCalledOnce();
        state.onMeasure.mockClear();
        state.pane.dispatchEvent(new Event('resize'));
        state.pane.dispatchEvent(new Event('focus'));
        state.ownerDocument.dispatchEvent(new Event('visibilitychange'));
        state.viewport.dispatchEvent(new Event('scroll'));
        state.controller.schedule();
        state.controller.measure();
        state.flush();
        expect(state.onMeasure).not.toHaveBeenCalled();
        expect(state.frames.size).toBe(0);
    });
});
