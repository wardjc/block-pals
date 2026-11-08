import { ITEMS, isItemId, type StackId } from '../core/items';

/**
 * The picture for a bag stack: a block is its atlas tile (an img), an item is its emoji with an
 * optional small badge (a seed shows which crop it grows). Pure DOM, no text needed to read it.
 */
export function stackPicture(id: StackId, iconFor: (id: StackId) => string, cls = 'pic'): HTMLElement {
  if (isItemId(id)) {
    const def = ITEMS[id];
    const wrap = document.createElement('span');
    wrap.className = `${cls} pic-item`;
    wrap.dataset.item = String(id);
    wrap.textContent = def.icon;
    if (def.badge) {
      const badge = document.createElement('span');
      badge.className = 'pic-badge';
      badge.textContent = def.badge;
      wrap.appendChild(badge);
    }
    return wrap;
  }
  const img = document.createElement('img');
  img.className = cls;
  img.src = iconFor(id);
  img.alt = '';
  img.draggable = false;
  return img;
}
