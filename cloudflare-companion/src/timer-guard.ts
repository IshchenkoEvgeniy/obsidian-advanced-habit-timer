import type { TimerRow } from './types';

export function timerWriteGuard(profile: string, timer: TimerRow): { sql: string; values: unknown[] } {
 return {
  sql: 'EXISTS (SELECT 1 FROM active_timers WHERE profile_id=? AND session_id IS ? AND updated_at=? AND timer_state=? AND started_at IS ? AND elapsed_seconds=?)',
  values: [profile, timer.session_id, timer.updated_at, timer.timer_state, timer.started_at, timer.elapsed_seconds]
 };
}
