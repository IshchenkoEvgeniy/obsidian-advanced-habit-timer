import { moment, requestUrl } from 'obsidian';
import { taskNotificationSummary } from '../tasks/notification-summary';
import { formatDurationShort, getDailyNotes, isHabitMet } from '../utils';
import { getHabitDeferredBonus, getHabitValueFromFrontmatter, getHabitWeeklyValue } from './habit-service';
import type HabitTimerPlugin from '../main';
import { evaluateHabitState, getHabitGoals, readHabitExplicitState, statePreservesStreak } from '../habits/goals';
import type { HabitDayState, HabitProperty } from '../types';
import { HabitSnapshotService } from './habit-snapshot-service';
import { TelegramCardRenderer } from './telegram-card-renderer';
import { TelegramTimerController } from './telegram-timer-controller';

interface TelegramInlineButton { text: string; callback_data: string; }
interface TelegramMarkup { inline_keyboard: TelegramInlineButton[][]; }
interface TelegramMessage { message_id: number; chat: { id: number | string }; text?: string; }
interface TelegramCallbackQuery { id: string; data?: string; message?: TelegramMessage; }
interface TelegramUpdate { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery; }
interface TelegramUpdatesResponse { ok?: boolean; result?: TelegramUpdate[]; }

/**
 * Handles all Telegram messaging: sending messages, generating report content,
 * and scheduling automatic morning/evening/weekly notifications.
 */
export class TelegramService {
    private telegramInterval: number | null = null;
    private pollInterval: number | null = null;
    private isPolling = false;
    private lastUpdateId: number;
    readonly timer: TelegramTimerController;
    readonly snapshots: HabitSnapshotService;

    constructor(private plugin: HabitTimerPlugin) {
        this.lastUpdateId = plugin.settings.telegramLastUpdateId || 0;
        this.timer = new TelegramTimerController(plugin);
        this.snapshots = new HabitSnapshotService(plugin);
    }

    /** Start the background scheduler (checks every minute). */
    startScheduler(): void {
        // Guard: prevent duplicate intervals if startScheduler() is called more than once
        // (e.g. during plugin reload without proper onunload)
        if (this.telegramInterval !== null || this.pollInterval !== null) {
            this.stopScheduler();
        }
        if (this.plugin.settings.telegramMode === 'cloudflare') return;

        this.telegramInterval = window.setInterval(() => {
            void this.checkNotifications();
        }, 60000);

        // Only poll for bot commands if a token is configured
        const token = this.plugin.settings.telegramBotToken?.trim();
        if (token) {
            void this.configureBotCommands();
            void this.pollBotUpdates();
            this.pollInterval = window.setInterval(() => {
                void this.pollBotUpdates();
            }, 5000);
        }
    }

    restartScheduler(): void {
        this.stopScheduler();
        this.lastUpdateId = this.plugin.settings.telegramLastUpdateId || 0;
        this.startScheduler();
    }

    /** Stop the background scheduler. */
    stopScheduler(): void {
        if (this.telegramInterval) {
            window.clearInterval(this.telegramInterval);
            this.telegramInterval = null;
        }
        if (this.pollInterval) {
            window.clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /** Send a plain text message to the configured Telegram chat. */
    async send(text: string): Promise<boolean> {
        return this.sendMessage(text);
    }

    async sendMessage(text: string, replyMarkup?: TelegramMarkup, messageId?: number): Promise<boolean> {
        const token = this.plugin.settings.telegramBotToken?.trim();
        const chatId = this.plugin.settings.telegramChatId?.trim();
        if (!token || !chatId) return false;
        try {
            const res = await requestUrl({
                url: `https://api.telegram.org/bot${token}/${messageId ? 'editMessageText' : 'sendMessage'}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text,
                    ...(messageId ? { message_id: messageId } : {}),
                    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
                })
            });
            return (res.json as { ok?: boolean } | undefined)?.ok === true;
        } catch (e) {
            console.error('Telegram Send Error:', e);
            return false;
        }
    }

    private async pollBotUpdates(): Promise<void> {
        const token = this.plugin.settings.telegramBotToken?.trim();
        if (!token || this.isPolling) return;
        this.isPolling = true;
        try {
            const res = await requestUrl({
                url: `https://api.telegram.org/bot${token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=5`,
                method: 'GET'
            });
            const data = res.json as TelegramUpdatesResponse;
            if (data.ok && data.result) {
                for (const item of data.result) {
                    this.lastUpdateId = Math.max(this.lastUpdateId, item.update_id);
                    if (item.message?.text && this.isAllowedChat(item.message.chat.id)) {
                        await this.handleCommand(item.message.text.trim());
                    } else if (item.callback_query && this.isAllowedChat(item.callback_query.message?.chat.id)) {
                        await this.handleCallback(item.callback_query);
                    }
                }
                if (data.result.length > 0) {
                    this.plugin.settings.telegramLastUpdateId = this.lastUpdateId;
                    await this.plugin.saveSettings();
                }
            }
            const completed = await this.timer.finishWhenTargetReached();
            if (completed?.ok) {
                await this.send(`Timer completed. Logged: ${formatDurationShort(completed.elapsedSeconds || 0, this.plugin.settings.language)}.`);
                await this.showToday();
            }
        } catch {
            // Obsidian may be offline; the next poll resumes from the persisted update id.
        } finally {
            this.isPolling = false;
        }
    }

    private async configureBotCommands(): Promise<void> {
        const token = this.plugin.settings.telegramBotToken?.trim();
        if (!token) return;
        const ru = this.plugin.settings.language === 'ru';
        const commands = [
            { command: 'menu', description: ru ? 'Открыть пульт привычек' : 'Open habit control center' },
            { command: 'today', description: ru ? 'Привычки на сегодня' : 'Today habits' },
            { command: 'timer', description: ru ? 'Запустить таймер' : 'Start a timer' },
            { command: 'status', description: ru ? 'Состояние таймера' : 'Timer status' },
            { command: 'habit', description: ru ? 'Карта привычки' : 'Habit map' },
            { command: 'day', description: ru ? 'Картинка итогов дня' : 'Daily summary image' }
        ];
        try {
            await requestUrl({
                url: `https://api.telegram.org/bot${token}/setMyCommands`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commands })
            });
        } catch { /* Commands are registered again after the next settings restart. */ }
    }

    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unused-vars */
    private async pollUpdatesLegacy(): Promise<void> {
        const token = this.plugin.settings.telegramBotToken?.trim();
        if (!token) return;

        try {
            const res = await requestUrl({
                url: `https://api.telegram.org/bot${token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=5`,
                method: 'GET'
            });
            const data = res.json;
            if (data?.ok && data.result?.length > 0) {
                for (const item of data.result) {
                    this.lastUpdateId = Math.max(this.lastUpdateId, item.update_id);
                    if (item.message?.text) {
                        const text: string = item.message.text.trim();

                        if (text.startsWith('/start ')) {
                            const habitName = text.substring(7).trim();
                            const started = await this.plugin.startTimerForHabit(habitName);
                            if (started) {
                                await this.send(`✅ Timer started for: ${habitName}`);
                            } else {
                                await this.send(`❌ Habit not found or timer view not open: ${habitName}`);
                            }
                        } else if (text === '/stop') {
                            const stopped = await this.plugin.stopTimer();
                            if (stopped) {
                                await this.send(`🛑 Timer stopped.`);
                            } else {
                                await this.send(`ℹ️ No timer view is open.`);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore polling errors to prevent log spam when offline
        }
    }

    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unused-vars */
    private isAllowedChat(chatId: number | string | undefined): boolean {
        const configured = this.plugin.settings.telegramChatId?.trim();
        return Boolean(configured) && chatId !== undefined && String(chatId) === configured;
    }

    private async handleCommand(text: string): Promise<void> {
        const firstSpace = text.indexOf(' ');
        const rawCommand = (firstSpace >= 0 ? text.slice(0, firstSpace) : text).split('@')[0]?.toLowerCase() || '';
        const args = firstSpace >= 0 ? text.slice(firstSpace + 1).trim() : '';
        if (rawCommand === '/start' && args) {
            const match = args.match(/^(.*?)(?:\s+(\d+))?$/);
            const habit = this.findHabit(match?.[1]?.trim() || '');
            const minutes = match?.[2] ? Number(match[2]) : undefined;
            if (!habit) {
                await this.send(this.text('Привычка не найдена.', 'Habit not found.'));
                return;
            }
            await this.startTimer(habit, minutes);
            return;
        }
        if (rawCommand === '/add') {
            await this.handleQuickAdd(args);
            return;
        }
        if (rawCommand === '/pause') await this.timer.pause();
        else if (rawCommand === '/resume') await this.timer.resume();
        else if (rawCommand === '/stop' || rawCommand === '/finish') await this.finishTimer();
        else if (rawCommand === '/cancel') await this.timer.cancel();
        else if (rawCommand === '/status') await this.showTimerStatus();
        else if (rawCommand === '/today') await this.showToday();
        else if (rawCommand === '/timer') await this.showTimerHabits();
        else if (rawCommand === '/habit') await this.showHabitChoices();
        else if (rawCommand === '/day') await this.sendDailyCard();
        else await this.showMainMenu();
    }

    private async handleCallback(query: TelegramCallbackQuery): Promise<void> {
        await this.answerCallback(query.id);
        const data = query.data || '';
        const messageId = query.message?.message_id;
        if (data === 'menu') await this.showMainMenu(messageId);
        else if (data === 'today') await this.showToday(messageId);
        else if (data === 'timers') await this.showTimerHabits(messageId);
        else if (data === 'timer_status') await this.showTimerStatus(messageId);
        else if (data === 'timer_pause') { await this.timer.pause(); await this.showTimerStatus(messageId); }
        else if (data === 'timer_resume') { await this.timer.resume(); await this.showTimerStatus(messageId); }
        else if (data === 'timer_finish') { await this.finishTimer(); }
        else if (data === 'timer_cancel') { await this.timer.cancel(); await this.showMainMenu(messageId); }
        else if (data === 'habit_choices') await this.showHabitChoices(messageId);
        else if (data === 'daily_card') await this.sendDailyCard();
        else if (data.startsWith('timer_habit:')) {
            const prop = this.propertyAt(data.split(':')[1]);
            if (prop) await this.showTimerDurations(prop, messageId);
        } else if (data.startsWith('timer_start:')) {
            const [, rawIndex, rawMinutes] = data.split(':');
            const prop = this.propertyAt(rawIndex);
            if (prop) await this.startTimer(prop, Number(rawMinutes));
        } else if (data.startsWith('habit_card:')) {
            const prop = this.propertyAt(data.split(':')[1]);
            if (prop) await this.sendHabitCard(prop);
        } else if (data.startsWith('state_menu:')) {
            const prop = this.propertyAt(data.split(':')[1]);
            if (prop) await this.showStateChoices(prop, messageId);
        } else if (data.startsWith('quick:')) {
            const [, rawIndex, action] = data.split(':');
            const prop = this.propertyAt(rawIndex);
            if (prop) await this.applyQuickAction(prop, action || '');
            await this.showToday(messageId);
        } else if (data.startsWith('state:')) {
            const [, rawIndex, state] = data.split(':');
            const prop = this.propertyAt(rawIndex);
            if (prop) await this.applyState(prop, state || '');
            await this.showToday(messageId);
        }
    }

    private async showMainMenu(messageId?: number): Promise<void> {
        const status = this.timer.getStatus();
        const title = this.text('Пульт привычек', 'Habit control center');
        const timerLine = status
            ? `\n${this.text('Активный таймер', 'Active timer')}: ${status.habitName} - ${formatDurationShort(status.elapsedSeconds, this.plugin.settings.language)}`
            : '';
        await this.sendMessage(`${title}${timerLine}`, this.markup([
            [this.button(this.text('Сегодня', 'Today'), 'today'), this.button(this.text('Таймер', 'Timer'), status ? 'timer_status' : 'timers')],
            [this.button(this.text('Карты привычек', 'Habit maps'), 'habit_choices'), this.button(this.text('Итоги дня', 'Daily summary'), 'daily_card')]
        ]), messageId);
    }

    private async showToday(messageId?: number): Promise<void> {
        const today = moment().format('YYYY-MM-DD');
        const allSnapshots = (await this.snapshots.getAllSnapshots(30))
            .filter(snapshot => (snapshot.property.createdAt || '0000-00-00') <= today);
        const snapshots = allSnapshots.slice(0, 20);
        const lines = [this.text('Сегодня', 'Today')];
        const rows: TelegramInlineButton[][] = [];
        snapshots.forEach(snapshot => {
            const index = this.plugin.settings.properties.indexOf(snapshot.property);
            lines.push(`${this.stateSymbol(snapshot.today.state)} ${snapshot.property.name}: ${this.formatValue(snapshot.property, snapshot.today.value)} / ${this.formatValue(snapshot.property, snapshot.today.desired)}`);
            const type = snapshot.property.type || 'timer';
            const action = type === 'timer' ? 'add10' : type === 'count' ? 'add1' : 'toggle';
            rows.push([
                this.button(type === 'timer' ? '+10 min' : type === 'count' ? '+1' : this.text('Готово', 'Done'), `quick:${index}:${action}`),
                this.button(this.text('Статус', 'State'), `state_menu:${index}`),
                this.button(this.text('Карта', 'Map'), `habit_card:${index}`)
            ]);
        });
        if (allSnapshots.length > snapshots.length) lines.push(`+${allSnapshots.length - snapshots.length} ${this.text('привычек скрыто', 'more habits')}`);
        rows.push([this.button(this.text('Таймер', 'Timer'), 'timers'), this.button(this.text('Картинка', 'Image'), 'daily_card'), this.button(this.text('Меню', 'Menu'), 'menu')]);
        await this.sendMessage(lines.join('\n'), this.markup(rows), messageId);
    }

    private async showTimerHabits(messageId?: number): Promise<void> {
        if (this.timer.getStatus()) {
            await this.showTimerStatus(messageId);
            return;
        }
        const rows = this.chunkButtons(this.plugin.settings.properties
            .map((prop, index) => ({ prop, index }))
            .filter(({ prop }) => (prop.type || 'timer') === 'timer' && (prop.createdAt || '0000-00-00') <= moment().format('YYYY-MM-DD'))
            .map(({ prop, index }) => this.button(prop.name, `timer_habit:${index}`)), 2);
        rows.push([this.button(this.text('Назад', 'Back'), 'menu')]);
        await this.sendMessage(this.text('Выберите привычку для таймера:', 'Choose a habit for the timer:'), this.markup(rows), messageId);
    }

    private async showTimerDurations(prop: HabitProperty, messageId?: number): Promise<void> {
        const index = this.plugin.settings.properties.indexOf(prop);
        await this.sendMessage(`${this.text('Таймер', 'Timer')}: ${prop.name}`, this.markup([
            [this.button('25 min', `timer_start:${index}:25`), this.button('45 min', `timer_start:${index}:45`), this.button('60 min', `timer_start:${index}:60`)],
            [this.button(this.text('Без ограничения', 'No limit'), `timer_start:${index}:0`)],
            [this.button(this.text('Назад', 'Back'), 'timers')]
        ]), messageId);
    }

    private async showTimerStatus(messageId?: number): Promise<void> {
        const status = this.timer.getStatus();
        if (!status) {
            await this.showTimerHabits(messageId);
            return;
        }
        const remaining = status.remainingSeconds === undefined ? '' : `\n${this.text('Осталось', 'Remaining')}: ${formatDurationShort(status.remainingSeconds, this.plugin.settings.language)}`;
        const text = `${status.habitName}\n${this.text('Прошло', 'Elapsed')}: ${formatDurationShort(status.elapsedSeconds, this.plugin.settings.language)}${remaining}`;
        await this.sendMessage(text, this.markup([
            [this.button(status.state === 'running' ? this.text('Пауза', 'Pause') : this.text('Продолжить', 'Resume'), status.state === 'running' ? 'timer_pause' : 'timer_resume')],
            [this.button(this.text('Завершить и записать', 'Finish and log'), 'timer_finish'), this.button(this.text('Отменить', 'Cancel'), 'timer_cancel')],
            [this.button(this.text('Обновить', 'Refresh'), 'timer_status')]
        ]), messageId);
    }

    private async startTimer(prop: HabitProperty, minutes?: number): Promise<void> {
        const result = await this.timer.start(prop.name, minutes);
        if (!result.ok) {
            await this.send(result.reason === 'active'
                ? this.text('Уже запущен другой таймер.', 'Another timer is already active.')
                : this.text('Не удалось запустить таймер.', 'Could not start the timer.'));
            return;
        }
        await this.showTimerStatus();
    }

    private async finishTimer(): Promise<void> {
        const result = await this.timer.finish();
        if (!result.ok) {
            await this.send(result.reason === 'obsidian-session'
                ? this.text('Эта сессия запущена в Obsidian. Завершите её в окне таймера, чтобы сохранить связанные задачи и медиа.', 'This session was started in Obsidian. Finish it in the timer view to preserve linked tasks and media.')
                : this.text('Нет активного времени для сохранения.', 'There is no active time to save.'));
            return;
        }
        await this.send(`${this.text('Сессия сохранена', 'Session saved')}: ${formatDurationShort(result.elapsedSeconds || 0, this.plugin.settings.language)}.`);
        await this.showToday();
    }

    private async showHabitChoices(messageId?: number): Promise<void> {
        const buttons = this.plugin.settings.properties.map((prop, index) => this.button(prop.name, `habit_card:${index}`));
        const rows = this.chunkButtons(buttons, 2);
        rows.push([this.button(this.text('Назад', 'Back'), 'menu')]);
        await this.sendMessage(this.text('Выберите карту привычки:', 'Choose a habit map:'), this.markup(rows), messageId);
    }

    private async showStateChoices(prop: HabitProperty, messageId?: number): Promise<void> {
        const index = this.plugin.settings.properties.indexOf(prop);
        await this.sendMessage(`${this.text('Состояние', 'State')}: ${prop.name}`, this.markup([
            [this.button(this.text('Выполнено', 'Completed'), `state:${index}:completed`), this.button(this.text('Частично', 'Partial'), `state:${index}:partial`)],
            [this.button(this.text('Пропущено', 'Skipped'), `state:${index}:skipped`), this.button(this.text('Уважительный пропуск', 'Excused'), `state:${index}:excused`)],
            [this.button(this.text('Перенести на завтра', 'Defer to tomorrow'), `state:${index}:deferred`)],
            [this.button(this.text('Автоматически', 'Automatic'), `state:${index}:auto`), this.button(this.text('Назад', 'Back'), 'today')]
        ]), messageId);
    }

    private async sendHabitCard(prop: HabitProperty): Promise<void> {
        try {
            const snapshot = await this.snapshots.getHabitSnapshot(prop, 84);
            const image = await new TelegramCardRenderer(this.plugin.settings.language).renderHabit(snapshot);
            await this.sendPhoto(image, `${prop.name}. ${this.text('Статистика за 12 недель.', 'Statistics for 12 weeks.')}`, this.markup([
                [this.button(this.text('Сегодня', 'Today'), 'today'), this.button(this.text('Другая привычка', 'Another habit'), 'habit_choices')]
            ]));
        } catch (error) {
            console.error('Telegram habit card error:', error);
            await this.send(this.text('Не удалось создать карту привычки.', 'Could not render the habit map.'));
        }
    }

    async sendDailyCard(): Promise<boolean> {
        try {
            const today = moment().format('YYYY-MM-DD');
            const snapshots = (await this.snapshots.getAllSnapshots(28))
                .filter(snapshot => (snapshot.property.createdAt || '0000-00-00') <= today);
            const image = await new TelegramCardRenderer(this.plugin.settings.language).renderDaily(snapshots, moment().format('DD.MM.YYYY'));
            const tasks=taskNotificationSummary(await this.plugin.tasks.list(),today,true,this.plugin.settings.language);
            return this.sendPhoto(image, this.text('Итоги дня', 'Daily summary')+'\n\n'+tasks, this.markup([
                [this.button(this.text('Изменить результаты', 'Edit results'), 'today'), this.button(this.text('Запустить таймер', 'Start timer'), 'timers')]
            ]));
        } catch (error) {
            console.error('Telegram daily card error:', error);
            return false;
        }
    }

    private async handleQuickAdd(args: string): Promise<void> {
        const match = args.match(/^(.*?)\s+([+-]?\d+(?:[.,]\d+)?)$/);
        const prop = this.findHabit(match?.[1]?.trim() || '');
        const amount = Number((match?.[2] || '').replace(',', '.'));
        if (!prop || !Number.isFinite(amount)) {
            await this.send(this.text('Формат: /add Название 10', 'Format: /add Habit 10'));
            return;
        }
        await this.addValue(prop, amount);
        await this.showToday();
    }

    private async applyQuickAction(prop: HabitProperty, action: string): Promise<void> {
        if (action === 'add10') await this.addValue(prop, 10);
        else if (action === 'add1') await this.addValue(prop, 1);
        else if (action === 'toggle') await this.plugin.toggleBinaryHabit(prop.name);
    }

    private async addValue(prop: HabitProperty, amount: number): Promise<void> {
        await this.plugin.setHabitDayState(prop.name, null);
        if ((prop.type || 'timer') === 'timer') await this.plugin.updateTimerHabit(prop.name, Math.round(amount * 60));
        else if (prop.type === 'count') await this.plugin.updateCountHabit(prop.name, amount);
        else if (prop.type === 'binary') await this.plugin.toggleBinaryHabit(prop.name);
    }

    private async applyState(prop: HabitProperty, state: string): Promise<void> {
        if (state === 'auto') {
            await this.plugin.setHabitDayState(prop.name, null);
        } else if (state === 'completed' || state === 'partial' || state === 'skipped' || state === 'excused') {
            await this.plugin.setHabitDayState(prop.name, state);
        } else if (state === 'deferred') {
            const today = moment().format('YYYY-MM-DD');
            await this.plugin.setHabitDayState(
                prop.name, 'deferred', today, moment().add(1, 'day').format('YYYY-MM-DD'),
                getHabitGoals(prop, today).desired
            );
        }
    }

    private async sendPhoto(image: ArrayBuffer, caption: string, replyMarkup?: TelegramMarkup): Promise<boolean> {
        const token = this.plugin.settings.telegramBotToken?.trim();
        const chatId = this.plugin.settings.telegramChatId?.trim();
        if (!token || !chatId) return false;
        const boundary = `HabitTimer${Date.now()}`;
        const encoder = new TextEncoder();
        const parts: Uint8Array[] = [];
        const field = (name: string, value: string) => {
            parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
        };
        field('chat_id', chatId);
        field('caption', caption);
        if (replyMarkup) field('reply_markup', JSON.stringify(replyMarkup));
        parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="habit-stats.png"\r\nContent-Type: image/png\r\n\r\n`));
        parts.push(new Uint8Array(image));
        parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
        const body = this.concatBytes(parts);
        try {
            const response = await requestUrl({
                url: `https://api.telegram.org/bot${token}/sendPhoto`,
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body: body.buffer
            });
            return (response.json as { ok?: boolean } | undefined)?.ok === true;
        } catch (error) {
            console.error('Telegram photo error:', error);
            return false;
        }
    }

    private async answerCallback(callbackQueryId: string): Promise<void> {
        const token = this.plugin.settings.telegramBotToken?.trim();
        if (!token) return;
        try {
            await requestUrl({
                url: `https://api.telegram.org/bot${token}/answerCallbackQuery`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: callbackQueryId })
            });
        } catch { /* A stale callback is harmless. */ }
    }

    private markup(rows: TelegramInlineButton[][]): TelegramMarkup { return { inline_keyboard: rows }; }
    private button(text: string, data: string): TelegramInlineButton { return { text, callback_data: data }; }
    private chunkButtons(buttons: TelegramInlineButton[], size: number): TelegramInlineButton[][] {
        const rows: TelegramInlineButton[][] = [];
        for (let index = 0; index < buttons.length; index += size) rows.push(buttons.slice(index, index + size));
        return rows;
    }
    private propertyAt(rawIndex: string | undefined): HabitProperty | undefined {
        const index = Number(rawIndex);
        return Number.isInteger(index) ? this.plugin.settings.properties[index] : undefined;
    }
    private findHabit(name: string): HabitProperty | undefined {
        const normalized = name.toLocaleLowerCase();
        return this.plugin.settings.properties.find(prop => prop.name.toLocaleLowerCase() === normalized);
    }
    private formatValue(prop: HabitProperty, value: number): string {
        return (prop.type || 'timer') === 'timer'
            ? formatDurationShort(Math.round(value), this.plugin.settings.language)
            : String(Math.round(value * 10) / 10);
    }
    private stateSymbol(state: HabitDayState): string {
        if (state === 'completed') return '[x]';
        if (state === 'partial') return '[/]';
        if (state === 'excused') return '[-]';
        if (state === 'deferred') return '[>]';
        return '[ ]';
    }
    private text(ru: string, en: string): string { return this.plugin.settings.language === 'ru' ? ru : en; }
    private concatBytes(parts: Uint8Array[]): Uint8Array {
        const length = parts.reduce((sum, part) => sum + part.length, 0);
        const result = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) { result.set(part, offset); offset += part.length; }
        return result;
    }

    async generateMorningBriefing(): Promise<string> {
        const lang = this.plugin.settings.language;
        const displayDate = moment().format('DD.MM.YYYY');

        let msg = lang === 'en'
            ? `🌅 Good morning! Plan for today (${displayDate}):\n\n`
            : `🌅 Доброе утро! План на сегодня (${displayDate}):\n\n`;

        let totalPlannedSec = 0;
        const timers: string[] = [];
        const counters: string[] = [];
        const checklists: string[] = [];

        for (const p of this.plugin.settings.properties) {
            const type = p.type || 'timer';
            const goals = getHabitGoals(p, moment().format('YYYY-MM-DD'));
            if (type === 'timer') {
                const mins = Math.round(goals.desired / 60);
                if (mins > 0) {
                    if (goals.mode === 'daily') totalPlannedSec += mins * 60;
                    const hoursStr = Math.round((mins / 60) * 10) / 10;
                    timers.push(`• ${p.name}: ${hoursStr}h (${mins}m)`);
                }
            } else if (type === 'count') {
                counters.push(`• ${p.name}: ${goals.desired}${goals.mode === 'weekly' ? ' / week' : ''}`);
            } else if (type === 'binary') {
                checklists.push(`• ${p.name}`);
            }
        }

        if (timers.length > 0) msg += `${lang === 'en' ? '⏱ Timers Target:' : '⏱ Цели по времени:'}\n${timers.join('\n')}\n\n`;
        if (counters.length > 0) msg += `${lang === 'en' ? '🔢 Counters Goal:' : '🔢 Цели по количеству:'}\n${counters.join('\n')}\n\n`;
        if (checklists.length > 0) msg += `${lang === 'en' ? '✅ Checklists:' : '✅ Чек-листы:'}\n${checklists.join('\n')}\n\n`;

        const activeTasks = await this.plugin.getActiveProjectTasks();
        msg+=taskNotificationSummary(await this.plugin.tasks.list(),moment().format('YYYY-MM-DD'),false,lang)+'\n\n';
        if (activeTasks.length > 0) {
            msg += `${lang === 'en' ? '📂 Active Project Tasks:' : '📂 Актуальные задачи проектов:'}\n`;
            activeTasks.slice(0, 5).forEach(t => {
                msg += `• [${t.scopeName}] ${t.name} [${t.status}]\n`;
            });
            msg += '\n';
        }

        const totalHours = Math.floor(totalPlannedSec / 3600);
        const totalMins = Math.floor((totalPlannedSec % 3600) / 60);
        msg += lang === 'en'
            ? `💡 Total planned focused time: ${totalHours}h ${totalMins}m. Have a productive day!`
            : `💡 Итого запланировано времени: ${totalHours}ч ${totalMins}м. Продуктивного дня!`;
        return msg;
    }

    async generateEveningSummary(): Promise<string> {
        const lang = this.plugin.settings.language;
        const todayStr = moment().format('YYYY-MM-DD');
        const displayDate = moment().format('DD.MM.YYYY');

        let msg = lang === 'en'
            ? `🌙 Evening Summary (${displayDate}):\n\n`
            : `🌙 Итоги дня (${displayDate}):\n\n`;

        const dailyFile = this.plugin.getDailyNote(todayStr);
        let fm: Record<string, unknown> = {};
        if (dailyFile) {
            const cache = this.plugin.app.metadataCache.getFileCache(dailyFile);
            if (cache?.frontmatter) fm = cache.frontmatter;
        }

        let successCount = 0;
        let totalCount = 0;
        let totalSpentSec = 0;
        const successes: string[] = [];
        const failures: string[] = [];

        for (const p of this.plugin.settings.properties) {
            totalCount++;
            const type = p.type || 'timer';
            let valForDay = getHabitValueFromFrontmatter(fm, p);

            if (type === 'timer') {
                totalSpentSec += valForDay;
            }

            const deferredBonus = getHabitDeferredBonus(this.plugin.app, this.plugin.settings.dailyNotesFolder, p, todayStr);
            const goals = getHabitGoals(p, todayStr, deferredBonus);
            const weeklyValue = goals.mode === 'weekly'
                ? getHabitWeeklyValue(this.plugin.app, this.plugin.settings.dailyNotesFolder, p, todayStr)
                : undefined;
            const state = evaluateHabitState(p, valForDay, todayStr, readHabitExplicitState(fm, p.name), weeklyValue, deferredBonus, todayStr);
            const isMet = statePreservesStreak(state);
            const displayValue = goals.mode === 'weekly' ? (weeklyValue || 0) : valForDay;
            const streak = await this.plugin.getHabitStreak(p.name);
            const streakStr = streak > 0 ? ` 🔥 ${lang === 'en' ? 'Streak:' : 'Стрик:'} ${streak}` : '';

            if (type === 'timer') {
                const hoursStr = Math.round((displayValue / 3600) * 10) / 10;
                const targetHours = Math.round((goals.desired / 3600) * 10) / 10;
                const line = `• ${p.name}: ${hoursStr}h / ${targetHours}h` + streakStr;
                if (isMet) { successCount++; successes.push(line); } else { failures.push(line); }
            } else if (type === 'count') {
                const line = `• ${p.name}: ${displayValue} / ${goals.desired}` + streakStr;
                if (isMet) { successCount++; successes.push(line); } else { failures.push(line); }
            } else {
                const line = `• ${p.name}` + streakStr;
                if (isMet) { successCount++; successes.push(line); } else { failures.push(line); }
            }
        }

        const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;
        const totalHours = Math.floor(totalSpentSec / 3600);
        const totalMins = Math.floor((totalSpentSec % 3600) / 60);

        msg += lang === 'en'
            ? `🏆 Overall Success Rate: ${successRate}%\n⏱ Focused Time Today: ${totalHours}h ${totalMins}m\n\n`
            : `🏆 Общий успех: ${successRate}%\n⏱ Сфокусированное время: ${totalHours}ч ${totalMins}м\n\n`;

        if (successes.length > 0) msg += `${lang === 'en' ? '✅ Completed Successfully:' : '✅ Выполнено успешно:'}\n${successes.join('\n')}\n\n`;
        if (failures.length > 0) msg += `${lang === 'en' ? '❌ Missed / Incomplete:' : '❌ Пропущено / Не выполнено:'}\n${failures.join('\n')}\n\n`;

        const completedTasks = await this.plugin.getCompletedProjectTasksToday();
        msg+=taskNotificationSummary(await this.plugin.tasks.list(),todayStr,true,lang)+'\n\n';
        if (completedTasks.length > 0) {
            msg += `${lang === 'en' ? '🎉 Completed Project Tasks Today:' : '🎉 Завершенные задачи проектов сегодня:'}\n`;
            completedTasks.forEach(t => { msg += `• [${t.scopeName}] ${t.name}\n`; });
            msg += '\n';
        }

        return msg.trim();
    }

    async generateWeeklyReport(): Promise<string> {
        const lang = this.plugin.settings.language;
        const startOfWeek = moment().startOf('isoWeek').format('DD.MM');
        const endOfWeek = moment().endOf('isoWeek').format('DD.MM.YYYY');

        let msg = lang === 'en'
            ? `📊 Weekly Report (${startOfWeek} - ${endOfWeek}):\n\n`
            : `📊 Итоги недели (${startOfWeek} - ${endOfWeek}):\n\n`;

        const files = getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder);
        let weekTotalSec = 0;
        let successfulDays = 0;

        for (let d = moment().startOf('isoWeek'); d.isSameOrBefore(moment().endOf('isoWeek')); d.add(1, 'days')) {
            const dStr = d.format('YYYY-MM-DD');
            const f = files.find(x => x.basename === dStr);
            if (!f) continue;

            const cache = this.plugin.app.metadataCache.getFileCache(f);
            const fm = cache?.frontmatter;
            if (!fm) continue;

            let daySuccesses = 0;
            let dayProps = 0;
            for (const p of this.plugin.settings.properties) {
                dayProps++;
                const type = p.type || 'timer';
                let valForDay = getHabitValueFromFrontmatter(fm, p);
                if (type === 'timer') {
                    weekTotalSec += valForDay;
                }
                if (isHabitMet(p, valForDay)) daySuccesses++;
            }
            if (dayProps > 0 && (daySuccesses / dayProps) >= 0.5) successfulDays++;
        }

        const totalHours = Math.floor(weekTotalSec / 3600);
        const totalMins = Math.floor((weekTotalSec % 3600) / 60);

        if (lang === 'en') {
            msg += `⏱ Total Focused Time: ${totalHours}h ${totalMins}m\n🏆 Successful Days: ${successfulDays} / 7\n\nKeep pushing forward in the upcoming week! 💪`;
        } else {
            msg += `⏱ Всего сфокусированного времени: ${totalHours}ч ${totalMins}м\n🏆 Успешных дней: ${successfulDays} / 7\n\nТак держать на следующей неделе! 💪`;
        }
        return msg;
    }

    async checkNotifications(): Promise<void> {
        const now = moment();
        const todayStr = now.format('YYYY-MM-DD');
        const currentWeekStr = now.format('YYYY-WW');
        const currentTimeStr = now.format('HH:mm');

        const completed = await this.timer.finishWhenTargetReached();
        if (completed?.ok) {
            await this.send(`Timer completed. Logged: ${formatDurationShort(completed.elapsedSeconds || 0, this.plugin.settings.language)}.`);
        }

        if (this.plugin.settings.telegramMorningEnabled && this.plugin.settings.telegramMorningTime) {
            if (currentTimeStr >= this.plugin.settings.telegramMorningTime && this.plugin.settings.telegramLastMorningDate !== todayStr) {
                this.plugin.settings.telegramLastMorningDate = todayStr;
                await this.plugin.saveSettings();
                const msg = await this.generateMorningBriefing();
                await this.send(msg);
            }
        }

        if (this.plugin.settings.telegramEveningEnabled && this.plugin.settings.telegramEveningTime) {
            if (currentTimeStr >= this.plugin.settings.telegramEveningTime && this.plugin.settings.telegramLastEveningDate !== todayStr) {
                this.plugin.settings.telegramLastEveningDate = todayStr;
                await this.plugin.saveSettings();
                const msg = await this.generateEveningSummary();
                await this.send(msg);
                await this.sendDailyCard();
            }
        }

        if (this.plugin.settings.telegramWeeklyReport) {
            if (now.isoWeekday() === 7 && currentTimeStr >= (this.plugin.settings.telegramEveningTime || '20:00') && this.plugin.settings.telegramLastWeeklyDate !== currentWeekStr) {
                this.plugin.settings.telegramLastWeeklyDate = currentWeekStr;
                await this.plugin.saveSettings();
                const msg = await this.generateWeeklyReport();
                await this.send(msg);
            }
        }
    }
}
