export type LineKey =
  | 'hello'
  | 'letsFindWood'
  | 'collectedFirst'
  | 'collectedMore'
  | 'full'
  | 'crafted'
  | 'placed'
  | 'noPath'
  | 'idleHint'
  | 'craftNeedMore'
  | 'breakTime'
  | 'welcomeBack'
  | 'upYouCome';

/** Lines spoken by Pip. British English, short and warm. */
export const LINES: Record<LineKey, string[]> = {
  hello: [
    "Hiya! I'm Pip. Let's go exploring!",
    "Hello! I'm Pip. Shall we play?",
    'Hiya! Ready for an adventure?',
    'Hello! What a lovely day for blocks!',
  ],
  letsFindWood: [
    "Let's find some wood. Press and hold a tree!",
    'Trees have wood. Shall we look for one?',
    "Shall we get some wood? Let's find a tree!",
    'Hold your finger on a tree to get wood!',
  ],
  collectedFirst: [
    'Well done! You collected a block!',
    'Lovely! You got one!',
    'Smashing! You found a lovely block!',
    "Super! That one's in your bag!",
  ],
  collectedMore: [
    'Nice one! Keep going!',
    'Super! You got another!',
    'Goodness! Look at that!',
    'Wonderful! One more for your bag!',
  ],
  full: [
    "That's plenty of those! Let's use some.",
    "Let's use some of those to make room!",
    "Wow, lots of those! Let's build with them.",
    "Lots of those! Let's make something with them.",
  ],
  crafted: [
    'Brilliant! You made it!',
    'Wow, look what you made!',
    'Fantastic! Well done!',
    'Look at your new thing!',
  ],
  placed: [
    'Lovely building!',
    'What are you making?',
    'What a lovely spot for it!',
    'Great building! Keep going!',
  ],
  noPath: [
    "I can't get there. Let's try another way!",
    "That's tricky! Let's go a different way.",
    "Oops, I can't reach that. Let's try again!",
    "That's a bit tricky. Shall we go round?",
  ],
  idleHint: [
    'Press and hold a block to dig it!',
    'What shall we build today?',
    'Shall we look for a tree?',
    'Hold your finger on a block to dig it!',
  ],
  craftNeedMore: [
    'We need a few more blocks first.',
    "Let's collect the blocks we need!",
    'We need a little bit more first.',
    "Let's get some more blocks, then try!",
  ],
  breakTime: [
    "Let's have a stretch! Wiggle your arms!",
    'Time for a wiggle! Jump up and down!',
    'Time for a little rest! Wiggle your toes!',
    "Let's stretch up high! Reach for the sky!",
  ],
  welcomeBack: [
    "You're back! I missed you!",
    'Hiya! You came back!',
    "Hello again! I'm so happy you're here!",
    'Welcome back! Pip missed you!',
  ],
  upYouCome: [
    'Up you come! There we go!',
    'Whoops-a-daisy! Up you come!',
    'Up you come!',
    'Whoops! Let me help you up!',
  ],
};

/** Pick a variant for a key, never the same one twice in a row. */
export function pickLine(key: LineKey, last: string | undefined, rng: () => number = Math.random): string {
  const variants = LINES[key];
  if (variants.length === 0) return '';
  const pool = variants.length > 1 ? variants.filter(v => v !== last) : variants;
  const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[i];
}

/** One picture per line, shown in the speech bubble so no reading is needed. */
export const LINE_ICONS: Record<LineKey, string> = {
  hello: '👋',
  letsFindWood: '🌳',
  collectedFirst: '⭐',
  collectedMore: '🎉',
  full: '🎒',
  crafted: '🛠️',
  placed: '🧱',
  noPath: '🤔',
  idleHint: '👀',
  craftNeedMore: '➕',
  breakTime: '🤸',
  welcomeBack: '🥰',
  upYouCome: '⬆️',
};
