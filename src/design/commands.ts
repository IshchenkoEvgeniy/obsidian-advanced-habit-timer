/**
 * Board keyboard commands as pure functions, so the mapping is testable without a DOM.
 * Letters come from `shortcutLetter` (physical key, layout-independent); brackets are matched by `event.code`.
 */
export type BoardCommand = 'undo' | 'redo' | 'duplicate' | 'selectAll' | 'copy' | 'cut' | 'paste' | 'search' | 'group' | 'ungroup' | 'lock' | 'parent' | 'back' | 'forward';

export function letterCommand(letter: string, modifier: boolean, shift: boolean): BoardCommand | undefined {
    if (!modifier) return undefined;
    switch (letter) {
        case 'z': return shift ? 'redo' : 'undo';
        case 'y': return 'redo';
        case 'd': return 'duplicate';
        case 'a': return 'selectAll';
        case 'c': return 'copy';
        case 'x': return 'cut';
        case 'v': return 'paste';
        case 'f': return 'search';
        case 'g': return shift ? 'ungroup' : 'group';
        case 'l': return shift ? 'lock' : undefined;
        case 'u': return 'parent';
        default: return undefined;
    }
}

export function codeCommand(code: string, modifier: boolean): BoardCommand | undefined {
    if (!modifier) return undefined;
    if (code === 'BracketLeft') return 'back';
    if (code === 'BracketRight') return 'forward';
    return undefined;
}
