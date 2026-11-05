import { describe, expect, test, vi } from 'vitest';
import { REMINDER_OPTIONS, USAGE_KEY, UsageTracker } from '../../src/core/usage';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => { items.delete(key); },
    setItem: (key, value) => { items.set(key, value); },
  };
}

function setup(storage: Storage | null = null, date = new Date(2026, 10, 5, 12)) {
  let current = date;
  const tracker = new UsageTracker(storage, () => current);
  return {
    tracker,
    setDate: (next: Date) => { current = next; },
    tick: (ms: number, visible = true) => {
      current = new Date(current.getTime() + ms);
      return tracker.tick(ms, visible);
    },
  };
}

describe('UsageTracker', () => {
  test('counts only while visible', () => {
    const { tracker, tick } = setup();
    tick(3000);
    tick(5000, false);
    tick(2000);
    expect(tracker.minutesOn('2026-11-05')).toBeCloseTo(5 / 60);
    expect(tracker.minutesOn('2026-11-04')).toBe(0);
  });

  test('caps delta at 5 seconds', () => {
    const { tracker, tick } = setup();
    tick(3_600_000);
    expect(tracker.minutesOn('2026-11-05')).toBeCloseTo(5 / 60);
  });

  test.each([-1, 0, NaN, Infinity, -Infinity])('ignores invalid delta %s', delta => {
    const { tracker } = setup();
    expect(tracker.tick(delta, true)).toEqual({ remind: false });
    expect(tracker.minutesOn('2026-11-05')).toBe(0);
  });

  test('rolls over at midnight, splitting capped time across both local dates', () => {
    const { tracker, tick } = setup(null, new Date(2026, 10, 5, 23, 59, 30));
    tick(60_000);
    expect(tracker.minutesOn('2026-11-05')).toBeCloseTo(2.5 / 60);
    expect(tracker.minutesOn('2026-11-06')).toBeCloseTo(2.5 / 60);
  });

  test('splits an ordinary delta at midnight in proportion to each day', () => {
    const { tracker, tick } = setup(null, new Date(2026, 11, 31, 23, 59, 58));
    tick(5000);
    expect(tracker.minutesOn('2026-12-31')).toBeCloseTo(2 / 60);
    expect(tracker.minutesOn('2027-01-01')).toBeCloseTo(3 / 60);
  });

  test('assigns a tick ending exactly at midnight to the previous day', () => {
    const { tracker, tick } = setup(null, new Date(2026, 10, 5, 23, 59, 55));
    tick(5000);
    expect(tracker.minutesOn('2026-11-05')).toBeCloseTo(5 / 60);
    expect(tracker.minutesOn('2026-11-06')).toBe(0);
  });

  test('uses local dates and returns seven days oldest to today with zero-filled gaps', () => {
    const { tracker, tick } = setup(null, new Date(2027, 0, 2, 0, 1));
    tick(3000);
    expect(tracker.last7Days()).toEqual([
      { date: '2026-12-27', minutes: 0 },
      { date: '2026-12-28', minutes: 0 },
      { date: '2026-12-29', minutes: 0 },
      { date: '2026-12-30', minutes: 0 },
      { date: '2026-12-31', minutes: 0 },
      { date: '2027-01-01', minutes: 0 },
      { date: '2027-01-02', minutes: 0.05 },
    ]);
  });

  test('reminds once after the interval, then again after reset', () => {
    const { tracker, tick } = setup();
    tracker.reminderMinutes = 10;
    for (let i = 0; i < 119; i++) expect(tick(5000).remind).toBe(false);
    expect(tick(5000, false).remind).toBe(false);
    expect(tick(4999).remind).toBe(false);
    expect(tick(1).remind).toBe(true);
    for (let i = 0; i < 240; i++) expect(tick(5000).remind).toBe(false);
    tracker.resetSessionTimer();
    for (let i = 0; i < 119; i++) expect(tick(5000).remind).toBe(false);
    expect(tick(5000).remind).toBe(true);
    expect(tracker.minutesOn('2026-11-05')).toBeCloseTo(40);
  });

  test('reminder 0 never reminds and usage still accumulates', () => {
    const { tracker, tick } = setup();
    tracker.reminderMinutes = 0;
    for (let i = 0; i < 800; i++) expect(tick(5000).remind).toBe(false);
    expect(tracker.minutesOn('2026-11-05')).toBeCloseTo(4000 / 60);
  });

  test('defaults to a 20-minute reminder and caps session time too', () => {
    const { tracker, tick } = setup();
    expect(REMINDER_OPTIONS).toEqual([0, 10, 15, 20, 30, 45, 60]);
    expect(tracker.reminderMinutes).toBe(20);
    expect(tick(3_600_000).remind).toBe(false);
    for (let i = 0; i < 238; i++) expect(tick(5000).remind).toBe(false);
    expect(tick(5000).remind).toBe(true);
  });

  test.each(REMINDER_OPTIONS)('persists usage and reminder option %s without persisting session time', option => {
    const storage = memoryStorage();
    storage.setItem('unrelated', 'keep');
    const { tracker, tick } = setup(storage);
    tracker.reminderMinutes = option;
    for (let i = 0; i < 119; i++) tick(5000);
    tracker.flush();
    expect(USAGE_KEY).toBe('blockpals.usage.v1');
    expect(storage.getItem(USAGE_KEY)).not.toBeNull();
    const reloaded = setup(storage);
    expect(reloaded.tracker.reminderMinutes).toBe(option);
    expect(reloaded.tracker.minutesOn('2026-11-05')).toBeCloseTo(595 / 60);
    expect(reloaded.tick(5000).remind).toBe(false);
    expect(storage.getItem('unrelated')).toBe('keep');
  });

  test.each([-10, 1, 21, 10.5, '10', null])('invalid stored reminder %s falls back to 20', value => {
    const storage = memoryStorage();
    storage.setItem(USAGE_KEY, JSON.stringify({ days: { '2026-11-05': 60_000 }, reminderMinutes: value }));
    const { tracker } = setup(storage);
    expect(tracker.reminderMinutes).toBe(20);
    expect(tracker.minutesOn('2026-11-05')).toBe(1);
  });

  test.each([-1, 1, 12, NaN, Infinity])('invalid assigned reminder %s falls back to 20', value => {
    const { tracker } = setup();
    tracker.reminderMinutes = value;
    expect(tracker.reminderMinutes).toBe(20);
  });

  test('prunes days older than the 30-day window on load and as time advances', () => {
    const storage = memoryStorage();
    storage.setItem(USAGE_KEY, JSON.stringify({ days: {
      '2026-10-06': 60_000, '2026-10-07': 120_000, '2026-11-05': 180_000,
    }, reminderMinutes: 15 }));
    const { tracker, setDate } = setup(storage);
    expect(tracker.minutesOn('2026-10-06')).toBe(0);
    expect(tracker.minutesOn('2026-10-07')).toBe(2);
    setDate(new Date(2026, 10, 6, 12));
    expect(tracker.minutesOn('2026-10-07')).toBe(0);
    tracker.flush();
    expect(JSON.parse(storage.getItem(USAGE_KEY)!).days).toEqual({ '2026-11-05': 180_000 });
  });

  test.each(['garbage', 'null', '[]', '42', '{}', '{"days":null}'])('survives corrupt storage: %s', value => {
    const storage = memoryStorage();
    storage.setItem(USAGE_KEY, value);
    const { tracker, tick } = setup(storage);
    expect(tracker.reminderMinutes).toBe(20);
    tick(3000);
    expect(() => tracker.flush()).not.toThrow();
    expect(tracker.minutesOn('2026-11-05')).toBe(0.05);
  });

  test('discards malformed history entries but retains valid ones', () => {
    const storage = memoryStorage();
    storage.setItem(USAGE_KEY, JSON.stringify({ days: {
      '2026-11-05': 60_000, '2026-11-04': -1, '2026-11-03': '60000',
      '2026-11-02': null, '2026-10-32': 60000, bogus: 60000,
    } }));
    const { tracker } = setup(storage);
    tracker.flush();
    expect(JSON.parse(storage.getItem(USAGE_KEY)!).days).toEqual({ '2026-11-05': 60_000 });
  });

  test('survives null storage', () => {
    const { tracker, tick } = setup();
    tick(3000);
    tracker.reminderMinutes = 30;
    expect(() => tracker.flush()).not.toThrow();
    expect(tracker.minutesOn('2026-11-05')).toBe(0.05);
    expect(tracker.reminderMinutes).toBe(30);
  });

  test('survives storage reads and writes throwing, and can retry a failed flush', () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'getItem').mockImplementationOnce(() => { throw new Error('Blocked'); });
    const { tracker, tick } = setup(storage);
    vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new Error('Full'); });
    tick(5000);
    expect(() => tracker.flush()).not.toThrow();
    expect(tracker.minutesOn('2026-11-05')).toBeCloseTo(5 / 60);
    tracker.reminderMinutes = 45;
    tracker.flush();
    const { tracker: restored } = setup(storage);
    expect(restored.minutesOn('2026-11-05')).toBeCloseTo(5 / 60);
    expect(restored.reminderMinutes).toBe(45);
  });

  test('uses the system clock when none is injected', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 10, 5, 12));
      const tracker = new UsageTracker(null);
      tracker.tick(3000, true);
      expect(tracker.minutesOn('2026-11-05')).toBe(0.05);
    } finally {
      vi.useRealTimers();
    }
  });
});
