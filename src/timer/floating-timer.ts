import { setIcon } from 'obsidian';
import { get } from 'svelte/store';
import type HabitTimerPlugin from '../main';
import { activeTab } from '../store/TimerStore';
import { VIEW_TYPE_TIMER } from './timer-view';

const POSITION_KEY = 'habit-timer:floating-timer-position';

/** A small, movable indicator that stays visible while the timer screen is elsewhere. */
export class FloatingTimer {
    private root: HTMLElement | null = null;
    private timeEl: HTMLElement | null = null;
    private labelEl: HTMLElement | null = null;
    private interval: number | null = null;
    private intervalWindow: Window | null = null;
    private unsubscribeTab: (() => void) | null = null;
    private drag: { pointerId: number; offsetX: number; offsetY: number } | null = null;

    constructor(private plugin: HabitTimerPlugin) {}

    mount(): void {
        if (this.root) return;
        const ru = this.plugin.settings.language === 'ru';
        const doc = this.plugin.app.workspace.activeLeaf?.view.containerEl.ownerDocument || document;
        const root = doc.body.createDiv({ cls: 'fl-floating-timer' });
        root.setAttribute('role', 'status');
        root.setAttribute('aria-label', ru ? 'Работающий таймер' : 'Running timer');
        const header = root.createDiv({ cls: 'fl-floating-timer-header' });
        setIcon(header.createSpan({ cls: 'fl-floating-timer-icon' }), 'timer');
        header.createSpan({ text: ru ? 'Таймер работает' : 'Timer running' });
        header.setAttribute('title', ru ? 'Перетащить таймер' : 'Drag timer');
        const open = root.createEl('button', {
            cls: 'fl-floating-timer-open',
            attr: { title: ru ? 'Открыть таймер' : 'Open timer', 'aria-label': ru ? 'Открыть таймер' : 'Open timer' }
        });
        setIcon(open, 'arrow-up-right');
        open.onclick = () => { void this.plugin.activateView(VIEW_TYPE_TIMER); };
        this.timeEl = root.createDiv({ cls: 'fl-floating-timer-time' });
        this.labelEl = root.createDiv({ cls: 'fl-floating-timer-label' });
        this.root = root;
        this.restorePosition();
        header.addEventListener('pointerdown', this.onPointerDown);
        header.addEventListener('pointermove', this.onPointerMove);
        header.addEventListener('pointerup', this.onPointerUp);
        header.addEventListener('pointercancel', this.onPointerUp);
        this.bindWindow(doc.defaultView);
        this.plugin.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => this.syncDocument()));
        this.unsubscribeTab = activeTab.subscribe(() => this.refresh());
        this.refresh();
    }

    destroy(): void {
        if (this.interval !== null) this.intervalWindow?.clearInterval(this.interval);
        this.interval = null;
        this.unsubscribeTab?.();
        this.unsubscribeTab = null;
        this.intervalWindow?.removeEventListener('resize', this.clampPosition);
        this.intervalWindow = null;
        this.root?.remove();
        this.root = null;
    }

    private syncDocument(): void {
        if (!this.root) return;
        const doc = this.plugin.app.workspace.activeLeaf?.view.containerEl.ownerDocument || document;
        if (this.root.ownerDocument !== doc) doc.body.appendChild(this.root);
        this.bindWindow(doc.defaultView);
        this.clampPosition();
        this.refresh();
    }

    private bindWindow(next: Window | null): void {
        if (this.intervalWindow === next) return;
        if (this.interval !== null) this.intervalWindow?.clearInterval(this.interval);
        this.intervalWindow?.removeEventListener('resize', this.clampPosition);
        this.intervalWindow = next;
        next?.addEventListener('resize', this.clampPosition);
        this.interval = next?.setInterval(() => this.refresh(), 1000) ?? null;
    }

    private refresh(): void {
        if (!this.root || !this.timeEl || !this.labelEl) return;
        const active = this.plugin.settings.activeTimer;
        const running = Boolean(active && active.timerState !== 'paused');
        const timerScreenVisible = this.plugin.app.workspace.activeLeaf?.view.getViewType() === VIEW_TYPE_TIMER
            && get(activeTab) === 'timer';
        this.root.classList.toggle('is-visible', running && !timerScreenVisible);
        if (!active || !running) return;
        const delta = active.lastStartedAt ? Math.max(0, Math.floor((Date.now() - active.lastStartedAt) / 1000)) : 0;
        const elapsed = Math.max(0, active.elapsedSeconds || 0) + delta;
        this.timeEl.setText(this.plugin.formatTime(elapsed));
        this.labelEl.setText(active.taskName || active.habitName);
    }

    private restorePosition(): void {
        if (!this.root) return;
        try {
            const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
            if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
                this.setPosition(saved.x, saved.y);
                return;
            }
        } catch { /* Ignore invalid local UI preference. */ }
        const win = this.root.ownerDocument.defaultView || window;
        this.setPosition(win.innerWidth - 224, win.innerHeight - 120);
    }

    private setPosition(x: number, y: number): void {
        if (!this.root) return;
        const win = this.root.ownerDocument.defaultView || window;
        const width = this.root.offsetWidth || 200;
        const height = this.root.offsetHeight || 96;
        this.root.style.left = `${Math.max(8, Math.min(x, win.innerWidth - width - 8))}px`;
        this.root.style.top = `${Math.max(8, Math.min(y, win.innerHeight - height - 8))}px`;
    }

    private readonly clampPosition = (): void => {
        if (!this.root) return;
        this.setPosition(parseFloat(this.root.style.left) || 8, parseFloat(this.root.style.top) || 8);
    };

    private readonly onPointerDown = (event: PointerEvent): void => {
        if (!this.root || event.button !== 0) return;
        const rect = this.root.getBoundingClientRect();
        this.drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        this.setPosition(event.clientX - this.drag.offsetX, event.clientY - this.drag.offsetY);
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        if (!this.drag || this.drag.pointerId !== event.pointerId || !this.root) return;
        this.drag = null;
        try {
            localStorage.setItem(POSITION_KEY, JSON.stringify({
                x: parseFloat(this.root.style.left), y: parseFloat(this.root.style.top)
            }));
        } catch { /* Position persistence is optional. */ }
    };
}
