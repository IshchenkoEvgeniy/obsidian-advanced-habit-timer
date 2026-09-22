import { App, PluginSettingTab, Setting, Notice, moment, requestUrl } from 'obsidian';
import { t } from '../i18n';
import type HabitTimerPlugin from '../main';
import SettingsSvelte from '../components/Settings.svelte';
import { mount } from 'svelte';
import { DEFAULT_LIBRARY_PROPERTY_ALIASES } from '../types';
import type { HabitProperty, LibraryPropertyField, WeekdayKey } from '../types';
import type { Language } from '../i18n';

interface TelegramChatInfo { id?: string | number; }
interface TelegramMessageInfo { chat?: TelegramChatInfo; }
interface TelegramUpdateInfo { message?: TelegramMessageInfo; }
interface TelegramGetUpdatesResponse { ok?: boolean; result: TelegramUpdateInfo[]; }
interface TelegramSendResponse { ok?: boolean; description?: string; }

export class HabitTimerSettingTab extends PluginSettingTab {
    plugin: HabitTimerPlugin;
    svelteComponent: unknown;

    constructor(app: App, plugin: HabitTimerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl: c } = this;
        c.empty();
        const lang = this.plugin.settings.language;
        new Setting(c).setName("").setHeading();

        new Setting(c)
            .setName(t(lang, 'language_label'))
            .setDesc(t(lang, 'language_desc'))
            .addDropdown(d => d
                .addOption('en', 'English')
                .addOption('ru', 'Русский')
                .setValue(lang)
                .onChange(async (val) => {
                    this.plugin.settings.language = val as Language;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(c).setName(t(lang, 'theme_label')).setDesc(t(lang, 'theme_desc'))
            .addDropdown(d => {
                const themes = ['modern-dark', 'light', 'dracula', 'nord', 'gruvbox', 'monokai', 'solarized-light', 'solarized-dark', 'synthwave', 'oled'];
                themes.forEach(th => {
                    d.addOption(`habit-theme-${th}`, th.charAt(0).toUpperCase() + th.slice(1).replace('-', ' '));
                });
                d.setValue(this.plugin.settings.theme);
                d.onChange(v => {
                    this.plugin.settings.theme = v;
                    this.plugin.applyTheme(v);
                    void this.plugin.saveSettings();
                });
            });

        new Setting(c).setName(t(lang, 'pomodoro_duration_label'))
            .addText(text => text.setValue(String(this.plugin.settings.pomodoroDuration)).onChange(async v => { this.plugin.settings.pomodoroDuration = Number(v) || 25; await this.plugin.saveSettings(); }));

        new Setting(c).setName(t(lang, 'daily_notes_label'))
            .addText(text => text.setValue(this.plugin.settings.dailyNotesFolder).onChange(async v => { this.plugin.settings.dailyNotesFolder = v; await this.plugin.saveSettings(); }));

        new Setting(c).setName(t(lang, 'global_music_folder_label')).setDesc(t(lang, 'global_music_folder_desc'))
            .addText(text => text.setValue(this.plugin.settings.globalMusicFolder).onChange(async v => { this.plugin.settings.globalMusicFolder = v; await this.plugin.saveSettings(); }));

        // --- Project Scopes ---
        new Setting(c).setName("").setHeading();

        const addScopeBtn = c.createEl('button', { text: t(lang, 'scope_add_btn'), cls: 'btn-small' });
        addScopeBtn.setCssStyles({ marginBottom: "15px" });
        addScopeBtn.onclick = async () => {
            this.plugin.settings.projectScopes.push({
                id: String(Date.now()),
                name: 'New Project',
                sourceType: 'folder',
                sourceValue: 'Projects/New',
                statuses: 'Backlog, To Do, In Progress, Done',
                color: '#3b82f6'
            });
            await this.plugin.saveSettings();
            this.display();
        };

        const scopesContainer = c.createDiv({ cls: 'project-scopes-list', attr: { style: 'display: flex; flex-direction: column; gap: 15px; margin-bottom: 20px;' } });

        this.plugin.settings.projectScopes.forEach((scope, index) => {
            const scopeCard = scopesContainer.createDiv({ attr: { style: 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-left: 4px solid ' + (scope.color || '#3b82f6') + '; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 10px;' } });

            const headerRow = scopeCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center;' } });
            const titleInput = headerRow.createEl('input', { type: 'text', value: scope.name, attr: { style: 'font-weight: bold; font-size: 1.1em; background: transparent; border: none; border-bottom: 1px solid var(--background-modifier-border);' } });
            titleInput.onchange = async (e) => {
                scope.name = (e.target as HTMLInputElement).value;
                await this.plugin.saveSettings();
            };

            const delBtn = headerRow.createEl('button', { text: '🗑️', attr: { style: 'background: transparent; box-shadow: none; color: var(--text-error);' } });
            delBtn.onclick = async () => {
                this.plugin.settings.projectScopes.splice(index, 1);
                await this.plugin.saveSettings();
                this.display();
            };

            // Source Type Row
            const srcRow = scopeCard.createDiv({ attr: { style: 'display: flex; gap: 10px; align-items: center;' } });
            srcRow.createSpan({ text: t(lang, 'scope_source_label'), attr: { style: 'font-size: 0.9em; color: var(--text-muted); min-width: 80px;' } });
            const typeSel = srcRow.createEl('select', { cls: 'dropdown' });
            typeSel.createEl('option', { text: t(lang, 'scope_source_folder'), value: 'folder' });
            typeSel.createEl('option', { text: t(lang, 'scope_source_tag'), value: 'tag' });
            typeSel.createEl('option', { text: t(lang, 'scope_source_dataview'), value: 'dataview' });
            typeSel.createEl('option', { text: t(lang, 'scope_source_file'), value: 'file' });
            typeSel.value = scope.sourceType;

            let placeholderText = t(lang, 'scope_source_placeholder_folder');
            if (scope.sourceType === 'tag') placeholderText = t(lang, 'scope_source_placeholder_tag');
            else if (scope.sourceType === 'dataview') placeholderText = t(lang, 'scope_source_placeholder_dataview');
            else if (scope.sourceType === 'file') placeholderText = t(lang, 'scope_source_placeholder_file');

            const valInput = srcRow.createEl('input', { type: 'text', value: scope.sourceValue, placeholder: placeholderText, attr: { style: 'flex-grow: 1;' } });

            typeSel.onchange = async () => {
                scope.sourceType = typeSel.value as 'folder' | 'tag' | 'dataview' | 'file';
                valInput.placeholder = scope.sourceType === 'folder'
                    ? t(lang, 'scope_source_placeholder_folder')
                    : scope.sourceType === 'tag'
                        ? t(lang, 'scope_source_placeholder_tag')
                        : scope.sourceType === 'dataview'
                            ? t(lang, 'scope_source_placeholder_dataview')
                            : t(lang, 'scope_source_placeholder_file');
                await this.plugin.saveSettings();
                this.display();
            };
            valInput.onchange = async (e) => {
                scope.sourceValue = (e.target as HTMLInputElement).value;
                await this.plugin.saveSettings();
            };

            // Target Folder Row (if tag)
            if (scope.sourceType === 'tag') {
                const tgtRow = scopeCard.createDiv({ attr: { style: 'display: flex; gap: 10px; align-items: center;' } });
                tgtRow.createSpan({ text: t(lang, 'scope_save_tasks_to'), attr: { style: 'font-size: 0.9em; color: var(--text-muted); min-width: 80px;' } });
                const tgtInput = tgtRow.createEl('input', { type: 'text', value: scope.targetFolder || '', placeholder: t(lang, 'scope_save_tasks_placeholder'), attr: { style: 'flex-grow: 1;' } });
                tgtInput.onchange = async (e) => {
                    scope.targetFolder = (e.target as HTMLInputElement).value;
                    await this.plugin.saveSettings();
                };
            }

            // Statuses Row
            const stRow = scopeCard.createDiv({ attr: { style: 'display: flex; gap: 10px; align-items: center;' } });
            stRow.createSpan({ text: t(lang, 'scope_columns_label'), attr: { style: 'font-size: 0.9em; color: var(--text-muted); min-width: 80px;' } });
            const stInput = stRow.createEl('input', { type: 'text', value: scope.statuses, placeholder: 'Backlog, To Do, In Progress, Done', attr: { style: 'flex-grow: 1;' } });
            stInput.onchange = async (e) => {
                scope.statuses = (e.target as HTMLInputElement).value;
                await this.plugin.saveSettings();
            };

            // Color & Template Row
            const ctRow = scopeCard.createDiv({ attr: { style: 'display: flex; gap: 15px; align-items: center;' } });
            ctRow.createSpan({ text: t(lang, 'scope_color_label'), attr: { style: 'font-size: 0.9em; color: var(--text-muted);' } });
            const colorInput = ctRow.createEl('input', { type: 'color', value: scope.color || '#3b82f6' });
            colorInput.onchange = async (e) => {
                scope.color = (e.target as HTMLInputElement).value;
                scopeCard.setCssStyles({ borderLeftColor: scope.color });
                await this.plugin.saveSettings();
            };

            ctRow.createSpan({ text: t(lang, 'scope_template_label'), attr: { style: 'font-size: 0.9em; color: var(--text-muted); margin-left: 10px;' } });
            const tplInput = ctRow.createEl('input', { type: 'text', value: scope.templatePath || '', placeholder: 'Templates/TaskTemplate.md', attr: { style: 'flex-grow: 1;' } });
            tplInput.onchange = async (e) => {
                scope.templatePath = (e.target as HTMLInputElement).value;
                await this.plugin.saveSettings();
            };

            // Default Subtasks Row
            const subRow = scopeCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 5px;' } });
            subRow.createSpan({ text: t(lang, 'scope_subtasks_label'), attr: { style: 'font-size: 0.9em; color: var(--text-muted);' } });
            const subArea = subRow.createEl('textarea', { placeholder: t(lang, 'scope_subtasks_placeholder'), attr: { style: 'width: 100%; height: 60px; resize: vertical; background: var(--background-primary);' } });
            subArea.value = scope.defaultSubtasks || '';
            subArea.onchange = async (e) => {
                scope.defaultSubtasks = (e.target as HTMLTextAreaElement).value;
                await this.plugin.saveSettings();
            };

            // Exclude Patterns Row
            const exclRow = scopeCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 5px;' } });
            const exclLabel = exclRow.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
            exclLabel.createSpan({ text: '🚫 ' + t(lang, 'scope_exclude_label'), attr: { style: 'font-size: 0.9em; color: var(--text-muted); font-weight: 500;' } });

            if (scope.sourceType === 'file') {
                exclRow.createEl('p', {
                    text: t(lang, 'scope_exclude_singlefile_hint'),
                    attr: { style: 'font-size: 0.8em; color: var(--text-faint); margin: 0; font-style: italic;' }
                });
            } else {
                exclRow.createEl('p', {
                    text: t(lang, 'scope_exclude_desc'),
                    attr: { style: 'font-size: 0.8em; color: var(--text-faint); margin: 0;' }
                });
                const exclInput = exclRow.createEl('textarea', {
                    placeholder: t(lang, 'scope_exclude_placeholder'),
                    attr: { style: 'width: 100%; height: 48px; resize: vertical; background: var(--background-primary); font-family: monospace; font-size: 0.85em;' }
                });
                exclInput.value = scope.excludePatterns || '';
                exclInput.onchange = async (e) => {
                    scope.excludePatterns = (e.target as HTMLTextAreaElement).value.trim();
                    await this.plugin.saveSettings();
                };

                const exclHint = exclRow.createEl('p', {
                    attr: { style: 'font-size: 0.75em; color: var(--text-faint); margin: 2px 0 0;' }
                });
                exclHint.createSpan({ text: t(lang, 'scope_exclude_hint') });
            }
        });

        // --- Kanban Card Badges Visibility ---
        new Setting(c).setName("").setHeading();

        new Setting(c).setName(t(lang, 'badge_show_cover')).setDesc(t(lang, 'badge_show_cover_desc'))
            .addToggle(tgl => tgl.setValue(this.plugin.settings.projShowCover ?? true).onChange(async v => { this.plugin.settings.projShowCover = v; await this.plugin.saveSettings(); }));

        new Setting(c).setName(t(lang, 'badge_show_tags')).setDesc(t(lang, 'badge_show_tags_desc'))
            .addToggle(tgl => tgl.setValue(this.plugin.settings.projShowTags ?? true).onChange(async v => { this.plugin.settings.projShowTags = v; await this.plugin.saveSettings(); }));

        new Setting(c).setName(t(lang, 'badge_show_subtasks')).setDesc(t(lang, 'badge_show_subtasks_desc'))
            .addToggle(tgl => tgl.setValue(this.plugin.settings.projShowSubtasks ?? true).onChange(async v => { this.plugin.settings.projShowSubtasks = v; await this.plugin.saveSettings(); }));

        new Setting(c).setName(t(lang, 'badge_show_dates')).setDesc(t(lang, 'badge_show_dates_desc'))
            .addToggle(tgl => tgl.setValue(this.plugin.settings.projShowDates ?? true).onChange(async v => { this.plugin.settings.projShowDates = v; await this.plugin.saveSettings(); }));

        new Setting(c).setName(t(lang, 'badge_show_priority')).setDesc(t(lang, 'badge_show_priority_desc'))
            .addToggle(tgl => tgl.setValue(this.plugin.settings.projShowPriority ?? true).onChange(async v => { this.plugin.settings.projShowPriority = v; await this.plugin.saveSettings(); }));

        new Setting(c).setName(t(lang, 'badge_show_estimates')).setDesc(t(lang, 'badge_show_estimates_desc'))
            .addToggle(tgl => tgl.setValue(this.plugin.settings.projShowEstimates ?? true).onChange(async v => { this.plugin.settings.projShowEstimates = v; await this.plugin.saveSettings(); }));

        // --- Media Library ---
        new Setting(c).setName("").setHeading();
        new Setting(c).setName(t(lang, 'lib_show_author') || 'Show Author/Director')
            .addToggle(tgl => tgl.setValue(this.plugin.settings.libraryShowAuthor ?? true).onChange(async v => { this.plugin.settings.libraryShowAuthor = v; await this.plugin.saveSettings(); }));
        new Setting(c).setName(t(lang, 'lib_show_rating') || 'Show Rating')
            .addToggle(tgl => tgl.setValue(this.plugin.settings.libraryShowRating ?? true).onChange(async v => { this.plugin.settings.libraryShowRating = v; await this.plugin.saveSettings(); }));
        new Setting(c).setName(t(lang, 'lib_show_progress') || 'Show Progress/Pages')
            .addToggle(tgl => tgl.setValue(this.plugin.settings.libraryShowProgress ?? true).onChange(async v => { this.plugin.settings.libraryShowProgress = v; await this.plugin.saveSettings(); }));
        new Setting(c).setName(t(lang, 'lib_show_series') || 'Show Series/Collection')
            .addToggle(tgl => tgl.setValue(this.plugin.settings.libraryShowSeries ?? true).onChange(async v => { this.plugin.settings.libraryShowSeries = v; await this.plugin.saveSettings(); }));
        new Setting(c).setName(t(lang, 'lib_show_genre') || 'Show Genre')
            .addToggle(tgl => tgl.setValue(this.plugin.settings.libraryShowGenre ?? true).onChange(async v => { this.plugin.settings.libraryShowGenre = v; await this.plugin.saveSettings(); }));

        const aliasLabels: Record<LibraryPropertyField, string> = {
            title: lang === 'ru' ? 'Название' : 'Title',
            author: lang === 'ru' ? 'Автор / режиссёр' : 'Author / director',
            genre: lang === 'ru' ? 'Жанр' : 'Genre',
            series: lang === 'ru' ? 'Серия' : 'Series',
            seriesIndex: lang === 'ru' ? 'Номер части' : 'Series index',
            status: lang === 'ru' ? 'Статус' : 'Status',
            total: lang === 'ru' ? 'Общий объём' : 'Total',
            progress: lang === 'ru' ? 'Прогресс' : 'Progress',
            rating: lang === 'ru' ? 'Рейтинг' : 'Rating',
            cover: lang === 'ru' ? 'Обложка' : 'Cover',
            format: lang === 'ru' ? 'Формат' : 'Format',
            libraryType: lang === 'ru' ? 'Тип коллекции' : 'Collection type',
            startDate: lang === 'ru' ? 'Дата начала' : 'Start date',
            endDate: lang === 'ru' ? 'Дата завершения' : 'End date',
            season: lang === 'ru' ? 'Сезон' : 'Season',
            episode: lang === 'ru' ? 'Эпизод' : 'Episode',
            queueOrder: lang === 'ru' ? 'Порядок в очереди' : 'Queue order',
            targetDate: lang === 'ru' ? 'Дата цели' : 'Target date',
            unit: lang === 'ru' ? 'Единица прогресса' : 'Progress unit'
        };
        const aliasesDetails = c.createEl('details', { cls: 'ht-property-aliases' });
        aliasesDetails.createEl('summary', {
            text: lang === 'ru' ? 'Соответствие свойств библиотеки' : 'Library property mapping'
        });
        aliasesDetails.createEl('p', {
            text: lang === 'ru'
                ? 'Первое имя используется для новых заметок. Остальные имена читаются как алиасы.'
                : 'The first name is used for new notes. Remaining names are read as aliases.',
            cls: 'setting-item-description'
        });
        const aliasesContainer = aliasesDetails.createDiv();
        (Object.keys(DEFAULT_LIBRARY_PROPERTY_ALIASES) as LibraryPropertyField[]).forEach(field => {
            new Setting(aliasesContainer)
                .setName(aliasLabels[field])
                .addText(text => text
                    .setValue(this.plugin.settings.libraryPropertyAliases[field].join(', '))
                    .onChange(async value => {
                        const aliases = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
                        this.plugin.settings.libraryPropertyAliases[field] = aliases.length
                            ? aliases
                            : [...DEFAULT_LIBRARY_PROPERTY_ALIASES[field]];
                        await this.plugin.saveSettings();
                        this.plugin.stateManager.refreshAllMedia();
                    }));
        });
        new Setting(aliasesContainer)
            .setName(lang === 'ru' ? 'Восстановить стандартные имена' : 'Restore default names')
            .addButton(button => button.setButtonText(lang === 'ru' ? 'Сбросить' : 'Reset').onClick(async () => {
                this.plugin.settings.libraryPropertyAliases = structuredClone(DEFAULT_LIBRARY_PROPERTY_ALIASES);
                await this.plugin.saveSettings();
                this.plugin.stateManager.refreshAllMedia();
                this.display();
            }));

        new Setting(c)
            .setName(t(lang, 'lib_year_goal_label') || '🎯 Yearly Reading Goal')
            .setDesc(t(lang, 'lib_year_goal_desc') || 'How many items (books, games, etc.) do you want to finish this year?')
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text.inputEl.max = '9999';
                text.inputEl.setCssStyles({ width: '70px' });
                text.setValue(String(this.plugin.settings.libraryYearGoal ?? 12));
                text.onChange(async v => {
                    const val = parseInt(v);
                    if (!isNaN(val) && val > 0) {
                        this.plugin.settings.libraryYearGoal = val;
                        await this.plugin.saveSettings();
                    }
                });
            });

        const svelteTarget = c.createDiv();
        try {
            this.svelteComponent = mount(SettingsSvelte, {
                target: svelteTarget,
                props: { plugin: this.plugin }
            });
        } catch (e) {
            console.error("Error loading Svelte settings", e);
            svelteTarget.createEl('div', { text: "Error loading Media settings", cls: "error" });
        }

        // --- Telegram Integration ---
        new Setting(c).setName("").setHeading();
        const cloudflareMode = this.plugin.settings.telegramMode === 'cloudflare';
        new Setting(c).setName(lang === 'ru' ? 'Режим Telegram' : 'Telegram mode')
            .setDesc(lang === 'ru' ? 'Локальный режим требует запущенный Obsidian. Cloudflare работает постоянно.' : 'Local mode requires Obsidian to be running. Cloudflare works continuously.')
            .addDropdown(dropdown => dropdown
                .addOption('obsidian', lang === 'ru' ? 'Внутри Obsidian' : 'Inside Obsidian')
                .addOption('cloudflare', 'Cloudflare Companion')
                .setValue(this.plugin.settings.telegramMode || 'obsidian')
                .onChange(async value => {
                    this.plugin.settings.telegramMode = value as 'obsidian' | 'cloudflare';
                    await this.plugin.saveSettings();
                    this.plugin.telegram.restartScheduler();
                    this.plugin.companion.restart();
                    this.display();
                }));

        if (!cloudflareMode) {
            new Setting(c).setName(t(lang, 'telegram_token_label')).setDesc(t(lang, 'telegram_token_desc'))
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setValue(this.plugin.settings.telegramBotToken).onChange(async v => {
                        this.plugin.settings.telegramBotToken = v.trim();
                        await this.plugin.saveSettings();
                        this.plugin.telegram.restartScheduler();
                    });
                });
        } else {
            new Setting(c).setName('Worker URL')
                .setDesc(lang === 'ru' ? 'Адрес развёрнутого Cloudflare Worker.' : 'URL of the deployed Cloudflare Worker.')
                .addText(text => text.setPlaceholder('https://habit-timer-companion.workers.dev')
                    .setValue(this.plugin.settings.cloudflareWorkerUrl || '').onChange(async value => {
                        this.plugin.settings.cloudflareWorkerUrl = value.trim();
                        await this.plugin.saveSettings();
                    }));
            new Setting(c).setName(lang === 'ru' ? 'Ключ синхронизации' : 'Sync API token')
                .setDesc(lang === 'ru' ? 'Должен совпадать с секретом COMPANION_API_TOKEN в Cloudflare.' : 'Must match the COMPANION_API_TOKEN Cloudflare secret.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setValue(this.plugin.settings.cloudflareApiToken || '').onChange(async value => {
                        this.plugin.settings.cloudflareApiToken = value.trim();
                        await this.plugin.saveSettings();
                    });
                });
            new Setting(c).setName(lang === 'ru' ? 'Часовой пояс' : 'Timezone')
                .setDesc('IANA timezone')
                .addText(text => text.setPlaceholder('Europe/Kyiv').setValue(this.plugin.settings.cloudflareTimezone || 'Europe/Kyiv').onChange(async value => {
                    this.plugin.settings.cloudflareTimezone = value.trim() || 'Europe/Kyiv';
                    await this.plugin.saveSettings();
                }));
            new Setting(c).setName(lang === 'ru' ? 'Интервал синхронизации' : 'Sync interval')
                .setDesc(lang === 'ru' ? 'Секунды, минимум 30.' : 'Seconds, minimum 30.')
                .addText(text => {
                    text.inputEl.type = 'number';
                    text.setValue(String(this.plugin.settings.cloudflareSyncIntervalSec || 60)).onChange(async value => {
                        this.plugin.settings.cloudflareSyncIntervalSec = Math.max(30, Number(value) || 60);
                        await this.plugin.saveSettings();
                        this.plugin.companion.restart();
                    });
                });
        }

        new Setting(c).setName(t(lang, 'telegram_chat_id_label')).setDesc(t(lang, 'telegram_chat_id_desc'))
            .addText(text => text.setValue(this.plugin.settings.telegramChatId).onChange(async v => {
                this.plugin.settings.telegramChatId = v.trim();
                await this.plugin.saveSettings();
                this.plugin.telegram.restartScheduler();
                this.plugin.companion.restart();
            }))
            .addButton(btn => btn.setButtonText(t(lang, 'telegram_get_chat_id_btn')).onClick(async () => {
                if (cloudflareMode) {
                    const result = await this.plugin.companion.discoverChatId();
                    if (result.ok && result.chatId) {
                        this.plugin.settings.telegramChatId = result.chatId;
                        await this.plugin.saveSettings();
                        new Notice(t(lang, 'telegram_get_chat_id_notice_ok', result.chatId));
                        this.display();
                    } else {
                        new Notice(result.message || t(lang, 'telegram_get_chat_id_notice_err'));
                    }
                    return;
                }
                const token = this.plugin.settings.telegramBotToken.trim();
                if (!token) { new Notice('Please enter Bot Token first!'); return; }
                try {
                    const resp = await requestUrl({ url: `https://api.telegram.org/bot${token}/getUpdates`, method: 'GET' });
                    const data = resp.json as TelegramGetUpdatesResponse;
                    if (data?.ok && data.result?.length > 0) {
                        let foundId = '';
                        for (let idx = data.result.length - 1; idx >= 0; idx--) {
                            const item = data.result[idx];
                            if (item?.message?.chat?.id) { foundId = String(item.message.chat.id); break; }
                        }
                        if (foundId) {
                            this.plugin.settings.telegramChatId = foundId;
                            await this.plugin.saveSettings();
                            this.plugin.telegram.restartScheduler();
                            new Notice(t(lang, 'telegram_get_chat_id_notice_ok', foundId));
                            this.display();
                        } else { new Notice(t(lang, 'telegram_get_chat_id_notice_err')); }
                    } else { new Notice(t(lang, 'telegram_get_chat_id_notice_err')); }
                } catch (e) { console.error(e); new Notice('Error: ' + (e instanceof Error ? e.message : String(e))); }
            }));

        if (cloudflareMode) {
            const lastSync = this.plugin.settings.cloudflareLastSyncAt
                ? moment(this.plugin.settings.cloudflareLastSyncAt).format('DD.MM.YYYY HH:mm:ss')
                : (lang === 'ru' ? 'ещё не выполнялась' : 'not synchronized yet');
            const error = this.plugin.settings.cloudflareLastSyncError;
            new Setting(c).setName(lang === 'ru' ? 'Cloudflare Companion' : 'Cloudflare Companion')
                .setDesc(`${lang === 'ru' ? 'Последняя синхронизация' : 'Last sync'}: ${lastSync}${error ? ` | ${error}` : ''}`)
                .addButton(button => button.setButtonText(lang === 'ru' ? 'Синхронизировать' : 'Sync now').setCta().onClick(async () => {
                    const ok = await this.plugin.companion.sync();
                    new Notice(ok ? (lang === 'ru' ? 'Синхронизация завершена.' : 'Synchronization completed.') : (this.plugin.settings.cloudflareLastSyncError || 'Sync failed'));
                    this.display();
                }))
                .addButton(button => button.setButtonText(lang === 'ru' ? 'Настроить бот и приложение' : 'Configure bot and app').onClick(async () => {
                    const result = await this.plugin.companion.setupWebhook();
                    new Notice(result.ok ? `${lang === 'ru' ? 'Бот и Mini App настроены' : 'Bot and Mini App configured'}: ${result.message}` : result.message, 8000);
                }));
        }

        new Setting(c).setName(t(lang, 'telegram_morning_enabled_label'))
            .addToggle(toggle => toggle.setValue(this.plugin.settings.telegramMorningEnabled).onChange(async v => { this.plugin.settings.telegramMorningEnabled = v; await this.plugin.saveSettings(); }))
            .addText(text => { text.inputEl.type = 'time'; text.setValue(this.plugin.settings.telegramMorningTime).onChange(async v => { this.plugin.settings.telegramMorningTime = v || '08:00'; await this.plugin.saveSettings(); }); });

        new Setting(c).setName(t(lang, 'telegram_evening_enabled_label'))
            .addToggle(toggle => toggle.setValue(this.plugin.settings.telegramEveningEnabled).onChange(async v => { this.plugin.settings.telegramEveningEnabled = v; await this.plugin.saveSettings(); }))
            .addText(text => { text.inputEl.type = 'time'; text.setValue(this.plugin.settings.telegramEveningTime).onChange(async v => { this.plugin.settings.telegramEveningTime = v || '22:00'; await this.plugin.saveSettings(); }); });

        new Setting(c).setName(t(lang, 'telegram_live_label')).setDesc(t(lang, 'telegram_live_desc'))
            .addToggle(toggle => toggle.setValue(this.plugin.settings.telegramLiveNotifications).onChange(async v => { this.plugin.settings.telegramLiveNotifications = v; await this.plugin.saveSettings(); }));

        new Setting(c).setName(t(lang, 'telegram_weekly_label')).setDesc(t(lang, 'telegram_weekly_desc'))
            .addToggle(toggle => toggle.setValue(this.plugin.settings.telegramWeeklyReport).onChange(async v => { this.plugin.settings.telegramWeeklyReport = v; await this.plugin.saveSettings(); }));

        new Setting(c).setName(t(lang, 'telegram_test_btn'))
            .addButton(btn => btn.setButtonText(t(lang, 'telegram_test_btn')).setCta().onClick(async () => {
                if (cloudflareMode) {
                    const ok = await this.plugin.companion.sync();
                    new Notice(ok ? t(lang, 'telegram_test_success') : (this.plugin.settings.cloudflareLastSyncError || 'Cloudflare Companion test failed'));
                    return;
                }
                const token = this.plugin.settings.telegramBotToken.trim();
                const chatId = this.plugin.settings.telegramChatId.trim();
                if (!token || !chatId) { new Notice('Please configure Bot Token and Chat ID first!'); return; }
                try {
                    const res = await requestUrl({
                        url: `https://api.telegram.org/bot${token}/sendMessage`,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: '🤖 Obsidian Habit Timer: ' + t(lang, 'telegram_test_success') })
                    });
                    const sentJson = res.json as TelegramSendResponse;
                    if (sentJson?.ok) { new Notice(t(lang, 'telegram_test_success')); }
                    else { new Notice('Failed: ' + (sentJson?.description || 'Unknown error')); }
                } catch (e) { console.error(e); new Notice('Error: ' + (e instanceof Error ? e.message : String(e))); }
            }));

        // --- Habits ---
        new Setting(c).setName("").setHeading();
        const addBtn = c.createEl('button', { text: t(lang, 'add_habit') });
        addBtn.onclick = async () => {
            this.plugin.settings.properties.push({
                name: 'Habit-New',
                goalMinutes: 60,
                minimumGoalMinutes: 20,
                weeklyGoalMinutes: 300,
                goalCount: 10,
                minimumGoalCount: 1,
                weeklyGoalCount: 50,
                goalMode: 'daily',
                globalGoalHours: 1000,
                musicFolder: '',
                subTasks: [],
                type: 'timer',
                createdAt: moment().format('YYYY-MM-DD')
            });
            await this.plugin.saveSettings();
            this.display();
        };

        this.plugin.settings.properties.forEach((p, i) => {
            const s = new Setting(c).setName(`${t(lang, 'habit_name')} #${i + 1}`);
            s.settingEl.addClass('habit-config-row');
            const type = p.type || 'timer';
            s.addDropdown(d => d
                .addOption('timer', t(lang, 'type_timer'))
                .addOption('count', t(lang, 'type_count'))
                .addOption('binary', t(lang, 'type_binary'))
                .addOption('negative', t(lang, 'type_negative'))
                .setValue(type)
                .onChange(async (val) => {
                    p.type = val as HabitProperty['type'];
                    await this.plugin.saveSettings();
                    this.display();
                }));

            s.addText(text => text.setPlaceholder(t(lang, 'habit_name')).setValue(p.name).onChange(async (v) => { p.name = v; await this.plugin.saveSettings(); }));

            if (type === 'timer') {
                s.addText(text => text.setPlaceholder(t(lang, 'goal_minutes')).setValue(String(p.goalMinutes)).onChange(async (v) => { p.goalMinutes = Number(v); await this.plugin.saveSettings(); }));
                s.addText(text => text.setPlaceholder(t(lang, 'music_folder')).setValue(p.musicFolder || '').onChange(async (v) => { p.musicFolder = v; await this.plugin.saveSettings(); }));
            } else if (type === 'count') {
                s.addText(text => text.setPlaceholder(t(lang, 'goal_count')).setValue(String(p.goalCount || 10)).onChange(async (v) => { p.goalCount = Number(v); await this.plugin.saveSettings(); }));
            }

            s.addText(text => text.setPlaceholder(t(lang, 'subtasks_label')).setValue(p.subTasks?.join(', ') || '').onChange(async (v) => { p.subTasks = v.split(',').map(x => x.trim()).filter(x => x); await this.plugin.saveSettings(); }));

            if (type === 'timer' || type === 'count') new Setting(c)
                .setName(lang === 'ru' ? 'Создавать ежедневное задание' : 'Create a daily task')
                .setDesc(lang === 'ru' ? 'Для дневной цели: задание выполняется при достижении нормы привычки. Отключение останавливает создание новых заданий.' : 'For daily goals: completes when the habit target is reached. Disabling stops new tasks.')
                .addToggle(toggle => toggle.setValue(p.autoDailyTask === true).onChange(async value => {
                    p.autoDailyTask = value;
                    await this.plugin.saveSettings();
                    await this.plugin.tasks.list();
                }));

            s.addText(text => text.setPlaceholder(t(lang, 'created_at_label')).setValue(p.createdAt || '').onChange(async (v) => { p.createdAt = v; await this.plugin.saveSettings(); }));

            s.addButton(btn => btn.setButtonText(t(lang, 'delete')).setWarning().onClick(async () => {
                this.plugin.settings.properties.splice(i, 1);
                await this.plugin.saveSettings();
                this.display();
            }));

            if (type === 'timer' || type === 'count') {
                const unit = type === 'timer'
                    ? (lang === 'ru' ? 'минуты' : 'minutes')
                    : (lang === 'ru' ? 'повторения' : 'count');
                const flexible = c.createEl('details', { cls: 'ht-flexible-goals' });
                flexible.createEl('summary', {
                    text: lang === 'ru' ? `Гибкие цели: ${p.name}` : `Flexible goals: ${p.name}`
                });
                const flexibleBody = flexible.createDiv();

                new Setting(flexibleBody)
                    .setName(lang === 'ru' ? 'Период цели' : 'Goal period')
                    .setDesc(lang === 'ru' ? 'Дневная цель или общий результат за неделю' : 'Daily target or a shared weekly result')
                    .addDropdown(dropdown => dropdown
                        .addOption('daily', lang === 'ru' ? 'Каждый день' : 'Daily')
                        .addOption('weekly', lang === 'ru' ? 'На неделю' : 'Weekly')
                        .setValue(p.goalMode || 'daily')
                        .onChange(async value => {
                            p.goalMode = value as 'daily' | 'weekly';
                            await this.plugin.saveSettings();
                            this.display();
                        }));

                new Setting(flexibleBody)
                    .setName(lang === 'ru' ? `Минимум (${unit})` : `Minimum (${unit})`)
                    .setDesc(lang === 'ru' ? 'Сохраняет серию, но день отмечается как частичный' : 'Preserves the streak while the day remains partial')
                    .addText(text => {
                        text.inputEl.type = 'number';
                        const value = type === 'timer'
                            ? (p.minimumGoalMinutes ?? p.goalMinutes)
                            : (p.minimumGoalCount ?? p.goalCount ?? 10);
                        text.setValue(String(value)).onChange(async raw => {
                            if (type === 'timer') p.minimumGoalMinutes = Math.max(0, Number(raw) || 0);
                            else p.minimumGoalCount = Math.max(0, Number(raw) || 0);
                            await this.plugin.saveSettings();
                        });
                    });

                if ((p.goalMode || 'daily') === 'weekly') {
                    new Setting(flexibleBody)
                        .setName(lang === 'ru' ? `Желательная цель на неделю (${unit})` : `Desired weekly goal (${unit})`)
                        .addText(text => {
                            text.inputEl.type = 'number';
                            const value = type === 'timer'
                                ? (p.weeklyGoalMinutes ?? p.goalMinutes)
                                : (p.weeklyGoalCount ?? p.goalCount ?? 10);
                            text.setValue(String(value)).onChange(async raw => {
                                if (type === 'timer') p.weeklyGoalMinutes = Math.max(0, Number(raw) || 0);
                                else p.weeklyGoalCount = Math.max(0, Number(raw) || 0);
                                await this.plugin.saveSettings();
                            });
                        });
                } else {
                    const weekdayLabels: Array<[WeekdayKey, string]> = [
                        ['mon', lang === 'ru' ? 'Пн' : 'Mon'], ['tue', lang === 'ru' ? 'Вт' : 'Tue'],
                        ['wed', lang === 'ru' ? 'Ср' : 'Wed'], ['thu', lang === 'ru' ? 'Чт' : 'Thu'],
                        ['fri', lang === 'ru' ? 'Пт' : 'Fri'], ['sat', lang === 'ru' ? 'Сб' : 'Sat'],
                        ['sun', lang === 'ru' ? 'Вс' : 'Sun']
                    ];
                    const weekdaysSetting = new Setting(flexibleBody)
                        .setName(lang === 'ru' ? 'Цели по дням' : 'Goals by weekday')
                        .setDesc(lang === 'ru' ? 'Пустое поле использует обычную желательную цель' : 'An empty value uses the regular desired goal');
                    const grid = weekdaysSetting.controlEl.createDiv({ cls: 'ht-weekday-goals' });
                    weekdayLabels.forEach(([key, label]) => {
                        const cell = grid.createEl('label');
                        cell.createEl('span', { text: label });
                        const input = cell.createEl('input', { type: 'number', attr: { min: '0' } });
                        input.value = p.dailyGoals?.[key] !== undefined ? String(p.dailyGoals[key]) : '';
                        input.onchange = async () => {
                            if (!p.dailyGoals) p.dailyGoals = {};
                            if (input.value === '') delete p.dailyGoals[key];
                            else p.dailyGoals[key] = Math.max(0, Number(input.value) || 0);
                            await this.plugin.saveSettings();
                        };
                    });
                }

                new Setting(flexibleBody)
                    .setName(lang === 'ru' ? 'Постепенное увеличение' : 'Progressive increase')
                    .setDesc(lang === 'ru' ? 'Автоматически повышать желательную цель' : 'Automatically increase the desired target')
                    .addToggle(toggle => toggle
                        .setValue(p.progressiveGoal?.enabled ?? false)
                        .onChange(async enabled => {
                            p.progressiveGoal = {
                                enabled,
                                step: p.progressiveGoal?.step || (type === 'timer' ? 5 : 1),
                                everyWeeks: p.progressiveGoal?.everyWeeks || 1,
                                max: p.progressiveGoal?.max,
                                startDate: p.progressiveGoal?.startDate || p.createdAt
                            };
                            await this.plugin.saveSettings();
                            this.display();
                        }));

                if (p.progressiveGoal?.enabled) {
                    const progression = new Setting(flexibleBody)
                        .setName(lang === 'ru' ? 'Шаг / период / предел' : 'Step / interval / maximum')
                        .setDesc(lang === 'ru' ? `Значения в единицах «${unit}»` : `Values use ${unit}`);
                    progression.addText(text => {
                        text.inputEl.type = 'number';
                        text.setPlaceholder(lang === 'ru' ? 'Шаг' : 'Step').setValue(String(p.progressiveGoal?.step || 1)).onChange(async value => {
                            if (p.progressiveGoal) p.progressiveGoal.step = Math.max(0, Number(value) || 0);
                            await this.plugin.saveSettings();
                        });
                    });
                    progression.addText(text => {
                        text.inputEl.type = 'number';
                        text.setPlaceholder(lang === 'ru' ? 'Каждые N недель' : 'Every N weeks').setValue(String(p.progressiveGoal?.everyWeeks || 1)).onChange(async value => {
                            if (p.progressiveGoal) p.progressiveGoal.everyWeeks = Math.max(1, Number(value) || 1);
                            await this.plugin.saveSettings();
                        });
                    });
                    progression.addText(text => {
                        text.inputEl.type = 'number';
                        text.setPlaceholder(lang === 'ru' ? 'Предел' : 'Maximum').setValue(p.progressiveGoal?.max ? String(p.progressiveGoal.max) : '').onChange(async value => {
                            if (p.progressiveGoal) p.progressiveGoal.max = value === '' ? undefined : Math.max(0, Number(value) || 0);
                            await this.plugin.saveSettings();
                        });
                    });
                }
            }

            const mcs = this.plugin.settings.mediaCollections;
            if (mcs.length > 0) {
                const mcSetting = new Setting(c).setName(`  ↳ Library Sections`).setDesc(`Select which library sections are available for ${p.name}`);
                mcSetting.settingEl.addClass('habit-media-collections-row');
                mcSetting.controlEl.setCssStyles({ flexWrap: 'wrap' });
                mcSetting.controlEl.setCssStyles({ gap: '10px' });
                mcSetting.controlEl.setCssStyles({ justifyContent: 'flex-start' });
                mcSetting.controlEl.setCssStyles({ marginTop: '10px' });
                mcSetting.infoEl.setCssStyles({ flex: '1 1 100%' });
                
                mcs.forEach(col => {
                    const itemCont = mcSetting.controlEl.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 5px; background: var(--background-primary); padding: 5px 10px; border-radius: 5px;' } });
                    itemCont.createSpan({ text: col.id.toUpperCase(), attr: { style: 'font-size: 0.85em; font-weight: bold; color: var(--text-muted);' } });
                    
                    const toggle = itemCont.createEl('input', { type: 'checkbox', cls: 'tui-checkbox' });
                    toggle.checked = p.mediaCollections?.includes(col.id) ?? false;
                    toggle.onchange = async () => {
                        const v = toggle.checked;
                        if (!p.mediaCollections) p.mediaCollections = [];
                        if (v) {
                            if (!p.mediaCollections.includes(col.id)) p.mediaCollections.push(col.id);
                        } else {
                            p.mediaCollections = p.mediaCollections.filter(id => id !== col.id);
                        }
                        await this.plugin.saveSettings();
                    };
                });
            }
        });
    }
}
