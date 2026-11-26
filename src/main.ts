import './ui/styles.css';
import { BLOCKS, BlockId } from './core/blocks';
import type { Cell } from './core/pathfind';
import { applySave, readSave, serialise, startAutosave, storeSave } from './core/save';
import { generateAsync } from './render/genWorker';
import { mouthCells } from './core/caves';
import { GrowthClock } from './core/growth';
import { cropBlock, seedFor, type CropKind } from './core/crops';
import { Game } from './game/game';
import { reactionKey } from './game/eating';
import { FarmHints, addHint, digDownReady, hasHint, mergeHints, type HintContext, type HintKey } from './game/hints';
import { LeadHome } from './game/leadHome';
import { CaveDiscovery } from './game/underground';
import { HomeFade } from './ui/homeFade';
import { routeHome } from './core/home';
import { lightDistances } from './core/caveDress';
import { fernGift } from './game/fern';
import { Herd } from './game/animals';
import { mulberry32 } from './core/rng';
import { AnimalView, ANIMAL_VIEW_RANGE } from './render/animals';
import { Projectile, SadMarks, Sparkles } from './render/effects';
import { GrumpView, GRUMP_VIEW_RANGE } from './render/grumps';
import { GrumpPlay } from './game/grumpPlay';
import { Delayed } from './game/delayed';
import { PAUSE_STEP_MAX_MS, pauseFor } from './game/farm';
import { FLIGHT_SECONDS } from './core/grumpRules';
import { ZONE_Y, avoidCells, farmZone, zoneBorder } from './core/farmZone';
import { WEAPONS, weaponKind } from './core/items';
import { pickAnimalAlongRay } from './input/entityPick';
import { GamepadInput } from './input/gamepad';
import { loadMapping } from './input/mapping';
import { GestureClassifier, type GestureEvent } from './input/gesture';
import { createDebouncer, resolveHold, resolveTap } from './input/tap';
import { animatePalTrot, animatePlayerWalk, idleVillager, makeWalkState, makeEmblem, makePalModel, makePlayerModel, makeVillagerModel, placeEmblem, setEatPose } from './render/characters';
import { pipHiddenFor } from './render/cameraRig';
import { GameScene, PICK_RANGE } from './render/scene';
import { ViewDistance, type ViewSetting } from './render/viewDistance';
import { loadViewSetting } from './render/viewSetting';
import { sfx } from './audio/sfx';
import { CraftScreen } from './ui/craft';
import { ChestReveal } from './ui/chestReveal';
import { BagTray } from './ui/bag';
import { FEEDS, isItemId, ItemId, ITEMS, type StackId } from './core/items';
import { Hud, hudStateFor } from './ui/hud';
import { Voice, audioLocked } from './audio/voice';
import { LINES, LINE_ICONS, pickLine, type LineKey } from './content/lines';
import { Pal } from './game/pal';
import { LeadToVillage } from './game/lead';
import { GreetTracker } from './game/villagers';
import { DeferredOnce, HELD_KEYS, LockedHold, allowLine, craftSpeech, helperDt, leadPaused, mayGreet, mayPipSpeakQueued, type SpeechContext } from './game/speechPolicy';
import { DOOR_EMBLEMS, FERN_LINES, VILLAGERS, VILLAGER_LINES, pickVillagerLine, type VillagerId } from './content/villagers';
import { isStandable, settleCell } from './core/pathfind';
import { UsageTracker } from './core/usage';
import { GrownUps } from './ui/grownups';
import { createAutosaveControl } from './game/autosaveControl';
import type { Puzzle } from './core/puzzles';
import { WIZARD_STOCK, newWizardState } from './game/wizardTrade';
import { WizardVisit } from './game/wizardVisit';
import { makeTowerLead } from './game/leadTower';
import { HeldPipLine, mayWizardGreet, wizardSpeech } from './game/speechPolicy';
import { WIZARD_ICONS, WIZARD_LINES, countSentence, pickWizardLine, wizardPartTexts, type WizardKey } from './content/wizard';
import { WizardView } from './render/wizard';
import { Beacon, beaconScreen, markerShown } from './render/beacon';
import { EdgeMarker } from './ui/marker';
import { WizardScreen } from './ui/wizard';
import { discPickAllowed, pickEntity, pickEntityAlongRay, type EntityBox, type EntityType } from './input/entityPick';
import { WIZARD_REACH } from './input/tap';

let storage: Storage | null = null;
try { storage = window.localStorage; } catch { /* Storage may be blocked. */ }
const saved = readSave(storage);
export const hadSave: boolean = saved !== null; // for Pip's welcome-back line (Task 10)
const seed = saved?.seed ?? 2026;
// The world is made in a worker behind the loading picture (the main thread stays free to animate it);
// without a worker the same generator runs here. His saved edits then replay on top, as before.
const genStart = performance.now();
const generated = await generateAsync(seed, { onFallback: reason => console.warn(`Block Pals: generating on the main thread (${reason})`) });
const genMs = performance.now() - genStart;
const loaded = saved ? applySave(saved, Date.now(), generated) : null;
const initial = loaded ?? generated;
const { world, spawn, village, tower, towerRoute, towerPad, caves } = initial;
const game = new Game(initial);
// Plants are blocks; the farm keeps their timers. Offline growth (capped at 8 h) is applied, and any
// pending stage changes are shown, before the first mesh is built so a catch-up costs no chunk rebuilds.
if (loaded) {
  game.farm.restore(loaded.farm.crops, loaded.farm.trees);
  game.farm.advance(loaded.offlineMs);
}
game.farm.records();
// The friendly herd lives inside the pasture fence (the fence ring itself and the gate row are never used).
const pasture = village.farm.pasture;
const roam = { x0: pasture.x0 + 1, z0: pasture.z0 + 1, x1: pasture.x1 - 1, z1: pasture.z1 - 1 };
const herd = new Herd(mulberry32((seed ^ 0xa11) >>> 0));
if (loaded) herd.restore(loaded.animals, village.farm.herdSpawns, world, roam, loaded.offlineMs / 1000);
else herd.populate(village.farm.herdSpawns);
game.herd = herd;
// Grumps and friends: small harmless visitors on the farm (surface only, never in the caves or the tower).
const grumpZone = farmZone(village);
const grumpAvoid = avoidCells(village);
const play = new GrumpPlay({
  game, world, zone: grumpZone, avoid: grumpAvoid, border: zoneBorder(grumpZone, world, grumpAvoid),
  rng: mulberry32((seed ^ 0x6b1) >>> 0), level: ZONE_Y, saved: loaded?.grumps,
});
const scene = new GameScene(document.getElementById('game')!, world);
// Within reach of a cave mouth the layers below are drawn too, so looking into a tunnel never shows a hole.
scene.setMouths(mouthCells(caves));
// How far he can see (Task 10b): Auto starts at 40 and grows with the tablet's speed; a grown-up can pin it.
// The clock has an offset only the ?viewtest feed moves (fake frame times in the e2e test).
let viewClockOffset = 0;
const viewDistance = new ViewDistance(() => performance.now() + viewClockOffset);
viewDistance.setSetting(loadViewSetting(storage));
viewDistance.pause(3); // loading and the first frames
scene.setViewDistance(viewDistance.distance);
const animalView = new AnimalView(scene.scene);
const sparkles = new Sparkles(scene.scene);
const grumpView = new GrumpView(scene.scene);
const sadMarks = new SadMarks(scene.scene);
const projectile = new Projectile(scene.scene);
const delayed = new Delayed();
const flags = loaded?.flags ?? { ledToVillage: false };
const hints = new FarmHints(flags.hints ?? []);
/** Orlo's gift, visit, lead and puzzle counters: read live by every save. */
const wizard = loaded?.wizard ?? newWizardState();
const saveGame = (): boolean => storeSave(storage, serialise(game, seed, flags, Date.now(), herd.toJSON(), wizard, play.saved()));
const autosave = createAutosaveControl(() => startAutosave(game, seed, storage, flags, () => herd.toJSON(), wizard, () => play.saved()), saveGame);
const usage = new UsageTracker(storage);
world.onChange((x, y, z) => scene.markSectionDirty(x, y, z));

const playerModel = makePlayerModel();
scene.add(playerModel);

// Pip follows the player; Pal holds the logic, main.ts only voices and draws it.
const pip = makePalModel();
scene.add(pip);

// Neighbours stand in their houses facing the door, off the door line. They are not solid (like Pip).
const villagers: Array<{ id: VillagerId; model: ReturnType<typeof makeVillagerModel>; cell: Cell }> = [];
for (const def of VILLAGERS) {
  const house = village.houses.find(h => h.id === def.house);
  if (!house) continue;
  const [nx, ny, nz] = house.npcSpot;
  const model = makeVillagerModel(def.id);
  model.position.set(nx + 0.5, ny, nz + 0.5);
  model.rotation.y = Math.atan2(house.doorInside[0] - nx, house.doorInside[2] - nz);
  scene.add(model);
  villagers.push({ id: def.id, model, cell: house.npcSpot });
}
// A picture sign over every door (house -> emoji), floating just in front of the wall.
for (const house of village.houses) {
  const emblem = makeEmblem(DOOR_EMBLEMS[house.id]);
  placeEmblem(emblem, house);
  scene.add(emblem);
}
// Orlo stands on the ground floor of his tower facing the door; Glim circles his shoulder. Not solid (like Pip).
const wizardView = new WizardView(
  scene.scene, { x: tower.wizardSpot[0], y: tower.wizardSpot[1], z: tower.wizardSpot[2] },
  { x: tower.doorInside[0] + 0.5, z: tower.doorInside[2] + 0.5 },
  tower.floors[0].ceilingY - tower.floors[0].y, // his hop never lifts the hat into the slab
);
const beacon = new Beacon(scene.scene, tower.beacon);
const edgeMarker = new EdgeMarker(document.getElementById('ui')!);
let pipHop = 0; // seconds into the happy hop; 0 = not hopping
const BUBBLE_WORDS: Partial<Record<LineKey, string>> = { hello: 'Hi!', welcomeBack: 'Hi!', crafted: 'Yay!', collectedFirst: 'Yay!', upYouCome: 'Up!' };
let bubbleTimer = 0;
const voice = new Voice(undefined, {
  fetch: (...a) => fetch(...a),
  base: import.meta.env.BASE_URL,
  audio: () => sfx.audioOut(),
});
const lastSpoken: Partial<Record<LineKey, string>> = {};
/** ?debug only: the keys of Pip's lines in the order they were spoken. */
const pipSaid: LineKey[] = [];
const recordPip = import.meta.env.DEV || location.search.includes('debug');
const speakVariant = (key: LineKey): void => {
  if (!allowLine(hud.breakOpen, key)) return; // the break reminder is never cut by another line
  const text = pickLine(key, lastSpoken[key]);
  if (!text) return; // never speak '' - it would cancel current speech
  lastSpoken[key] = text;
  if (recordPip && pipSaid.length < 500) pipSaid.push(key);
  orloLast = false;
  voice.say(text, 'pip', { holdForAudio: HELD_KEYS.has(key) });
};
/** True when the last sayLine really spoke (a hint is only counted as told then). */
let lineSpoken = false;
const sayLine = (key: LineKey): void => {
  lineSpoken = false;
  // The break reminder has priority: while its bubble is up nothing else talks over it or cuts it.
  if (!allowLine(hud.breakOpen, key)) return;
  if (HELD_KEYS.has(key) && isAudioLocked()) return; // an idle hint or lead line while audio is locked: dropped quietly
  lineSpoken = true;
  speakVariant(key);
  if (key === 'breakTime') {
    hud.showBreak(() => usage.resetSessionTimer());
    return;
  }
  hud.showBubble(LINE_ICONS[key], BUBBLE_WORDS[key]);
  clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => hud.hideBubble(), 3000);
};
// Pip starts beside him, in a free cell of the replayed world (never inside a block he placed).
const pipStart = settleCell(world, [Math.floor(spawn.x + 1.8), Math.floor(spawn.y), Math.floor(spawn.z + 1.2)]);
const pal = new Pal(
  { x: pipStart[0] + 0.5, y: pipStart[1], z: pipStart[2] + 0.5 },
  sayLine,
);
pal.setHasWood(() => game.inventory.count(BlockId.Wood) > 0);
// Orlo is never talked over: while his line (his goodbye too) is still speaking, Pip holds back.
pal.setQuiet(() => orloLast && voice.speaking());
game.on(e => pal.handle(e));
// The welcome is marked delivered only when it is admitted; an open break bubble holds it until it closes.
const welcome = new DeferredOnce();
const tryWelcome = (): void => {
  if (welcome.take(hud.breakOpen)) pal.greet(hadSave);
};
const greetOnce = (): void => {
  welcome.want();
  tryWelcome();
};

/** Where people stand (him, Pip, the neighbours): the animals keep out of these. */
const peopleCells = (): Cell[] => {
  const [x, y, z] = game.player.feetCell();
  const [px, py, pz] = pal.feetCell();
  const cells: Cell[] = [[x, y, z], [x, y + 1, z], [px, py, pz], [px, py + 1, pz]];
  for (const v of villagers) cells.push(v.cell, [v.cell[0], v.cell[1] + 1, v.cell[2]]);
  cells.push(...wizardView.cells());
  return cells;
};
/** Everyone, animals too: nothing can be built into an animal and the ground under one is never dug. */
const occupied = (): Cell[] => [...peopleCells(), ...herd.occupiedCells(), ...play.system.occupiedCells()];
game.setOccupied(occupied);

// Real-time growth: one clock, one rule (never negative, capped). A sleeping tab sees one capped step.
const growthClock = new GrowthClock(Date.now());
/** Sad little bubbles over the plants a sulky grump is pausing (drawn only: nothing is written to the world). */
const refreshSadMarks = (): void => sadMarks.set(play.system.pausedCells(game.farm.plantCells()), performance.now() / 1000);
const tickGrowth = (): void => {
  const step = growthClock.step(Date.now());
  // A short step is paused near a sulky grump; time away (a long step) never is.
  game.farm.advance(step, pauseFor(step, (x, y, z) => play.system.pausesCell([x, y, z])));
  refreshSadMarks();
};
setInterval(tickGrowth, 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tickGrowth(); });
const burstAt = (cell: Cell, kind: 'water' | 'sun' | 'both' | 'heart' | 'crumb'): void =>
  sparkles.burst({ x: cell[0] + 0.5, y: cell[1] + 0.4, z: cell[2] + 0.5 }, kind);
game.farm.onEvent(e => {
  if (e.type === 'planted') { sfx.plant(); burstAt(e.cell, 'crumb'); }
  else if (e.type === 'helped') {
    if (e.cue === 'water') sfx.water(); else sfx.sun();
    burstAt(e.cell, e.cue);
  } else if (e.type === 'harvested') { sfx.pick(); react('harvested'); }
  else if (e.type === 'ripe') sfx.chime();
});
const NOISE = { chicken: sfx.cluck, cow: sfx.moo, sheep: sfx.baa, pig: sfx.oink } as const;
game.on(e => {
  const a = 'animal' in e ? herd.animals.find(o => o.id === e.animal) : undefined;
  if (!a) return;
  const at = { x: a.x, y: a.y + 0.9, z: a.z };
  if (e.type === 'fed') {
    sfx.gift();
    sparkles.burst(at, 'heart');
    hud.showBubble(ITEMS[e.gift].icon);
    react(e.gift === ItemId.Egg ? 'gotEgg' : e.gift === ItemId.Milk ? 'gotMilk' : e.gift === ItemId.Wool ? 'gotWool' : 'fedAnimal');
  } else if (e.type === 'petted' || e.type === 'resting') {
    sfx.pet();
    sparkles.burst(at, 'heart', 6);
    react(e.type === 'resting' ? 'animalFull' : 'petAnimal');
  }
});

// ---- grumps and friends: the pictures and sounds that follow what the game already decided ----
/** What each grump shows while the shot is still flying (the game has already changed its mood). */
const shownMood = new Map<number, 0 | 1>();
/** A cheered-up grump stays on screen until the shot arrives; a new friend hides until then. */
const leaving = new Map<number, import('./game/grumps').Grump>();
const hiddenFriends = new Set<number>();
let friendJustMade = false;
const WEAPON_SFX = { bubble: sfx.blub, wand: sfx.twinkle, water: sfx.squirt } as const;
const WEAPON_BURST = { bubble: 'bubble', wand: 'star', water: 'drop' } as const;
/** Pip's grump lines never talk over a voice (Orlo, a neighbour or Pip) or the break reminder. */
function grumpSay(key: LineKey): void {
  if (voice.speaking() || hud.breakOpen || wizardScreen.isOpen) return;
  react(key);
}
game.on(e => {
  if (e.type === 'fired') {
    projectile.launch(e.from, e.to, e.weapon);
    WEAPON_SFX[e.weapon]();
    lastFire.weapon = e.weapon; lastFire.sfx = { bubble: 'blub', wand: 'twinkle', water: 'squirt' }[e.weapon]; lastFire.projectile = e.weapon;
    delayed.after(FLIGHT_SECONDS, () => sparkles.burst(e.to, WEAPON_BURST[e.weapon], 8));
  } else if (e.type === 'unsure') {
    shownMood.set(e.grump, 0);
    delayed.after(FLIGHT_SECONDS, () => {
      shownMood.delete(e.grump);
      sfx.grumpHop();
      sparkles.burst({ x: e.at.x, y: e.at.y + 0.8, z: e.at.z }, 'sun', 8);
      refreshSadMarks();
      grumpSay('cheerHalf');
    });
    refreshSadMarks();
  } else if (e.type === 'cheered') {
    // The shot is still flying: the unsure grump stays in the picture until it arrives (a new friend waits too).
    leaving.set(e.grump, {
      id: e.grump, kind: e.kind, variant: e.variant, x: e.at.x, y: e.at.y, z: e.at.z, heading: e.heading, mood: 1, hits: 1,
      state: 'idle', stateT: 0, spawnT: 1, sulkNoiseIn: 99, stuckFor: 0, settle: null, crop: null, spot: 'farm', target: null, walkT: 0,
    });
    if (e.friend) hiddenFriends.add(e.grump);
    delayed.after(FLIGHT_SECONDS, () => {
      leaving.delete(e.grump);
      hiddenFriends.delete(e.grump);
      const at = { x: e.at.x, y: e.at.y + 0.6, z: e.at.z };
      if (e.friend) { sparkles.burst(at, 'heart', 10); sparkles.burst(at, 'star', 8); sfx.friendChime(); }
      else { sparkles.burst(at, 'confetti', 24); sfx.confetti(); }
      if (e.reward.length > 0) hud.showBubble(ITEMS[e.reward[0].id].icon);
      refreshSadMarks();
      if (e.friend) { friendJustMade = true; window.setTimeout(() => { friendJustMade = false; }, 8000); }
      else { grumpSay('cheeredUp'); if (e.reward.length > 0) window.setTimeout(() => grumpSay('grumpGift'), 4500); }
    });
  } else if (e.type === 'friendPetted') {
    const f = play.system.friends.find(o => o.id === e.friend);
    if (f) { sfx.pet(); sparkles.burst({ x: f.x, y: f.y + 0.9, z: f.z }, 'heart', 6); }
  }
});

/** Pip's plain-word reaction: once per kind per 20 s, then the Pal's own gap, and never over the break reminder. */
function react(key: LineKey): void {
  const now = Date.now();
  if (hud.breakOpen || !hints.reactionReady(key, now)) return;
  if (pal.react(key)) hints.reactionSaid(key, now); // a line the chatter gap held back does not use up its 20 s
}
// Eating: sound at once, the pose and crumbs follow the 1.3 s munch clock, Pip speaks when it ends.
game.on(e => {
  if (e.type !== 'ate') return;
  if (e.id === ItemId.Milk) sfx.drink(); else sfx.munch();
  eatEmoji = ITEMS[e.id].icon;
});

game.on(e => {
  if (e.type === 'collected') sfx.pop();
  else if (e.type === 'placed') sfx.place();
  else if (e.type === 'walking') { sfx.walk(); scene.showMarker(e.to); }
});

let eatEmoji = '🍎';
let eatBite = 0;
let eatPosed = false;
let hudRevision = -1;
let hudSelected: StackId | 'hand' | null = null;
const bagStacks = (): Array<{ id: StackId; count: number }> =>
  game.inventory.slots().map(id => ({ id, count: game.inventory.count(id) }));
/** Blocks are atlas tiles; items draw as emoji pictures, so they have no tile url. */
const stackIcon = (id: StackId): string => (isItemId(id) ? '' : scene.atlas.iconDataUrl(id));
function renderHud(): void {
  const sel = game.effectiveSelected();
  hudRevision = game.inventory.revision;
  hudSelected = sel;
  const edible = sel !== 'hand' && isItemId(sel) && ITEMS[sel].edible;
  hud.render(hudStateFor(bagStacks(), sel, edible));
}

const hud = new Hud(document.getElementById('ui')!, stackIcon, {
  onSelect: i => {
    const id = game.inventory.slots()[i - 1];
    game.selected = i === 0 || id === undefined ? 'hand' : id;
    sfx.tap();
    renderHud();
  },
  onBag: () => { if (!craftScreen.isOpen && !grownUps.isOpen && !chestReveal.open) bagTray.open(); },
  onCraft: openCraft,
  onGrownUps: () => {},
  onGrownUpsHold: (down, id) => (down ? grownUps.holdStart(id) : grownUps.holdEnd(id)),
  onHome: () => startHomeLift(),
});

// The Home lift (7h): the white-gold fade out, the move behind it, the fade back in. Touch or pad.
const homeFade = new HomeFade(document.getElementById('ui')!);
function startHomeLift(): void {
  if (!game.isDeep() || homeFade.running || game.paused || hud.blockingOverlayOpen) return;
  cancelPress(); // A captured canvas pointer can still release through the fade.
  if (pendingPip === 'goUp') pendingPip = null;
  caveLines.length = 0;
  if (leadHome.state === 'leading') pal.setLead(null);
  leadHome.reset();
  homeRoute = null;
  sfx.tap();
  game.player.setPath(null);
  game.player.setStick(0, 0);
  homeFade.start(() => {
    if (!game.goHome()) return;
    // Pip joins him (the homeLift event) and the camera jumps with him behind the fade.
    scene.snapFollow();
    viewDistance.pause(2); // the frames round the lift are not the tablet's real speed
  });
}
game.onHomeRequest = startHomeLift;

hud.onMunch(() => game.applyIntent({ kind: 'eat' }));

function syncOverlays(): void {
  const open = craftScreen.isOpen || grownUps.isOpen || bagTray.isOpen || wizardScreen.isOpen || chestReveal.open;
  hud.setOverlayOpen(open);
  game.paused = open;
  if (open) { game.player.setPath(null); game.player.setStick(0, 0); }
}
function openCraft(): void { if (!grownUps.isOpen && !bagTray.isOpen && !wizardScreen.isOpen && !chestReveal.open) craftScreen.open(); }

// A chest opened (plan Task 19): a soft chime and the picture cards of what came in (they pause the game for 4 s).
const chestReveal = new ChestReveal(document.getElementById('ui')!, { iconFor: id => stackIcon(id), onOpenChange: syncOverlays });
game.on(e => {
  if (e.type !== 'chestOpened') return;
  sfx.chest();
  sparkles.burst({ x: e.cell[0] + 0.5, y: e.cell[1] + 1, z: e.cell[2] + 0.5 }, 'sun');
  renderHud();
  chestReveal.show(e.reward);
});

const bagTray = new BagTray(document.getElementById('ui')!, {
  stacks: bagStacks,
  iconFor: stackIcon,
  current: () => game.effectiveSelected(),
  select: id => { game.selected = id; sfx.tap(); renderHud(); },
  onOpenChange: syncOverlays,
});

const craftScreen = new CraftScreen(document.getElementById('ui')!, {
  inventory: game.inventory,
  tryCraft: id => game.tryCraft(id),
  iconFor: stackIcon,
  ...craftSpeech(() => hud.breakOpen, {
    // Orlo is never talked over: crafting chatter waits while his line (his goodbye too) is still speaking.
    say: text => { if (!(orloLast && voice.speaking())) voice.say(text); },
    needMore: () => { if (!(orloLast && voice.speaking())) speakVariant('craftNeedMore'); },
    full: () => { if (!(orloLast && voice.speaking())) speakVariant('full'); },
  }),
  sfxTap: () => sfx.tap(),
  sfxCraft: () => sfx.craft(),
  onOpenChange: syncOverlays,
});
game.onCraftRequest = openCraft;

// Orlo's voice: every line through wizardSpeech (silent while the break bubble is up), speaker 'wizard'.
const lastWizard: Partial<Record<WizardKey, string>> = {};
/** Orlo was the last to be asked to speak: while that line lasts Pip holds back (see pal.setQuiet). */
let orloLast = false;
const orloSpoke = (): void => { orloLast = true; };
/** The last wizard line asked for (debug: which key, since clips are named by hash). */
let lastWizardKey = '';
let wizardAgain: (() => void) | null = null;
const wizardSay = (key: WizardKey): void => {
  const text = pickWizardLine(key, lastWizard[key]);
  if (!text) return;
  lastWizard[key] = text;
  lastWizardKey = key;
  // Held like the hellos: with audio locked or suspended he says nothing rather than use the tablet voice.
  wizardAgain = () => { orloSpoke(); voice.say(text, 'wizard', { holdForAudio: true }); };
  orloSpoke();
  voice.say(text, 'wizard', { holdForAudio: true });
};
const wizardCount = (p: Puzzle): void => {
  const lead = pickWizardLine('countAsk', lastWizard.countAsk);
  lastWizard.countAsk = lead;
  lastWizardKey = 'countAsk';
  const parts = [lead, ...countSentence(p)];
  wizardAgain = () => { orloSpoke(); voice.sayParts('wizard', parts); };
  orloSpoke();
  voice.sayParts('wizard', parts); // stitched clips only, never the tablet voice
};
const wizardVoice = wizardSpeech(() => hud.breakOpen, {
  line: k => wizardSay(k as WizardKey),
  countSentence: p => wizardCount(p as Puzzle),
  again: () => wizardAgain?.(),
});
/** Pip's line held while Orlo's screen is open, said only when nobody is speaking. */
const pipHeld = new HeldPipLine();
const wizardScreen = new WizardScreen(document.getElementById('ui')!, {
  inventory: game.inventory,
  state: () => wizard,
  save: () => saveNow(),
  iconFor: id => scene.atlas.iconDataUrl(id as BlockId),
  speak: { line: k => wizardVoice.line(k), countSentence: p => wizardVoice.countSentence(p), again: () => wizardVoice.again() },
  // Pip never talks over Orlo: his nudge waits until Orlo has finished, his "a magic block!" until the screen closes.
  pipNudge: () => pipHeld.want('puzzleStuck'),
  pipGot: () => { pendingPip ??= 'gotMagicBlock'; },
  rng: Math.random,
  celebrate: () => wizardView.celebrate(),
  onOpenChange: open => {
    syncOverlays();
    if (open) voice.prefetch(wizardPartTexts(), 'wizard');
    else pipHeld.clear();
  },
  sfx: { tap: () => sfx.tap(), gift: () => { sfx.gift(); renderHud(); }, nudge: () => sfx.nudge(), solved: () => sfx.solved() },
  stock: WIZARD_STOCK,
});
/** The screen opens only when no other overlay has the game paused. */
function openWizard(): void {
  if (craftScreen.isOpen || grownUps.isOpen || bagTray.isOpen || wizardScreen.isOpen || chestReveal.open) return;
  // A hello still held (audio locked, Pip talking) is given up: it must not play after "bye".
  visit.skipCurrent();
  wizardScreen.open();
}
game.on(e => { if (e.type === 'talk') openWizard(); });
// The pad's place button talks when Orlo is right in front of him (within 2 blocks, roughly faced).
game.wizardInFront = () => {
  const p = game.player.pos;
  const wx = tower.wizardSpot[0] + 0.5, wz = tower.wizardSpot[2] + 0.5;
  if (Math.abs(p.y - tower.wizardSpot[1]) > 1 || Math.hypot(wx - p.x, wz - p.z) > 2.2) return false;
  const want = Math.atan2(wx - p.x, wz - p.z);
  let d = Math.abs(want - game.player.heading) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d < Math.PI / 3;
};

let pad = new GamepadInput(loadMapping(storage));
const grownUps = new GrownUps(document.getElementById('ui')!, {
  usage,
  storage,
  captureButton: () => pad.captureNextButton(),
  cancelCapture: () => pad.cancelCapture(),
  getMapping: () => loadMapping(storage),
  onMappingSaved: m => { pad = new GamepadInput(m); },
  stopAutosave: () => autosave.stop(),
  resumeAutosave: () => autosave.resume(),
  // "Save a copy" never hands out stale progress: write the game now, else copy the live game.
  flushSave: () => !autosave.frozen && saveGame(),
  snapshotSave: () => JSON.stringify(serialise(game, seed, flags, Date.now(), herd.toJSON(), wizard, play.saved())),
  onOpenChange: syncOverlays,
  getViewSetting: () => viewDistance.currentSetting,
  onViewSettingSaved: s => viewDistance.setSetting(s),
});

const flushUsage = (): void => usage.flush();
setInterval(flushUsage, 15_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushUsage();
  else {
    last = performance.now();
    viewDistance.pause(2); // the first frames back are not the tablet's real speed
  }
});
window.addEventListener('pagehide', flushUsage);

// Touches on the canvas (spec §7a, fix round 1): a release before ½ s walks or builds,
// a press and hold digs. HUD buttons stop propagation, so they never reach here.
const allowTap = createDebouncer();
const gesture = new GestureClassifier();
const canvas = scene.renderer.domElement;
type Hit = ReturnType<typeof scene.pick>;
let pressHit: Hit = null;
/** The animal or wizard under the finger when it went down: a hold on it does nothing and never digs behind it. */
let pressEntity: { type: EntityType; id: number } | null = null;
/**
 * The animal the finger is on: the ray through the point against the animals' padded boxes, the
 * nearest of animal and block along it wins, and an animal behind a block is never picked.
 */
const animalAt = (clientX: number, clientY: number): number | null => {
  const r = scene.pickRay(clientX, clientY);
  return pickAnimalAlongRay(r.origin, r.dir, animalView.boxes(), r.t);
};
/**
 * Who the finger is on: the animals and the wizard in one list along the pick ray (nearest wins,
 * nobody behind a block). A finger near the wizard (his 72 px disc) still counts when nothing
 * stands in front of him.
 */
const entityAt = (clientX: number, clientY: number): { type: EntityType; id: number } | null => {
  const r = scene.pickRay(clientX, clientY);
  const boxes: EntityBox[] = [...animalView.boxes().map(b => ({ ...b, type: 'animal' as const })), ...grumpView.boxes()];
  // Orlo is pickable only as far as the ray looks for walls (it would not see one farther away).
  const s = tower.wizardSpot;
  const cam = scene.camera.position;
  const far = Math.hypot(s[0] + 0.5 - cam.x, s[1] + 1.2 - cam.y, s[2] + 0.5 - cam.z);
  const wizardPickable = wizardView.group.visible && far <= PICK_RANGE;
  if (wizardPickable) boxes.push({ ...wizardView.box(), type: 'wizard' });
  const hit = pickEntityAlongRay(r.origin, r.dir, boxes, r.t);
  if (hit || !wizardPickable) return hit;
  const rect = canvas.getBoundingClientRect();
  const c = wizardView.screenCentre(scene.camera, rect);
  if (c.sz < -1 || c.sz > 1) return null;
  const disc = pickEntity({ x: clientX, y: clientY }, [{ type: 'wizard', id: -1, ...c }]);
  if (!disc) return null;
  // Both the finger's ray and the ray to his middle must reach him before any block (never through the tower wall).
  const centre = scene.pickRay(c.sx, c.sy);
  return discPickAllowed(r.t, centre.t, far, 0.7, PICK_RANGE) ? disc : null;
};

const holdNow = (hit: Hit) => resolveHold(hit, game.player.feetCell(), world, occupied(), pressEntity !== null);
function endHoldVisuals(): void {
  hud.hideDigRing();
  scene.showOutline(null);
  sfx.digStop(); // every way a hold ends (complete, lift, slide, overlay) comes through here
}
function handleGesture(events: GestureEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case 'holdStart':
      case 'holdProgress': {
        const intent = holdNow(pressHit);
        if (intent.kind !== 'dig') { endHoldVisuals(); break; }
        hud.showDigRing(ev.x, ev.y, ev.progress);
        sfx.digStart();
        scene.showOutline(intent.cell);
        break;
      }
      case 'holdComplete':
        endHoldVisuals();
        // Resolved again now: he may have walked while holding. Too far → walk beside it.
        if (allowTap('hold', performance.now())) game.applyIntent(holdNow(pressHit));
        break;
      case 'tap':
        endHoldVisuals();
        if (!allowTap('tap', performance.now())) break;
        const tappedOn = entityAt(ev.x, ev.y);
        const tapped = tappedOn?.type === 'animal' ? tappedOn.id : null;
        const animal = tapped === null ? undefined : herd.animals.find(o => o.id === tapped);
        const pf = game.player.pos;
        const ws = tower.wizardSpot;
        const bodyHit = (b: { id: number; x: number; y: number; z: number } | undefined) => b
          ? { id: b.id, dist: Math.hypot(b.x - pf.x, b.y + 0.5 - (pf.y + 1.6), b.z - pf.z), cell: [Math.floor(b.x), b.y, Math.floor(b.z)] as Cell }
          : null;
        game.applyIntent(resolveTap(
          scene.pick(ev.x, ev.y), game.effectiveSelected(), game.player.feetCell(), world, occupied(),
          {
            grumpHit: tappedOn?.type === 'grump' ? bodyHit(play.system.grumps.find(o => o.id === tappedOn.id)) : null,
            friendHit: tappedOn?.type === 'friend' ? bodyHit(play.system.friends.find(o => o.id === tappedOn.id)) : null,
            plantAt: c => game.farm.isPlantCell(c),
            animalHit: animal
              ? { id: animal.id, dist: Math.hypot(animal.x - pf.x, animal.z - pf.z), cell: [Math.floor(animal.x), animal.y, Math.floor(animal.z)] }
              : null,
            wizardHit: tappedOn?.type === 'wizard'
              ? { dist: Math.max(Math.hypot(ws[0] + 0.5 - pf.x, ws[2] + 0.5 - pf.z), Math.abs(ws[1] - pf.y) > 1.5 ? WIZARD_REACH + 1 : 0), cell: ws }
              : null,
          },
        ));
        break;
      case 'holdStop':
      case 'cancel':
        endHoldVisuals();
        break;
      case 'drag': // spec §7c: a slide turns the camera and never walks, builds or digs
        scene.rig.drag(ev.dx, ev.dy, canvas.clientWidth || window.innerWidth);
        break;
    }
  }
}
const cancelPress = (id?: number): void => handleGesture(gesture.cancel(id));

canvas.addEventListener('pointerdown', e => {
  sfx.unlock();
  greetOnce();
  if (hud.blockingOverlayOpen || homeFade.running) return;
  handleGesture(gesture.down(e.pointerId, e.clientX, e.clientY, performance.now()));
  if (gesture.activeId !== e.pointerId) return; // a second finger: ignored
  try { canvas.setPointerCapture(e.pointerId); } catch { /* not every pointer can be captured */ }
  pressHit = scene.pick(e.clientX, e.clientY);
  pressEntity = entityAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', e => {
  if (hud.blockingOverlayOpen || homeFade.running) { cancelPress(); return; }
  handleGesture(gesture.move(e.pointerId, e.clientX, e.clientY, performance.now()));
});
canvas.addEventListener('pointerup', e => {
  if (hud.blockingOverlayOpen || homeFade.running) { cancelPress(e.pointerId); return; }
  handleGesture(gesture.up(e.pointerId, e.clientX, e.clientY, performance.now()));
});
// A lost release must never leave a press stuck (the classifier also drops presses over 2 s old).
canvas.addEventListener('pointercancel', e => cancelPress(e.pointerId));
canvas.addEventListener('lostpointercapture', e => cancelPress(e.pointerId));
window.addEventListener('blur', () => cancelPress());
// A long press must not open a menu or select anything.
canvas.addEventListener('contextmenu', e => e.preventDefault());
// Capture phase: HUD buttons stop propagation, but a first tap on them must still unlock audio and greet.
window.addEventListener('pointerdown', () => { sfx.unlock(); greetOnce(); tapped = true; }, { once: true, capture: true });
// Clips are fetched on first use; only the greetings are warmed once the first tap has unlocked audio.
window.addEventListener('pointerdown', () => voice.prefetch([...LINES.hello, ...LINES.welcomeBack]), { once: true, capture: true });

const camDir = { x: 0, z: 1 };

/** Left stick relative to where the camera faces (its yaw, so pitch never matters). */
function padStick(stick: [number, number]): [number, number] {
  camDir.x = Math.sin(scene.rig.yaw);
  camDir.z = Math.cos(scene.rig.yaw);
  const fwd = -stick[1];
  const right = stick[0];
  let x = camDir.x * fwd - camDir.z * right;
  let z = camDir.z * fwd + camDir.x * right;
  const m = Math.hypot(x, z);
  if (m > 1) { x /= m; z /= m; }
  return [x, z];
}

// Neighbours greet on their own when he walks near; Pip leads him there once (until he has arrived).
const greet = new GreetTracker();
const villagerById = Object.fromEntries(VILLAGERS.map(v => [v.id, v])) as Record<VillagerId, (typeof VILLAGERS)[number]>;
const lastHello: Partial<Record<VillagerId, string>> = {};
const warmed = new Set<VillagerId>();
// Neighbour lookups done once, not per frame.
const warmZones = VILLAGERS.flatMap(def => {
  const house = village.houses.find(h => h.id === def.house);
  return house ? [{ def, rect: house.greetRect }] : [];
});
let currentHello: { text: string; speaker: string } | null = null;
let tapped = false; // the first tap / button unlocks audio
const feet: Cell = [0, 0, 0]; // reused every frame
const isAudioLocked = (): boolean => audioLocked(tapped, sfx.audioOut()?.ctx.state);
const lockedHold = new LockedHold();
const lead = new LeadToVillage(village.route, village.square, flags.ledToVillage, village.pad);
// Underground (7h): Pip leads him home on foot after a quiet spell; first visits are saved as flags.
const leadHome = new LeadHome();
let homeRoute: Cell[] | null = null;
const discovery = new CaveDiscovery(world, caves, flags);
/** Pip's cave lines waiting for a quiet moment (a few seconds at most, then dropped), and what saying one sets. */
const caveLines: Array<{ key: LineKey; left: number; said?: () => void }> = [];
const queueCaveLine = (key: LineKey, seconds: number, said?: () => void): void => {
  if (!caveLines.some(l => l.key === key)) caveLines.push({ key, left: seconds, said });
};
function beginLeadHome(cell: Cell): void {
  // Never over another walk Pip is leading.
  if (pal.leading || lead.state === 'leading' || leadTower.state === 'leading') { leadHome.decline(); return; }
  const route = routeHome(world, [cell[0], cell[1], cell[2]], caves);
  if (!route || route.length < 2) { leadHome.decline(); return; }
  leadHome.begin(route, cell);
  homeRoute = route;
  pal.setLead(route, () => leadHome.targetIndex());
  pendingPip = 'goUp';
}
const atRouteEnd = (cell: Cell): boolean => {
  const end = homeRoute?.[homeRoute.length - 1];
  return !!end && Math.hypot(cell[0] - end[0], cell[2] - end[2]) <= 2 && Math.abs(cell[1] - end[1]) <= 2;
};
game.on(e => {
  if (e.type === 'noPathDeep') {
    // A tap he cannot walk to while deep: the Home button wobbles and Pip offers the way up (once a trip).
    hud.wobbleHome();
    if (leadHome.offerNow()) beginLeadHome(game.player.feetCell());
    else pal.react('noPath');
  } else if (e.type === 'gem') {
    if (!hasHint(flags, 'gemFound')) queueCaveLine('gemFound', 20, () => { addHint(flags, 'gemFound'); saveNow(); });
  } else if (e.type === 'chestOpened') {
    if (hints.reactionReady('treasureFound', Date.now())) queueCaveLine('treasureFound', 6, () => hints.reactionSaid('treasureFound', Date.now()));
  }
});
// "Let's dig down and find caves": the second idle hint, once, after the village walk and before he has been deep.
pal.setIdleLine(n => (digDownReady(flags, n) ? 'digDown' : null), k => {
  if (k === 'digDown' && lineSpoken) { addHint(flags, 'digDown'); saveNow(); }
});
// Pip's second walk: to the wizard, once per save, only once he has a gem and the village walk is done.
const leadTower = makeTowerLead(tower, towerRoute, towerPad, wizard.led, {
  hasGem: () => game.inventory.count(ItemId.Gem) > 0,
  ledToVillage: () => flags.ledToVillage,
  villageLeading: () => lead.state === 'leading',
  villagePad: village.pad,
});
const visit = new WizardVisit();
let currentWizardHello: string | null = null;
let wizardWarmed = false;
let acted = false;
game.on(e => { if (e.type !== 'idle') acted = true; });
let pendingPip: LineKey | null = null;
let cosySaid = false;
const cottage = village.houses.find(h => h.id === 'cottage');
const saveNow = (): void => autosave.save();

const HINT_ORDER: readonly HintKey[] = ['cropReady', 'tryMunch', 'plantSome', 'needWaterSun', 'holdOutFood', 'grumpArrives', 'plantsWaiting', 'craftWeapon', 'pickWeapon', 'friendMade'];
const isHintKey = (k: LineKey): k is HintKey => (HINT_ORDER as readonly string[]).includes(k);
let hintClock = 0;
let reactionsWarmed = false;
const REACTION_KEYS: readonly LineKey[] = [
  'harvested', 'ateApple', 'ateCarrot', 'atePotato', 'drankMilk', 'fedAnimal', 'animalFull', 'petAnimal', 'gotEgg', 'gotMilk', 'gotWool',
  'plantSome', 'needWaterSun', 'cropReady', 'holdOutFood', 'tryMunch',
  'cheerHalf', 'cheeredUp', 'grumpGift', 'friendHelps',
];
const SEED_ITEMS = [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed, ItemId.AppleSapling];
const within = (r: { x0: number; z0: number; x1: number; z1: number }, c: Cell, pad: number): boolean =>
  c[0] >= r.x0 - pad && c[0] <= r.x1 + pad && c[2] >= r.z0 - pad && c[2] <= r.z1 + pad;
const plotRect = {
  x0: Math.min(...village.farm.beds.map(b => b.x0)), z0: Math.min(...village.farm.beds.map(b => b.z0)),
  x1: Math.max(...village.farm.beds.map(b => b.x1)), z1: Math.max(...village.farm.beds.map(b => b.z1)),
};
function hintContext(cell: Cell): HintContext {
  const sel = game.effectiveSelected();
  return {
    hasSeeds: SEED_ITEMS.some(id => game.inventory.count(id) > 0),
    nearPlot: within(plotRect, cell, 8),
    planted: game.farm.seedsAndGrowing().growing > 0,
    ripeNearby: game.farm.nearestRipe(cell, 6) !== null,
    hasFood: FEEDS.some(id => game.inventory.count(id) > 0),
    nearPasture: within(pasture, cell, 6),
    edibleSelected: sel !== 'hand' && isItemId(sel) && ITEMS[sel].edible,
    grumpHere: play.system.grumps.length > 0,
    grumpWaitedSeconds: grumpWait,
    plantsPaused: play.system.pausedCells(game.farm.plantCells()).length > 0,
    hasWeapon: WEAPONS.some(id => game.inventory.count(id) > 0),
    weaponSelected: sel !== 'hand' && weaponKind(sel as never) !== null,
    sulkyInView: play.system.grumps.some(g => g.mood === 0 && Math.hypot(g.x - cell[0], g.z - cell[2]) < 24),
    friendJustMade,
  };
}

function updateVillage(dt: number): void {
  if (homeFade.running) return; // No new cave discoveries or lead offers during the lift.
  const breakOpen = hud.breakOpen;
  tryWelcome(); // replays a welcome the break bubble held back, once the bubble has closed
  const paused = game.paused || hud.blockingOverlayOpen;
  if (breakOpen) pal.hush(1000); // Pip's own chatter waits for the break bubble
  const pp = game.player.pos;
  feet[0] = Math.floor(pp.x); feet[1] = Math.floor(pp.y); feet[2] = Math.floor(pp.z);
  const cell = feet;
  const evH = leadHome.update(dt, game.isDeep(), acted, leadPaused(paused, breakOpen), atRouteEnd(cell), cell);
  if (evH === 'offer') beginLeadHome(cell);
  else if (evH === 'arrive') { pal.setLead(null); homeRoute = null; pendingPip = 'backUp'; }
  else if (evH === 'giveUp') { pal.setLead(null); homeRoute = null; }
  // The walks to the village and the tower are never offered while he is deep underground (their
  // clocks wait): down there the way up comes first, and Pip's own lead home must not be crowded out.
  const holdOffer = (l: LeadToVillage): boolean => game.isDeep() && l.state === 'waiting';
  const ev = lead.update(dt, cell, acted, leadPaused(paused, breakOpen) || holdOffer(lead));
  const evT = leadTower.update(dt, cell, acted, leadPaused(paused, breakOpen) || holdOffer(leadTower));
  acted = false;
  if (evT === 'start') { pal.setLead(towerRoute, () => leadTower.targetIndex()); pendingPip = 'letsVisitWizard'; }
  else if (evT === 'comeOn' || evT === 'thisWay') pendingPip = evT;
  else if (evT === 'arrive') { pal.setLead(null); pendingPip = 'meetWizard'; }
  else if (evT === 'giveUp') pal.setLead(null);
  if (leadTower.takeFlagSet()) {
    wizard.led = true;
    saveNow();
  }
  if (ev === 'start') { pal.setLead(village.route, () => lead.targetIndex()); pendingPip = 'letsMeetNeighbours'; }
  else if (ev === 'comeOn' || ev === 'thisWay') pendingPip = ev;
  else if (ev === 'arrive') { pal.setLead(null); pendingPip = 'weAreHere'; }
  else if (ev === 'giveUp') pal.setLead(null);
  if (lead.takeFlagSet()) {
    flags.ledToVillage = true;
    saveNow();
  }
  updateUnderground(dt, cell, leadPaused(paused, breakOpen));
  if (paused) return;
  // Warm the clips of a neighbour he is walking towards.
  for (const { def, rect: r } of warmZones) {
    if (warmed.has(def.id)) continue;
    if (cell[0] >= r.x0 - 12 && cell[0] <= r.x1 + 12 && cell[2] >= r.z0 - 12 && cell[2] <= r.z1 + 12) {
      warmed.add(def.id);
      voice.prefetch(VILLAGER_LINES[def.id], def.speaker);
    }
  }
  // Walking away stops the hello itself, never a Pip line or break reminder that has replaced it.
  if (greet.takeCancel() && currentHello) {
    if (voice.stopIfCurrent(currentHello.text, currentHello.speaker)) hud.hideBubble();
    currentHello = null;
  }
  // Audio locked or suspended: hold hellos and Pip's queued line (the first tap resumes it, then they play
  // as clips). Held more than 30 s, they are dropped quietly and no cooldown is used up.
  const locked = isAudioLocked();
  if (lockedHold.update(dt, locked)) {
    pendingPip = null;
    greet.skipCurrent(cell, village.houses);
    visit.skipCurrent();
  }
  const speech: SpeechContext = {
    breakOpen, speaking: voice.speaking(), locked, pipPending: pendingPip !== null, gestureBusy: gesture.busy,
  };
  // Orlo: he counts as met the first time he stands in the tower or on its doorstep (saved at once,
  // so the star marker is gone for good); his hello waits for Pip, the break bubble and the audio.
  const wizardHello = visit.update(cell, tower, !mayWizardGreet(speech));
  if (visit.firstEnter() && !wizard.met) { wizard.met = true; saveNow(); }
  if (visit.takeCancel() && currentWizardHello) {
    if (voice.stopIfCurrent(currentWizardHello, 'wizard')) hud.hideBubble();
    currentWizardHello = null;
  }
  if (!wizardWarmed && Math.hypot(cell[0] - tower.doorFront[0], cell[2] - tower.doorFront[2]) < 14) {
    wizardWarmed = true;
    voice.prefetch(WIZARD_LINES.hello, 'wizard');
  }
  if (locked) return;
  if (wizardHello) {
    const text = pickWizardLine('hello', lastWizard.hello);
    lastWizard.hello = text;
    lastWizardKey = 'hello';
    currentWizardHello = text;
    wizardAgain = () => { orloSpoke(); voice.say(text, 'wizard', { holdForAudio: true }); };
    orloSpoke();
    voice.say(text, 'wizard', { holdForAudio: true });
    hud.showBubble(WIZARD_ICONS.hello, 'Hi!');
    clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => hud.hideBubble(), 3000);
    pal.hush(5000);
    return;
  }
  // Pip waits for a neighbour to finish (and the other way round): nobody talks over anybody.
  if (pendingPip && mayPipSpeakQueued(speech)) {
    const said = pendingPip;
    pendingPip = null;
    if (isHintKey(said)) {
      // A hint goes through Pip's chatter gap like any reaction, and counts as told only once it was really said.
      // Checked again with fresh facts (he may have put the food away since it was queued).
      if (!hud.breakOpen && hints.shouldSay(said, hintContext(cell)) && pal.react(said) && lineSpoken) {
        hints.markSeen(said);
        flags.hints = mergeHints(flags.hints, hints.seen()); // the caves' hints stay beside the farm's
      }
    } else {
      sayLine(said);
      // Pip's "what is that light?" counts as said only once it really was (then it never comes again).
      if (said === 'seeTowerLight' && lineSpoken && !wizard.hints.includes('seeLight')) {
        wizard.hints.push('seeLight');
        saveNow();
      }
    }
    return;
  }
  const hello = greet.update(cell, village.houses, !mayGreet(speech));
  if (hello) {
    const def = villagerById[hello];
    let text = pickVillagerLine(hello, lastHello[hello]);
    let icon = def.icon;
    let word: string | undefined = 'Hi!';
    if (hello === 'fern') {
      // Her first hello gives the starter seeds (once per save); later she tops up an empty bag. Saved at once.
      const gift = fernGift(flags, game.inventory, game.farm.seedsAndGrowing());
      if (gift) {
        const pool = gift.kind === 'seedGift' ? FERN_LINES.seedGift : FERN_LINES.moreSeeds;
        text = pool.filter(l => l !== lastHello.fern)[Math.floor(Math.random() * Math.max(1, pool.length - 1))] ?? pool[0];
        icon = '🌱';
        word = undefined;
        sfx.gift();
        renderHud();
        saveNow();
      }
    }
    lastHello[hello] = text;
    currentHello = { text, speaker: def.speaker };
    orloLast = false;
    voice.say(text, def.speaker, { holdForAudio: true });
    hud.showBubble(icon, word);
    clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => hud.hideBubble(), 3000);
    pal.hush(5000);
    return;
  }
  if (!reactionsWarmed && (within(plotRect, cell, 14) || within(pasture, cell, 14))) {
    reactionsWarmed = true; // the farm's reaction lines are fetched once he is near, so the first one is not late
    voice.prefetch(REACTION_KEYS.flatMap(k => LINES[k]));
  }
  hintClock += dt;
  if (hintClock >= 1 && pendingPip === null && !hello && !game.eating.active) {
    hintClock = 0;
    const ctx = hintContext(cell);
    for (const k of HINT_ORDER) if (hints.shouldSay(k, ctx)) { pendingPip = k; break; }
  }
  if (!cosySaid && cottage) {
    const r = cottage.rect;
    if (cell[0] >= r.x0 && cell[0] <= r.x1 && cell[2] >= r.z0 && cell[2] <= r.z1) {
      cosySaid = true;
      pendingPip = 'cosyHome';
    }
  }
}

/** First visits underground (saved at once) and Pip's cave lines, said when he is free to talk. */
function updateUnderground(dt: number, cell: Cell, paused: boolean): void {
  for (const ev of discovery.update(cell, game.isDeep())) {
    if (ev === 'cavesSeen') { flags.cavesSeen = true; queueCaveLine('cavesLit', 20); }
    else { flags.ruinFound = true; queueCaveLine('oldBase', 20); }
    saveNow();
  }
  if (caveLines.length === 0 || hud.breakOpen) return;
  const next = caveLines[0];
  next.left -= dt;
  if (next.left <= 0) { caveLines.shift(); return; }
  if (paused && next.key !== 'treasureFound') return; // the chest's own line goes with its cards
  if (pendingPip !== null || voice.speaking() || isAudioLocked()) return;
  if (pal.react(next.key) && lineSpoken) {
    caveLines.shift();
    next.said?.();
  }
}

/** Animals wander, come over for food and make small happy noises (only near him, never over a voice). */
function updateHerd(dt: number, seconds: number): void {
  const events = herd.update({ world, roam, player: game.player.pos, held: game.effectiveSelected(), occupied: peopleCells(), dt });
  for (const ev of events) {
    if (ev.dist > 12 || voice.speaking() || hud.blockingOverlayOpen) continue;
    NOISE[ev.kind]();
  }
  const cam = scene.camera.position;
  animalView.sync(herd.animals, (x, z) => Math.hypot(x - cam.x, z - cam.z) < ANIMAL_VIEW_RANGE, seconds);
}

/** Grumps and friends: they wobble, settle by the plants and keep their distance. A menu stops all of it (dt 0). */
let grumpWait = 0;
let sadClock = 0;
/** ?debug only: what the last shot was (its weapon, picture and sound). */
const lastFire = { weapon: '', sfx: '', projectile: '' };
/** One game-time step of the grump rules (the frame calls it, and so do the debug hooks that skip waiting). */
function updateGrumpsStep(dt: number): void {
  const over = game.paused || hud.blockingOverlayOpen || hud.breakOpen || homeFade.running;
  const res = play.update(dt, {
    player: game.player.pos, occupied: [...peopleCells(), ...herd.occupiedCells()], plantCells: game.farm.plantCells(),
    overlayOpen: over, paused: game.paused, deep: game.isDeep(),
  });
  if (res.spawned) refreshSadMarks();
}
function updateGrumps(dt: number, seconds: number): void {
  const over = game.paused || hud.blockingOverlayOpen || hud.breakOpen || homeFade.running;
  const res = play.update(dt, {
    player: game.player.pos, occupied: [...peopleCells(), ...herd.occupiedCells()], plantCells: game.farm.plantCells(),
    overlayOpen: over, paused: game.paused, deep: game.isDeep(),
  });
  const frozen = helperDt(over, dt);
  delayed.update(frozen);
  projectile.update(frozen);
  const p = game.player.pos;
  for (const ev of res.grumps) {
    if (ev.type === 'arrived') {
      const g = play.system.grumps.find(o => o.id === ev.id);
      if (g && Math.hypot(g.x - p.x, g.z - p.z) <= 12) sfx.plip();
    } else if (ev.dist <= 10 && !voice.speaking() && !hud.blockingOverlayOpen) {
      sfx.sulk(ev.dist);
    }
  }
  for (const ev of res.friends) {
    const f = play.system.friends.find(o => o.id === ev.friend);
    if (f) sparkles.burst({ x: f.x, y: f.y + 1.1, z: f.z }, 'heart', 5);
    grumpSay('friendHelps');
  }
  if (res.spawned) { sfx.plip(); refreshSadMarks(); }
  if (play.system.grumps.length === 0) grumpWait = 0; else if (!over) grumpWait += dt;
  sadClock += dt;
  if (sadClock >= 0.25) { sadClock = 0; refreshSadMarks(); }
  const cam = scene.camera.position;
  grumpView.sync(
    play.system, (x, z) => Math.hypot(x - cam.x, z - cam.z) < GRUMP_VIEW_RANGE, seconds,
    id => shownMood.get(id) ?? play.system.grumps.find(g => g.id === id)?.mood ?? 1,
    [...leaving.values()], (type, id) => type === 'friend' && hiddenFriends.has(id),
  );
}

/** The munch: arms up, head dips, the little picture shrinks, crumbs on each bite, Pip speaks when it ends. */
function updateEating(): void {
  const e = game.eating;
  if (e.active) {
    setEatPose(playerModel, e.progress, e.bite, eatEmoji);
    if (e.bite > eatBite) {
      eatBite = e.bite;
      const q = game.player.pos;
      const h = game.player.heading;
      sparkles.burst({ x: q.x + Math.sin(h) * 0.35, y: q.y + 1.3, z: q.z + Math.cos(h) * 0.35 }, 'crumb', 3);
    }
    eatPosed = true;
  } else if (eatPosed) {
    setEatPose(playerModel, 0, 0);
    eatPosed = false;
    eatBite = 0;
  }
  const done = e.takeFinished();
  if (done !== null) react(reactionKey(done));
}

/** A rare, gentle sparkle over one ripe plant near him, so a ready crop catches the eye. */
let shimmerClock = 0;
function updateShimmer(dt: number): void {
  shimmerClock += dt;
  if (shimmerClock < 0.8) return;
  shimmerClock = 0;
  if (game.paused || hud.blockingOverlayOpen) return;
  const ripe = game.farm.nearestRipe(game.player.feetCell(), 10);
  if (ripe) sparkles.burst({ x: ripe[0] + 0.5, y: ripe[1] + 1.1, z: ripe[2] + 0.5 }, 'sun', 2);
}

/** The tower's far light and the star marker; Pip notices the light once (saved in the wizard's hints). */
let markerClock = 0;
let pipLookFor = 0;
let lastBeacon = { onScreen: false, x: 0, y: 0, angle: 0, distance: 0 };
function updateTowerLight(dt: number, seconds: number): void {
  beacon.update(scene.camera, seconds);
  markerClock += dt;
  if (markerClock < 0.1) return; // ten checks a second is plenty for a picture on the edge
  markerClock = 0;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  lastBeacon = beaconScreen(scene.camera, tower.beacon, w, h);
  const shown = markerShown(lastBeacon, wizard.met, hud.blockingOverlayOpen || hud.breakOpen);
  edgeMarker.update(lastBeacon, shown);
  if (shown && !wizard.hints.includes('seeLight') && pendingPip === null && !game.paused) {
    pendingPip = 'seeTowerLight'; // saved in wizard.hints when Pip has really said it
    if (pipLookFor <= 0) pipLookFor = 2.5;
  }
}

let fpsValue = 0;
let fpsFrames = 0;
let fpsSince = performance.now();
const debugOn = import.meta.env.DEV || location.search.includes('debug');
let fpsEl: HTMLElement | null = null;
if (location.search.includes('debug')) {
  fpsEl = document.createElement('div');
  fpsEl.className = 'fps';
  document.body.appendChild(fpsEl);
}
if (debugOn) {
  (window as unknown as Record<string, unknown>).__debug = {
    playerPos: () => ({ ...game.player.pos }),
    giveItem: (id: StackId, n: number) => { game.inventory.add(id, n); renderHud(); },
    // Only registered ids: a bad one would be autosaved and then rejected on the next load.
    setBlock: (x: number, y: number, z: number, id: BlockId) => { if (Object.hasOwn(BLOCKS, id)) game.world.set(x, y, z, id); },
    selectStack: (id: StackId | 'hand') => { game.selected = id; renderHud(); },
    openBag: () => bagTray.open(),
    fps: () => fpsValue,
    pipPos: () => ({ ...pal.pos }),
    screenOf: (x: number, y: number, z: number) => scene.screenOf(x, y, z),
    pick: (x: number, y: number) => scene.pick(x, y),
    outlineVisible: () => scene.outlineVisible,
    camera: () => {
      const c = scene.camera.position;
      return { position: { x: c.x, y: c.y, z: c.z }, yaw: scene.rig.yaw, pitch: scene.rig.pitch, distance: scene.rig.distance, close: scene.rig.close };
    },
    dragging: () => gesture.dragging,
    digSound: () => sfx.digState(),
    voiceLast: () => ({ ...voice.last }),
    voiceSpeaking: () => voice.speaking(),
    resumeAudio: () => { sfx.unlock(); void sfx.audioOut()?.ctx.resume(); },
    audioState: () => ({ ctx: sfx.audioOut()?.ctx.state ?? null, tapped, locked: isAudioLocked(), pending: pendingPip, busy: gesture.busy }),
    village: () => ({
      houses: village.houses.map(h => ({ id: h.id, rect: h.rect, interior: h.interior, floor: h.floor, doorCells: h.doorCells, groundY: h.groundY, doorFront: h.doorFront, doorInside: h.doorInside, npcSpot: h.npcSpot, greetRect: h.greetRect })),
      route: village.route, square: village.square, gate: village.gate,
    }),
    flags: () => ({ ...flags }),
    leadState: () => lead.state,
    drawCalls: () => scene.renderer.info.render.calls,
    stats: () => {
      const gl = scene.renderer.getContext();
      return { ...scene.stats(), fps: fpsValue, worldTriangles: scene.triangleCount(), animals: herd.animals.length, particles: sparkles.live, grumps: play.system.grumps.length, friends: play.system.friends.length, markers: sadMarks.shown, depthBits: gl.getParameter(gl.DEPTH_BITS) as number };
    },
    // ---- grumps (debug only) ----
    grumps: () => play.system.grumps.map(g => ({ id: g.id, kind: g.kind, x: g.x, y: g.y, z: g.z, mood: g.mood, hits: g.hits, state: g.state })),
    friends: () => play.system.friends.map(f => ({ id: f.id, kind: f.kind, variant: f.variant, x: f.x, y: f.y, z: f.z, jobIn: f.jobIn, state: f.state })),
    spawnGrump: (kind: 'jelly' | 'cloud' = 'jelly') => {
      const border = zoneBorder(grumpZone, world, grumpAvoid);
      const p = game.player.pos;
      const far = border.filter(c => Math.hypot(c[0] + 0.5 - p.x, c[2] + 0.5 - p.z) >= 8);
      const c = (far[0] ?? border[0]) as Cell | undefined;
      return c ? play.system.spawn(c, kind).id : null;
    },
    spawnGrumpAt: (x: number, z: number, kind: 'jelly' | 'cloud' = 'jelly') => {
      const c = settleCell(world, [Math.floor(x), ZONE_Y, Math.floor(z)]);
      return play.system.spawn(c, kind).id;
    },
    spawnerState: () => ({ ...play.spawner.state(), cheered: game.cheered }),
    fire: (id: number) => game.fireWeapon(id).map(e => e.type),
    giveWeapon: (kind: 'bubble' | 'wand' | 'water') => { game.inventory.add({ bubble: ItemId.BubbleBlaster, wand: ItemId.MagicWand, water: ItemId.WaterSquirter }[kind], 1); renderHud(); },
    makeFriend: (id: number) => play.system.tryMakeFriend(id, 5)?.id ?? null,
    setCheered: (n: number) => { game.cheered = n; },
    advanceSpawner: (seconds: number) => { for (let t = 0; t < seconds; t += 0.5) updateGrumpsStep(0.5); },
    advanceFriendJobs: (seconds: number) => { for (let t = 0; t < seconds; t += 0.5) updateGrumpsStep(0.5); },
    screenOfGrump: (id: number) => {
      const p = grumpView.screenPositions(scene.camera, canvas.getBoundingClientRect()).find(o => o.id === id && o.type === 'grump');
      return p ? { x: p.sx, y: p.sy } : null;
    },
    markers: () => sadMarks.shown,
    lastFire: () => ({ ...lastFire }),
    projectileActive: () => projectile.active,
    herd: () => herd.animals.map(a => ({ id: a.id, kind: a.kind, x: a.x, y: a.y, z: a.z, state: a.state, giftIn: a.giftIn })),
    pasture: () => ({ ...pasture, roam, gate: village.farm.gate }),
    animalAt: (x: number, y: number) => animalAt(x, y), // the animal a finger at this point would be on (the real pick)
    screenOfAnimal: (id: number) => {
      const p = animalView.screenPositions(scene.camera, canvas.getBoundingClientRect()).find(o => o.id === id);
      return p ? { x: p.sx, y: p.sy } : null;
    },
    burst: (kind: 'water' | 'sun' | 'both' | 'heart' | 'crumb') => { const q = game.player.pos; sparkles.burst({ x: q.x + 1.2, y: q.y + 1.6, z: q.z }, kind); },
    worldSize: () => ({ x: world.sizeX, y: world.sizeY, z: world.sizeZ }),
    deep: () => game.isDeep(),
    goHome: () => game.goHome(),
    /** The real Home button's path: the fade, then the lift (false when it would do nothing). */
    homeButton: () => { const before = homeFade.running; startHomeLift(); return !before && homeFade.running; },
    home: () => ({ visible: hud.homeVisible, fading: homeFade.running, lead: leadHome.state, target: leadHome.targetIndex(), route: homeRoute?.length ?? 0, cavePending: caveLines.map(l => l.key) }),
    /** The worst straight-line distance from any cave air cell to a glowing block (the "never dark" rule: at most 6). */
    pipSaid: () => [...pipSaid],
    /** Test only: ends the line now playing (headless audio clocks may never fire a clip's end). */
    hushVoice: () => voice.stop(),
    /** Test only: as if Pip had already walked him to the village (the flag is saved with the next save). */
    skipVillageWalk: () => { flags.ledToVillage = true; if (lead.state === 'leading') pal.setLead(null); lead.state = 'done'; pendingPip = null; },
    routeHome: (x: number, y: number, z: number) => routeHome(world, [x, y, z], caves),
    lightCheck: () => {
      const d = lightDistances(world, caves.airCells, 12);
      let worst = 0;
      for (let i = 0; i < d.length; i++) if (d[i] > worst) worst = d[i];
      return worst;
    },
    openChests: () => [...caves.treasure.map(t => ({ id: t.id as string, cell: t.chest })), ...(caves.ruin ? [{ id: 'R', cell: caves.ruin.chest }] : [])]
      .map(c => ({ ...c, open: world.get(c.cell[0], c.cell[1], c.cell[2]) === BlockId.ChestOpen })),
    chestReveal: () => ({ open: chestReveal.open, cards: document.querySelectorAll('.chest-card').length }),
    genMs: () => genMs,
    caves: () => ({
      mouths: caves.mouths.map(m => ({ kind: m.kind, cell: m.cell, ramp: m.ramp })),
      rooms: caves.rooms.map(r => ({ id: r.id, layer: r.layer, centre: [r.cx, r.floorY, r.cz] })),
      treasure: caves.treasure.map(t => ({ id: t.id, chest: t.chest, entrance: t.entrance, front: [t.chest[0] - t.dir[0], t.floorY, t.chest[2] - t.dir[1]] })),
      ruin: caves.ruin && { rect: caves.ruin.rect, floorY: caves.ruin.floorY, chest: caves.ruin.chest, gaps: caves.ruin.gaps },
      stairs: caves.stairs.map(s => s.cells[Math.floor(s.cells.length / 2)]),
      ore: caves.ore.slice(0, 20),
      lights: caves.lights.length,
      timings: caves.timings,
    }),
    look: () => scene.lookNow(),
    loading: () => !!document.getElementById('loading') && !document.getElementById('loading')!.classList.contains('done'),
    sections: () => {
      const s = scene.stats();
      return { built: s.chunks, meshed: s.meshed, visible: s.visible, frustum: s.frustumVisible, queued: s.queued, zone: s.zone };
    },
    view: () => ({
      distance: viewDistance.distance, setting: viewDistance.currentSetting, pinned: viewDistance.pinned,
      emaMs: viewDistance.emaMs, ...scene.view(),
    }),
    setViewSetting: (s: ViewSetting) => viewDistance.setSetting(s),
    ...(location.search.includes('viewtest') ? {
      /** Test only: drives the controller with fake frame times on a fake clock for `seconds` (real frames ignored meanwhile). */
      viewFeed: (ms: number, seconds: number, ctx?: { backlog?: number; drawCalls?: number; sections?: number }) => {
        viewFeeding = true;
        for (let t = 0; t < seconds * 1000; t += ms) {
          viewClockOffset += ms;
          viewDistance.frame(ms, ctx ?? { backlog: 0, drawCalls: 50, sections: 30 });
        }
        return viewDistance.distance;
      },
      viewFeedEnd: () => { viewFeeding = false; },
    } : {}),
    saveNow,
    eating: () => ({ active: game.eating.active, progress: game.eating.progress, bite: game.eating.bite, food: game.eating.food }),
    layoutFarm: () => ({ beds: village.farm.beds, pool: village.farm.pool, irrigation: village.farm.irrigation, pasture, gate: village.farm.gate, fence: village.farm.fence, path: village.farm.path }),
    bag: () => game.inventory.slots().map(id => ({ id, count: game.inventory.count(id) })),
    farm: () => ({ ...game.farm.records(), seeds: game.farm.seedsAndGrowing() }),
    advanceFarm: (ms: number) => game.farm.advance(ms),
    plantAt: (x: number, z: number, kind: CropKind) => {
      const y = world.topSolidY(x, z) + 1;
      game.inventory.add(seedFor(kind), 1);
      renderHud();
      return game.farm.plant([x, y, z], seedFor(kind), []);
    },
    setStage: (x: number, z: number, stage: number) => {
      world.set(x, world.topSolidY(x, z) + 1, z, cropBlock('wheat', stage));
    },
    sparkles,
    limbs: () => {
      const u = playerModel.userData as Record<string, { rotation: { x: number } }>;
      const pl = (pip.userData.legs as { rotation: { x: number } }[]).map(l => l.rotation.x);
      return { legL: u.legL.rotation.x, legR: u.legR.rotation.x, armL: u.armL.rotation.x, armR: u.armR.rotation.x, bob: playerModel.position.y - game.player.pos.y, pip: pl };
    },
    hidePlayer: (hide: boolean) => { debugHidePlayer = hide; },
    setCamera: (yaw: number, pitch: number) => { scene.rig.yaw = yaw; scene.rig.pitch = pitch; },
    teleport: (x: number, y: number, z: number) => {
      if (!isStandable(world, [Math.floor(x), Math.floor(y), Math.floor(z)])) return false;
      game.player.pos = { x, y, z };
      game.player.setPath(null);
      return true;
    },
    game,
    usage,
    pal,
    hud,
    craftScreen,
    tower: () => ({ ...tower, route: towerRoute, wizardSpot: tower.wizardSpot }),
    wizard: () => ({
      state: { ...wizard, hints: [...wizard.hints] },
      open: () => openWizard(),
      close: () => wizardScreen.close(),
      tab: (t: 'trade' | 'puzzle') => wizardScreen.tab(t),
      isOpen: wizardScreen.isOpen,
      currentTab: wizardScreen.currentTab,
      puzzle: () => {
        const s = wizardScreen.session;
        return s ? { ...s.puzzle, solved: s.solved, helped: s.helped, wrong: s.wrong, basket: { ...s.basket } } : null;
      },
      hint: () => wizardScreen.session?.hint() ?? null,
      lastKey: () => lastWizardKey,
      play: (p: Puzzle) => wizardScreen.play(p),
      advance: (seconds: number) => { for (let t = 0; t < seconds; t += 0.5) wizardScreen.update(0.5); },
      screenOf: () => {
        const r = canvas.getBoundingClientRect();
        const c = wizardView.screenCentre(scene.camera, r);
        return { x: c.sx, y: c.sy };
      },
      entityAt: (x: number, y: number) => entityAt(x, y),
    }),
    giveGem: (n: number) => { game.inventory.add(ItemId.Gem, n); renderHud(); return game.inventory.count(ItemId.Gem); },
    horizon: () => ({ ...scene.horizonStats(), tower: tower.beacon }),
    setHorizon: (on: boolean) => scene.setHorizonEnabled(on),
    beacon: () => ({ ...lastBeacon, markerVisible: edgeMarker.visible, spriteVisible: beacon.sprite.visible }),
    leadTowerState: () => leadTower.state,
    depthBits: () => {
      const gl = scene.renderer.getContext();
      return gl.getParameter(gl.DEPTH_BITS) as number;
    },
  };
  (window as unknown as { __triangles: () => number }).__triangles = () => scene.triangleCount();
}

let usageMs = 0;
/** The loading picture fades once the first frame of the world is drawn. */
let loadingHidden = false;
function hideLoading(): void {
  loadingHidden = true;
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('done');
  window.setTimeout(() => el.remove(), 450);
}
let viewFrames = 0;
let viewSections = 0;
/** True while the ?viewtest feed drives the view controller (real frames are then ignored). */
let viewFeeding = false;
let pipGone = false;
let debugHidePlayer = false; // ?debug screenshots only
// Walk cycles advance by the distance actually moved each frame (blocked, paused or standing = 0 = ease to rest).
const playerWalk = makeWalkState();
const pipWalk = makeWalkState();
let prevPlayerX = game.player.pos.x, prevPlayerZ = game.player.pos.z;
let prevPipX = pal.pos.x, prevPipZ = pal.pos.z;
let last = performance.now();
function frame(now: number): void {
  const rawMs = now - last;
  const dt = Math.min(0.1, rawMs / 1000);
  last = now;

  const { stick, look, pressed } = pad.poll(now);
  if (grownUps.isOpen) {
    game.player.setStick(0, 0);
  } else if (wizardScreen.isOpen) {
    game.player.setStick(0, 0);
    wizardScreen.padInput(stick, pressed);
  } else if (craftScreen.isOpen) {
    game.player.setStick(0, 0);
    craftScreen.padInput(stick, pressed);
  } else if (bagTray.isOpen) {
    game.player.setStick(0, 0);
    bagTray.padInput(stick, pressed);
  } else if (hud.blockingOverlayOpen || homeFade.running) {
    game.player.setStick(0, 0);
    if (chestReveal.open && pressed.length > 0) chestReveal.hide(); // any pad button closes the chest cards too
  } else {
    if (stick[0] !== 0 || stick[1] !== 0) {
      const [sx, sz] = padStick(stick);
      game.player.setStick(sx, sz);
      game.noteActivity();
      acted = true;
    } else {
      game.player.setStick(0, 0);
    }
    if (pressed.length > 0) { sfx.unlock(); tapped = true; }
    for (const action of pressed) game.padAction(action);
    if (look[0] !== 0 || look[1] !== 0) {
      scene.rig.turn(look[0], look[1], dt);
      game.noteActivity();
    }
  }

  if (hud.blockingOverlayOpen || homeFade.running) cancelPress();
  else if (gesture.busy && !gesture.dragging) handleGesture(gesture.tick(now, holdNow(pressHit).kind === 'dig'));
  game.update(dt);
  if (!game.paused) {
    game.farm.update(dt);
    updateHerd(dt, now / 1000);
  }
  updateGrumps(dt, now / 1000);
  sparkles.update(dt);
  chestReveal.update(dt);
  homeFade.update(rawMs / 1000);
  hud.setHomeVisible(game.isDeep() && !homeFade.running);
  updateShimmer(dt);
  // Usage is counted once a second, not every frame (it caps each tick at 5 s anyway).
  usageMs += rawMs;
  if (usageMs >= 1000) {
    if (usage.tick(usageMs, document.visibilityState === 'visible').remind) pal.remindBreak();
    usageMs = 0;
  }
  const p = game.player.pos;
  playerModel.position.set(p.x, game.player.visualY, p.z); // a gentle drop is a glide
  playerModel.rotation.y = game.player.heading;
  animatePlayerWalk(playerModel, playerWalk, dt, Math.hypot(p.x - prevPlayerX, p.z - prevPlayerZ));
  prevPlayerX = p.x; prevPlayerZ = p.z;
  updateEating(); // after the walk swing: while he munches the arms belong to the munch (legs still walk)
  updateVillage(dt);
  pal.update(world, game.player, helperDt(game.paused || hud.blockingOverlayOpen, dt));
  for (const v of villagers) idleVillager(v.model, now / 1000);
  // The puzzle's hint clock stands still while the break bubble is up.
  wizardScreen.update(hud.breakOpen ? 0 : dt);
  if (wizardScreen.isOpen) {
    pipHeld.offer(voice.speaking(), hud.breakOpen, k => pal.react(k as LineKey));
  }
  const wizardSpeaking = voice.speaking() && voice.last.key.startsWith('wizard/');
  wizardView.update(dt, now / 1000, game.player.pos, wizardSpeaking, scene.camera.position);
  if (pal.takeHop()) pipHop = 0.0001;
  let hopY = 0;
  if (pipHop > 0) {
    pipHop += dt;
    hopY = Math.abs(Math.sin(pipHop * 8)) * 0.6;
    if (pipHop > 0.8) pipHop = 0;
  }
  pip.position.set(pal.pos.x, pal.pos.y + hopY, pal.pos.z);
  pip.rotation.y = pal.heading;
  if (pipLookFor > 0) {
    // Pip turns his head towards the far light he has just noticed.
    pipLookFor -= dt;
    pip.rotation.y = Math.atan2(tower.beacon.x - pal.pos.x, tower.beacon.z - pal.pos.z);
  }
  animatePalTrot(pip, pipWalk, dt, Math.hypot(pal.pos.x - prevPipX, pal.pos.z - prevPipZ));
  prevPipX = pal.pos.x; prevPipZ = pal.pos.z;
  scene.followTarget(playerModel.position, dt);
  // Hidden with hysteresis while the camera is near his head, so a back-view never fills a small room.
  playerModel.visible = !scene.rig.modelHidden && !debugHidePlayer;
  // Pip steps out of the picture when the camera is close to him or he would cover the middle of the view.
  pipGone = pipHiddenFor(scene.rig.position, scene.rig.forward, pip.position, pipGone);
  pip.visible = !pipGone;
  scene.updateMarker(dt);
  updateTowerLight(dt, now / 1000);
  scene.render();
  // The view distance watches the real frame time and the budgets (the frustum count every 10 frames).
  if (++viewFrames % 10 === 0) viewSections = scene.frustumSections();
  if (!viewFeeding) viewDistance.frame(rawMs, { backlog: scene.backlog, drawCalls: scene.renderer.info.render.calls, sections: viewSections });
  scene.setViewDistance(viewDistance.distance);
  if (!loadingHidden) hideLoading();

  // Redraw the hotbar only when a count or the selection changed.
  const rev = game.inventory.revision;
  const sel = game.effectiveSelected();
  if (rev !== hudRevision || sel !== hudSelected) renderHud();

  fpsFrames++;
  if (now - fpsSince >= 500) {
    fpsValue = Math.round((fpsFrames * 1000) / (now - fpsSince));
    fpsFrames = 0;
    fpsSince = now;
    if (fpsEl) fpsEl.textContent = `${fpsValue} fps`;
  }
  requestAnimationFrame(frame);
}
renderHud();
// Show Pip's greeting picture straight away; the voice follows the first tap (mobile needs a gesture).
hud.showBubble(LINE_ICONS[hadSave ? 'welcomeBack' : 'hello'], 'Hi!');
requestAnimationFrame(frame);
