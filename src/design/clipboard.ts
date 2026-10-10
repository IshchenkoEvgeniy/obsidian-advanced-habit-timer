import type { BoardItem, DesignBoard } from './types';
/** Shared only inside the plugin; never copies note data into board files. */
export const designClipboard: { value?: { board: DesignBoard; selected: string[] }; text?: string; style?: Partial<BoardItem> } = {};
