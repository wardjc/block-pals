export type Action = 'collect' | 'place' | 'nextSlot' | 'craft';

export interface ButtonMapping {
  collect: number;
  place: number;
  nextSlot: number;
  axisX: number;
  axisY: number;
  invertY: boolean;
}

export const DEFAULT_MAPPING: ButtonMapping = {
  collect: 0,
  place: 1,
  nextSlot: 5,
  axisX: 0,
  axisY: 1,
  invertY: false,
};

const STORAGE_KEY = 'blockpals.pad.v1';
const INDEX_FIELDS = ['collect', 'place', 'nextSlot', 'axisX', 'axisY'] as const;

function isMapping(value: unknown): value is ButtonMapping {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const mapping = value as Record<string, unknown>;
  return typeof mapping.invertY === 'boolean' && INDEX_FIELDS.every((key) =>
    typeof mapping[key] === 'number' && Number.isSafeInteger(mapping[key]) && mapping[key] >= 0,
  );
}

export function loadMapping(storage: Storage | null): ButtonMapping {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const mapping: unknown = raw ? JSON.parse(raw) : null;
    if (isMapping(mapping)) {
      return {
        collect: mapping.collect, place: mapping.place, nextSlot: mapping.nextSlot,
        axisX: mapping.axisX, axisY: mapping.axisY, invertY: mapping.invertY,
      };
    }
  } catch {
    // Blocked storage and corrupt saves must not prevent controller input.
  }
  return { ...DEFAULT_MAPPING };
}

export function saveMapping(storage: Storage | null, m: ButtonMapping): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    // The current mapping still works when storage is blocked or full.
  }
}
