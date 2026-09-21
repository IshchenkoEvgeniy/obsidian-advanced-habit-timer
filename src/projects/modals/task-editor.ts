import { App, Modal, Setting, Notice, SuggestModal, Platform, getAllTags, moment } from 'obsidian';
import HabitTimerPlugin from '../../main';
import { t } from '../../i18n';
import type { TaskData } from '../types';

export class HabitSuggestModal extends SuggestModal<string> {
    constructor(app: App, public plugin: HabitTimerPlugin, public onSelect: (habitName: string) => void) {
        super(app);
        this.setPlaceholder(t(this.plugin.settings.language, 'select_habit_link'));
    }

    getSuggestions(query: string): string[] {
        // Only allow linking to timer-based habits
        const habits = this.plugin.settings.properties
            .filter(p => p.type === 'timer' || !p.type)
            .map(p => p.name);
        return habits.filter(h => h.toLowerCase().includes(query.toLowerCase()));
    }

    renderSuggestion(habit: string, el: HTMLElement) {
        el.createEl("div", { text: habit });
    }

    onChooseSuggestion(habit: string, evt: MouseEvent | KeyboardEvent) {
        this.onSelect(habit);
    }
}

export class TaskEditorModal extends Modal {
    plugin: HabitTimerPlugin;
    data: TaskData;
    isEdit: boolean;
    columns: string[];
    onSubmit: (data: TaskData) => void | Promise<void>;

    constructor(app: App, plugin: HabitTimerPlugin, initialData: Partial<TaskData>, columns: string[], isEdit: boolean, onSubmit: (data: TaskData) => void | Promise<void>) {
        super(app);
        this.plugin = plugin;
        this.columns = columns;
        this.isEdit = isEdit;
        this.onSubmit = onSubmit;
        
        this.data = {
            name: initialData.name || "",
            status: initialData.status || columns[0] || "Backlog",
            habitName: initialData.habitName || "",
            timeEstimated: initialData.timeEstimated || "",
            startDate: initialData.startDate || "",
            endDate: initialData.endDate || "",
            cover: initialData.cover || "",
            color: initialData.color || "",
            tags: initialData.tags || "",
            priority: initialData.priority || "",
            order: initialData.order || 0
        };
    }

    parseDateShortcut(val: string): string {
        const clean = val.trim().toLowerCase();
        if (clean === 'today' || clean === 'сегодня') return moment().format('YYYY-MM-DD');
        if (clean === 'tomorrow' || clean === 'завтра') return moment().add(1, 'day').format('YYYY-MM-DD');
        if (clean === 'monday' || clean === 'понедельник') {
            const now = moment();
            const diff = (1 - now.isoWeekday() + 7) % 7;
            return now.add(diff === 0 ? 7 : diff, 'days').format('YYYY-MM-DD');
        }
        if (clean === 'friday' || clean === 'пятница') {
            const now = moment();
            const diff = (5 - now.isoWeekday() + 7) % 7;
            return now.add(diff === 0 ? 7 : diff, 'days').format('YYYY-MM-DD');
        }
        const m = clean.match(/^\+(\d+)$/);
        if (m && m[1]) {
            return moment().add(parseInt(m[1]), 'days').format('YYYY-MM-DD');
        }
        return val;
    }

    onOpen() {
        const { contentEl } = this;
        
        if (Platform.isMobile) {
            const modalEl = contentEl.parentElement;
            if (modalEl) {
                modalEl.setCssStyles({ position: "absolute", bottom: "0", width: "100%", borderRadius: "20px 20px 0 0", margin: "0", maxHeight: "85vh", animation: "slideUp 0.3s ease-out" });
            }
        }

        const lang = this.plugin.settings.language;
        contentEl.createEl("h2", { text: this.isEdit ? t(lang, 'edit_task') || "Edit Task" : (t(lang, 'add_new_task') || "Add New Task") });
        
        new Setting(contentEl).setName(t(lang, 'task_name_label') || "Task Name").addText(text => {
            text.setValue(this.data.name).onChange(v => this.data.name = v);
            if (!this.isEdit) {
                text.inputEl.focus();
            }
        });

        const habits = this.plugin.settings.properties.filter(p => p.type === 'timer' || !p.type).map(p => p.name);
        new Setting(contentEl).setName(t(lang, 'assoc_habit_label') || "Associated Habit").addDropdown(cb => {
            cb.addOption("", "None");
            habits.forEach(h => {
                cb.addOption(h, h);
            });
            cb.setValue(this.data.habitName).onChange(v => this.data.habitName = v);
        });

        new Setting(contentEl).setName(t(lang, 'status_label') || "Status").addDropdown(cb => {
            this.columns.forEach(c => {
                cb.addOption(c, c);
            });
            cb.setValue(this.data.status).onChange(v => this.data.status = v);
        });

        new Setting(contentEl).setName(lang === 'ru' ? 'Приоритет' : 'Priority').addDropdown(cb => {
            cb.addOption('', lang === 'ru' ? 'Без приоритета' : 'No priority');
            cb.addOption('low', lang === 'ru' ? 'Низкий' : 'Low');
            cb.addOption('medium', lang === 'ru' ? 'Средний' : 'Medium');
            cb.addOption('high', lang === 'ru' ? 'Высокий' : 'High');
            cb.setValue(this.data.priority || '').onChange(value => this.data.priority = value || undefined);
        });

        const tagsSetting = new Setting(contentEl).setName("Tags (comma separated)").addText(text => {
            text.setValue(this.data.tags || "").onChange(v => this.data.tags = v);
            text.inputEl.placeholder = 'Tag 1, tag 2';
        });
        
        const tagsHintsDiv = contentEl.createDiv({ attr: { style: 'display: flex; gap: 6px; margin-top: -10px; margin-bottom: 12px; justify-content: flex-end; flex-wrap: wrap; font-size: 0.8em; color: var(--text-muted);' } });
        const allGlobalTags = Array.from(new Set(
            this.app.vault.getMarkdownFiles().flatMap(file =>
                getAllTags(this.app.metadataCache.getFileCache(file) ?? {}) ?? []
            )
        )).map(tag => tag.replace(/^#/, '')).slice(0, 12);
        if (allGlobalTags.length > 0) {
            tagsHintsDiv.createSpan({ text: '💡 Подсказки:', attr: { style: 'margin-right: 4px; align-self: center;' } });
            allGlobalTags.forEach(tg => {
                const tBtn = tagsHintsDiv.createEl('button', { text: tg, attr: { style: 'padding: 1px 6px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 4px; cursor: pointer;' } });
                tBtn.onclick = () => {
                    const curr = this.data.tags ? this.data.tags.split(',').map(s => s.trim()).filter(Boolean) : [];
                    if (!curr.includes(tg)) {
                        curr.push(tg);
                        this.data.tags = curr.join(', ');
                        const inputEl = tagsSetting.controlEl.querySelector('input');
                        if (inputEl) inputEl.value = this.data.tags;
                    }
                };
            });
        }

        new Setting(contentEl).setName(t(lang, 'estimated_time_label') || "Estimated Time (hh:mm:ss)").addText(text => {
            text.setValue(this.data.timeEstimated).onChange(v => {
                this.data.timeEstimated = v;
                if (v && !/^\d{2,}:\d{2}:\d{2}$/.test(v)) {
                    text.inputEl.setCssStyles({ borderColor: 'var(--text-error)' });
                } else {
                    text.inputEl.setCssStyles({ borderColor: '' });
                }
            });
            text.inputEl.placeholder = "02:00:00";
        });

        const startSetting = new Setting(contentEl).setName(t(lang, 'start_date_label') || "Start Date (YYYY-MM-DD)").addText(text => {
            text.setValue(this.data.startDate).onChange(v => {
                const parsed = this.parseDateShortcut(v);
                this.data.startDate = parsed;
                if (parsed !== v) text.setValue(parsed);
            });
            text.inputEl.placeholder = 'Today, tomorrow, monday...';
        });
        const dateShortcuts1 = contentEl.createDiv({ attr: { style: 'display: flex; gap: 6px; margin-top: -10px; margin-bottom: 10px; justify-content: flex-end; font-size: 0.8em;' } });
        ['today', 'tomorrow', 'monday'].forEach(sc => {
            const btn = dateShortcuts1.createEl('button', { text: sc, attr: { style: 'padding: 1px 6px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 4px; cursor: pointer;' } });
            btn.onclick = () => {
                const res = this.parseDateShortcut(sc);
                this.data.startDate = res;
                const inputEl = startSetting.controlEl.querySelector('input');
                if (inputEl) inputEl.value = res;
            };
        });

        const endSetting = new Setting(contentEl).setName(t(lang, 'end_date_label') || "End Date (YYYY-MM-DD)").addText(text => {
            text.setValue(this.data.endDate).onChange(v => {
                const parsed = this.parseDateShortcut(v);
                this.data.endDate = parsed;
                if (parsed !== v) text.setValue(parsed);
            });
            text.inputEl.placeholder = 'Today, tomorrow, monday...';
        });
        const dateShortcuts2 = contentEl.createDiv({ attr: { style: 'display: flex; gap: 6px; margin-top: -10px; margin-bottom: 10px; justify-content: flex-end; font-size: 0.8em;' } });
        ['today', 'tomorrow', 'monday'].forEach(sc => {
            const btn = dateShortcuts2.createEl('button', { text: sc, attr: { style: 'padding: 1px 6px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 4px; cursor: pointer;' } });
            btn.onclick = () => {
                const res = this.parseDateShortcut(sc);
                this.data.endDate = res;
                const inputEl = endSetting.controlEl.querySelector('input');
                if (inputEl) inputEl.value = res;
            };
        });

        new Setting(contentEl).setName(t(lang, 'task_cover_label') || "Cover Image URL/Link").addText(text => {
            text.setValue(this.data.cover).onChange(v => this.data.cover = v);
        });

        const colorSetting = new Setting(contentEl).setName(t(lang, 'task_color_label') || "Color (CSS color)").addText(text => {
            text.setValue(this.data.color).onChange(v => {
                this.data.color = v;
                text.inputEl.setCssStyles({ borderColor: v ? v : '' });
            });
            if (this.data.color) text.inputEl.setCssStyles({ borderColor: this.data.color });
        });
        const paletteDiv = contentEl.createDiv({ attr: { style: 'display: flex; gap: 8px; margin-top: -10px; margin-bottom: 12px; justify-content: flex-end; flex-wrap: wrap;' } });
        const premiumColors = [
            '#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#264653', 
            '#8338ec', '#ff006e', '#3a86c8', '#4cc9f0', '#b5179e',
            '#7209b7', '#4895ef'
        ];
        premiumColors.forEach(c => {
            const cDot = paletteDiv.createDiv({ attr: { style: `width: 18px; height: 18px; border-radius: 50%; background: ${c}; cursor: pointer; border: 1px solid var(--background-modifier-border); transition: transform 0.1s;` } });
            cDot.onmouseenter = () => cDot.setCssStyles({ transform: 'scale(1.2)' });
            cDot.onmouseleave = () => cDot.setCssStyles({ transform: '' });
            cDot.onclick = () => {
                this.data.color = c;
                const inputEl = colorSetting.controlEl.querySelector('input');
                if (inputEl) {
                    inputEl.value = c;
                    inputEl.setCssStyles({ borderColor: c });
                }
            };
        });
        
        new Setting(contentEl).addButton(btn => btn.setButtonText(this.isEdit ? t(lang, 'save') || "Save" : (t(lang, 'create_btn') || "Create")).setCta().onClick(() => {
            if (!this.data.name.trim()) {
                new Notice((t(lang, 'task_name_label') || "Task Name") + " is required!");
                return;
            }
            void this.onSubmit(this.data);
            this.close();
        }));
    }

    onClose() {
        this.contentEl.empty();
    }
}
