import type { Puzzle, Thing } from '../core/puzzles';

/**
 * Orlo the wizard's lines (spec §7g), spoken in his own voice (speaker `wizard`, tools/voice/voices.json).
 * Lines policy (tests/content/wizard.test.ts enforces it): British, at most 12 words, four variants,
 * no cheer or sound words (his slowness comes from the voice's tempo, not from "hmm"), never "tap",
 * nothing scary or dark, never asks him to read, true whenever the key can fire (no claims about his
 * gems or bag, and the puzzle lines never promise a block: a full bag gets none), nothing for later steps.
 */
export type WizardKey =
  | 'hello'
  | 'welcomeGift'
  | 'tradeAsk'
  | 'bought'
  | 'needGem'
  | 'bagFull'
  | 'puzzleAsk'
  | 'countAsk'
  | 'patternAsk'
  | 'matchAsk'
  | 'tryAgain'
  | 'hint1'
  | 'hint2'
  | 'solved'
  | 'helped'
  | 'bye';

export const WIZARD_LINES: Record<WizardKey, string[]> = {
  hello: [
    'Welcome to my tower, young friend.',
    'Hello, young friend. I am Orlo the wizard.',
    'Glim and I were counting stars.',
    'Come in, come in. Mind the stairs.',
  ],
  welcomeGift: [
    'Every new friend gets one gift. Choose a magic block.',
    'A gift for you, young friend. Choose a block.',
    'Choose one magic block. It is my gift to you.',
    'Glim says you should pick a gift.',
  ],
  tradeAsk: [
    'Magic blocks for shiny gems. Choose one.',
    'Shiny gems buy sets of magic blocks.',
    'Gems turn into magic blocks in my tower.',
    'Choose a block. Gems are what I like best.',
  ],
  // Only after a trade, which always gives a bundle of four.
  bought: [
    'Four magic blocks for you, young friend.',
    'There you are. Build something wonderful.',
    'A fine choice. Glim approves.',
    'Those will look lovely in your house.',
  ],
  needGem: [
    'That one needs more gems. A puzzle might help.',
    'Not enough gems yet. Would you like a puzzle?',
    'Bring me a gem, or try a puzzle.',
    'Puzzles are free. Shall we try one?',
  ],
  bagFull: [
    'Your bag is full of those. Build with some!',
    'You have plenty of those. Build with some first.',
    'That is a lot of blocks already.',
    'Use some first, then come back.',
  ],
  puzzleAsk: [
    'Here is a puzzle for you.',
    'Let us try a puzzle together.',
    'Can you solve my puzzle, young friend?',
    'A little puzzle, just for you.',
  ],
  // The lead-in, spoken just before the stitched numbers and things (WIZARD_PARTS).
  countAsk: [
    'Bring me',
    'Please put in my basket',
    'I would like',
    'Fill my basket with',
  ],
  patternAsk: [
    'What comes next?',
    'Which picture comes next?',
    'Look at the row. What comes next?',
    'Can you finish the row?',
  ],
  matchAsk: [
    'Find the one that is the same.',
    'Which one matches?',
    'Look carefully. Which is the same?',
    'Find the matching picture.',
  ],
  tryAgain: [
    'Not that one. Try again.',
    'Have another look.',
    'Not quite. Try once more.',
    'That is not it. Try another.',
  ],
  // Hint 1: the right card (or the needed shelf picture) pulses.
  hint1: [
    'Look at the glowing picture.',
    'Glim thinks it is this one.',
    'Look closely. Something is shining.',
    'Take your time. Look at the glow.',
  ],
  // Hint 2: cards fade out, or dotted slots show what is missing; true for every puzzle kind.
  hint2: [
    'Take another look. Glim is helping.',
    'Glim is giving you a clue.',
    'Slowly does it. Look at each picture.',
    'Glim is making it easier for you.',
  ],
  solved: [
    'That is right! You are very clever.',
    'Splendid. You worked it out.',
    'You solved it, young friend.',
    'Quite right. Glim is pleased.',
  ],
  helped: [
    'We solved it together, young friend.',
    'Glim and I helped a little. Well done.',
    'That was a tricky one. Well done.',
    'Together we did it.',
  ],
  bye: [
    'Come back whenever you like.',
    'The stars will be here, young friend.',
    'Come and see Glim and me again.',
    'Glim and I will be here.',
  ],
};

/** One picture per key, for the speech bubble and the 🔊 button (no reading needed). */
export const WIZARD_ICONS: Record<WizardKey, string> = {
  hello: '🧙',
  welcomeGift: '🎁',
  tradeAsk: '💎',
  bought: '✨',
  needGem: '💎',
  bagFull: '🎒',
  puzzleAsk: '🧩',
  countAsk: '🧺',
  patternAsk: '🔴🔵',
  matchAsk: '🔷',
  tryAgain: '🔁',
  hint1: '💡',
  hint2: '🔎',
  solved: '🌟',
  helped: '🌟',
  bye: '👋',
};

/** The numbers one to twenty as spoken parts; NUMBER_WORDS[n - 1] says n. */
export const NUMBER_WORDS: readonly string[] = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/**
 * Fragments with their own clips, stitched by `Voice.sayParts` into a counting sentence: the
 * numbers, each thing (singular for one, plural otherwise) and "and". At most three words each.
 */
export const WIZARD_PARTS: { numbers: readonly string[]; things: Record<Thing, { one: string; many: string }>; and: string } = {
  numbers: NUMBER_WORDS,
  things: {
    apple: { one: 'apple', many: 'apples' },
    carrot: { one: 'carrot', many: 'carrots' },
    potato: { one: 'potato', many: 'potatoes' },
    wheat: { one: 'bundle of wheat', many: 'bundles of wheat' },
    egg: { one: 'egg', many: 'eggs' },
  },
  and: 'and',
};

/** Every fragment text, de-duplicated (the exporter and the clip tests read this). */
export function wizardPartTexts(): string[] {
  const things = Object.values(WIZARD_PARTS.things).flatMap(t => [t.one, t.many]);
  return [...new Set([...WIZARD_PARTS.numbers, ...things, WIZARD_PARTS.and])];
}

/** A variant for a key, never the same one twice in a row. */
export function pickWizardLine(key: WizardKey, last: string | undefined, rng: () => number = Math.random): string {
  const variants = WIZARD_LINES[key];
  const pool = variants.length > 1 ? variants.filter(v => v !== last) : variants;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] ?? '';
}

/**
 * The parts after the `countAsk` lead-in for a counting puzzle, e.g. ["three", "apples", "and",
 * "two", "carrots"]. Empty for the other kinds. A count outside 1..20 is clamped so it always has a clip.
 */
export function countSentence(p: Puzzle): string[] {
  if (p.kind !== 'count') return [];
  const out: string[] = [];
  p.wants.forEach((w, i) => {
    if (i > 0) out.push(WIZARD_PARTS.and);
    const n = Math.max(1, Math.min(NUMBER_WORDS.length, Math.round(w.n)));
    const thing = WIZARD_PARTS.things[w.thing];
    out.push(NUMBER_WORDS[n - 1], n === 1 ? thing.one : thing.many);
  });
  return out;
}
