import {
  addHabitValue, cancelTimer, clearMediaDraft, createCaptureEvent, createLibraryItemEvent, finishTimer, getConfig,
  deleteLibraryItem, editLibraryItem, findLibraryDuplicate, getLibraryByAuthor, getLibraryBySeries,
  getLibraryCollections, getLibraryItem, getLibraryItems, getLibrarySuggestions, getMediaDraft,
  getActiveProjectTasks, getCompletedMedia, getCompletedProjectTasks, getLibraryProgressEvents,
  getReadingItems, getTimer, getValues, nextSeriesIndex, parseHabits, pauseTimer,
  recordLibraryTimerSession, resumeTimer, saveMediaDraft, searchLibrary, setHabitState, setHabitValue, setLibraryProgress,
  startLibraryItem, startTimer, timerElapsed, updateLibraryProgress
} from './db';
import { renderDailyCard, renderHabitCard, renderWeeklyCard } from './png';
import { createSnapshots, formatValue, habitGoals } from './stats';
import { addDays, zonedParts } from './time';
import { buildWeeklyOverview } from './weekly';
import { convertDailyProgress } from '../../src/library/daily-goal-value';
import { taskNotificationSummary } from '../../src/tasks/notification-summary';
import type { DailyTask } from '../../src/tasks/model';
import { reconcileHabitTasks } from './habit-tasks';
import type {
  CompanionConfigRow, CompanionEventRow, Env, HabitConfig, HabitState, LibraryItemRow, TelegramButton,
  TelegramCallbackQuery, TelegramMarkup, TelegramUpdate, TimerRow
} from './types';

export class TelegramBot {
  private readonly profileId: string;
  constructor(private env: Env) { this.profileId = env.PROFILE_ID || 'default'; }

  private async dailyGoalLines(habits: HabitConfig[], config: CompanionConfigRow, date: string): Promise<string[]> {
    const result = await this.env.DB.prepare('SELECT * FROM library_items WHERE profile_id = ?')
      .bind(this.profileId).all<LibraryItemRow>();
    const events = await getLibraryProgressEvents(this.env.DB, this.profileId, date, date);
    return dailyMediaGoalLines(habits, config.language, date, result.results || [], events);
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const processed = await this.env.DB.prepare('SELECT update_id FROM telegram_updates WHERE update_id = ?')
      .bind(update.update_id).first<{ update_id: number }>();
    if (processed) return;
    await this.env.DB.prepare('INSERT INTO telegram_updates (update_id, processed_at) VALUES (?, ?)')
      .bind(update.update_id, Date.now()).run();
    const config = await getConfig(this.env.DB, this.profileId);
    if (!config) return;
    const messageText = update.message?.text || update.message?.caption;
    if (messageText && update.message && String(update.message.chat.id) === config.chat_id) {
      await this.handleCommand(config, messageText.trim(), update.message);
    } else if (update.callback_query && String(update.callback_query.message?.chat.id) === config.chat_id) {
      await this.answerCallback(update.callback_query.id);
      await this.handleCallback(config, update.callback_query);
    }
  }

  async showMainMenu(config: CompanionConfigRow, messageId?: number): Promise<void> {
    const timer = await getTimer(this.env.DB, this.profileId);
    const status = timer ? `\n${this.tx(config, 'Активный таймер', 'Active timer')}: ${timer.habit_name} - ${formatSeconds(timerElapsed(timer))}` : '';
    await this.sendMessage(config, `${this.tx(config, 'Пульт привычек', 'Habit control center')}${status}`, this.markup([
      [this.button(this.tx(config, 'Сегодня', 'Today'), 'today'), this.button(this.tx(config, 'Таймер', 'Timer'), timer ? 'timer_status' : 'timers')],
      [this.button(this.tx(config, 'Карты привычек', 'Habit maps'), 'habit_choices'), this.button(this.tx(config, 'Итоги дня', 'Daily summary'), 'daily_card')]
    ].concat([[
      this.button(this.tx(config, 'Библиотека', 'Library'), 'library'),
      this.button(this.tx(config, 'Сейчас читаю', 'In progress'), 'lib_reading:0')
    ], [
      this.button(this.tx(config, 'План дня', 'Day plan'), 'plan:0'),
      this.button(this.tx(config, 'Обзор недели', 'Weekly review'), 'weekly_review')
    ], [
      this.button(this.tx(config, 'Быстрый захват', 'Quick capture'), 'capture'),
      this.button(this.tx(config, 'Добавить произведение', 'Add media'), 'addmedia')
    ]])), messageId);
  }

  async sendDailyReport(config: CompanionConfigRow): Promise<void> {
    const { date } = zonedParts(Date.now(), config.timezone);
    const snapshots = await this.snapshots(config, date, 28);
    const image = renderDailyCard(snapshots, date);
    const tasks=await this.taskSummary(config,date,true);
    await this.sendPhoto(config, image, this.tx(config, 'Итоги дня', 'Daily summary')+'\n\n'+tasks, this.markup([
      [this.button(this.tx(config, 'Изменить результаты', 'Edit results'), 'today'), this.button(this.tx(config, 'Запустить таймер', 'Start timer'), 'timers')]
    ]));
  }

  async taskSummary(config:CompanionConfigRow,date:string,evening:boolean):Promise<string>{
    await reconcileHabitTasks(this.env,this.profileId,config);
    const rows=await this.env.DB.prepare('SELECT data_json FROM daily_tasks WHERE profile_id=?').bind(this.profileId).all<{data_json:string}>();
    return taskNotificationSummary((rows.results||[]).map(r=>JSON.parse(r.data_json) as DailyTask),date,evening,config.language);
  }

  async sendWeeklyReview(config: CompanionConfigRow): Promise<void> {
    const { date } = zonedParts(Date.now(), config.timezone);
    const currentStart = addDays(date, -6);
    const previousEnd = addDays(date, -7);
    const previousStart = addDays(date, -13);
    const snapshots = await this.snapshots(config, date, 14);
    const [library, progressEvents, currentMedia, previousMedia, currentTasks, previousTasks] = await Promise.all([
      getLibraryItems(this.env.DB, this.profileId, null, 0, 1000),
      getLibraryProgressEvents(this.env.DB, this.profileId, previousStart, date),
      getCompletedMedia(this.env.DB, this.profileId, currentStart, date),
      getCompletedMedia(this.env.DB, this.profileId, previousStart, previousEnd),
      getCompletedProjectTasks(this.env.DB, this.profileId, currentStart, date),
      getCompletedProjectTasks(this.env.DB, this.profileId, previousStart, previousEnd)
    ]);
    const overview = buildWeeklyOverview(
      snapshots, library, progressEvents, currentMedia, previousMedia, currentTasks, previousTasks, currentStart, date
    );
    const caption = this.tx(config,
      `Обзор недели ${currentStart} - ${date}. Сравнение с предыдущей неделей показано на карточке.`,
      `Weekly review ${currentStart} - ${date}. Comparison with the previous week is shown on the card.`
    );
    await this.sendPhoto(config, renderWeeklyCard(overview), caption, this.markup([
      [this.button(this.tx(config, 'План дня', 'Day plan'), 'plan:0'), this.button(this.tx(config, 'Меню', 'Menu'), 'menu')]
    ]));
  }

  async checkTargetTimer(config: CompanionConfigRow): Promise<boolean> {
    const timer = await getTimer(this.env.DB, this.profileId);
    if (!timer || timer.timer_state !== 'running' || !timer.target_seconds || timerElapsed(timer) < timer.target_seconds) return false;
    const { date, time } = zonedParts(Date.now(), config.timezone);
    const result = await finishTimer(this.env.DB, this.profileId, date, time, true);
    if (!result) return false;
    await this.sendMessage(config, `${this.tx(config, 'Таймер завершён', 'Timer completed')}: ${result.timer.habit_name}. ${formatSeconds(result.elapsed)}.`);
    if (result.timer.media_id) await this.finishMediaTimer(config, result.timer, result.elapsed, date, time);
    return true;
  }

  private async handleCommand(config: CompanionConfigRow, text: string, message?: import('./types').TelegramMessage): Promise<void> {
    const firstSpace = text.indexOf(' ');
    const command = (firstSpace >= 0 ? text.slice(0, firstSpace) : text).split('@')[0]?.toLowerCase() || '';
    const args = firstSpace >= 0 ? text.slice(firstSpace + 1).trim() : '';
    if (!text.startsWith('/') && await this.handleMediaDraftText(config, text, message)) return;
    if (command === '/start' && args) { await this.startFromText(config, args); return; }
    if (command === '/add') { await this.addFromText(config, args); return; }
    if (command === '/search') { await this.searchLibraryCommand(config, args); return; }
    if (command === '/addmedia') { await this.startAddMedia(config); return; }
    if (command === '/capture') { await this.startCapture(config); return; }
    if (command === '/find') { await this.searchDraftSuggestions(config, args); return; }
    if (command === '/editmedia') { await this.editMediaCommand(config, args); return; }
    if (command === '/plan') { await this.showPlan(config); return; }
    if (command === '/week') { await this.sendWeeklyReview(config); return; }
    if (command === '/today') await this.showToday(config);
    else if (command === '/timer') await this.showTimerHabits(config);
    else if (command === '/status') await this.showTimerStatus(config);
    else if (command === '/pause') { await pauseTimer(this.env.DB, this.profileId); await this.showTimerStatus(config); }
    else if (command === '/resume') { await resumeTimer(this.env.DB, this.profileId); await this.showTimerStatus(config); }
    else if (command === '/finish' || command === '/stop') await this.finishActiveTimer(config);
    else if (command === '/cancel') { await cancelTimer(this.env.DB, this.profileId); await this.showMainMenu(config); }
    else if (command === '/habit') await this.showHabitChoices(config);
    else if (command === '/day') await this.sendDailyReport(config);
    else if (command === '/library') await this.showLibraryMenu(config);
    else if (command === '/reading') await this.showReading(config, 0);
    else await this.showMainMenu(config);
  }

  private async handleCallback(config: CompanionConfigRow, query: TelegramCallbackQuery): Promise<void> {
    const data = query.data || '';
    if(data.startsWith('dts:')){await snoozeTask(this.env,this.profileId,config,data);return;}
    // Photo messages cannot be updated with editMessageText; their buttons open a fresh text message.
    const messageId = query.message?.text ? query.message.message_id : undefined;
    if (data === 'menu') await this.showMainMenu(config, messageId);
    else if (data === 'today') await this.showToday(config, messageId);
    else if (data === 'timers') await this.showTimerHabits(config, messageId);
    else if (data === 'timer_status') await this.showTimerStatus(config, messageId);
    else if (data === 'timer_pause') { await pauseTimer(this.env.DB, this.profileId); await this.showTimerStatus(config, messageId); }
    else if (data === 'timer_resume') { await resumeTimer(this.env.DB, this.profileId); await this.showTimerStatus(config, messageId); }
    else if (data === 'timer_finish') await this.finishActiveTimer(config);
    else if (data === 'timer_cancel') { await cancelTimer(this.env.DB, this.profileId); await this.showMainMenu(config, messageId); }
    else if (data === 'habit_choices') await this.showHabitChoices(config, messageId);
    else if (data === 'daily_card') await this.sendDailyReport(config);
    else if (data === 'weekly_review') await this.sendWeeklyReview(config);
    else if (data === 'library') await this.showLibraryMenu(config, messageId);
    else if (data === 'addmedia') await this.startAddMedia(config, messageId);
    else if (data === 'capture') await this.startCapture(config, messageId);
    else if (data === 'capture_cancel') {
      await clearMediaDraft(this.env.DB, this.profileId);
      await this.showMainMenu(config, messageId);
    }
    else if (data.startsWith('plan:')) await this.showPlan(config, messageId);
    else if (data.startsWith('capture_type:')) await this.selectCaptureType(config, data.slice('capture_type:'.length));
    else if (data === 'addmedia_cancel') {
      await clearMediaDraft(this.env.DB, this.profileId);
      await this.showLibraryMenu(config, messageId);
    } else if (data.startsWith('addmedia_type:')) {
      await this.selectMediaType(config, decodeURIComponent(data.slice('addmedia_type:'.length)));
    } else if (data.startsWith('addmedia_format:')) {
      await this.setMediaFormat(config, data.slice('addmedia_format:'.length));
    } else if (data === 'addmedia_skip') {
      await this.handleMediaDraftText(config, '-');
    } else if (data.startsWith('addmedia_pick:')) {
      await this.pickMediaSuggestion(config, Number(data.split(':')[1]));
    } else if (data === 'addmedia_done') {
      await this.finishSuggestionStep(config);
    } else if (data === 'addmedia_duplicate_continue') {
      const draft = await getMediaDraft(this.env.DB, this.profileId);
      if (draft) {
        const draftData = parseDraftData(draft.data_json);
        await saveMediaDraft(this.env.DB, this.profileId, 'genres', draftData);
        await this.showSuggestionStep(config, 'genres', draftData);
      }
    } else if (data.startsWith('lib_col:')) {
      const [, rawCollection, rawPage] = data.split(':');
      await this.showLibraryCollection(config, decodeURIComponent(rawCollection || ''), Number(rawPage) || 0, messageId);
    } else if (data.startsWith('lib_reading:')) {
      await this.showReading(config, Number(data.split(':')[1]) || 0, messageId);
    } else if (data.startsWith('lib_item:')) {
      await this.showLibraryItem(config, Number(data.split(':')[1]));
    } else if (data.startsWith('lib_add:')) {
      const [, rawId, rawAmount] = data.split(':');
      await this.changeLibraryProgress(config, Number(rawId), Number(rawAmount), false);
    } else if (data.startsWith('lib_progress:')) {
      const [, rawId, mode, sessionId] = data.split(':');
      await this.startProgressInput(config, Number(rawId), mode || 'exact', sessionId);
    } else if (data.startsWith('lib_timer:')) {
      await this.showMediaTimerHabits(config, Number(data.split(':')[1]));
    } else if (data.startsWith('lib_timer_habit:')) {
      const [, rawMediaId, rawHabit] = data.split(':');
      await this.showMediaTimerDurations(config, Number(rawMediaId), Number(rawHabit));
    } else if (data.startsWith('lib_timer_start:')) {
      const [, rawMediaId, rawHabit, rawMinutes] = data.split(':');
      const habit = this.habitAt(config, rawHabit);
      if (habit) await this.startSelected(config, habit, Number(rawMinutes), Number(rawMediaId));
    } else if (data.startsWith('lib_author:')) {
      await this.showAuthorChoices(config, Number(data.split(':')[1]));
    } else if (data.startsWith('lib_author_pick:')) {
      const [, rawId, rawIndex] = data.split(':'); await this.showAuthorPage(config, Number(rawId), Number(rawIndex));
    } else if (data.startsWith('lib_series:')) {
      await this.showSeriesPage(config, Number(data.split(':')[1]));
    } else if (data.startsWith('lib_edit:')) {
      await this.showEditMedia(config, Number(data.split(':')[1]));
    } else if (data.startsWith('lib_edit_field:')) {
      const [, rawId, field] = data.split(':'); await this.startEditField(config, Number(rawId), field || '');
    } else if (data.startsWith('lib_edit_collection:')) {
      await this.showEditCollection(config, Number(data.split(':')[1]));
    } else if (data.startsWith('lib_edit_collection_set:')) {
      const [, rawId, collectionId] = data.split(':'); await this.applyEdit(config, Number(rawId), { collectionId: decodeURIComponent(collectionId || '') });
    } else if (data.startsWith('lib_delete_ask:')) {
      const id = Number(data.split(':')[1]);
      await this.sendMessage(config, this.tx(config, 'Удалить заметку? Это действие нельзя отменить.', 'Delete the note? This cannot be undone.'), this.markup([
        [this.button(this.tx(config, 'Удалить', 'Delete'), `lib_delete_confirm:${id}`), this.button(this.tx(config, 'Отмена', 'Cancel'), `lib_item:${id}`)]
      ]));
    } else if (data.startsWith('lib_delete_confirm:')) {
      const id = Number(data.split(':')[1]); const { date } = zonedParts(Date.now(), config.timezone);
      await deleteLibraryItem(this.env.DB, this.profileId, id, date); await this.showLibraryMenu(config);
    } else if (data.startsWith('lib_finish:')) {
      await this.changeLibraryProgress(config, Number(data.split(':')[1]), 0, true);
    } else if (data.startsWith('lib_start:')) {
      await this.startMedia(config, Number(data.split(':')[1]));
    } else if (data.startsWith('timer_media_pick:')) {
      const [, rawHabit, rawMedia] = data.split(':');
      await this.showMediaTimerDurations(config, Number(rawMedia), Number(rawHabit), `timer_media_choices:${rawHabit}`);
    } else if (data.startsWith('timer_media_choices:')) {
      const habit = this.habitAt(config, data.split(':')[1]); if (habit) await this.showHabitMediaChoices(config, habit, messageId);
    } else if (data.startsWith('timer_plain:')) {
      const habit = this.habitAt(config, data.split(':')[1]); if (habit) await this.showDurations(config, habit, messageId);
    } else if (data.startsWith('timer_habit:')) {
      const habit = this.habitAt(config, data.split(':')[1]); if (habit) await this.showHabitMediaChoices(config, habit, messageId);
    } else if (data.startsWith('timer_start:')) {
      const [, rawIndex, rawMinutes] = data.split(':'); const habit = this.habitAt(config, rawIndex);
      if (habit) await this.startSelected(config, habit, Number(rawMinutes));
    } else if (data.startsWith('habit_card:')) {
      const habit = this.habitAt(config, data.split(':')[1]); if (habit) await this.sendHabitCard(config, habit);
    } else if (data.startsWith('state_menu:')) {
      const habit = this.habitAt(config, data.split(':')[1]); if (habit) await this.showStates(config, habit, messageId);
    } else if (data.startsWith('state:')) {
      const [, rawIndex, state] = data.split(':'); const habit = this.habitAt(config, rawIndex);
      if (habit) await this.applyState(config, habit, state || ''); await this.showToday(config, messageId);
    } else if (data.startsWith('quick:')) {
      const [, rawIndex, action] = data.split(':'); const habit = this.habitAt(config, rawIndex);
      if (habit) await this.applyQuick(config, habit, action || ''); await this.showToday(config, messageId);
    } else {
      await this.sendMessage(config, this.tx(config, 'Эта кнопка устарела. Открываю меню.', 'This button is outdated. Opening the menu.'));
      await this.showMainMenu(config);
    }
  }

  private async showPlan(config: CompanionConfigRow, messageId?: number): Promise<void> {
    const { date } = zonedParts(Date.now(), config.timezone);
    const snapshots = await this.snapshots(config, date, 7);
    const habits = parseHabits(config);
    const media = await getReadingItems(this.env.DB, this.profileId, 0, 20);
    const tasks = await getActiveProjectTasks(this.env.DB, this.profileId, date, 20);
    const remainingHabits: Array<{ name: string; index: number; current: string; desired: string }> = [];
    for (const snapshot of snapshots) {
      const today = snapshot.days.at(-1);
      if (!today || today.value >= today.desired || today.state === 'completed' || today.state === 'excused') continue;
      remainingHabits.push({
        name: snapshot.habit.name,
        index: habits.findIndex(item => item.name === snapshot.habit.name),
        current: formatValue(snapshot.habit, today.value),
        desired: formatValue(snapshot.habit, today.desired)
      });
    }
    const overdue = tasks.filter(task => task.end_date && task.end_date < date);
    const dueToday = tasks.filter(task => task.end_date === date);
    const active = tasks.filter(task => !task.end_date || task.end_date > date);
    const lines = [this.tx(config, 'План на сегодня', 'Today plan')];
    lines.push(...await this.dailyGoalLines(habits, config, date));
    if (remainingHabits.length) {
      lines.push('', `${this.tx(config, 'Привычки', 'Habits')} (${remainingHabits.length})`);
      remainingHabits.forEach(item => lines.push(`- [H] ${item.name}: ${item.current} / ${item.desired}`));
    }
    if (overdue.length) {
      lines.push('', `${this.tx(config, 'Перенесённые дела', 'Overdue / carried over')} (${overdue.length})`);
      overdue.forEach(task => lines.push(`- [T] ${task.task_name}`));
    }
    if (dueToday.length) {
      lines.push('', `${this.tx(config, 'Срок сегодня', 'Due today')} (${dueToday.length})`);
      dueToday.forEach(task => lines.push(`- [T] ${task.task_name}`));
    }
    if (active.length) {
      lines.push('', `${this.tx(config, 'Активные задачи', 'Active tasks')} (${active.length})`);
      active.forEach(task => lines.push(`- [T] ${task.task_name}`));
    }
    if (media.length) {
      lines.push('', `${this.tx(config, 'Сейчас в процессе', 'Currently in progress')} (${media.length})`);
      media.forEach(item => lines.push(`- [${collectionLabel(item.collection_id)}] ${item.title}`));
    }
    if (!media.length) lines.push('', this.tx(config, 'Текущие произведения на сервере не найдены. Обновите синхронизацию библиотеки в Obsidian.', 'No current media found on the server. Sync the library from Obsidian.'));
    if (!tasks.length) lines.push('', this.tx(config, 'Активные задачи проектов на сервере не найдены.', 'No active project tasks found on the server.'));
    if (!remainingHabits.length && !tasks.length && !media.length) lines.push('', this.tx(config, 'На сегодня ничего не осталось.', 'Nothing remains for today.'));
    const rows: TelegramButton[][] = [];
    remainingHabits.filter(item => item.index >= 0).forEach(item => rows.push([
      this.button(truncate(`${this.tx(config, 'Начать', 'Start')}: ${item.name}`, 48), `timer_habit:${item.index}`)
    ]));
    media.forEach(item => rows.push([this.button(truncate(item.title, 48), `lib_item:${item.id}`)]));
    rows.push([this.button(this.tx(config, 'Обновить', 'Refresh'), 'plan:0'), this.button(this.tx(config, 'Меню', 'Menu'), 'menu')]);
    await this.sendMessage(config, lines.join('\n'), this.markup(rows), messageId);
  }

  private async startCapture(config: CompanionConfigRow, messageId?: number): Promise<void> {
    await clearMediaDraft(this.env.DB, this.profileId);
    await this.sendMessage(config, this.tx(config, 'Куда сохранить запись?', 'Capture category'), this.markup([
      [this.button(this.tx(config, 'Мысль', 'Thought'), 'capture_type:thought'), this.button(this.tx(config, 'Ссылка', 'Link'), 'capture_type:link')],
      [this.button(this.tx(config, 'Идея', 'Idea'), 'capture_type:idea'), this.button(this.tx(config, 'Задача', 'Task'), 'capture_type:task')],
      [this.button(this.tx(config, 'Цитата', 'Quote'), 'capture_type:quote')],
      [this.button(this.tx(config, 'Отмена', 'Cancel'), 'capture_cancel')]
    ]), messageId);
  }

  private async selectCaptureType(config: CompanionConfigRow, category: string): Promise<void> {
    const allowed = ['thought', 'link', 'idea', 'task', 'quote'];
    if (!allowed.includes(category)) return;
    await saveMediaDraft(this.env.DB, this.profileId, 'capture_content', { category });
    await this.sendMessage(config, this.tx(config,
      'Отправьте текст, ссылку или перешлите сообщение. Запись попадёт в сегодняшний дневник.',
      'Send text, a link, or forward a message. It will be added to today’s daily note.'), this.markup([
      [this.button(this.tx(config, 'Отмена', 'Cancel'), 'capture_cancel')]
    ]));
  }

  private async startAddMedia(config: CompanionConfigRow, messageId?: number): Promise<void> {
    await clearMediaDraft(this.env.DB, this.profileId);
    const synced = await getLibraryCollections(this.env.DB, this.profileId);
    const collectionIds = synced.length
      ? synced.map(item => item.collection_id)
      : ['book', 'manga', 'film', 'anime', 'series', 'game', 'course'];
    const buttons = collectionIds.map(id => this.button(collectionLabel(id), `addmedia_type:${encodeURIComponent(id)}`));
    const rows = chunk(buttons, 2);
    rows.push([this.button(this.tx(config, 'Отмена', 'Cancel'), 'addmedia_cancel')]);
    await this.sendMessage(config, this.tx(config, 'Что добавляем?', 'What would you like to add?'), this.markup(rows), messageId);
  }

  private async selectMediaType(config: CompanionConfigRow, collectionId: string): Promise<void> {
    await saveMediaDraft(this.env.DB, this.profileId, 'title', { collectionId });
    await this.sendMessage(config, this.tx(config, 'Введите название произведения.', 'Enter the title.'), this.markup([
      [this.button(this.tx(config, 'Отмена', 'Cancel'), 'addmedia_cancel')]
    ]));
  }

  private async showSuggestionStep(
    config: CompanionConfigRow, kind: 'authors' | 'genres' | 'series', data: Record<string, unknown>, query = ''
  ): Promise<void> {
    const suggestions = await getLibrarySuggestions(this.env.DB, this.profileId, kind, query, 8);
    data.suggestions = suggestions;
    if (!Array.isArray(data.selected)) data.selected = [];
    await saveMediaDraft(this.env.DB, this.profileId, kind, data);
    const selected = new Set((data.selected as unknown[]).filter(item => typeof item === 'string'));
    const buttons = suggestions.map((value, index) => this.button(`${selected.has(value) ? '✓ ' : ''}${truncate(value, 28)}`, `addmedia_pick:${index}`));
    const rows = chunk(buttons, 2);
    if (kind !== 'series') rows.push([this.button(this.tx(config, 'Готово', 'Done'), 'addmedia_done')]);
    rows.push([this.button(this.tx(config, 'Пропустить', 'Skip'), 'addmedia_skip'), this.button(this.tx(config, 'Отмена', 'Cancel'), 'addmedia_cancel')]);
    const label = kind === 'authors' ? this.tx(config, 'авторов', 'authors') : kind === 'genres' ? this.tx(config, 'жанры', 'genres') : this.tx(config, 'серию', 'series');
    await this.sendMessage(config, `${this.tx(config, 'Выберите или введите', 'Choose or enter')} ${label}. /find текст`, this.markup(rows));
  }

  private async pickMediaSuggestion(config: CompanionConfigRow, index: number): Promise<void> {
    const draft = await getMediaDraft(this.env.DB, this.profileId);
    if (!draft || !['authors', 'genres', 'series'].includes(draft.step)) return;
    const data = parseDraftData(draft.data_json);
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions.filter(item => typeof item === 'string') : [];
    const value = suggestions[index];
    if (typeof value !== 'string') return;
    if (draft.step === 'series') {
      data.series = value;
      data.seriesIndex = await nextSeriesIndex(this.env.DB, this.profileId, value);
      await saveMediaDraft(this.env.DB, this.profileId, 'seriesIndex', data);
      await this.promptMediaDraft(config, `${this.tx(config, 'Следующая часть', 'Suggested next part')}: ${String(data.seriesIndex)}. ${this.tx(config, 'Введите другой номер или пропустите.', 'Enter another number or skip.')}`);
      return;
    }
    const selected = new Set(Array.isArray(data.selected) ? data.selected.filter(item => typeof item === 'string') : []);
    if (selected.has(value)) selected.delete(value); else selected.add(value);
    data.selected = [...selected];
    await this.showSuggestionStep(config, draft.step as 'authors' | 'genres', data);
  }

  private async finishSuggestionStep(config: CompanionConfigRow): Promise<void> {
    const draft = await getMediaDraft(this.env.DB, this.profileId);
    if (!draft || (draft.step !== 'authors' && draft.step !== 'genres')) return;
    const data = parseDraftData(draft.data_json);
    const values = Array.isArray(data.selected) ? data.selected.filter(item => typeof item === 'string') : [];
    delete data.selected; delete data.suggestions;
    if (draft.step === 'authors') {
      data.authors = values;
      await this.advanceAfterAuthors(config, data);
    } else {
      data.genres = values;
      await saveMediaDraft(this.env.DB, this.profileId, 'series', data);
      await this.showSuggestionStep(config, 'series', data);
    }
  }

  private async searchDraftSuggestions(config: CompanionConfigRow, query: string): Promise<void> {
    const draft = await getMediaDraft(this.env.DB, this.profileId);
    if (!draft || !['authors', 'genres', 'series'].includes(draft.step)) {
      await this.sendMessage(config, this.tx(config, 'Сейчас поиск подсказок недоступен.', 'Suggestion search is not active.'));
      return;
    }
    await this.showSuggestionStep(config, draft.step as 'authors' | 'genres' | 'series', parseDraftData(draft.data_json), query);
  }

  private async advanceAfterAuthors(config: CompanionConfigRow, data: Record<string, unknown>): Promise<void> {
    delete data.selected; delete data.suggestions;
    const authors = Array.isArray(data.authors) ? data.authors.filter(item => typeof item === 'string') : [];
    const duplicate = await findLibraryDuplicate(this.env.DB, this.profileId, String(data.title || ''), authors);
    if (duplicate) {
      await saveMediaDraft(this.env.DB, this.profileId, 'duplicate_confirm', data);
      await this.sendMessage(config, `${this.tx(config, 'Возможный дубликат', 'Possible duplicate')}: ${duplicate.title}`, this.markup([
        [this.button(this.tx(config, 'Всё равно создать', 'Create anyway'), 'addmedia_duplicate_continue'), this.button(this.tx(config, 'Отмена', 'Cancel'), 'addmedia_cancel')]
      ]));
      return;
    }
    await saveMediaDraft(this.env.DB, this.profileId, 'genres', data);
    await this.showSuggestionStep(config, 'genres', data);
  }

  private async setMediaFormat(config: CompanionConfigRow, format: string): Promise<void> {
    const draft = await getMediaDraft(this.env.DB, this.profileId);
    if (!draft || draft.step !== 'format') return;
    const data = parseDraftData(draft.data_json);
    data.format = format === 'audiobook' ? 'Audiobook' : format === 'ebook' ? 'E-book' : 'Paper';
    await saveMediaDraft(this.env.DB, this.profileId, 'total', data);
    await this.promptMediaDraft(config, this.tx(config, 'Введите общий объём: страницы, минуты или эпизоды.', 'Enter total pages, minutes, or episodes.'));
  }

  private async handleMediaDraftText(
    config: CompanionConfigRow, text: string, message?: import('./types').TelegramMessage
  ): Promise<boolean> {
    const draft = await getMediaDraft(this.env.DB, this.profileId);
    if (!draft) return false;
    const data = parseDraftData(draft.data_json);
    const value = text.trim() === '-' ? '' : text.trim();
    if (draft.step === 'capture_content') {
      if (!value) return true;
      const { date, time } = zonedParts(Date.now(), config.timezone);
      await createCaptureEvent(this.env.DB, this.profileId, date, {
        category: String(data.category || 'thought'), text: value, time, source: forwardedSource(message)
      });
      await clearMediaDraft(this.env.DB, this.profileId);
      await this.sendMessage(config, this.tx(config, 'Сохранено в очередь дневной заметки.', 'Queued for the daily note.'), this.markup([
        [this.button(this.tx(config, 'Добавить ещё', 'Capture another'), 'capture'), this.button(this.tx(config, 'Меню', 'Menu'), 'menu')]
      ]));
    } else if (draft.step === 'progress_exact' || draft.step === 'progress_delta' || draft.step === 'progress_episode') {
      const mediaId = Number(data.mediaId);
      const item = await getLibraryItem(this.env.DB, this.profileId, mediaId);
      if (!item) { await clearMediaDraft(this.env.DB, this.profileId); return true; }
      if (draft.step === 'progress_episode') {
        const match = value.match(/^S?(\d+)\s*[:/\-]?\s*E?(\d+)$/i);
        if (!match) { await this.sendMessage(config, 'Format: S2E5'); return true; }
        const season = Number(match[1]); const episode = Number(match[2]);
        await this.queueProgressNote(config, data, episode, episode - item.progress, season, episode);
      } else {
        const parsed = parseMediaNumber(value, isAudiobook(item));
        if (parsed === null) { await this.sendMessage(config, this.tx(config, 'Не удалось распознать значение.', 'Could not parse the value.')); return true; }
        const progress = draft.step === 'progress_delta' ? item.progress + parsed : parsed;
        await this.queueProgressNote(config, data, progress, progress - item.progress);
      }
    } else if (draft.step === 'progress_note') {
      const mediaId = Number(data.mediaId);
      const pending = data.pendingProgress && typeof data.pendingProgress === 'object' ? data.pendingProgress as Record<string, unknown> : {};
      const { date, time } = zonedParts(Date.now(), config.timezone);
      const item = await setLibraryProgress(this.env.DB, this.profileId, mediaId, Number(pending.progress) || 0, date, {
        delta: Number(pending.delta) || 0, note: value || '-', time,sessionId:typeof data.sessionId==='string'?data.sessionId:undefined,
        season: pending.season === undefined ? undefined : Number(pending.season),
        episode: pending.episode === undefined ? undefined : Number(pending.episode)
      });
      await clearMediaDraft(this.env.DB, this.profileId);
      if (item) await this.showLibraryItem(config, item.id, false);
    } else if (draft.step === 'edit_field') {
      const mediaId = Number(data.mediaId);
      const field = String(data.field || '');
      let edited: unknown = value;
      if (field === 'authors' || field === 'genres') edited = splitValues(value);
      if (field === 'seriesIndex' || field === 'total') {
        edited = Number(value.replace(',', '.'));
        if (!Number.isFinite(edited) || Number(edited) < 0) { await this.sendMessage(config, this.tx(config, 'Нужно неотрицательное число.', 'Enter a non-negative number.')); return true; }
      }
      if (field === 'rating' && value && !/^[+-]?(?:10|[1-9])(?:[+-])?$/.test(value)) {
        await this.sendMessage(config, this.tx(config, 'Некорректный рейтинг. Пример: 7+, 6-, -6.', 'Invalid rating. Example: 7+, 6-, -6.')); return true;
      }
      if ((field === 'startDate' || field === 'endDate') && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        await this.sendMessage(config, 'Format: YYYY-MM-DD'); return true;
      }
      await clearMediaDraft(this.env.DB, this.profileId);
      await this.applyEdit(config, mediaId, { [field]: edited });
    } else if (draft.step === 'title') {
      if (!value) { await this.sendMessage(config, this.tx(config, 'Название обязательно.', 'Title is required.')); return true; }
      data.title = value;
      await saveMediaDraft(this.env.DB, this.profileId, 'authors', data);
      await this.showSuggestionStep(config, 'authors', data);
    } else if (draft.step === 'authors') {
      data.authors = splitValues(value);
      await this.advanceAfterAuthors(config, data);
    } else if (draft.step === 'genres') {
      data.genres = splitValues(value);
      delete data.selected; delete data.suggestions;
      await saveMediaDraft(this.env.DB, this.profileId, 'series', data);
      await this.showSuggestionStep(config, 'series', data);
    } else if (draft.step === 'series') {
      data.series = value;
      data.seriesIndex = value ? await nextSeriesIndex(this.env.DB, this.profileId, value) : 0;
      await saveMediaDraft(this.env.DB, this.profileId, 'seriesIndex', data);
      await this.promptMediaDraft(config, `${this.tx(config, 'Следующая часть', 'Suggested next part')}: ${String(data.seriesIndex || 0)}. ${this.tx(config, 'Введите другой номер или пропустите.', 'Enter another number or skip.')}`);
    } else if (draft.step === 'seriesIndex') {
      const index = value ? Number(value.replace(',', '.')) : Number(data.seriesIndex || 0);
      if (!Number.isFinite(index) || index < 0) { await this.sendMessage(config, this.tx(config, 'Нужен корректный номер.', 'Enter a valid number.')); return true; }
      data.seriesIndex = index;
      if (data.collectionId === 'book') {
        await saveMediaDraft(this.env.DB, this.profileId, 'format', data);
        await this.sendMessage(config, this.tx(config, 'Выберите формат книги.', 'Choose the book format.'), this.markup([
          [this.button('Paper', 'addmedia_format:paper'), this.button('E-book', 'addmedia_format:ebook')],
          [this.button('Audiobook', 'addmedia_format:audiobook')],
          [this.button(this.tx(config, 'Отмена', 'Cancel'), 'addmedia_cancel')]
        ]));
      } else {
        await saveMediaDraft(this.env.DB, this.profileId, 'total', data);
        await this.promptMediaDraft(config, this.tx(config, 'Введите общий объём: минуты или эпизоды.', 'Enter total minutes or episodes.'));
      }
    } else if (draft.step === 'total') {
      const total = value ? Number(value.replace(',', '.')) : 0;
      if (!Number.isFinite(total) || total < 0) { await this.sendMessage(config, this.tx(config, 'Нужен корректный объём.', 'Enter a valid total.')); return true; }
      data.total = total;
      await saveMediaDraft(this.env.DB, this.profileId, 'coverUrl', data);
      await this.promptMediaDraft(config, this.tx(config, 'Введите внешний URL обложки. Локальную обложку можно добавить позже в Obsidian.', 'Enter an external cover URL. A local cover can be added later in Obsidian.'));
    } else if (draft.step === 'coverUrl') {
      if (value && !/^https?:\/\//i.test(value)) { await this.sendMessage(config, this.tx(config, 'Нужна ссылка http:// или https://.', 'Enter an http:// or https:// URL.')); return true; }
      data.coverUrl = value;
      await saveMediaDraft(this.env.DB, this.profileId, 'status', data);
      await this.promptMediaDraft(config, this.tx(config, 'Введите статус или пропустите для «В планах».', 'Enter a status or skip for Planned.'));
    } else if (draft.step === 'status') {
      data.status = value || this.tx(config, 'В планах', 'Planned');
      const { date } = zonedParts(Date.now(), config.timezone);
      await createLibraryItemEvent(this.env.DB, this.profileId, date, data);
      await clearMediaDraft(this.env.DB, this.profileId);
      await this.sendMessage(config, `${this.tx(config, 'Добавление поставлено в очередь', 'Queued for creation')}: ${String(data.title || '')}`, this.markup([
        [this.button(this.tx(config, 'Добавить ещё', 'Add another'), 'addmedia'), this.button(this.tx(config, 'Библиотека', 'Library'), 'library')]
      ]));
    }
    return true;
  }

  private async promptMediaDraft(config: CompanionConfigRow, text: string): Promise<void> {
    await this.sendMessage(config, text, this.markup([
      [this.button(this.tx(config, 'Пропустить', 'Skip'), 'addmedia_skip'), this.button(this.tx(config, 'Отмена', 'Cancel'), 'addmedia_cancel')]
    ]));
  }

  private async showLibraryMenu(config: CompanionConfigRow, messageId?: number): Promise<void> {
    const collections = await getLibraryCollections(this.env.DB, this.profileId);
    const buttons = collections.map(item => this.button(
      `${collectionLabel(item.collection_id)} (${item.item_count})`,
      `lib_col:${encodeURIComponent(item.collection_id)}:0`
    ));
    const rows = chunk(buttons, 2);
    rows.push([this.button(this.tx(config, 'Сейчас читаю', 'In progress'), 'lib_reading:0')]);
    rows.push([this.button(this.tx(config, 'Добавить произведение', 'Add media'), 'addmedia')]);
    rows.push([this.button(this.tx(config, 'Быстрый захват', 'Quick capture'), 'capture')]);
    rows.push([this.button(this.tx(config, 'Назад', 'Back'), 'menu')]);
    const text = collections.length
      ? this.tx(config, 'Библиотека. Выберите коллекцию или используйте /search название', 'Library. Choose a collection or use /search title')
      : this.tx(config, 'Библиотека пока не синхронизирована.', 'The library has not been synced yet.');
    await this.sendMessage(config, text, this.markup(rows), messageId);
  }

  private async showLibraryCollection(
    config: CompanionConfigRow, collectionId: string, page: number, messageId?: number
  ): Promise<void> {
    const safePage = Math.max(0, page);
    const items = await getLibraryItems(this.env.DB, this.profileId, collectionId, safePage * 8, 9);
    await this.showLibraryList(config, `${collectionLabel(collectionId)} · ${safePage + 1}`, items, safePage,
      next => `lib_col:${encodeURIComponent(collectionId)}:${next}`, messageId);
  }

  private async showReading(config: CompanionConfigRow, page: number, messageId?: number): Promise<void> {
    const safePage = Math.max(0, page);
    const items = await getReadingItems(this.env.DB, this.profileId, safePage * 8, 9);
    await this.showLibraryList(config, this.tx(config, 'Сейчас читаю / смотрю', 'In progress'), items, safePage,
      next => `lib_reading:${next}`, messageId);
  }

  private async showLibraryList(
    config: CompanionConfigRow, title: string, source: LibraryItemRow[], page: number,
    pageCallback: (page: number) => string, messageId?: number
  ): Promise<void> {
    const hasNext = source.length > 8;
    const items = source.slice(0, 8);
    const rows = items.map(item => [this.button(truncate(item.title, 48), `lib_item:${item.id}`)]);
    const navigation: TelegramButton[] = [];
    if (page > 0) navigation.push(this.button('‹', pageCallback(page - 1)));
    if (hasNext) navigation.push(this.button('›', pageCallback(page + 1)));
    if (navigation.length) rows.push(navigation);
    rows.push([this.button(this.tx(config, 'Библиотека', 'Library'), 'library'), this.button(this.tx(config, 'Меню', 'Menu'), 'menu')]);
    const text = items.length ? title : `${title}\n${this.tx(config, 'Ничего не найдено.', 'Nothing found.')}`;
    await this.sendMessage(config, text, this.markup(rows), messageId);
  }

  private async searchLibraryCommand(config: CompanionConfigRow, query: string): Promise<void> {
    if (!query.trim()) {
      await this.sendMessage(config, this.tx(config, 'Использование: /search название, автор или серия', 'Usage: /search title, author or series'));
      return;
    }
    const items = await searchLibrary(this.env.DB, this.profileId, query, 10);
    const rows = items.map(item => [this.button(truncate(item.title, 48), `lib_item:${item.id}`)]);
    rows.push([this.button(this.tx(config, 'Библиотека', 'Library'), 'library')]);
    await this.sendMessage(config,
      items.length ? `${this.tx(config, 'Результаты поиска', 'Search results')}: ${query}` : this.tx(config, 'Ничего не найдено.', 'Nothing found.'),
      this.markup(rows));
  }

  private async showLibraryItem(config: CompanionConfigRow, id: number, includeCover = true): Promise<void> {
    const item = await getLibraryItem(this.env.DB, this.profileId, id);
    if (!item) { await this.sendMessage(config, this.tx(config, 'Произведение не найдено.', 'Item not found.')); return; }
    if (includeCover && /^https?:\/\//i.test(item.cover_url)) await this.sendRemotePhoto(config, item.cover_url, item.title);
    const authors = parseStringList(item.authors_json).join(', ');
    const genres = parseStringList(item.genres_json).join(', ');
    const details = [
      item.title,
      `${collectionLabel(item.collection_id)}${item.format ? ` · ${item.format}` : ''}`,
      authors ? `${this.tx(config, 'Автор', 'Author')}: ${authors}` : '',
      item.series ? `${this.tx(config, 'Серия', 'Series')}: ${item.series}${item.series_index ? ` #${item.series_index}` : ''}` : '',
      genres ? `${this.tx(config, 'Жанры', 'Genres')}: ${genres}` : '',
      item.status ? `${this.tx(config, 'Статус', 'Status')}: ${item.status}` : '',
      `${this.tx(config, 'Прогресс', 'Progress')}: ${formatMediaProgress(item, config.language)}`,
      item.season || item.episode ? `S${item.season || 0} E${item.episode || 0}` : '',
      item.rating ? `${this.tx(config, 'Рейтинг', 'Rating')}: ${item.rating}` : ''
    ].filter(Boolean).join('\n');
    await this.sendMessage(config, details, this.markup([
      [this.button(`+1 ${shortMediaUnit(item.unit, config.language)}`, `lib_add:${id}:1`), this.button(`+10 ${shortMediaUnit(item.unit, config.language)}`, `lib_add:${id}:10`)],
      [this.button(this.tx(config, 'Указать точно', 'Set exact'), `lib_progress:${id}:exact`), this.button(this.tx(config, 'Свой шаг', 'Custom change'), `lib_progress:${id}:delta`)],
      [this.button('-1', `lib_add:${id}:-1`), this.button('-10', `lib_add:${id}:-10`)],
      ...(item.collection_id === 'series' || item.collection_id === 'anime' ? [[this.button('Season / Episode', `lib_progress:${id}:episode`)]] : []),
      [this.button(this.tx(config, 'Начать', 'Start'), `lib_start:${id}`), this.button(this.tx(config, 'Завершить', 'Finish'), `lib_finish:${id}`)],
      [this.button(this.tx(config, 'Таймер произведения', 'Media timer'), `lib_timer:${id}`)],
      ...(authors ? [[this.button(this.tx(config, 'Страница автора', 'Author page'), `lib_author:${id}`)]] : []),
      ...(item.series ? [[this.button(this.tx(config, 'Страница серии', 'Series page'), `lib_series:${id}`)]] : []),
      [this.button(this.tx(config, 'Редактировать', 'Edit'), `lib_edit:${id}`)],
      [this.button(this.tx(config, 'Библиотека', 'Library'), 'library')]
    ]));
  }

  private async editMediaCommand(config: CompanionConfigRow, query: string): Promise<void> {
    if (!query.trim()) { await this.sendMessage(config, this.tx(config, 'Использование: /editmedia название', 'Usage: /editmedia title')); return; }
    const items = await searchLibrary(this.env.DB, this.profileId, query, 10);
    const rows = items.map(item => [this.button(truncate(item.title, 48), `lib_edit:${item.id}`)]);
    await this.sendMessage(config, items.length ? this.tx(config, 'Выберите произведение.', 'Choose an item.') : this.tx(config, 'Ничего не найдено.', 'Nothing found.'), this.markup(rows));
  }

  private async showEditMedia(config: CompanionConfigRow, id: number): Promise<void> {
    const item = await getLibraryItem(this.env.DB, this.profileId, id);
    if (!item) return;
    await this.sendMessage(config, `${this.tx(config, 'Редактирование', 'Edit')}: ${item.title}`, this.markup([
      [this.button(this.tx(config, 'Статус', 'Status'), `lib_edit_field:${id}:status`), this.button(this.tx(config, 'Авторы', 'Authors'), `lib_edit_field:${id}:authors`)],
      [this.button(this.tx(config, 'Жанры', 'Genres'), `lib_edit_field:${id}:genres`), this.button(this.tx(config, 'Серия', 'Series'), `lib_edit_field:${id}:series`)],
      [this.button(this.tx(config, 'Номер части', 'Part'), `lib_edit_field:${id}:seriesIndex`), this.button(this.tx(config, 'Формат', 'Format'), `lib_edit_field:${id}:format`)],
      [this.button('Total', `lib_edit_field:${id}:total`), this.button(this.tx(config, 'Рейтинг', 'Rating'), `lib_edit_field:${id}:rating`)],
      [this.button(this.tx(config, 'Дата начала', 'Start date'), `lib_edit_field:${id}:startDate`), this.button(this.tx(config, 'Дата завершения', 'End date'), `lib_edit_field:${id}:endDate`)],
      [this.button(this.tx(config, 'Коллекция', 'Collection'), `lib_edit_collection:${id}`), this.button(this.tx(config, 'Удалить', 'Delete'), `lib_delete_ask:${id}`)],
      [this.button(this.tx(config, 'Назад', 'Back'), `lib_item:${id}`)]
    ]));
  }

  private async startEditField(config: CompanionConfigRow, id: number, field: string): Promise<void> {
    const allowed = ['status', 'authors', 'genres', 'series', 'seriesIndex', 'format', 'total', 'rating', 'startDate', 'endDate'];
    if (!allowed.includes(field)) return;
    await saveMediaDraft(this.env.DB, this.profileId, 'edit_field', { mediaId: id, field });
    const hint = field === 'authors' || field === 'genres' ? this.tx(config, 'Несколько значений вводятся через запятую.', 'Separate multiple values with commas.')
      : field === 'rating' ? 'Examples: 7+, 6-, -6'
      : field === 'startDate' || field === 'endDate' ? 'YYYY-MM-DD'
      : this.tx(config, 'Введите новое значение.', 'Enter the new value.');
    await this.sendMessage(config, hint, this.markup([[this.button(this.tx(config, 'Отмена', 'Cancel'), 'addmedia_cancel')]]));
  }

  private async showEditCollection(config: CompanionConfigRow, id: number): Promise<void> {
    const collections = await getLibraryCollections(this.env.DB, this.profileId);
    const rows = chunk(collections.map(value => this.button(collectionLabel(value.collection_id), `lib_edit_collection_set:${id}:${encodeURIComponent(value.collection_id)}`)), 2);
    await this.sendMessage(config, this.tx(config, 'Выберите новую коллекцию.', 'Choose a new collection.'), this.markup(rows));
  }

  private async applyEdit(config: CompanionConfigRow, id: number, changes: Record<string, unknown>): Promise<void> {
    const { date } = zonedParts(Date.now(), config.timezone);
    const item = await editLibraryItem(this.env.DB, this.profileId, id, changes, date);
    if (item) await this.showLibraryItem(config, item.id, false);
  }

  private async showAuthorChoices(config: CompanionConfigRow, itemId: number): Promise<void> {
    const item = await getLibraryItem(this.env.DB, this.profileId, itemId);
    if (!item) return;
    const authors = parseStringList(item.authors_json);
    if (authors.length === 1) { await this.showAuthorPage(config, itemId, 0); return; }
    const rows = authors.map((author, index) => [this.button(truncate(author, 45), `lib_author_pick:${itemId}:${index}`)]);
    await this.sendMessage(config, this.tx(config, 'Выберите автора.', 'Choose an author.'), this.markup(rows));
  }

  private async showAuthorPage(config: CompanionConfigRow, itemId: number, authorIndex: number): Promise<void> {
    const source = await getLibraryItem(this.env.DB, this.profileId, itemId);
    const author = source ? parseStringList(source.authors_json)[authorIndex] : '';
    if (!author) return;
    const items = await getLibraryByAuthor(this.env.DB, this.profileId, author);
    const finished = items.filter(item => item.finished_status && item.status.toLocaleLowerCase() === item.finished_status.toLocaleLowerCase()).length;
    const ratings = items.map(item => Number(item.rating.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.'))).filter(Number.isFinite);
    const average = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) : '-';
    const rows = items.slice(0, 20).map(item => [this.button(truncate(item.title, 45), `lib_item:${item.id}`)]);
    rows.push([this.button(this.tx(config, 'Библиотека', 'Library'), 'library')]);
    await this.sendMessage(config, `${author}\n${this.tx(config, 'Произведений', 'Items')}: ${items.length}\n${this.tx(config, 'Завершено', 'Finished')}: ${finished}\n${this.tx(config, 'Средний рейтинг', 'Average rating')}: ${average}`, this.markup(rows));
  }

  private async showSeriesPage(config: CompanionConfigRow, itemId: number): Promise<void> {
    const source = await getLibraryItem(this.env.DB, this.profileId, itemId);
    if (!source?.series) return;
    const items = await getLibraryBySeries(this.env.DB, this.profileId, source.series);
    const finished = items.filter(item => item.finished_status && item.status.toLocaleLowerCase() === item.finished_status.toLocaleLowerCase()).length;
    const total = items.reduce((sum, item) => sum + Math.max(0, item.total), 0);
    const progress = items.reduce((sum, item) => sum + Math.max(0, Math.min(item.total || item.progress, item.progress)), 0);
    const percent = total > 0 ? Math.round(progress / total * 100) : 0;
    const next = items.find(item => !item.finished_status || item.status.toLocaleLowerCase() !== item.finished_status.toLocaleLowerCase());
    const rows = items.slice(0, 20).map(item => [this.button(`${item.series_index ? `${item.series_index}. ` : ''}${truncate(item.title, 40)}`, `lib_item:${item.id}`)]);
    if (next) rows.unshift([this.button(this.tx(config, 'Следующая часть', 'Next part'), `lib_item:${next.id}`)]);
    rows.push([this.button(this.tx(config, 'Библиотека', 'Library'), 'library')]);
    await this.sendMessage(config, `${source.series}\n${this.tx(config, 'Частей', 'Parts')}: ${items.length}\n${this.tx(config, 'Завершено', 'Finished')}: ${finished}\n${this.tx(config, 'Общий прогресс', 'Overall progress')}: ${percent}%`, this.markup(rows));
  }

  private async changeLibraryProgress(config: CompanionConfigRow, id: number, amount: number, finish: boolean): Promise<void> {
    const { date, time } = zonedParts(Date.now(), config.timezone);
    const current = await getLibraryItem(this.env.DB, this.profileId, id);
    const item = finish
      ? await updateLibraryProgress(this.env.DB, this.profileId, id, 0, date, true, time)
      : current ? await setLibraryProgress(this.env.DB, this.profileId, id, current.progress + amount, date, { delta: amount, time }) : null;
    if (!item) await this.sendMessage(config, this.tx(config, 'Произведение не найдено.', 'Item not found.'));
    else await this.showLibraryItem(config, item.id, false);
  }

  private async startProgressInput(config: CompanionConfigRow, id: number, mode: string, sessionId?: string): Promise<void> {
    const item = await getLibraryItem(this.env.DB, this.profileId, id);
    if (!item) return;
    const step = mode === 'delta' ? 'progress_delta' : mode === 'episode' ? 'progress_episode' : 'progress_exact';
    await saveMediaDraft(this.env.DB, this.profileId, step, { mediaId: id, sessionId });
    const prompt = step === 'progress_delta'
      ? this.tx(config,
          `Сколько ${mediaUnitLabel(item.unit, 'ru')} добавить? Например: 25 или -5.`,
          `How many ${mediaUnitLabel(item.unit, 'en')} should be added? For example: 25 or -5.`)
      : step === 'progress_episode'
        ? this.tx(config, 'Введите сезон и эпизод, например S2E5.', 'Enter season and episode, for example S2E5.')
        : isAudiobook(item)
          ? this.tx(config, 'Введите точный прогресс в минутах или как 1:25:30.', 'Enter exact minutes or a duration such as 1:25:30.')
          : this.tx(config,
              item.unit.toLocaleLowerCase() === 'pages' ? 'До какой страницы вы дошли?' : `До какой позиции вы дошли (${mediaUnitLabel(item.unit, 'ru')})?`,
              item.unit.toLocaleLowerCase() === 'pages' ? 'What page did you reach?' : `What position did you reach (${mediaUnitLabel(item.unit, 'en')})?`);
    await this.sendMessage(config, prompt, this.markup([[this.button(this.tx(config, 'Отмена', 'Cancel'), 'addmedia_cancel')]]));
  }

  private async queueProgressNote(
    config: CompanionConfigRow, data: Record<string, unknown>, progress: number, delta: number,
    season?: number, episode?: number
  ): Promise<void> {
    data.pendingProgress = { progress, delta, season, episode };
    await saveMediaDraft(this.env.DB, this.profileId, 'progress_note', data);
    await this.promptMediaDraft(config, this.tx(config, 'Добавьте комментарий к сессии.', 'Add a session note.'));
  }

  private async startMedia(config: CompanionConfigRow, id: number): Promise<void> {
    const { date } = zonedParts(Date.now(), config.timezone);
    const item = await startLibraryItem(this.env.DB, this.profileId, id, date);
    if (!item) await this.sendMessage(config, this.tx(config, 'Произведение не найдено.', 'Item not found.'));
    else await this.showLibraryItem(config, item.id, false);
  }

  private async showToday(config: CompanionConfigRow, messageId?: number): Promise<void> {
    const { date } = zonedParts(Date.now(), config.timezone);
    const snapshots = (await this.snapshots(config, date, 30)).slice(0, 20);
    const lines = [this.tx(config, 'Сегодня', 'Today')];
    const rows: TelegramButton[][] = [];
    const habits = parseHabits(config);
    for (const snapshot of snapshots) {
      const today = snapshot.days.at(-1)!;
      const index = habits.findIndex(value => value.name === snapshot.habit.name);
      lines.push(`${stateSymbol(today.state)} ${snapshot.habit.name}: ${formatValue(snapshot.habit, today.value)} / ${formatValue(snapshot.habit, today.desired)}`);
      const type = snapshot.habit.type || 'timer';
      rows.push([
        this.button(type === 'timer' ? '+10 min' : type === 'count' ? '+1' : this.tx(config, 'Готово', 'Done'), `quick:${index}:${type === 'timer' ? 'add10' : type === 'count' ? 'add1' : 'toggle'}`),
        this.button(this.tx(config, 'Статус', 'State'), `state_menu:${index}`), this.button(this.tx(config, 'Карта', 'Map'), `habit_card:${index}`)
      ]);
    }
    lines.push(...await this.dailyGoalLines(habits, config, date));
    const media = await getReadingItems(this.env.DB, this.profileId, 0, 8);
    const tasks = (await getActiveProjectTasks(this.env.DB, this.profileId, date, 8))
      .filter(task => task.end_date && task.end_date <= date);
    if (media.length) {
      lines.push('', this.tx(config, 'Сейчас в процессе:', 'Currently in progress:'));
      for (const item of media) {
        lines.push(`- ${truncate(item.title, 80)}`);
        rows.push([this.button(truncate(item.title, 48), `lib_item:${item.id}`)]);
      }
    }
    if (tasks.length) {
      lines.push('', this.tx(config, 'Задачи на сегодня и просроченные:', 'Tasks due today and overdue:'));
      tasks.forEach(task => lines.push(`- ${truncate(task.task_name, 80)} (${task.end_date})`));
    }
    rows.push([this.button(this.tx(config, 'Полный план', 'Full plan'), 'plan:0')]);
    rows.push([this.button(this.tx(config, 'Таймер', 'Timer'), 'timers'), this.button(this.tx(config, 'Картинка', 'Image'), 'daily_card'), this.button(this.tx(config, 'Меню', 'Menu'), 'menu')]);
    await this.sendMessage(config, lines.join('\n'), this.markup(rows), messageId);
  }

  private async showTimerHabits(config: CompanionConfigRow, messageId?: number): Promise<void> {
    if (await getTimer(this.env.DB, this.profileId)) { await this.showTimerStatus(config, messageId); return; }
    const habits = parseHabits(config);
    const buttons = habits.map((habit, index) => ({ habit, index }))
      .filter(({ habit }) => (habit.type || 'timer') === 'timer')
      .map(({ habit, index }) => this.button(habit.name, `timer_habit:${index}`));
    const rows = chunk(buttons, 2); rows.push([this.button(this.tx(config, 'Назад', 'Back'), 'menu')]);
    await this.sendMessage(config, this.tx(config, 'Выберите привычку:', 'Choose a habit:'), this.markup(rows), messageId);
  }

  private async showMediaTimerHabits(config: CompanionConfigRow, mediaId: number): Promise<void> {
    if (await getTimer(this.env.DB, this.profileId)) { await this.showTimerStatus(config); return; }
    const item = await getLibraryItem(this.env.DB, this.profileId, mediaId);
    if (!item) return;
    const linked = parseHabits(config).map((habit, index) => ({ habit, index }))
      .filter(({ habit }) => (habit.type || 'timer') === 'timer' && habitLinksCollection(habit, item.collection_id));
    if (linked.length === 1 && linked[0]) {
      await this.showMediaTimerDurations(config, mediaId, linked[0].index);
      return;
    }
    if (!linked.length) {
      await this.sendMessage(config,
        `${item.title}\n${this.tx(config, 'Для этой коллекции не настроена связанная привычка.', 'No linked habit is configured for this collection.')}`,
        this.markup([[this.button(this.tx(config, 'Назад', 'Back'), `lib_item:${mediaId}`)]])
      );
      return;
    }
    const buttons = linked
      .map(({ habit, index }) => this.button(habit.name, `lib_timer_habit:${mediaId}:${index}`));
    const rows = chunk(buttons, 2); rows.push([this.button(this.tx(config, 'Назад', 'Back'), `lib_item:${mediaId}`)]);
    await this.sendMessage(config, `${item.title}\n${this.tx(config, 'Выберите связанную привычку.', 'Choose a linked habit.')}`, this.markup(rows));
  }

  private async showHabitMediaChoices(config: CompanionConfigRow, habit: HabitConfig, messageId?: number): Promise<void> {
    const habitIndex = parseHabits(config).findIndex(value => value.name === habit.name);
    const configured = new Set((habit.mediaCollections || []).map(value => value.toLocaleLowerCase()));
    if (!configured.size) {
      await this.showDurations(config, habit, messageId);
      return;
    }
    const media = (await getReadingItems(this.env.DB, this.profileId, 0, 50))
      .filter(item => configured.has(item.collection_id.toLocaleLowerCase()));
    const rows: TelegramButton[][] = media.slice(0, 20).map(item => [
      this.button(truncate(`[${collectionLabel(item.collection_id)}] ${item.title}`, 52), `timer_media_pick:${habitIndex}:${item.id}`)
    ]);
    rows.push([
      this.button(this.tx(config, 'Обновить', 'Refresh'), `timer_media_choices:${habitIndex}`),
      this.button(this.tx(config, 'Без произведения', 'Without media'), `timer_plain:${habitIndex}`)
    ]);
    rows.push([this.button(this.tx(config, 'Назад', 'Back'), 'timers')]);
    const collections = [...configured].map(id => {
      const goal = habit.mediaGoals?.[id];
      return goal ? `${collectionLabel(id)} (${goal.goal} ${mediaUnitLabel(goal.unit, config.language)}/${this.tx(config, 'день', 'day')})` : collectionLabel(id);
    }).join(', ');
    const empty = media.length ? '' : `\n${this.tx(config, 'Активные произведения не найдены.', 'No active media found.')}`;
    await this.sendMessage(config,
      `${habit.name}\n${this.tx(config, 'Выберите произведение', 'Choose media')}: ${collections}${empty}`,
      this.markup(rows), messageId
    );
  }

  private async showMediaTimerDurations(
    config: CompanionConfigRow, mediaId: number, habitIndex: number, backCallback?: string
  ): Promise<void> {
    const habit = this.habitAt(config, String(habitIndex));
    const item = await getLibraryItem(this.env.DB, this.profileId, mediaId);
    if (!habit || !item) return;
    await this.sendMessage(config, `${habit.name}\n${item.title}`, this.markup([
      [this.button('25 min', `lib_timer_start:${mediaId}:${habitIndex}:25`), this.button('45 min', `lib_timer_start:${mediaId}:${habitIndex}:45`)],
      [this.button('60 min', `lib_timer_start:${mediaId}:${habitIndex}:60`), this.button(this.tx(config, 'Без ограничения', 'No limit'), `lib_timer_start:${mediaId}:${habitIndex}:0`)],
      [this.button(this.tx(config, 'Назад', 'Back'), backCallback || `lib_timer:${mediaId}`)]
    ]));
  }

  private async showDurations(config: CompanionConfigRow, habit: HabitConfig, messageId?: number): Promise<void> {
    const index = parseHabits(config).findIndex(value => value.name === habit.name);
    await this.sendMessage(config, `${this.tx(config, 'Таймер', 'Timer')}: ${habit.name}`, this.markup([
      [this.button('25 min', `timer_start:${index}:25`), this.button('45 min', `timer_start:${index}:45`), this.button('60 min', `timer_start:${index}:60`)],
      [this.button(this.tx(config, 'Без ограничения', 'No limit'), `timer_start:${index}:0`)], [this.button(this.tx(config, 'Назад', 'Back'), 'timers')]
    ]), messageId);
  }

  private async showTimerStatus(config: CompanionConfigRow, messageId?: number): Promise<void> {
    const timer = await getTimer(this.env.DB, this.profileId);
    if (!timer) { await this.showTimerHabits(config, messageId); return; }
    const elapsed = timerElapsed(timer);
    const remaining = timer.target_seconds ? `\n${this.tx(config, 'Осталось', 'Remaining')}: ${formatSeconds(Math.max(0, timer.target_seconds - elapsed))}` : '';
    await this.sendMessage(config, `${timer.habit_name}\n${this.tx(config, 'Прошло', 'Elapsed')}: ${formatSeconds(elapsed)}${remaining}`, this.markup([
      [this.button(timer.timer_state === 'running' ? this.tx(config, 'Пауза', 'Pause') : this.tx(config, 'Продолжить', 'Resume'), timer.timer_state === 'running' ? 'timer_pause' : 'timer_resume')],
      [this.button(this.tx(config, 'Завершить и записать', 'Finish and log'), 'timer_finish'), this.button(this.tx(config, 'Отменить', 'Cancel'), 'timer_cancel')],
      [this.button(this.tx(config, 'Обновить', 'Refresh'), 'timer_status')]
    ]), messageId);
  }

  private async startSelected(config: CompanionConfigRow, habit: HabitConfig, minutes: number, mediaId: number | null = null): Promise<void> {
    const { time } = zonedParts(Date.now(), config.timezone);
    const started = await startTimer(this.env.DB, this.profileId, habit.name, minutes > 0 ? minutes * 60 : null, time, mediaId);
    if (!started) await this.sendMessage(config, this.tx(config, 'Уже запущен другой таймер.', 'Another timer is already active.'));
    else await this.showTimerStatus(config);
  }

  private async finishActiveTimer(config: CompanionConfigRow): Promise<void> {
    const { date, time } = zonedParts(Date.now(), config.timezone);
    const result = await finishTimer(this.env.DB, this.profileId, date, time);
    if (!result) await this.sendMessage(config, this.tx(config, 'Нет активного таймера.', 'No active timer.'));
    else {
      await this.sendMessage(config, `${this.tx(config, 'Сессия сохранена', 'Session saved')}: ${formatSeconds(result.elapsed)}.`);
      if (result.timer.media_id) await this.finishMediaTimer(config, result.timer, result.elapsed, date, time);
      else await this.showToday(config);
    }
  }

  private async finishMediaTimer(
    config: CompanionConfigRow, timer: TimerRow, elapsed: number, date: string, time: string
  ): Promise<void> {
    if (!timer.media_id) return;
    const item = await getLibraryItem(this.env.DB, this.profileId, timer.media_id);
    if (!item) return;
    await recordLibraryTimerSession(this.env.DB, this.profileId, item.id, date, time, elapsed);
    const normalizedUnit = item.unit.trim().toLocaleLowerCase();
    const automaticDelta = isAudiobook(item) || normalizedUnit === 'minutes'
      ? Math.round(elapsed / 60 * 100) / 100
      : normalizedUnit === 'hours' ? Math.round(elapsed / 3600 * 100) / 100 : null;
    if (automaticDelta !== null) {
      await setLibraryProgress(this.env.DB, this.profileId, item.id, item.progress + automaticDelta, date, {
        delta: automaticDelta, note: this.tx(config, 'Таймер Telegram', 'Telegram timer'), time,sessionId:timer.session_id||undefined
      });
      await this.showLibraryItem(config, item.id, false);
    } else {
      await this.sendMessage(config, this.tx(config,
        'Время сохранено. Как записать прогресс произведения?',
        'Time was saved. How should media progress be recorded?'), this.markup([
        [
          this.button(this.tx(config, `Добавить ${mediaUnitLabel(item.unit, 'ru')}`, `Add ${mediaUnitLabel(item.unit, 'en')}`), `lib_progress:${item.id}:delta${timer.session_id?':'+timer.session_id:''}`),
          this.button(this.tx(config, 'Указать позицию', 'Set current position'), `lib_progress:${item.id}:exact${timer.session_id?':'+timer.session_id:''}`)
        ],
        [this.button(this.tx(config, 'Без изменения прогресса', 'Keep progress unchanged'), `lib_item:${item.id}`)]
      ]));
    }
  }

  private async showHabitChoices(config: CompanionConfigRow, messageId?: number): Promise<void> {
    const buttons = parseHabits(config).map((habit, index) => this.button(habit.name, `habit_card:${index}`));
    const rows = chunk(buttons, 2); rows.push([this.button(this.tx(config, 'Назад', 'Back'), 'menu')]);
    await this.sendMessage(config, this.tx(config, 'Выберите карту привычки:', 'Choose a habit map:'), this.markup(rows), messageId);
  }

  private async sendHabitCard(config: CompanionConfigRow, habit: HabitConfig): Promise<void> {
    const { date } = zonedParts(Date.now(), config.timezone);
    const snapshot = (await this.snapshots(config, date, 84)).find(value => value.habit.name === habit.name);
    if (!snapshot) return;
    await this.sendPhoto(config, renderHabitCard(snapshot), `${habit.name}. ${this.tx(config, 'Статистика за 12 недель.', 'Statistics for 12 weeks.')}`, this.markup([
      [this.button(this.tx(config, 'Сегодня', 'Today'), 'today'), this.button(this.tx(config, 'Другая привычка', 'Another habit'), 'habit_choices')]
    ]));
  }

  private async showStates(config: CompanionConfigRow, habit: HabitConfig, messageId?: number): Promise<void> {
    const index = parseHabits(config).findIndex(value => value.name === habit.name);
    await this.sendMessage(config, `${this.tx(config, 'Состояние', 'State')}: ${habit.name}`, this.markup([
      [this.button(this.tx(config, 'Выполнено', 'Completed'), `state:${index}:completed`), this.button(this.tx(config, 'Частично', 'Partial'), `state:${index}:partial`)],
      [this.button(this.tx(config, 'Пропущено', 'Skipped'), `state:${index}:skipped`), this.button(this.tx(config, 'Уважительный пропуск', 'Excused'), `state:${index}:excused`)],
      [this.button(this.tx(config, 'Перенести', 'Defer'), `state:${index}:deferred`)],
      [this.button(this.tx(config, 'Автоматически', 'Automatic'), `state:${index}:auto`), this.button(this.tx(config, 'Назад', 'Back'), 'today')]
    ]), messageId);
  }

  private async applyQuick(config: CompanionConfigRow, habit: HabitConfig, action: string): Promise<void> {
    const { date, time } = zonedParts(Date.now(), config.timezone);
    if (action === 'add10') await addHabitValue(this.env.DB, this.profileId, habit.name, date, 600, 'add_timer', { startTime: time, endTime: time, mode: 'Telegram manual' });
    else if (action === 'add1') await addHabitValue(this.env.DB, this.profileId, habit.name, date, 1, 'add_count');
    else if (action === 'toggle') {
      const snapshots = await this.snapshots(config, date, 1); const current = snapshots.find(value => value.habit.name === habit.name)?.days.at(-1)?.value || 0;
      await setHabitValue(this.env.DB, this.profileId, habit.name, date, current ? 0 : 1);
    }
  }

  private async applyState(config: CompanionConfigRow, habit: HabitConfig, rawState: string): Promise<void> {
    const { date } = zonedParts(Date.now(), config.timezone);
    const allowed = ['completed', 'partial', 'skipped', 'excused', 'deferred'] as const;
    const state = allowed.includes(rawState as typeof allowed[number]) ? rawState as HabitState : null;
    const payload = state === 'deferred' ? { deferredTo: addDays(date, 1), deferredAmount: habitGoals(habit, date).desired } : {};
    await setHabitState(this.env.DB, this.profileId, habit.name, date, state, payload);
  }

  private async startFromText(config: CompanionConfigRow, args: string): Promise<void> {
    const match = args.match(/^(.*?)(?:\s+(\d+))?$/); const habit = findHabit(parseHabits(config), match?.[1]?.trim() || '');
    if (!habit || (habit.type || 'timer') !== 'timer') { await this.sendMessage(config, this.tx(config, 'Привычка не найдена.', 'Habit not found.')); return; }
    await this.startSelected(config, habit, match?.[2] ? Number(match[2]) : 0);
  }

  private async addFromText(config: CompanionConfigRow, args: string): Promise<void> {
    const match = args.match(/^(.*?)\s+([+-]?\d+(?:[.,]\d+)?)$/); const habit = findHabit(parseHabits(config), match?.[1]?.trim() || '');
    const amount = Number((match?.[2] || '').replace(',', '.'));
    if (!habit || !Number.isFinite(amount)) { await this.sendMessage(config, this.tx(config, 'Формат: /add Название 10', 'Format: /add Habit 10')); return; }
    const { date, time } = zonedParts(Date.now(), config.timezone); const type = habit.type || 'timer';
    if (type === 'timer') await addHabitValue(this.env.DB, this.profileId, habit.name, date, amount * 60, 'add_timer', { startTime: time, endTime: time, mode: 'Telegram manual' });
    else if (type === 'count') await addHabitValue(this.env.DB, this.profileId, habit.name, date, amount, 'add_count');
    await this.showToday(config);
  }

  private async snapshots(config: CompanionConfigRow, date: string, days: number) {
    const values = await getValues(this.env.DB, this.profileId, addDays(date, -Math.max(days, 84)), date);
    return createSnapshots(parseHabits(config), values, date, days);
  }

  private async sendMessage(config: CompanionConfigRow, text: string, markup?: TelegramMarkup, messageId?: number): Promise<boolean> {
    const result = await this.api(messageId ? 'editMessageText' : 'sendMessage', {
      chat_id: config.chat_id, text, ...(messageId ? { message_id: messageId } : {}), ...(markup ? { reply_markup: markup } : {})
    });
    return result;
  }

  private async sendPhoto(config: CompanionConfigRow, png: Uint8Array, caption: string, markup?: TelegramMarkup): Promise<boolean> {
    const form = new FormData(); form.set('chat_id', config.chat_id); form.set('caption', caption);
    if (markup) form.set('reply_markup', JSON.stringify(markup));
    const image = new Uint8Array(png.length); image.set(png);
    form.set('photo', new Blob([image.buffer], { type: 'image/png' }), 'habit-stats.png');
    const response = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
    return response.ok;
  }

  private async sendRemotePhoto(config: CompanionConfigRow, url: string, caption: string): Promise<boolean> {
    return this.api('sendPhoto', { chat_id: config.chat_id, photo: url, caption: truncate(caption, 900) });
  }

  private async answerCallback(id: string): Promise<void> { await this.api('answerCallbackQuery', { callback_query_id: id }); }
  private async api(method: string, body: Record<string, unknown>): Promise<boolean> {
    const response = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return response.ok;
  }
  private habitAt(config: CompanionConfigRow, raw: string | undefined): HabitConfig | undefined { const index = Number(raw); return Number.isInteger(index) ? parseHabits(config)[index] : undefined; }
  private button(text: string, callbackData: string): TelegramButton { return { text, callback_data: callbackData }; }
  private markup(rows: TelegramButton[][]): TelegramMarkup { return { inline_keyboard: rows }; }
  private tx(config: CompanionConfigRow, ru: string, en: string): string { return config.language === 'ru' ? ru : en; }
}

export function dailyMediaGoalLines(
  habits: HabitConfig[], language: 'ru' | 'en', date = '',
  library: LibraryItemRow[] = [], events: CompanionEventRow[] = []
): string[] {
  const goals = new Map<string, NonNullable<HabitConfig['mediaGoals']>[string]>();
  for (const habit of habits) {
    for (const [id, goal] of Object.entries(habit.mediaGoals || {})) {
      const key = id.trim().toLocaleLowerCase();
      if (key && Number.isFinite(goal.goal) && goal.goal > 0 && !goals.has(key)) goals.set(key, goal);
    }
  }
  if (!goals.size) return [];
  return ['', language === 'ru' ? 'Дневные нормы:' : 'Daily goals:', ...[...goals].map(([id, goal]) => {
    const items = library.filter(item => item.collection_id.trim().toLocaleLowerCase() === id);
    const baseline = goal.daily?.date === date ? goal.daily : undefined;
    let value = Number.isFinite(baseline?.value) ? Math.max(0, baseline!.value) : 0;
    if (goal.unit === 'items') {
      value = items.filter(item => item.finished_status && item.status.trim().toLocaleLowerCase() === item.finished_status.trim().toLocaleLowerCase()
        && item.end_date?.slice(0, 10) === date).length;
    } else {
      const byPath = new Map(items.map(item => [item.item_path, item]));
      for (const event of events) {
        if (event.habit_date !== date || event.sequence <= (baseline?.throughSequence || 0)) continue;
        const item = byPath.get(event.habit_name);
        if (!item) continue;
        try {
          const payload = JSON.parse(event.payload_json);
          const delta = Number(payload?.progressLog?.delta);
          const unit = /audio|аудио/i.test(item.format) ? 'minutes' : item.unit || goal.unit;
          value += convertDailyProgress(delta, unit, goal.unit);
        } catch { /* Ignore malformed historical events. */ }
      }
    }
    return `- ${collectionLabel(id)}: ${Math.round(value * 100) / 100} / ${goal.goal} ${mediaUnitLabel(goal.unit, language)}`;
  })];
}

function findHabit(habits: HabitConfig[], name: string): HabitConfig | undefined { const normalized = name.toLocaleLowerCase(); return habits.find(habit => habit.name.toLocaleLowerCase() === normalized); }
export function habitLinksCollection(habit: HabitConfig, collectionId: string): boolean {
  const normalized = collectionId.trim().toLocaleLowerCase();
  return (habit.mediaCollections || []).some(value => value.trim().toLocaleLowerCase() === normalized)
    || Object.keys(habit.mediaGoals || {}).some(value => value.trim().toLocaleLowerCase() === normalized);
}
function chunk<T>(items: T[], size: number): T[][] { const result: T[][] = []; for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size)); return result; }
function formatSeconds(seconds: number): string { const value = Math.max(0, Math.round(seconds)); return `${String(Math.floor(value / 3600)).padStart(2,'0')}:${String(Math.floor(value % 3600 / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`; }
function stateSymbol(state: HabitState): string { if (state === 'completed') return '[x]'; if (state === 'partial') return '[/]'; if (state === 'excused') return '[-]'; if (state === 'deferred') return '[>]'; return '[ ]'; }
export function truncate(value: string, length: number): string { return value.length <= length ? value : `${value.slice(0, Math.max(1, length - 1))}…`; }
export function parseStringList(value: string): string[] { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []; } catch { return []; } }
export function collectionLabel(value: string): string {
  const labels: Record<string, string> = { book: 'Books', manga: 'Manga', film: 'Films', anime: 'Anime', series: 'Series', game: 'Games', course: 'Courses' };
  return labels[value.toLowerCase()] || value;
}
export function formatMediaProgress(item: LibraryItemRow, language: 'ru' | 'en' = 'en'): string {
  const progress = Number.isInteger(item.progress) ? String(item.progress) : item.progress.toFixed(1);
  const total = Number.isInteger(item.total) ? String(item.total) : item.total.toFixed(1);
  const unit = item.unit ? ` ${mediaUnitLabel(item.unit, language)}` : '';
  return item.total > 0 ? `${progress} / ${total}${unit}` : `${progress}${unit}`;
}
function mediaUnitLabel(unit: string, language: 'ru' | 'en'): string {
  const normalized = unit.trim().toLocaleLowerCase();
  const labels: Record<string, [string, string]> = {
    pages: ['pages', 'страниц'], items: ['items', 'произведений'], episodes: ['episodes', 'эпизодов'],
    chapters: ['chapters', 'глав'], minutes: ['minutes', 'минут'], hours: ['hours', 'часов'],
    lessons: ['lessons', 'уроков'], units: ['units', 'единиц']
  };
  const label = labels[normalized];
  return label ? label[language === 'ru' ? 1 : 0] : unit || (language === 'ru' ? 'единиц' : 'units');
}
function shortMediaUnit(unit: string, language: 'ru' | 'en'): string {
  const normalized = unit.trim().toLocaleLowerCase();
  const labels: Record<string, [string, string]> = {
    pages: ['pg', 'стр'], items: ['item', 'шт'], episodes: ['ep', 'эп'], chapters: ['ch', 'гл'],
    minutes: ['min', 'мин'], hours: ['h', 'ч'], lessons: ['lesson', 'ур'], units: ['unit', 'ед']
  };
  const label = labels[normalized];
  return label ? label[language === 'ru' ? 1 : 0] : '';
}
function parseDraftData(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}
export function splitValues(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean))];
}
function forwardedSource(message?: import('./types').TelegramMessage): string {
  if (!message) return '';
  const origin = message.forward_origin;
  const user = origin?.sender_user;
  const userName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;
  return origin?.sender_user_name || userName || origin?.chat?.title || origin?.chat?.username
    || message.forward_sender_name || message.forward_from_chat?.title || message.forward_from_chat?.username || '';
}
function isAudiobook(item: LibraryItemRow): boolean { return /audio/i.test(item.format); }
export function parseMediaNumber(value: string, durationMode: boolean): number | null {
  const normalized = value.trim().replace(',', '.');
  if (durationMode && normalized.includes(':')) {
    const parts = normalized.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part) || part < 0) || parts.length < 2 || parts.length > 3) return null;
    const seconds = parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!;
    return Math.round(seconds / 60 * 100) / 100;
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
import { snoozeTask } from './task-reminders';
