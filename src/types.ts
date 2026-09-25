import type { Language } from './i18n';
import type { ProjectScopeDefinition } from './projects/types';
export type { ProjectScopeDefinition };

export type MediaType = string;
export type MediaDailyGoalUnit = 'pages' | 'items' | 'episodes' | 'chapters' | 'minutes' | 'hours' | 'lessons' | 'units';

export type LibraryPropertyField =
    | 'title' | 'author' | 'genre' | 'series' | 'seriesIndex'
    | 'status' | 'total' | 'progress' | 'rating' | 'cover'
    | 'format' | 'libraryType' | 'startDate' | 'endDate'
    | 'season' | 'episode' | 'queueOrder' | 'targetDate' | 'unit';

export type LibraryPropertyAliases = Record<LibraryPropertyField, string[]>;

export const DEFAULT_LIBRARY_PROPERTY_ALIASES: LibraryPropertyAliases = {
    title: ['Title', 'NameBook', 'Название'],
    author: ['Author', 'Authors', 'Автор', 'Авторы', 'Director', 'Режиссер', 'Режиссёр', 'Studio'],
    genre: ['Genre', 'Genres', 'Жанр', 'Жанры'],
    series: ['Series', 'Серия'],
    seriesIndex: ['Series Index', 'Part', 'Volume', 'Номер части'],
    status: ['Status', 'Статус'],
    total: ['Total', 'Pages', 'Duration', 'Всего'],
    progress: ['Progress', 'Read Pages', 'Listened', 'Прогресс'],
    rating: ['Rating', 'Рейтинг', 'Оценка'],
    cover: ['Cover', 'Обложка'],
    format: ['Format', 'Book type', 'Book Type', 'Media format', 'Type'],
    libraryType: ['Library type', 'Library Type', 'Тип библиотеки'],
    startDate: ['Start Date', 'Дата начала', 'Start', 'Start date of readings'],
    endDate: ['End Date', 'Дата завершения', 'End', 'End date of readings'],
    season: ['Season', 'Сезон'],
    episode: ['Episode', 'Эпизод', 'Серия эпизода'],
    queueOrder: ['Queue Order', 'Reading Order', 'Порядок чтения', 'Очередь'],
    targetDate: ['Target Date', 'Finish Target', 'Дата цели', 'Цель завершения'],
    unit: ['Unit', 'Progress Unit', 'Единица', 'Единица прогресса']
};

export interface MediaCollectionConfig {
    id: string;
    icon?: string;
    enabled: boolean;
    folder: string;
    templatePath: string;
    readingStatusName: string;
    pausedStatusName?: string;
    finishedStatusName: string;
    targetHabit?: string;
    dailyGoalEnabled?: boolean;
    dailyGoal?: number;
    dailyGoalUnit?: MediaDailyGoalUnit;
}

export interface HabitProperty {
    autoDailyTask?: boolean;
    /** Stable integration ID. Added lazily for settings created before API V1. */
    id?: string;
    name: string;
    goalMinutes: number;
    globalGoalHours: number;
    musicFolder?: string;
    subTasks?: string[];
    mediaCollections?: string[];
    type?: 'timer' | 'binary' | 'negative' | 'count';
    goalCount?: number;
    createdAt?: string;
    goalMode?: 'daily' | 'weekly';
    minimumGoalMinutes?: number;
    minimumGoalCount?: number;
    weeklyGoalMinutes?: number;
    weeklyGoalCount?: number;
    dailyGoals?: Partial<Record<WeekdayKey, number>>;
    progressiveGoal?: {
        enabled: boolean;
        step: number;
        everyWeeks: number;
        max?: number;
        startDate?: string;
    };
}

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type HabitExplicitState = 'completed' | 'partial' | 'skipped' | 'excused' | 'deferred';
export type HabitDayState = HabitExplicitState | 'pending' | 'missed';

export interface HabitTimerSettings {
    properties: HabitProperty[];
    pomodoroDuration: number;
    dailyNotesFolder: string;
    globalMusicFolder: string;
    globalMusicStreamUrl: string;
    activeMusicSource: string;
    theme: string;
    mediaCollections: MediaCollectionConfig[];
    dailyPagesGoal: number;
    libraryZoom: number;
    libraryShowAuthor?: boolean;
    libraryShowRating?: boolean;
    libraryShowProgress?: boolean;
    libraryShowSeries?: boolean;
    libraryShowGenre?: boolean;
    libraryYearGoal?: number;
    libraryPropertyAliases: LibraryPropertyAliases;
    language: Language;
    heatmapDays: number;
    heatmapCellSize: 's' | 'm' | 'l';
    heatmapGroupByMonth: boolean;
    projectsFolder: string;
    projectsStatuses: string;
    activeTimer?: {
        path: string;
        habitName: string;
        subTask?: string;
        mode: 'pm' | 'timer';
        startTime: string;
        bookPath?: string;
        taskName?: string;
        isSingleFileTask?: boolean;
        timerState?: 'running' | 'paused';
        elapsedSeconds?: number;
        remainingSeconds?: number;
        lastStartedAt?: number;
        targetSeconds?: number;
        source?: 'obsidian' | 'telegram';
    };
    telegramBotToken: string;
    telegramChatId: string;
    telegramMorningEnabled: boolean;
    telegramMorningTime: string;
    telegramEveningEnabled: boolean;
    telegramEveningTime: string;
    telegramLiveNotifications: boolean;
    telegramWeeklyReport: boolean;
    telegramLastMorningDate: string;
    telegramLastEveningDate: string;
    telegramLastWeeklyDate: string;
    telegramLastUpdateId?: number;
    telegramMode?: 'obsidian' | 'cloudflare';
    cloudflareWorkerUrl?: string;
    cloudflareProjectKeys?: Record<string, string>;
    cloudflareApiToken?: string;
    cloudflareTimezone?: string;
    cloudflareSyncIntervalSec?: number;
    cloudflareSyncCursor?: number;
    cloudflareAppliedEventIds?: string[];
    cloudflareLastSyncAt?: number;
    cloudflareLastSyncError?: string;
    cloudflareLibrarySyncHash?: string;
    cloudflareLibraryLastPushAt?: number;
    cloudflareProjectsSyncHash?: string;
    cloudflareProjectsLastPushAt?: number;
    projectScopes: ProjectScopeDefinition[];
    projShowCover?: boolean;
    projShowTags?: boolean;
    projShowSubtasks?: boolean;
    projShowDates?: boolean;
    projShowPriority?: boolean;
    projShowEstimates?: boolean;
}

export const DEFAULT_SETTINGS: HabitTimerSettings = {
    properties: [
        { id: 'habit-programming', name: 'Habit-Programming', goalMinutes: 120, globalGoalHours: 1000 },
        { id: 'habit-english', name: 'Habit-English', goalMinutes: 60, globalGoalHours: 300 }
    ],
    pomodoroDuration: 25,
    dailyNotesFolder: '',
    globalMusicFolder: '',
    globalMusicStreamUrl: '',
    activeMusicSource: 'none',
    theme: 'habit-theme-modern-dark',
    mediaCollections: [
        {
            id: 'book',
            enabled: true,
            folder: 'DataBases/Book',
            templatePath: 'Разное/Шаблоны/Book.md',
            readingStatusName: 'Чтение',
            pausedStatusName: 'На паузе',
            finishedStatusName: 'Прочитано',
            dailyGoalEnabled: true,
            dailyGoal: 10,
            dailyGoalUnit: 'pages'
        },
        {
            id: 'manga',
            enabled: true,
            folder: 'DataBases/Manga',
            templatePath: 'Разное/Шаблоны/Manga.md',
            readingStatusName: 'Чтение',
            pausedStatusName: 'На паузе',
            finishedStatusName: 'Прочитано',
            dailyGoalEnabled: true,
            dailyGoal: 1,
            dailyGoalUnit: 'chapters'
        },
        {
            id: 'film',
            enabled: true,
            folder: 'DataBases/Film',
            templatePath: 'Разное/Шаблоны/Film.md',
            readingStatusName: 'Смотрю',
            pausedStatusName: 'На паузе',
            finishedStatusName: 'Просмотрено',
            dailyGoalEnabled: true,
            dailyGoal: 1,
            dailyGoalUnit: 'items'
        },
        {
            id: 'anime',
            enabled: true,
            folder: 'DataBases/Anime',
            templatePath: 'Разное/Шаблоны/Anime.md',
            readingStatusName: 'Смотрю',
            pausedStatusName: 'На паузе',
            finishedStatusName: 'Просмотрено',
            dailyGoalEnabled: true,
            dailyGoal: 1,
            dailyGoalUnit: 'episodes'
        },
        {
            id: 'series',
            enabled: true,
            folder: 'DataBases/Series',
            templatePath: 'Разное/Шаблоны/Series.md',
            readingStatusName: 'Смотрю',
            pausedStatusName: 'На паузе',
            finishedStatusName: 'Просмотрено',
            dailyGoalEnabled: true,
            dailyGoal: 1,
            dailyGoalUnit: 'episodes'
        },
        {
            id: 'game',
            enabled: true,
            folder: 'DataBases/Game',
            templatePath: 'Разное/Шаблоны/Game.md',
            readingStatusName: 'Играю',
            pausedStatusName: 'На паузе',
            finishedStatusName: 'Пройдено',
            dailyGoalEnabled: true,
            dailyGoal: 1,
            dailyGoalUnit: 'hours'
        },
        {
            id: 'course',
            enabled: true,
            folder: 'DataBases/Course',
            templatePath: 'Разное/Шаблоны/Course.md',
            readingStatusName: 'Изучаю',
            pausedStatusName: 'На паузе',
            finishedStatusName: 'Пройдено',
            dailyGoalEnabled: true,
            dailyGoal: 1,
            dailyGoalUnit: 'lessons'
        }
    ],
    dailyPagesGoal: 10,
    libraryZoom: 1,
    libraryShowAuthor: true,
    libraryShowRating: true,
    libraryShowProgress: true,
    libraryShowSeries: true,
    libraryShowGenre: true,
    libraryYearGoal: 12,
    libraryPropertyAliases: DEFAULT_LIBRARY_PROPERTY_ALIASES,
    language: 'en',
    heatmapDays: 90,
    heatmapCellSize: 'm',
    heatmapGroupByMonth: false,
    projectsFolder: '',
    projectsStatuses: 'Backlog, To Do, In Progress, Done',
    activeTimer: undefined,
    telegramBotToken: '',
    telegramChatId: '',
    telegramMorningEnabled: false,
    telegramMorningTime: '08:00',
    telegramEveningEnabled: false,
    telegramEveningTime: '22:00',
    telegramLiveNotifications: false,
    telegramWeeklyReport: false,
    telegramLastMorningDate: '',
    telegramLastEveningDate: '',
    telegramLastWeeklyDate: '',
    telegramLastUpdateId: 0,
    telegramMode: 'obsidian',
    cloudflareWorkerUrl: '',
    cloudflareApiToken: '',
    cloudflareTimezone: 'Europe/Kyiv',
    cloudflareSyncIntervalSec: 60,
    cloudflareSyncCursor: 0,
    cloudflareAppliedEventIds: [],
    cloudflareLastSyncAt: 0,
    cloudflareLastSyncError: '',
    cloudflareLibrarySyncHash: '',
    cloudflareLibraryLastPushAt: 0,
    cloudflareProjectsSyncHash: '',
    cloudflareProjectsLastPushAt: 0,
    projectScopes: [],
    projShowCover: true,
    projShowTags: true,
    projShowSubtasks: true,
    projShowDates: true,
    projShowPriority: true,
    projShowEstimates: true,
};
