import { writable } from 'svelte/store';
import { TFile } from 'obsidian';

export const timerSeconds = writable<number>(0);
export const timerMode = writable<'timer'|'pm'>('timer');
export const isRunning = writable<boolean>(false);
export const sessionStartTime = writable<string | null>(null);

export const selectedHabit = writable<string>('');
export const selectedSubTask = writable<string>('');
export const selectedBook = writable<string>('');
export const sessionNote = writable<string>('');

export const activeTab = writable<'timer'|'habits'>('timer');
export const activeProjectTaskFile = writable<TFile | null>(null);
export const activeProjectTaskName = writable<string | null>(null);
export const isSingleFileTask = writable<boolean>(false);

export const pastHistory = writable<{ date: string, durationSec: number }[]>([]);
export const baseSecondsToday = writable<number>(0);
