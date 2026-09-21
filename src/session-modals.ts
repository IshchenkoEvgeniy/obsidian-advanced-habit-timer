import { App, Modal, moment } from 'obsidian';
import { formatDurationShort } from './utils';
import { t } from './i18n';
import type { Language } from './i18n';

export class DaySummaryModal extends Modal {
    date: string;
    sessions: { habit: string, subTask?: string, durationSec: number, task?: string, startHour: number }[];
    lang: Language;

    constructor(app: App, date: string, sessions: { habit: string, subTask?: string, durationSec: number, task?: string, startHour: number }[], lang: Language) {
        super(app);
        this.date = date;
        this.sessions = sessions;
        this.lang = lang;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("day-summary-modal");

        contentEl.createEl("h2", { text: t(this.lang, 'day_summary_title', moment(this.date).format('DD MMMM YYYY')) });

        if (this.sessions.length === 0) {
            contentEl.createEl("p", { text: t(this.lang, 'no_sessions_day') });
            return;
        }

        const list = contentEl.createDiv({ cls: "day-session-list" });

        // Sort by start hour
        const sorted = [...this.sessions].sort((a, b) => a.startHour - b.startHour);

        sorted.forEach(s => {
            const item = list.createDiv({ cls: "day-session-item" });
            const top = item.createDiv({ cls: "day-session-top" });
            
            const habitCont = top.createDiv({ cls: "day-session-habit-cont" });
            habitCont.createSpan({ text: s.habit, cls: "day-session-habit" });
            if (s.subTask) {
                habitCont.createSpan({ text: `: ${s.subTask}`, cls: "day-session-subtask" });
            }

            top.createSpan({ text: formatDurationShort(s.durationSec), cls: "day-session-duration" });

            if (s.task) {
                item.createDiv({ text: s.task, cls: "day-session-task" });
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
