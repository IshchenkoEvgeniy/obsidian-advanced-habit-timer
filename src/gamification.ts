import { App, moment } from 'obsidian';
import { parseDuration, getDailyNotes, SESSION_ROW_REGEX, getObject } from './utils';
import { t } from './i18n';
import type { Language } from './i18n';
import type { HabitTimerSettings, HabitProperty, MediaCollectionConfig } from './types';
import type { Frontmatter } from './utils/frontmatter';
import { readPropertyNumber, readPropertyString, readPropertyStrings } from './library/property-schema';
import { evaluateHabitState, readHabitExplicitState, statePreservesStreak } from './habits/goals';
import { getHabitValueFromFrontmatter } from './services/habit-service';

export interface Achievement {
    id: string; title: string; desc: string; icon: string; rank: number; count: number; repeatable: boolean;
}

type MomentInstance = ReturnType<typeof moment>;

export class GamificationEngine {
    constructor(
        public app: App,
        public dailyNotesFolder: string,
        public mediaCollections: MediaCollectionConfig[],
        public lang: string,
        public properties: HabitProperty[],
        public settings: HabitTimerSettings
    ) {}

    getRankName(level: number): string {
        const l = this.lang as Language;
        if (level < 10) return t(l, 'rank_novice') || "Novice";
        if (level < 50) return t(l, 'rank_adept') || "Adept";
        if (level < 100) return t(l, 'rank_expert') || "Expert";
        return t(l, 'rank_master') || "Master";
    }

    async checkAchievements(): Promise<Achievement[]> {
        const l = this.lang as Language;
        const achievements: Achievement[] = [
            { id: 'first', title: t(l, 'ach_first_title') || 'First Steps', desc: t(l, 'ach_first_desc') || 'Complete your first habit.', icon: '🎯', rank: 1, count: 0, repeatable: false },
            { id: 'early', title: t(l, 'ach_early_title') || 'Early Bird', desc: t(l, 'ach_early_desc') || 'Complete a habit before 7 AM.', icon: '🌅', rank: 2, count: 0, repeatable: true },
            { id: 'owl', title: t(l, 'ach_owl_title') || 'Night Owl', desc: t(l, 'ach_owl_desc') || 'Complete a habit after 11 PM.', icon: '🦉', rank: 2, count: 0, repeatable: true },
            { id: 'deep', title: t(l, 'ach_deep_title') || 'Deep Worker', desc: t(l, 'ach_deep_desc') || 'Log 4+ hours on a single habit in one day.', icon: '🧠', rank: 3, count: 0, repeatable: true },
            { id: 'pomodoro_fan', title: t(l, 'ach_pomodoro_title') || 'Pomodoro Fanatic', desc: t(l, 'ach_pomodoro_desc') || 'Complete 5 sessions in one day.', icon: '🍅', rank: 2, count: 0, repeatable: true },
            { id: 'multi', title: t(l, 'ach_multi_title') || 'Multi-Tasker', desc: t(l, 'ach_multi_desc') || 'Complete 3 different habits in one day.', icon: '🤹', rank: 2, count: 0, repeatable: true },
            { id: 'marathon_7', title: t(l, 'ach_marathon7_title') || '7-Day Streak', desc: t(l, 'ach_marathon7_desc') || 'Maintain a 7-day streak.', icon: '🔥', rank: 2, count: 0, repeatable: true },
            { id: 'marathon_30', title: t(l, 'ach_marathon30_title') || '30-Day Streak', desc: t(l, 'ach_marathon30_desc') || 'Maintain a 30-day streak.', icon: '🔥', rank: 3, count: 0, repeatable: true },
            { id: 'marathon_100', title: t(l, 'ach_marathon100_title') || '100-Day Streak', desc: t(l, 'ach_marathon100_desc') || 'Maintain a 100-day streak.', icon: '🔥', rank: 4, count: 0, repeatable: true },
            { id: 'marathon_365', title: t(l, 'ach_marathon365_title') || 'Year Streak', desc: t(l, 'ach_marathon365_desc') || 'Maintain a 365-day streak.', icon: '🔥', rank: 5, count: 0, repeatable: true },
            { id: 'workaholic', title: t(l, 'ach_workaholic_title') || 'Workaholic', desc: t(l, 'ach_workaholic_desc') || 'Log 10+ hours on a habit in one week.', icon: '👔', rank: 3, count: 0, repeatable: true },
            { id: 'god_mode', title: t(l, 'ach_godmode_title') || 'God Mode', desc: t(l, 'ach_godmode_desc') || 'Log 50+ hours across all habits in one week.', icon: '⚡', rank: 5, count: 0, repeatable: true },
            { id: 'book_marathon', title: t(l, 'ach_book_marathon_title') || 'Book Marathon', desc: t(l, 'ach_book_marathon_desc') || 'Finish a book over 1000 pages.', icon: '📚', rank: 4, count: 0, repeatable: true },
            { id: 'book_binge', title: t(l, 'ach_book_binge_title') || 'Book Binge', desc: t(l, 'ach_book_binge_desc') || 'Read 7 days in a row.', icon: '📖', rank: 3, count: 0, repeatable: true },
            { id: 'book_diverse', title: t(l, 'ach_book_diverse_title') || 'Diverse Reader', desc: t(l, 'ach_book_diverse_desc') || 'Read books from 5 different genres.', icon: '🌈', rank: 3, count: 0, repeatable: false },
            { id: 'book_sprinter', title: t(l, 'ach_book_sprinter_title') || 'Book Sprinter', desc: t(l, 'ach_book_sprinter_desc') || 'Finish a book in under 48 hours.', icon: '🏃', rank: 4, count: 0, repeatable: true },
        ];

        const files = getDailyNotes(this.app, this.dailyNotesFolder);
        
        const datesWithSessions = new Set<string>();
        const dailySessionsCount: Record<string, number> = {};
        const dailyHabits: Record<string, Set<string>> = {};
        const habitWeeklyTime: Record<string, Record<string, number>> = {};
        const weeklyTotalTime: Record<string, number> = {};

        let totalEarly = 0;
        let totalOwl = 0;
        let totalDeep = 0;
        let totalFirst = 0;

        for (const file of files) {
            const content = await this.app.vault.cachedRead(file);
            const lines = content.split('\n');
            const date = file.basename;

            // Process table rows for timer habits
            for (const line of lines) {
                const m = line.match(SESSION_ROW_REGEX);
                if (m && m[1] && m[2] && m[3]) {
                    totalFirst = 1;

                    const startHour = parseInt(m[1]);
                    const rawHabit = m[2].trim();
                    const parts = rawHabit.split(':');
                    const habitName = (parts[0] || rawHabit).trim();
                    const durationStr = m[3];
                    
                    dailySessionsCount[date] = (dailySessionsCount[date] || 0) + 1;
                    
                    if (!dailyHabits[date]) dailyHabits[date] = new Set();
                    dailyHabits[date].add(habitName);

                    if (startHour >= 4 && startHour < 7) totalEarly++;
                    if (startHour >= 23 || startHour < 3) totalOwl++;

                    const sec = parseDuration(durationStr);
                    if (sec >= 14400) totalDeep++;

                    datesWithSessions.add(date);
                    
                    const weekStr = moment(date, "YYYY-MM-DD").format('YYYY-ww');
                    if (!habitWeeklyTime[habitName]) habitWeeklyTime[habitName] = {};
                    habitWeeklyTime[habitName][weekStr] = (habitWeeklyTime[habitName][weekStr] || 0) + sec;
                    weeklyTotalTime[weekStr] = (weeklyTotalTime[weekStr] || 0) + sec;
                }
            }

            // Process frontmatter for count, binary, and negative habits
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter && this.properties) {
                const fm = getObject(cache.frontmatter);
                for (const prop of this.properties) {
                    const type = prop.type || 'timer';
                    if (type === 'timer') continue; // Handled by table rows
                    
                    const createdAt = prop.createdAt || '0000-00-00';
                    const value = getHabitValueFromFrontmatter(fm, prop);
                    const state = evaluateHabitState(prop, value, date, readHabitExplicitState(fm, prop.name));
                    const success = date >= createdAt && statePreservesStreak(state);

                    if (success) {
                        totalFirst = 1;
                        dailySessionsCount[date] = (dailySessionsCount[date] || 0) + 1;
                        if (!dailyHabits[date]) dailyHabits[date] = new Set();
                        dailyHabits[date].add(prop.name);
                        datesWithSessions.add(date);
                    }
                }
            }
        }

        const getAch = (id: string) => achievements.find(a => a.id === id);

        const aFirst = getAch('first'); if(aFirst) aFirst.count = totalFirst;
        const aEarly = getAch('early'); if(aEarly) aEarly.count = totalEarly;
        const aOwl = getAch('owl'); if(aOwl) aOwl.count = totalOwl;
        const aDeep = getAch('deep'); if(aDeep) aDeep.count = totalDeep;

        let totalPomoFans = 0;
        for (const date in dailySessionsCount) {
            if ((dailySessionsCount[date] || 0) >= 5) totalPomoFans++;
        }
        const aPomo = getAch('pomodoro_fan'); if(aPomo) aPomo.count = totalPomoFans;

        let totalMulti = 0;
        for (const date in dailyHabits) {
            if ((dailyHabits[date]?.size || 0) >= 3) totalMulti++;
        }
        const aMulti = getAch('multi'); if(aMulti) aMulti.count = totalMulti;

        const sortedDates = Array.from(datesWithSessions).sort();
        let currentStreak = 0;
        let prevDate: MomentInstance | null = null;

        let count7 = 0;
        let count30 = 0;
        let count100 = 0;
        let count365 = 0;

        for (const d of sortedDates) {
            const curr = moment(d, "YYYY-MM-DD");
            if (!prevDate) { 
                currentStreak = 1; 
            } else if (curr.diff(prevDate, 'days') === 1) { 
                currentStreak++; 
            } else { 
                currentStreak = 1; 
            }
            prevDate = curr;

            if (currentStreak > 0 && currentStreak % 7 === 0) count7++;
            if (currentStreak > 0 && currentStreak % 30 === 0) count30++;
            if (currentStreak > 0 && currentStreak % 100 === 0) count100++;
            if (currentStreak > 0 && currentStreak % 365 === 0) count365++;
        }
        const aM7 = getAch('marathon_7'); if(aM7) aM7.count = count7;
        const aM30 = getAch('marathon_30'); if(aM30) aM30.count = count30;
        const aM100 = getAch('marathon_100'); if(aM100) aM100.count = count100;
        const aM365 = getAch('marathon_365'); if(aM365) aM365.count = count365;

        let totalWorkaholic = 0;
        for (const habit in habitWeeklyTime) {
            for (const week in habitWeeklyTime[habit]) {
                if ((habitWeeklyTime[habit][week] || 0) >= 36000) totalWorkaholic++;
            }
        }
        const aWork = getAch('workaholic'); if(aWork) aWork.count = totalWorkaholic;

        let totalGodMode = 0;
        for (const week in weeklyTotalTime) {
            if ((weeklyTotalTime[week] || 0) >= 180000) totalGodMode++;
        }
        const aGod = getAch('god_mode'); if(aGod) aGod.count = totalGodMode;

        const bookFiles = this.app.vault.getMarkdownFiles().filter(f => {
            let inMediaFolder = false;
            for (const col of this.mediaCollections) {
                if (col.enabled && col.folder && f.path.startsWith(col.folder)) {
                    inMediaFolder = true;
                    break;
                }
            }
            if (!inMediaFolder) return false;
            const cache = this.app.metadataCache.getFileCache(f);
            const fm = getObject(cache?.frontmatter) as Frontmatter;
            return Boolean(readPropertyString(fm, this.settings, 'title'));
        });
        
        let countBookMarathon = 0;
        let countBookSprinter = 0;
        const readGenres = new Set<string>();
        let countBinge = 0;

        for (const bFile of bookFiles) {
            const cache = this.app.metadataCache.getFileCache(bFile);
            const fm = getObject(cache?.frontmatter) as Frontmatter;
            if (!readPropertyString(fm, this.settings, 'title')) continue;
            
            const collection = this.mediaCollections.find(collection =>
                collection.enabled && collection.folder && bFile.path.startsWith(collection.folder)
            );
            const isFinished = Boolean(collection &&
                readPropertyString(fm, this.settings, 'status') === collection.finishedStatusName);
            
            if (isFinished && readPropertyNumber(fm, this.settings, 'total') >= 1000) {
                countBookMarathon++;
            }
            
            if (isFinished) {
                readPropertyStrings(fm, this.settings, 'genre').forEach(genre => readGenres.add(genre));
            }

            const content = await this.app.vault.cachedRead(bFile);
            const lines = content.split('\n');
            const datesRead: string[] = [];
            for (const line of lines) {
                if (line.startsWith('|')) {
                    const parts = line.split('|');
                    const p1 = parts[1];
                    if (parts.length > 2 && p1 && p1.trim().match(/^\d{4}-\d{2}-\d{2}$/)) {
                        datesRead.push(p1.trim());
                    }
                }
            }
            
            if (datesRead.length > 0) {
                datesRead.sort();
                
                let bStreak = 0;
                let bPrev: MomentInstance | null = null;
                for (const d of datesRead) {
                    const curr = moment(d, "YYYY-MM-DD");
                    if (!bPrev) { bStreak = 1; }
                    else if (curr.diff(bPrev, 'days') === 1) { bStreak++; }
                    else if (curr.diff(bPrev, 'days') > 1) { bStreak = 1; }
                    bPrev = curr;
                    if (bStreak === 7) { countBinge++; bStreak = 0; }
                }
                
                if (isFinished) {
                    const firstRead = moment(datesRead[0], "YYYY-MM-DD");
                    const lastRead = moment(datesRead[datesRead.length - 1], "YYYY-MM-DD");
                    if (lastRead.diff(firstRead, 'hours') < 48) {
                        countBookSprinter++;
                    }
                }
            }
        }

        const aMarathon = getAch('book_marathon'); if(aMarathon) aMarathon.count = countBookMarathon;
        const aBinge = getAch('book_binge'); if(aBinge) aBinge.count = countBinge;
        const aDiverse = getAch('book_diverse'); if(aDiverse) aDiverse.count = readGenres.size >= 5 ? 1 : 0;
        const aSprinter = getAch('book_sprinter'); if(aSprinter) aSprinter.count = countBookSprinter;

        return achievements;
    }

    async renderGamificationTab(container: HTMLElement, habitTotalsSec: Record<string, number>, globalTotalSec: number) {
        container.empty();

        const globalHours = globalTotalSec / 3600;
        const globalLevel = Math.floor(globalHours / 100);
        const globalRemHours = globalHours % 100;
        const globalPerc = (globalRemHours / 100) * 100;

        const globalCard = container.createDiv({ cls: "gami-global-card" });
        globalCard.createDiv({ text: t(this.lang as Language, 'global_level_title') || 'Global Level', cls: "gami-global-title" });
        globalCard.createDiv({ text: `Level ${globalLevel}`, cls: "gami-global-level" });
        
        const gBg = globalCard.createDiv({ cls: "gami-progress-bg" });
        const gFill = gBg.createDiv({ cls: "gami-progress-fill" });
        gFill.setCssStyles({ width: `${globalPerc}%` });
        globalCard.createDiv({ text: `${Math.floor(globalRemHours)} / 100 hours`, cls: "gami-progress-text" });

        const h3Habits = container.createEl("h3", { text: "Habit Ranks" });
        h3Habits.setCssStyles({ color: "#89b4fa", borderBottom: "1px solid #313244", paddingBottom: "5px" });
        
        const grid = container.createDiv({ cls: "gami-habit-grid" });

        for (const [habit, sec] of Object.entries(habitTotalsSec)) {
            const hours = sec / 3600;
            const level = Math.floor(hours / 10);
            const remHours = hours % 10;
            const perc = (remHours / 10) * 100;

            const card = grid.createDiv({ cls: "gami-habit-card" });
            const head = card.createDiv({ cls: "gami-habit-header" });
            head.createDiv({ text: habit, cls: "gami-habit-name" });
            head.createDiv({ text: this.getRankName(level), cls: "gami-habit-rank" });

            card.createDiv({ text: `Lvl ${level}`, cls: "gami-habit-lvl" });
            
            const pBg = card.createDiv({ cls: "gami-progress-bg" });
            pBg.setCssStyles({ height: "8px" });
            const pFill = pBg.createDiv({ cls: "gami-habit-fill" });
            pFill.setCssStyles({ width: `${perc}%` });
            card.createDiv({ text: `${Math.floor(remHours)} / 10 points`, cls: "gami-progress-text" });
        }

        const h3Ach = container.createEl("h3", { text: "Achievements" });
        h3Ach.setCssStyles({ color: "#f9e2af", borderBottom: "1px solid #313244", paddingBottom: "5px", marginTop: "10px" });
        
        const achGrid = container.createDiv({ cls: "gami-achievements-grid" });
        const loading = achGrid.createDiv({ text: "Looking for achievements in logs..." });
        loading.setCssStyles({ color: "#a6adc8" });

        let achievements: Achievement[] = [];
        try {
            achievements = await this.checkAchievements();
        } catch (e) {
            console.error("HabitTimer: Failed to check achievements", e);
            loading.setText("Error loading achievements.");
            return;
        }
        loading.remove();

        achievements.forEach(ach => {
            const isUnlocked = ach.count > 0;
            const achCard = achGrid.createDiv({ cls: `achievement-card ${isUnlocked ? 'unlocked' : 'locked'} rank-${ach.rank}` });
            achCard.createDiv({ text: ach.icon, cls: "achievement-icon" });
            achCard.createDiv({ text: ach.title, cls: "achievement-title" });
            achCard.createDiv({ text: ach.desc, cls: "achievement-desc" });
            
            if (isUnlocked && ach.repeatable && ach.count > 1) {
                achCard.createDiv({ text: `x${ach.count}`, cls: "achievement-count" });
            } else if (isUnlocked && !ach.repeatable) {
                achCard.createDiv({ text: "✓", cls: "achievement-count achievement-done" });
            }
        });
    }
}
