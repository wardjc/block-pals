export const USAGE_KEY = 'blockpals.usage.v1';
export const REMINDER_OPTIONS = [0, 10, 15, 20, 30, 45, 60] as const;

const MINUTE_MS = 60_000;

function dateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDay(date: Date, offset = 0): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return day;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reminderOption(value: unknown): number {
  return REMINDER_OPTIONS.some(option => option === value) ? value as number : 20;
}

export class UsageTracker {
  // Persisted days contain milliseconds; only the public reporting API uses minutes.
  private days: Record<string, number> = {};
  private intervalMinutes = 20;
  private sessionMs = 0;
  private reminded = false;

  constructor(private storage: Storage | null, private now: () => Date = () => new Date()) {
    try {
      const raw = storage?.getItem(USAGE_KEY);
      const saved: unknown = raw ? JSON.parse(raw) : null;
      if (isRecord(saved)) {
        this.intervalMinutes = reminderOption(saved.reminderMinutes);
        if (isRecord(saved.days)) {
          for (const [key, ms] of Object.entries(saved.days)) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(key)
              && dateKey(new Date(`${key}T00:00:00`)) === key
              && typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) {
              this.days[key] = ms;
            }
          }
        }
      }
    } catch {
      // Blocked storage or a corrupt save must not interrupt play.
    }
    this.prune(this.now());
  }

  get reminderMinutes(): number {
    return this.intervalMinutes;
  }

  set reminderMinutes(value: number) {
    this.intervalMinutes = reminderOption(value);
  }

  tick(deltaMs: number, visible: boolean): { remind: boolean } {
    const end = this.now();
    this.prune(end);
    if (!visible || !Number.isFinite(deltaMs) || deltaMs <= 0) return { remind: false };

    const countedMs = Math.min(deltaMs, 5000);
    const endMs = end.getTime();
    // Spread capped play time over the reported interval, preserving midnight splits.
    // Skip expired history so even a very large sleep delta visits at most 30 days.
    let cursor = Math.max(endMs - deltaMs, localDay(end, -29).getTime());
    while (cursor < endMs) {
      const day = new Date(cursor);
      const next = Math.min(localDay(day, 1).getTime(), endMs);
      const key = dateKey(day);
      this.days[key] = (this.days[key] ?? 0) + countedMs * ((next - cursor) / deltaMs);
      cursor = next;
    }

    this.sessionMs += countedMs;
    if (!this.reminded && this.intervalMinutes > 0 && this.sessionMs >= this.intervalMinutes * MINUTE_MS) {
      this.reminded = true;
      return { remind: true };
    }
    return { remind: false };
  }

  minutesOn(key: string): number {
    this.prune(this.now());
    return Object.hasOwn(this.days, key) ? this.days[key] / MINUTE_MS : 0;
  }

  last7Days(): Array<{ date: string; minutes: number }> {
    const today = this.now();
    this.prune(today);
    return Array.from({ length: 7 }, (_, index) => {
      const date = dateKey(localDay(today, index - 6));
      return { date, minutes: (this.days[date] ?? 0) / MINUTE_MS };
    });
  }

  resetSessionTimer(): void {
    this.sessionMs = 0;
    this.reminded = false;
  }

  flush(): void {
    this.prune(this.now());
    try {
      this.storage?.setItem(USAGE_KEY, JSON.stringify({
        days: this.days,
        reminderMinutes: this.intervalMinutes,
      }));
    } catch {
      // Keep the in-memory history so a later flush can retry.
    }
  }

  private prune(today: Date): void {
    const oldest = dateKey(localDay(today, -29));
    for (const key of Object.keys(this.days)) {
      if (key < oldest) delete this.days[key];
    }
  }
}
