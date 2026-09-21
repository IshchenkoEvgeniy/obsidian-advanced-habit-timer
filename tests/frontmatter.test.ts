import { describe, expect, it } from 'vitest';
import { getStringArrayAny } from '../src/utils/frontmatter';
import type { Frontmatter } from '../src/utils/frontmatter';

describe('getStringArrayAny', () => {
    it('keeps Obsidian list properties as separate values', () => {
        const fm: Frontmatter = { Author: ['Илья Ильф', 'Евгений Петров'] };
        expect(getStringArrayAny(fm, ['Author'])).toEqual(['Илья Ильф', 'Евгений Петров']);
    });

    it('supports old comma-separated properties', () => {
        const fm: Frontmatter = { Genre: 'Роман, русская классика' };
        expect(getStringArrayAny(fm, ['Genre'])).toEqual(['Роман', 'русская классика']);
    });

    it('uses the first populated alias and removes duplicates', () => {
        const fm: Frontmatter = { Author: '', Director: ['John Doe', 'John Doe'] };
        expect(getStringArrayAny(fm, ['Author', 'Director'])).toEqual(['John Doe']);
    });
});
