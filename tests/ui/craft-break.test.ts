// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { craft } from '../../src/core/crafting';
import { Inventory } from '../../src/core/inventory';
import { RECIPES } from '../../src/core/recipes';
import { craftSpeech } from '../../src/game/speechPolicy';
import { CraftScreen } from '../../src/ui/craft';

function rig(inv: Inventory) {
  const spoken: string[] = [];
  let breakOpen = false;
  let crafted = 0;
  const t = { now: 1000 };
  const speech = craftSpeech(() => breakOpen, {
    say: text => spoken.push(`say:${text}`), needMore: () => spoken.push('need'), full: () => spoken.push('full'),
  });
  const screen = new CraftScreen(document.body, {
    inventory: inv,
    tryCraft: id => { const ok = craft(inv, RECIPES.find(x => x.id === id)!); if (ok) crafted++; return ok; },
    iconFor: () => '',
    ...speech,
    sfxTap: () => {}, sfxCraft: () => {}, onOpenChange: () => {},
    now: () => t.now,
  });
  screen.open();
  return { screen, spoken, setBreak: (b: boolean) => { breakOpen = b; }, crafted: () => crafted, tick: () => { t.now += 1000; } };
}

describe('craft screen speech and the break reminder', () => {
  test('an ingredient tap, "need more" and "full" are all silent while the break bubble is open', () => {
    const r = rig(new Inventory());
    r.setBreak(true);
    (document.querySelector('.craft-screen img, .craft-screen [class*="ing"]') as HTMLElement | null)?.click();
    document.querySelectorAll('.craft-screen *').forEach(el => (el as HTMLElement).click());
    r.screen.make(0); // nothing in the bag: "need more"
    r.tick();
    expect(r.spoken).toEqual([]);
    r.setBreak(false);
    r.screen.make(0);
    expect(r.spoken).toContain('need');
  });

  test('"full" is silent while the break is open, and crafting itself still works', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 5);
    const r = rig(inv);
    r.setBreak(true);
    r.screen.make(0);
    expect(r.crafted()).toBe(1); // input is never blocked
    expect(r.spoken).toEqual([]);
    inv.add(BlockId.Planks, 99);
    r.tick();
    r.screen.make(0);
    expect(r.spoken).not.toContain('full');
    r.setBreak(false);
    r.tick();
    r.screen.make(0);
    expect(r.spoken.length).toBeGreaterThan(0);
  });
});
