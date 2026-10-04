import { describe, expect, it } from 'vitest';
import { upsertSessionLog } from '../src/services/session-log';

describe('session log merge', () => {
    it('merges legacy and canonical sections into one table', () => {
        const content = [
            '# Day',
            '### Session Log',
            '| Time | Mode | Property | Duration | Pages | Task |',
            '|---|---|---|---|---|---|',
            '| 08:28 - 08:28 | Telegram | Habit-Read | 00:00:04 | - | - |',
            '',
            '### 📝 Session Log',
            '| Time | Mode | Property | Duration | Progress | Task |',
            '|---|---|---|---|---|---|',
            '| 11:31 - 11:31 | ⏱️ | Habit-Programming | 00:00:02 | - | - |'
        ].join('\n');

        const result = upsertSessionLog(content, '| 12:00 - 12:10 | Telegram | Habit-Read | 00:10:00 | 12 | - |');

        expect(result.match(/Session Log/g)).toHaveLength(1);
        expect(result).toContain('### 📝 Session Log');
        expect(result).toContain('00:00:04');
        expect(result).toContain('00:00:02');
        expect(result).toContain('00:10:00');
        expect(result).not.toContain('| Pages |');
    });

    it('keeps sections that follow the session log', () => {
        const result = upsertSessionLog(
            '### Session Log\n| Time | Mode | Property | Duration | Progress | Task |\n|---|---|---|---|---|---|\n\n## Notes\nKeep me'
        );
        expect(result).toContain('## Notes\nKeep me');
    });

    it('preserves prose and unrelated tables while merging session logs', () => {
        const row = '| 09:00 - 09:10 | ⏱️ | Read | 00:10:00 | - | - |';
        const content = [
            '### Session Log',
            '| Time | Mode | Property | Duration | Pages | Task |',
            '|---|---|---|---|---|---|', row, '',
            'Keep this reflection.', '',
            '| Topic | Notes |', '|---|---|', '| Book | Keep this table |', '',
            '### 📝 Session Log',
            '| Time | Mode | Property | Duration | Progress | Task |',
            '|---|---|---|---|---|---|',
            'Keep this second reflection.'
        ].join('\n');
        const result = upsertSessionLog(content);
        expect(result.match(/### .*Session Log/g)).toHaveLength(1);
        expect(result).toContain(row);
        expect(result).toContain('Keep this reflection.');
        expect(result).toContain('| Topic | Notes |\n|---|---|\n| Book | Keep this table |');
        expect(result).toContain('Keep this second reflection.');
        expect(upsertSessionLog(result)).toBe(result);
    });

    it('does not normalize a session log example inside a fenced code block', () => {
        const content = '```markdown\n### Session Log\nExample text\n```\n';
        expect(upsertSessionLog(content)).toBe(content);
    });
});
