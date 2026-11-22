import { VIEW_SETTINGS, type ViewSetting } from './viewDistance';

/**
 * The grown-ups' "View distance" choice, a tablet setting like the controller mapping and the break
 * reminder: NOT part of the saved game, and "Reset progress" leaves it. Only the choice is stored, never
 * the live distance (Auto always starts at 40 and grows, so a hot session never starts far out).
 */
export const VIEW_SETTING_KEY = 'blockpals.view.v1';

/** The stored choice; a missing, damaged, wrong-version or unknown value, or blocked storage, reads as 'auto'. */
export function loadViewSetting(storage: Storage | null): ViewSetting {
  try {
    const raw = storage?.getItem(VIEW_SETTING_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = value as { v?: unknown; setting?: unknown };
      if (v.v === 1 && typeof v.setting === 'string' && (VIEW_SETTINGS as readonly string[]).includes(v.setting)) {
        return v.setting as ViewSetting;
      }
    }
  } catch {
    // Blocked storage or a damaged value: Auto.
  }
  return 'auto';
}

export function saveViewSetting(storage: Storage | null, s: ViewSetting): void {
  if (!VIEW_SETTINGS.includes(s)) return;
  try {
    storage?.setItem(VIEW_SETTING_KEY, JSON.stringify({ v: 1, setting: s }));
  } catch {
    // The choice still applies for this session when storage is blocked or full.
  }
}
