import type { StackId } from './items';
import { Inventory, MAX_STACK } from './inventory';
import type { Recipe } from './recipes';

export function canCraft(inv: Inventory, r: Recipe): boolean {
  // Require space for the whole output so crafting never discards items.
  if (inv.count(r.output.id) + r.output.n > MAX_STACK) return false;
  const required = new Map<StackId, number>();
  for (const { id, n } of r.inputs) {
    required.set(id, (required.get(id) ?? 0) + n);
  }
  return [...required].every(([id, n]) => inv.count(id) >= n);
}

export function craft(inv: Inventory, r: Recipe): boolean {
  if (!canCraft(inv, r)) return false;
  for (const { id, n } of r.inputs) inv.remove(id, n);
  inv.add(r.output.id, r.output.n);
  return true;
}
