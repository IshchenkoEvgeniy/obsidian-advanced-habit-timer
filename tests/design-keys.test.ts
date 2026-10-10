import { describe, expect, it } from 'vitest';
import { shortcutLetter } from '../src/design/keys';

describe('letter shortcuts work on any keyboard layout', () => {
    it('reads the physical letter when the layout produces Cyrillic', () => {
        expect(shortcutLetter({ key: 'я', code: 'KeyZ' })).toBe('z');
        expect(shortcutLetter({ key: 'Я', code: 'KeyZ' })).toBe('z');
        expect(shortcutLetter({ key: 'ф', code: 'KeyA' })).toBe('a');
        expect(shortcutLetter({ key: 'и', code: 'KeyB' })).toBe('b');
    });

    it('keeps Latin letters and falls back to key for non-letter keys', () => {
        expect(shortcutLetter({ key: 'Z', code: 'KeyZ' })).toBe('z');
        expect(shortcutLetter({ key: '=', code: 'Equal' })).toBe('=');
        expect(shortcutLetter({ key: 'Enter', code: 'Enter' })).toBe('enter');
    });
});
