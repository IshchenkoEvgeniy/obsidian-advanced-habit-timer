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
});
