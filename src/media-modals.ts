import { App, Modal, Setting, Notice, TFile, moment } from 'obsidian';
import type { DropdownComponent, TextComponent } from 'obsidian';
import HabitTimerPlugin from './main';
import { t } from './i18n';
import type { TranslationKey } from './i18n';
import type { MediaCollectionConfig, MediaDailyGoalUnit, MediaType } from './types';
import type { MediaItem } from './store/StateManager';
import type { Frontmatter } from './utils/frontmatter';
import { parseRating } from './utils/rating';
import { createTagEditor } from './library/tag-editor';
import type { TagEditorHandle } from './library/tag-editor';
import { readPropertyNumber, readPropertyString, writeProperty } from './library/property-schema';
import { calculateMediaPace } from './library/pace';
import { DAILY_GOAL_UNITS, collectionDailyGoalUnit, dailyGoalUnitLabel, mediaProgressUnit, normalizeDailyGoalUnit } from './library/daily-goals';

type BookFormat = 'paper' | 'ebook' | 'audiobook';
const MEDIA_TYPE_LABELS: Record<string, TranslationKey> = {
    book: 'media_type_book',
    manga: 'media_type_manga',
    film: 'media_type_film',
    anime: 'media_type_anime',
    series: 'media_type_series',
    game: 'media_type_game',
    course: 'media_type_course'
};

export class AddMediaModal extends Modal {
    plugin: HabitTimerPlugin;
    
    collectionId: MediaType = 'book';
    title: string = '';
    author: string = '';
    totalProgress: string = '';
    series: string = '';
    seriesIndex: string = '';
    genre: string = '';
    status: string = '';
    rating: string = '';
    coverUrl: string = '';
    bookFormat: BookFormat = 'paper';
    queueOrder: string = '';
    targetDate: string = '';
    private suggestionIdPrefix = `ht-media-suggest-${Date.now()}`;

    constructor(app: App, plugin: HabitTimerPlugin) {
        super(app);
        this.plugin = plugin;
        const activeCols = this.plugin.settings.mediaCollections.filter(c => c.enabled);
        if (activeCols.length > 0 && activeCols[0]) {
            this.collectionId = activeCols[0].id;
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        const lang = this.plugin.settings.language;
        contentEl.createEl('h2', { text: t(lang, 'add_new_media_title') || 'Add New Media' });

        const activeCols = this.plugin.settings.mediaCollections.filter(c => c.enabled);
        const existingItems = this.getExistingMediaItems();
        const createDatalist = (name: string, values: string[]): string => {
            const id = `${this.suggestionIdPrefix}-${name}`;
            const list = contentEl.createEl('datalist');
            list.id = id;
            values
                .map(v => v.trim())
                .filter(Boolean)
                .filter((value, index, all) => all.indexOf(value) === index)
                .sort((a, b) => a.localeCompare(b))
                .forEach(value => list.createEl('option', { attr: { value } }));
            return id;
        };
        const titleListId = createDatalist('title', existingItems.map(item => item.title));
        const coverListId = createDatalist('cover', existingItems.map(item => item.cover));
        let bookFormatSetting: Setting | null = null;
        let bookFormatDropdown: DropdownComponent | null = null;
        let authorEditor: TagEditorHandle | null = null;
        let totalSetting: Setting | null = null;
        let totalInput: HTMLInputElement | null = null;
        let seriesEditor: TagEditorHandle | null = null;
        let seriesIndexInput: HTMLInputElement | null = null;
        let genreEditor: TagEditorHandle | null = null;
        let ratingInput: HTMLInputElement | null = null;
        let coverInput: HTMLInputElement | null = null;
        const updateDynamicFields = (): void => {
            bookFormatSetting?.settingEl.setCssStyles({
                display: this.collectionId === 'book' ? '' : 'none'
            });
            bookFormatDropdown?.setValue(this.bookFormat);
            if (!totalInput) return;
            const collection = activeCols.find(value => value.id === this.collectionId);
            const unit = mediaProgressUnit(
                '',
                this.collectionId,
                this.collectionId === 'book' ? this.bookFormat : '',
                Number(this.totalProgress) || 0,
                collection ? collectionDailyGoalUnit(collection) : 'units'
            );
            const unitLabel = dailyGoalUnitLabel(unit, lang === 'ru' ? 'ru' : 'en');
            totalSetting?.setName(lang === 'ru' ? `Общий объём (${unitLabel})` : `Total (${unitLabel})`);
            totalInput.placeholder = unitLabel;
        };
        const applyExistingMedia = (title: string): void => {
            const normalized = title.trim().toLowerCase();
            const item = existingItems.find(media =>
                media.title.trim().toLowerCase() === normalized &&
                (!this.collectionId || media.collectionId === this.collectionId)
            ) || existingItems.find(media => media.title.trim().toLowerCase() === normalized);
            if (!item) return;

            if (!this.author && item.authorOrDirector) {
                this.author = item.authorOrDirector;
                authorEditor?.setValues(item.authors);
            }
            if (!this.genre && item.genre) {
                this.genre = item.genre;
                genreEditor?.setValues(item.genres);
            }
            if (!this.series && item.series) {
                this.series = item.series;
                seriesEditor?.setValues([item.series]);
            }
            if (!this.seriesIndex && item.seriesIndex > 0) {
                this.seriesIndex = String(item.seriesIndex);
                if (seriesIndexInput) seriesIndexInput.value = this.seriesIndex;
            }
            if (!this.rating && item.rating) {
                this.rating = item.rating;
                if (ratingInput) ratingInput.value = item.rating;
            }
            if (!this.coverUrl && item.cover) {
                this.coverUrl = item.cover;
                if (coverInput) coverInput.value = item.cover;
            }
            if (this.collectionId === 'book') {
                this.bookFormat = this.getExistingBookFormat(item);
                updateDynamicFields();
            }
            if (!this.totalProgress && item.total > 0) {
                this.totalProgress = String(item.total);
                if (totalInput) totalInput.value = this.totalProgress;
            }
        };
        if (activeCols.length === 0) {
            contentEl.createEl('p', { text: "No media collections enabled in settings." });
            return;
        }

        new Setting(contentEl)
            .setName(t(lang, 'type_label'))
            .addDropdown(drop => {
                activeCols.forEach(c => {
                    const labelKey = MEDIA_TYPE_LABELS[c.id];
                    const label = labelKey ? t(lang, labelKey) : c.id;
                    drop.addOption(c.id, label);
                });
                drop.setValue(this.collectionId);
                drop.onChange(value => {
                    this.collectionId = value;
                    updateDynamicFields();
                    applyExistingMedia(this.title);
                });
            });

        bookFormatSetting = new Setting(contentEl)
            .setName(lang === 'ru' ? 'Формат книги' : 'Book format')
            .addDropdown(drop => {
                bookFormatDropdown = drop;
                drop.addOption('paper', t(lang, 'paper_type') || 'Book');
                drop.addOption('ebook', t(lang, 'ebook_type') || 'E-book');
                drop.addOption('audiobook', t(lang, 'audiobook_type') || 'Audiobook');
                drop.setValue(this.bookFormat);
                drop.onChange(value => {
                    this.bookFormat = this.normalizeBookFormat(value);
                    updateDynamicFields();
                });
            });
        updateDynamicFields();

        new Setting(contentEl)
            .setName(t(lang, 'media_title_label') || 'Title')
            .addText(text => {
                text.inputEl.setAttribute('list', titleListId);
                text.setPlaceholder(lang === 'ru' ? 'Начните вводить название...' : 'Start typing a title...');
                text.onChange(value => {
                    this.title = value;
                    applyExistingMedia(value);
                });
            });

        const authorSetting = new Setting(contentEl)
            .setName(t(lang, 'author_label'))
            .setDesc(lang === 'ru' ? 'Введите имя и нажмите Enter. Можно выбрать несколько.' : 'Type a name and press Enter. Multiple values are supported.');
        authorEditor = createTagEditor(authorSetting.controlEl, {
            suggestions: existingItems.flatMap(item => item.authors),
            placeholder: lang === 'ru' ? 'Добавить автора' : 'Add author',
            ariaLabel: lang === 'ru' ? 'Авторы' : 'Authors',
            onChange: values => { this.author = values.join(', '); }
        });

        totalSetting = new Setting(contentEl)
            .setName(t(lang, 'episodes_mins_label') || 'Pages / Episodes / Mins')
            .addText(text => {
                totalInput = text.inputEl;
                text.inputEl.type = 'number';
                updateDynamicFields();
                text.onChange(value => this.totalProgress = value);
            });
        updateDynamicFields();

        const seriesSetting = new Setting(contentEl)
            .setName(t(lang, 'series_label') || 'Series')
            .setDesc(lang === 'ru' ? 'Одна серия для произведения' : 'One series per item');
        seriesEditor = createTagEditor(seriesSetting.controlEl, {
            suggestions: existingItems.map(item => item.series),
            placeholder: lang === 'ru' ? 'Добавить серию' : 'Add series',
            ariaLabel: lang === 'ru' ? 'Серия' : 'Series',
            maxItems: 1,
            onChange: values => { this.series = values[0] || ''; }
        });

        new Setting(contentEl)
            .setName(lang === 'ru' ? 'Номер части' : 'Series index')
            .addText(text => {
                seriesIndexInput = text.inputEl;
                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text.inputEl.step = '0.1';
                text.setPlaceholder(lang === 'ru' ? 'Например: 2' : 'For example: 2');
                text.onChange(value => this.seriesIndex = value);
            });

        const genreSetting = new Setting(contentEl)
            .setName(t(lang, 'genre_label'))
            .setDesc(lang === 'ru' ? 'Введите жанр и нажмите Enter. Можно выбрать несколько.' : 'Type a genre and press Enter. Multiple values are supported.');
        genreEditor = createTagEditor(genreSetting.controlEl, {
            suggestions: existingItems.flatMap(item => item.genres),
            placeholder: lang === 'ru' ? 'Добавить жанр' : 'Add genre',
            ariaLabel: lang === 'ru' ? 'Жанры' : 'Genres',
            onChange: values => { this.genre = values.join(', '); }
        });

        if (!this.status) this.status = lang === 'ru' ? 'В планах' : 'Planned';
        const statusSetting = new Setting(contentEl)
            .setName(lang === 'ru' ? 'Статус' : 'Status')
            .setDesc(lang === 'ru' ? 'Статусы коллекции и ранее использованные значения' : 'Collection statuses and previously used values');
        createTagEditor(statusSetting.controlEl, {
            values: [this.status],
            suggestions: [
                ...existingItems.filter(item => item.collectionId === this.collectionId).map(item => item.status),
                ...activeCols.flatMap(collection => [collection.readingStatusName, collection.pausedStatusName || 'На паузе', collection.finishedStatusName]),
                lang === 'ru' ? 'В планах' : 'Planned'
            ],
            placeholder: lang === 'ru' ? 'Выберите статус' : 'Choose status',
            ariaLabel: lang === 'ru' ? 'Статус' : 'Status',
            maxItems: 1,
            onChange: values => { this.status = values[0] || ''; }
        });

        new Setting(contentEl)
            .setName(lang === 'ru' ? 'Порядок в очереди' : 'Queue order')
            .setDesc(lang === 'ru' ? '0 — не добавлять в очередь' : '0 means not queued')
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text.setPlaceholder('0');
                text.onChange(value => this.queueOrder = value);
            });

        new Setting(contentEl)
            .setName(lang === 'ru' ? 'Цель завершения' : 'Target date')
            .addText(text => {
                text.inputEl.type = 'date';
                text.onChange(value => this.targetDate = value);
            });

        new Setting(contentEl)
            .setName(t(lang, 'cover_url_label'))
            .addText(text => {
                coverInput = text.inputEl;
                text.inputEl.setAttribute('list', coverListId);
                text.onChange(value => this.coverUrl = value);
            });

        new Setting(contentEl)
            .setName(t(lang, 'rating_label') || 'Rating (1-10)')
            .setDesc(lang === 'ru' ? 'Допустимые примеры: 7, 7+, 7-, +6, -6' : 'Examples: 7, 7+, 7-, +6, -6')
            .addText(text => {
                ratingInput = text.inputEl;
                text.inputEl.inputMode = 'text';
                text.setPlaceholder('7+');
                text.onChange(value => this.rating = value);
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t(lang, 'create_btn'))
                .setCta()
                .onClick(async () => {
                    if (!this.title) {
                        new Notice(t(lang, 'title_required'));
                        return;
                    }
                    if (this.rating && !parseRating(this.rating)) {
                        new Notice(lang === 'ru' ? 'Рейтинг должен быть от 1 до 10, например 7+' : 'Rating must be between 1 and 10, for example 7+');
                        return;
                    }
                    await this.createMedia();
                    this.close();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }

    private getExistingMediaItems(): MediaItem[] {
        let items: MediaItem[] = [];
        const unsubscribe = this.plugin.stateManager.mediaItems.subscribe(value => {
            items = value;
        });
        unsubscribe();
        return items;
    }

    private normalizeBookFormat(value: string): BookFormat {
        if (value === 'audiobook') return 'audiobook';
        if (value === 'ebook') return 'ebook';
        return 'paper';
    }

    private getExistingBookFormat(item: MediaItem): BookFormat {
        const fm = item.cache.frontmatter as Frontmatter | undefined;
        if (!fm) return 'paper';

        const rawFormat = readPropertyString(fm, this.plugin.settings, 'format').toLowerCase();
        if (rawFormat.includes('audio') || rawFormat.includes('аудио')) return 'audiobook';
        if (rawFormat.includes('ebook') || rawFormat.includes('e-book') || rawFormat.includes('элект')) return 'ebook';
        return 'paper';
    }

    async createMedia() {
        const collection = this.plugin.settings.mediaCollections.find(c => c.id === this.collectionId);
        if (!collection) return;
        
        const lang = this.plugin.settings.language;
        let templateContent = '';
        if (collection.templatePath) {
            let tpPath = collection.templatePath;
            if (!tpPath.endsWith('.md')) {
                tpPath += '.md';
            }
            const templateFile = this.app.vault.getAbstractFileByPath(tpPath);
            if (templateFile instanceof TFile) {
                templateContent = await this.app.vault.read(templateFile);
            } else {
                new Notice(t(lang, 'template_not_found'));
            }
        }

        const safeTitle = this.title.replace(/[\\/:]/g, '-');
        const folderPath = collection.folder ? `${collection.folder}/` : '';
        const newFilePath = `${folderPath}${safeTitle}.md`;

        const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
        if (existingFile) {
            new Notice(t(lang, 'book_exists'));
            return;
        }

        try {
            const settings = this.plugin.settings;
            const authors = this.parseMultipleValues(this.author);
            const genres = this.parseMultipleValues(this.genre);
            const createdFile = await this.app.vault.create(newFilePath, templateContent);
            await this.app.fileManager.processFrontMatter(createdFile, frontmatter => {
                const fm = frontmatter as Frontmatter;
                writeProperty(fm, settings, 'title', this.title);
                writeProperty(fm, settings, 'author', authors);
                writeProperty(fm, settings, 'genre', genres);
                writeProperty(fm, settings, 'series', this.series);
                if (this.seriesIndex) writeProperty(fm, settings, 'seriesIndex', Number(this.seriesIndex));
                if (this.coverUrl) writeProperty(fm, settings, 'cover', this.coverUrl);
                if (this.rating) writeProperty(fm, settings, 'rating', this.rating.trim().replace(',', '.'));
                writeProperty(fm, settings, 'status', this.status || (lang === 'ru' ? 'В планах' : 'Planned'));
                if (this.collectionId === 'book') {
                    const typeByFormat: Record<BookFormat, string> = {
                        paper: 'Paper', ebook: 'E-book', audiobook: 'Audiobook'
                    };
                    writeProperty(fm, settings, 'format', typeByFormat[this.bookFormat]);
                } else {
                    writeProperty(fm, settings, 'libraryType', this.collectionId);
                }
                if (this.totalProgress) writeProperty(fm, settings, 'total', Number(this.totalProgress));
                writeProperty(
                    fm,
                    settings,
                    'unit',
                    mediaProgressUnit(
                        '',
                        this.collectionId,
                        this.collectionId === 'book' ? this.bookFormat : '',
                        Number(this.totalProgress) || 0,
                        collectionDailyGoalUnit(collection)
                    )
                );
                if (this.queueOrder) writeProperty(fm, settings, 'queueOrder', Math.max(0, Number(this.queueOrder) || 0));
                if (this.targetDate) writeProperty(fm, settings, 'targetDate', this.targetDate);
                writeProperty(fm, settings, 'progress', 0);
            });

            new Notice(t(lang, 'book_added_notice', this.title));
        } catch (e) {
            console.error('Error creating media:', e);
            new Notice(t(lang, 'no_data'));
        }
    }

    private parseMultipleValues(value: string): string[] {
        return [...new Set(value
            .split(/[,;\n]/)
            .map(item => item.trim())
            .filter(Boolean))];
    }

}

export class SaveMediaSessionModal extends Modal {
    plugin: HabitTimerPlugin;
    currentProgress: number;
    durationSec: number;
    onSubmit: (progressAdded: number, note: string) => void | Promise<void>;
    onCancel?: () => void;
    progressUnit?: string;
    private submitted = false;

    progressAdded: string = '';
    sessionNote: string = '';

    constructor(app: App, plugin: HabitTimerPlugin, currentProgress: number, durationSec: number, defaultNote: string, onSubmit: (progressAdded: number, note: string) => void | Promise<void>, onCancel?: () => void, progressUnit?: string, suggestedProgress?: number | null) {
        super(app);
        this.plugin = plugin;
        this.currentProgress = currentProgress;
        this.durationSec = durationSec;
        this.sessionNote = defaultNote;
        this.onSubmit = onSubmit;
        this.onCancel = onCancel;
        this.progressUnit = progressUnit;
        if (suggestedProgress !== null && suggestedProgress !== undefined) this.progressAdded = String(suggestedProgress);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        const lang = this.plugin.settings.language;
        
        // Use generic session finished title
        contentEl.createEl('h2', { text: t(lang, 'session_finished_title', this.currentProgress, '') });

        // Mode: Read/Watched Up To
        new Setting(contentEl)
            .setName(this.progressUnit
                ? (lang === 'ru' ? `Прогресс до (${this.progressUnit})` : `Progress up to (${this.progressUnit})`)
                : (t(lang, 'read_up_to_page') || 'Progress up to:'))
            .addText(text => {
                text.inputEl.type = 'number';
                text.setPlaceholder(String(this.currentProgress));
                text.onChange(value => {
                    if (value) {
                        const total = Number(value);
                        const delta = total - this.currentProgress;
                        if (delta >= 0) {
                            this.progressAdded = String(delta);
                            deltaInput.setValue(String(delta));
                        }
                    }
                });
            });

        // Mode: Delta
        let deltaInput: TextComponent;
        new Setting(contentEl)
            .setName(this.progressUnit
                ? (lang === 'ru' ? `За эту сессию (${this.progressUnit})` : `This session (${this.progressUnit})`)
                : (t(lang, 'pages_this_session') || 'Progress this session:'))
            .addText(text => {
                deltaInput = text;
                text.inputEl.type = 'number';
                text.setValue(this.progressAdded);
                text.onChange(value => this.progressAdded = value);
            });

        new Setting(contentEl)
            .setName(t(lang, 'session_notes_label'))
            .addTextArea(text => {
                text.setValue(this.sessionNote);
                text.onChange(value => this.sessionNote = value);
                text.inputEl.rows = 4;
                text.inputEl.cols = 25;
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t(lang, 'save_log_btn'))
                .setCta()
                .onClick(() => {
                    this.submitted = true;
                    const added = Number(this.progressAdded) || 0;
                    void this.onSubmit(added, this.sessionNote);
                    this.close();
                }));
    }

    onClose() {
        if (!this.submitted) this.onCancel?.();
        this.contentEl.empty();
    }
}

export class FinishMediaModal extends Modal {
    plugin: HabitTimerPlugin;
    mediaFile: TFile;
    rating: string = '10';
    reviewNote: string = '';
    onSubmit: (rating: string, review: string) => void | Promise<void>;

    constructor(app: App, plugin: HabitTimerPlugin, mediaFile: TFile, onSubmit: (rating: string, review: string) => void | Promise<void>) {
        super(app);
        this.plugin = plugin;
        this.mediaFile = mediaFile;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        const lang = this.plugin.settings.language;
        contentEl.createEl('h2', { text: t(lang, 'finish_book_title', this.mediaFile.basename) });

        new Setting(contentEl)
            .setName(t(lang, 'rating_label'))
            .setDesc(lang === 'ru' ? 'От 1 до 10; можно использовать + или -, например 7+ или -6' : 'From 1 to 10; modifiers are allowed, for example 7+ or -6')
            .addText(text => text
                .setValue(this.rating)
                .setPlaceholder('7+')
                .onChange(value => this.rating = value));

        new Setting(contentEl)
            .setName(t(lang, 'short_review_label'))
            .addTextArea(text => {
                text.onChange(value => this.reviewNote = value);
                text.inputEl.rows = 4;
                text.inputEl.cols = 25;
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t(lang, 'finish_btn'))
                .setCta()
                .onClick(() => {
                    const parsed = parseRating(this.rating);
                    if (!parsed) {
                        new Notice(lang === 'ru' ? 'Рейтинг должен быть от 1 до 10, например 7+' : 'Rating must be between 1 and 10, for example 7+');
                        return;
                    }
                    void this.onSubmit(parsed.label, this.reviewNote);
                    this.close();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MediaInteractionModal — Rich interaction panel for Library item cards
// ─────────────────────────────────────────────────────────────────────────────

interface SessionRow {
    date: string;
    time: string;
    pages: string;
    progress: string;
    notes: string;
}

export class MediaInteractionModal extends Modal {
    plugin: HabitTimerPlugin;
    item: MediaItem;
    private isEditMode = false;

    constructor(app: App, plugin: HabitTimerPlugin, item: MediaItem) {
        super(app);
        this.plugin = plugin;
        this.item = item;
        this.modalEl.addClass('ht-media-modal');
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ht-media-modal-content');

        const lang = this.plugin.settings.language;
        const item = this.item;
        const col = this.plugin.settings.mediaCollections.find(c => c.id === item.collectionId);
        const isFinished = col && item.status === col.finishedStatusName;
        const isReading = col && item.status === col.readingStatusName;
        const isPaused = col && item.status === col.pausedStatusName;
        const perc = item.total > 0 ? Math.min(100, Math.round((item.progress / item.total) * 100)) : 0;
        const pace = calculateMediaPace(item.progress, item.total, item.targetDate || '', moment().format('YYYY-MM-DD'));
        const itemUnit = normalizeDailyGoalUnit(item.unit, col ? collectionDailyGoalUnit(col) : 'units');
        const itemUnitLabel = dailyGoalUnitLabel(itemUnit, lang === 'ru' ? 'ru' : 'en');

        // ── HERO SECTION ─────────────────────────────────────────────────────
        const hero = contentEl.createDiv('ht-modal-hero');

        // Cover
        const coverEl = hero.createDiv('ht-modal-cover');
        if (item.cover) {
            coverEl.style.backgroundImage = `url('${item.cover}')`;
            coverEl.addClass('has-cover');
        } else {
            coverEl.createDiv('ht-modal-cover-placeholder').setText(item.title?.charAt(0)?.toUpperCase() || '?');
        }

        // Info panel
        const info = hero.createDiv('ht-modal-info');
        const titleEl = info.createEl('h2', { cls: 'ht-modal-title' });
        titleEl.setText(item.title || item.file.basename);

        const meta = info.createDiv('ht-modal-meta');
        if (item.authorOrDirector) meta.createEl('span', { text: `👤 ${item.authorOrDirector}`, cls: 'ht-modal-meta-tag' });
        if (item.genre) meta.createEl('span', { text: `🏷️ ${item.genre}`, cls: 'ht-modal-meta-tag' });
        if (item.series) meta.createEl('span', { text: `📚 ${item.series}`, cls: 'ht-modal-meta-tag' });
        if (item.rating) meta.createEl('span', { text: `⭐ ${item.rating}`, cls: 'ht-modal-meta-tag ht-rating' });

        const statusBadge = info.createEl('span', { cls: 'ht-modal-status-badge' });
        statusBadge.setText(item.status || 'Unknown');
        if (isFinished) statusBadge.addClass('badge-finished');
        else if (isReading) statusBadge.addClass('badge-reading');
        else if (isPaused) statusBadge.addClass('badge-paused');
        else statusBadge.addClass('badge-planned');

        // Progress bar
        if (item.total > 0) {
            const progWrap = info.createDiv('ht-modal-progress-wrap');
            const bar = progWrap.createDiv('ht-modal-progress-bar');
            const fill = bar.createDiv('ht-modal-progress-fill');
            fill.style.width = `${perc}%`;
            const progText = progWrap.createEl('span', { cls: 'ht-modal-progress-text' });
            progText.setText(`${item.progress} / ${item.total} ${itemUnitLabel} (${perc}%)`);
        }

        if (item.startDate) info.createEl('div', { text: `📅 Started: ${item.startDate}`, cls: 'ht-modal-date' });
        if (item.endDate) info.createEl('div', { text: `🏁 Finished: ${item.endDate}`, cls: 'ht-modal-date' });

        // ── ACTION BUTTONS ────────────────────────────────────────────────────
        if ((item.queueOrder || 0) > 0) info.createEl('div', { text: `${lang === 'ru' ? 'Очередь' : 'Queue'}: #${item.queueOrder}`, cls: 'ht-modal-date' });
        if (item.targetDate && pace) {
            const paceText = pace.overdue
                ? (lang === 'ru' ? `Цель ${item.targetDate} просрочена` : `Target ${item.targetDate} is overdue`)
                : (lang === 'ru'
                    ? `До ${item.targetDate}: ${pace.perDay} ${itemUnitLabel} в день`
                    : `Until ${item.targetDate}: ${pace.perDay} ${itemUnitLabel} per day`);
            info.createEl('div', { text: paceText, cls: `ht-modal-date${pace.overdue ? ' is-overdue' : ''}` });
        }

        const actions = contentEl.createDiv('ht-modal-actions');
        const setActionButtonContent = (button: HTMLButtonElement, icon: string, label: string): void => {
            button.createSpan({ cls: 'ht-btn-icon', text: icon });
            button.createSpan({ text: label });
        };

        // Open Note
        const btnNote = actions.createEl('button', { cls: 'ht-modal-btn ht-btn-secondary' });
        setActionButtonContent(btnNote, '📄', lang === 'ru' ? 'Открыть заметку' : 'Open Note');
        btnNote.onclick = () => {
            void this.app.workspace.getLeaf(false).openFile(item.file);
            this.close();
        };

        // Start Timer
        if (col && this.plugin.getTimerHabitForMedia(item)) {
            const btnTimer = actions.createEl('button', { cls: 'ht-modal-btn ht-btn-primary' });
            setActionButtonContent(btnTimer, '▶️', lang === 'ru' ? 'Запустить таймер' : 'Start Timer');
            btnTimer.onclick = () => void (async () => {
                if (await this.plugin.startTimerForMedia(item)) this.close();
            })();
        }

        if (col && (isReading || isPaused)) {
            const btnPause = actions.createEl('button', { cls: 'ht-modal-btn ht-btn-secondary' });
            setActionButtonContent(
                btnPause,
                isPaused ? '▶' : 'Ⅱ',
                isPaused
                    ? (lang === 'ru' ? 'Продолжить' : 'Resume')
                    : (lang === 'ru' ? 'Поставить на паузу' : 'Pause')
            );
            btnPause.onclick = () => void (async () => {
                await this.app.fileManager.processFrontMatter(item.file, frontmatter => {
                    writeProperty(
                        frontmatter as Frontmatter,
                        this.plugin.settings,
                        'status',
                        isPaused ? col.readingStatusName : (col.pausedStatusName || 'На паузе')
                    );
                });
                new Notice(isPaused
                    ? (lang === 'ru' ? `«${item.title}»: продолжено` : `Resumed “${item.title}”`)
                    : (lang === 'ru' ? `«${item.title}»: на паузе` : `Paused “${item.title}”`));
                this.close();
            })();
        }

        // Log Progress
        if (!isFinished) {
            const btnLog = actions.createEl('button', { cls: 'ht-modal-btn ht-btn-secondary' });
            setActionButtonContent(btnLog, '📝', lang === 'ru' ? 'Записать прогресс' : 'Log Progress');
            btnLog.onclick = () => {
                this.close();
                const unit = normalizeDailyGoalUnit(item.unit, col ? collectionDailyGoalUnit(col) : 'units');
                const unitLabel = dailyGoalUnitLabel(unit, lang === 'ru' ? 'ru' : 'en');
                new SaveMediaSessionModal(this.app, this.plugin, item.progress, 0, '', async (pagesAdded, note) => {
                    if (pagesAdded > 0 || note) {
                        let savedProgress = 0;
                        let newProgress = item.progress;
                        await this.app.fileManager.processFrontMatter(item.file, frontmatter => {
                            const fm = frontmatter as Frontmatter;
                            const current = readPropertyNumber(fm, this.plugin.settings, 'progress', item.progress);
                            newProgress = item.total > 0 ? Math.min(item.total, current + pagesAdded) : current + pagesAdded;
                            savedProgress = Math.max(0, newProgress - current);
                            writeProperty(fm, this.plugin.settings, 'progress', newProgress);
                            writeProperty(fm, this.plugin.settings, 'unit', unit);
                        });
                        const dateStr = moment().format('YYYY-MM-DD');
                        const timeStr = this.plugin.formatTime(0);
                        await this.app.vault.process(item.file, (d: string) => {
                            if (!d.includes('### 📖 Progress')) {
                                d += `\n\n---\n\n### 📖 Progress\n| Date | Time | Progress | % | Notes |\n|---|---|---|---|---|\n`;
                            }
                            const total = item.total > 0 ? item.total : '?';
                            const pct = item.total > 0 ? `${Math.round(newProgress / item.total * 100)}%` : '-';
                            const safeNote = (note || '-').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
                            return d + `| ${dateStr} | ${timeStr} | ${savedProgress} | (Total: ${newProgress}/${total} - ${pct}) | ${safeNote} |\n`;
                        });
                        new Notice(`✅ Progress saved: +${savedProgress} ${unitLabel}`);
                    }
                }, undefined, unitLabel).open();
            };
        }

        // Mark as Finished
        if (!isFinished) {
            const btnFinish = actions.createEl('button', { cls: 'ht-modal-btn ht-btn-success' });
            setActionButtonContent(btnFinish, '✅', lang === 'ru' ? 'Завершить' : 'Mark Finished');
            btnFinish.onclick = () => {
                this.close();
                new FinishMediaModal(this.app, this.plugin, item.file, async (rating, review) => {
                    await this.app.fileManager.processFrontMatter(item.file, frontmatter => {
                        const fm = frontmatter as Frontmatter;
                        if (col) writeProperty(fm, this.plugin.settings, 'status', col.finishedStatusName);
                        writeProperty(fm, this.plugin.settings, 'rating', rating);
                        const today = moment().format('YYYY-MM-DD');
                        if (!item.endDate) {
                            writeProperty(fm, this.plugin.settings, 'endDate', today);
                        }
                        if (review) fm['Review'] = review;
                    });
                    new Notice(`🎉 "${item.title}" marked as finished!`);
                }).open();
            };
        }

        // Edit Metadata
        const btnEdit = actions.createEl('button', { cls: 'ht-modal-btn ht-btn-ghost' });
        setActionButtonContent(btnEdit, '✏️', lang === 'ru' ? 'Редактировать' : 'Edit');
        btnEdit.onclick = () => this.renderEditSection(contentEl, item, col, lang);

        // ── SESSION HISTORY ───────────────────────────────────────────────────
        const historySection = contentEl.createDiv('ht-modal-history');
        historySection.createEl('div', { text: lang === 'ru' ? '📖 История сессий' : '📖 Session History', cls: 'ht-modal-section-title' });

        const sessions = await this.parseLastSessions(item.file, 5);
        if (sessions.length === 0) {
            historySection.createEl('div', {
                text: lang === 'ru' ? 'Нет записанных сессий' : 'No sessions logged yet',
                cls: 'ht-modal-empty'
            });
        } else {
            const table = historySection.createEl('table', { cls: 'ht-session-table' });
            const thead = table.createEl('thead');
            const hr = thead.createEl('tr');
            const historyUnit = dailyGoalUnitLabel(
                normalizeDailyGoalUnit(item.unit, col ? collectionDailyGoalUnit(col) : 'units'),
                lang === 'ru' ? 'ru' : 'en'
            );
            ['Date', 'Time', historyUnit, 'Total', 'Notes'].forEach(h => hr.createEl('th', { text: h }));
            const tbody = table.createEl('tbody');
            sessions.forEach(s => {
                const row = tbody.createEl('tr');
                row.createEl('td', { text: s.date });
                row.createEl('td', { text: s.time });
                row.createEl('td', { text: s.pages || '—' });
                row.createEl('td', { text: s.progress || '—' });
                row.createEl('td', { text: s.notes || '—' });
            });
        }
    }

    private renderEditSection(contentEl: HTMLElement, item: MediaItem, col: MediaCollectionConfig | undefined, lang: string) {
        // Remove existing edit section if any
        contentEl.querySelectorAll('.ht-edit-section').forEach(e => e.remove());

        const editSection = contentEl.createDiv('ht-edit-section');
        editSection.createEl('div', { text: lang === 'ru' ? '✏️ Редактирование' : '✏️ Edit Metadata', cls: 'ht-modal-section-title' });

        let newStatus = item.status || '';
        let newAuthors = [...item.authors];
        let newGenres = [...item.genres];
        let newSeries = item.series;
        let newUnit: MediaDailyGoalUnit = normalizeDailyGoalUnit(item.unit, col ? collectionDailyGoalUnit(col) : 'units');
        let newProgress = String(item.progress || 0);
        let newTotal = String(item.total || 0);
        let newRating = item.rating || '';
        let newStartDate = item.startDate || '';
        let newEndDate = item.endDate || '';
        let newQueueOrder = String(item.queueOrder || 0);
        let newTargetDate = item.targetDate || '';

        let libraryItems: MediaItem[] = [];
        const unsubscribe = this.plugin.stateManager.mediaItems.subscribe(value => { libraryItems = value; });
        unsubscribe();
        const addTagRow = (
            label: string,
            values: string[],
            suggestions: string[],
            maxItems: number | undefined,
            onChange: (values: string[]) => void
        ): void => {
            const row = editSection.createDiv('ht-edit-row ht-edit-tag-row');
            row.createEl('label', { text: label, cls: 'ht-edit-label' });
            createTagEditor(row, { values, suggestions, maxItems, ariaLabel: label, onChange });
        };
        addTagRow(lang === 'ru' ? 'Статус' : 'Status', [newStatus].filter(Boolean), [
            ...libraryItems.filter(value => value.collectionId === item.collectionId).map(value => value.status),
            col?.readingStatusName || '', col?.pausedStatusName || 'На паузе', col?.finishedStatusName || '', lang === 'ru' ? 'В планах' : 'Planned'
        ], 1, values => { newStatus = values[0] || ''; });
        addTagRow(lang === 'ru' ? 'Авторы' : 'Authors', newAuthors,
            libraryItems.flatMap(value => value.authors), undefined, values => { newAuthors = values; });
        addTagRow(lang === 'ru' ? 'Жанры' : 'Genres', newGenres,
            libraryItems.flatMap(value => value.genres), undefined, values => { newGenres = values; });
        addTagRow(lang === 'ru' ? 'Серия' : 'Series', [newSeries].filter(Boolean),
            libraryItems.map(value => value.series), 1, values => { newSeries = values[0] || ''; });

        // Progress
        const progRow = editSection.createDiv('ht-edit-row');
        progRow.createEl('label', { text: `${lang === 'ru' ? 'Прогресс' : 'Progress'} (${dailyGoalUnitLabel(newUnit, lang === 'ru' ? 'ru' : 'en')})`, cls: 'ht-edit-label' });
        const progInput = progRow.createEl('input', { cls: 'ht-edit-input', type: 'number' });
        progInput.value = newProgress;
        progInput.oninput = () => { newProgress = progInput.value; };

        // Total
        const totalRow = editSection.createDiv('ht-edit-row');
        totalRow.createEl('label', { text: `${lang === 'ru' ? 'Всего' : 'Total'} (${dailyGoalUnitLabel(newUnit, lang === 'ru' ? 'ru' : 'en')})`, cls: 'ht-edit-label' });
        const totalInput = totalRow.createEl('input', { cls: 'ht-edit-input', type: 'number' });
        totalInput.value = newTotal;
        totalInput.oninput = () => { newTotal = totalInput.value; };

        const unitRow = editSection.createDiv('ht-edit-row');
        unitRow.createEl('label', { text: lang === 'ru' ? 'Единица прогресса' : 'Progress unit', cls: 'ht-edit-label' });
        const unitSelect = unitRow.createEl('select', { cls: 'ht-edit-input' });
        DAILY_GOAL_UNITS.forEach(unit => {
            const option = unitSelect.createEl('option', {
                text: dailyGoalUnitLabel(unit, lang === 'ru' ? 'ru' : 'en'),
                value: unit
            });
            option.selected = unit === newUnit;
        });
        unitSelect.onchange = () => { newUnit = normalizeDailyGoalUnit(unitSelect.value); };

        // Rating
        const ratingRow = editSection.createDiv('ht-edit-row');
        ratingRow.createEl('label', { text: 'Rating', cls: 'ht-edit-label' });
        const ratingInput = ratingRow.createEl('input', { cls: 'ht-edit-input' });
        ratingInput.value = newRating;
        ratingInput.placeholder = '7+';
        ratingInput.oninput = () => { newRating = ratingInput.value; };

        // Start Date
        const startRow = editSection.createDiv('ht-edit-row');
        startRow.createEl('label', { text: 'Start Date', cls: 'ht-edit-label' });
        const startInput = startRow.createEl('input', { cls: 'ht-edit-input', type: 'date' });
        startInput.value = newStartDate;
        startInput.oninput = () => { newStartDate = startInput.value; };

        // End Date
        const endRow = editSection.createDiv('ht-edit-row');
        endRow.createEl('label', { text: 'End Date', cls: 'ht-edit-label' });
        const endInput = endRow.createEl('input', { cls: 'ht-edit-input', type: 'date' });
        endInput.value = newEndDate;
        endInput.oninput = () => { newEndDate = endInput.value; };

        const queueRow = editSection.createDiv('ht-edit-row');
        queueRow.createEl('label', { text: lang === 'ru' ? 'Порядок в очереди' : 'Queue order', cls: 'ht-edit-label' });
        const queueInput = queueRow.createEl('input', { cls: 'ht-edit-input', type: 'number' });
        queueInput.min = '0';
        queueInput.value = newQueueOrder;
        queueInput.oninput = () => { newQueueOrder = queueInput.value; };

        const targetRow = editSection.createDiv('ht-edit-row');
        targetRow.createEl('label', { text: lang === 'ru' ? 'Цель завершения' : 'Target date', cls: 'ht-edit-label' });
        const targetInput = targetRow.createEl('input', { cls: 'ht-edit-input', type: 'date' });
        targetInput.value = newTargetDate;
        targetInput.oninput = () => { newTargetDate = targetInput.value; };

        // Save button
        const saveBtnRow = editSection.createDiv('ht-edit-row');
        saveBtnRow.addClass('ht-edit-row-end');
        const saveBtn = saveBtnRow.createEl('button', { text: lang === 'ru' ? '💾 Сохранить' : '💾 Save', cls: 'ht-modal-btn ht-btn-primary' });
        saveBtn.onclick = async () => {
            if (newRating && !parseRating(newRating)) {
                new Notice(lang === 'ru' ? 'Рейтинг должен быть от 1 до 10, например 7+' : 'Rating must be between 1 and 10, for example 7+');
                return;
            }
            await this.app.fileManager.processFrontMatter(item.file, frontmatter => {
                const fm = frontmatter as Frontmatter;
                writeProperty(fm, this.plugin.settings, 'status', newStatus);
                writeProperty(fm, this.plugin.settings, 'author', newAuthors);
                writeProperty(fm, this.plugin.settings, 'genre', newGenres);
                writeProperty(fm, this.plugin.settings, 'series', newSeries);
                writeProperty(fm, this.plugin.settings, 'unit', newUnit);
                if (newProgress !== '') writeProperty(fm, this.plugin.settings, 'progress', Number(newProgress));
                if (newTotal !== '') writeProperty(fm, this.plugin.settings, 'total', Number(newTotal));
                if (newRating) writeProperty(fm, this.plugin.settings, 'rating', newRating.trim().replace(',', '.'));
                if (newStartDate) writeProperty(fm, this.plugin.settings, 'startDate', newStartDate);
                if (newEndDate) writeProperty(fm, this.plugin.settings, 'endDate', newEndDate);
                writeProperty(fm, this.plugin.settings, 'queueOrder', Math.max(0, Number(newQueueOrder) || 0));
                writeProperty(fm, this.plugin.settings, 'targetDate', newTargetDate);
            });
            new Notice(`✅ "${item.title}" updated!`);
            this.close();
        };
    }

    private async parseLastSessions(file: TFile, limit: number): Promise<SessionRow[]> {
        const rows: SessionRow[] = [];
        try {
            const content = await this.app.vault.read(file);
            const tableMatch = content.match(/###\s+📖\s+Progress\s*\n([\s\S]*?)(?:\n#{1,3}\s|\n---|$)/);
            if (!tableMatch) return rows;
            const tableBlock = tableMatch[1];
            if (!tableBlock) return rows;
            const lines = tableBlock.split('\n').filter(l => l.trim().startsWith('|'));
            const dataLines = lines.filter(l => !l.includes('---') && !l.toLowerCase().includes('date |'));
            const recent = dataLines.slice(-limit).reverse();
            for (const line of recent) {
                const cols = line.split('|').map(c => c.trim()).filter((_, i) => i > 0 && _ !== '');
                if (cols.length >= 2) {
                    rows.push({ date: cols[0] || '', time: cols[1] || '', pages: cols[2] || '', progress: cols[3] || '', notes: cols[4] || '' });
                }
            }
        } catch { /* silently ignore */ }
        return rows;
    }

    onClose() {
        this.contentEl.empty();
    }
}
