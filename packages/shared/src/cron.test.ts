import { describe, expect, it } from 'vitest';
import { assertCron, cronMatches } from './cron.js';

describe('cron', () => {
  it('rejects bad expressions', () => {
    expect(() => assertCron('tomorrow')).toThrow(/5-field/);
    expect(() => assertCron('* * *')).toThrow(/5-field/);
  });

  it('matches weekday mornings in UTC', () => {
    const mondayEight = new Date('2026-09-28T08:00:00Z');
    expect(cronMatches('0 8 * * 1-5', mondayEight)).toBe(true);
    expect(cronMatches('0 9 * * 1-5', mondayEight)).toBe(false);
    const sunday = new Date('2026-09-27T08:00:00Z');
    expect(cronMatches('0 8 * * 1-5', sunday)).toBe(false);
  });

  it('supports steps', () => {
    expect(cronMatches('*/15 * * * *', new Date('2026-09-26T08:15:00Z'))).toBe(true);
    expect(cronMatches('*/15 * * * *', new Date('2026-09-26T08:10:00Z'))).toBe(false);
  });
});
