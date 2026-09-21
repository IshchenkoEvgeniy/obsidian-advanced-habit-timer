import { describe, expect, it } from 'vitest';
import { getRatingValue, parseRating } from '../src/utils/rating';

describe('rating modifiers', () => {
    it('supports trailing plus and minus modifiers', () => {
        expect(getRatingValue('7+')).toBe(7.25);
        expect(getRatingValue('7-')).toBe(6.75);
    });

    it('supports leading plus and minus modifiers', () => {
        expect(getRatingValue('+6')).toBe(6.25);
        expect(getRatingValue('-6')).toBe(5.75);
    });

    it('keeps decimals and comma decimals working', () => {
        expect(parseRating('7.5')?.value).toBe(7.5);
        expect(parseRating('7,5')?.label).toBe('7.5');
    });

    it('rejects malformed and out-of-range ratings', () => {
        expect(parseRating('0')).toBeNull();
        expect(parseRating('11')).toBeNull();
        expect(parseRating('7++')).toBeNull();
        expect(parseRating('good')).toBeNull();
    });

    it('sorts plus above plain and minus below plain', () => {
        const ratings = ['7-', '7+', '7'];
        expect(ratings.sort((a, b) => getRatingValue(b) - getRatingValue(a))).toEqual(['7+', '7', '7-']);
    });
});
