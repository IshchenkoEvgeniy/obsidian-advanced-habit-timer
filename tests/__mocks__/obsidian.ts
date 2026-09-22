/**
 * Minimal manual mock of the 'obsidian' package.
 *
 * The real obsidian package is a native Obsidian module that doesn't exist
 * outside the Obsidian desktop app. This mock provides just enough surface
 * area for our pure-logic utility functions to be testable in Node/vitest.
 *
 * Only add what's actually imported by the files under test.
 * Do NOT try to replicate full Obsidian behaviour here.
 */

// TFile-like object — only the fields our utils access
export class TFile {
    basename: string;
    path: string;
    stat: { mtime: number; ctime: number; size: number };

    constructor(path?: string) {
        this.path = path ?? '';
        this.basename = path?.split('/').pop()?.replace(/\.md$/, '') ?? '';
        this.stat = { mtime: 0, ctime: 0, size: 0 };
    }
}

// moment stub — returns a basic object with format()
export function moment(arg?: string) {
    const Moment = {
        format: (fmt: string) => new Date().toISOString().slice(0, 10),
    };
    return Moment;
}

// App stub — empty, tests that need it can override
export class App {}

// Stub the rest so import { X } from 'obsidian' doesn't throw
export class Modal { constructor(_app: App) {} }
export class Notice { constructor(_msg: string) {} }
export class Setting { constructor(_el: HTMLElement) {} }
export class SuggestModal { constructor(_app: App) {} }
export class ItemView {}
export class MarkdownRenderer {}
export class ButtonComponent {}
export class Platform {}
export const WorkspaceLeaf = {};
