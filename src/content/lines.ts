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
    "Hiya! I'm Pip. Let's go exploring!", "Hello! I'm Pip. Shall we play?",
    'Hello, friend! Pip is so happy to see you!',
    'Hiya! Ready for an adventure?',
    'Hello! What a lovely day for blocks!',
  ],
  letsFindWood: [
    "Let's find some wood. Look for a tree!", 'Trees have wood. Can you spot one?',
    'Wood comes from trees. Can you find one?',
    'Shall we get some wood? Find a tree!',
    "I can see trees. Let's get some wood!",
  ],
  collectedFirst: [
    'Well done! You got your first one!', 'Ooh, lovely! Your first block!',
    "Hooray! That's your very first one!",
    'Ooh, well done! You got one!',
    'Lovely! Your first block is in your bag!',
  ],
  collectedMore: [
    'Nice one! Keep going!', 'Super! You got another!', 'Hooray! Look at that!',
    'Wonderful! One more for your bag!',
    "Yippee! You're so good at this!",
    'Great job! Keep it up!',
  ],
  full: [
    'Your bag is full of those!', 'No more room for those. Try something else!',
    'Oh, your bag has lots of those!',
    "That's plenty of those! Try something new!",
    'Your bag is nice and full!',
  ],
  crafted: [
    'Brilliant! You made it!', 'Wow, look what you made!', 'Fantastic! Well done!',
    'Ta-da! Look at your new thing!',
    'Super! You made something new!',
    'Hooray! What a clever make!',
  ],
  placed: [
    'Lovely building!', 'Nice! That looks great!', 'Ooh, what are you making?',
    'Ooh, that looks so good!',
    'What a lovely spot for it!',
    'Great building! Keep going!',
  ],
  noPath: [
    "Hmm, I can't get there. Let's try another way!", "That's tricky! Let's go a different way.",
    "Oops, I can't reach that. Let's try again!",
    "Hmm, not that way. Let's find another!",
    "That's a bit tricky. Shall we go round?",
  ],
  idleHint: [
    'Tap a block to collect it!', 'What shall we build today?', 'Look, a tree! Shall we go?',
    'Tap a tree to get some wood!',
    'Shall we build something lovely?',
    'Can you tap a block for me?',
  ],
  craftNeedMore: [
    'We need a few more blocks first.', 'Almost! Collect a few more.',
    'Nearly there! Just a few more blocks.',
    'We need a little bit more first.',
    "Let's get a few more, then try!",
  ],
  breakTime: [
    "Let's have a stretch! Wiggle your arms!", 'Time for a wiggle! Jump up and down!',
    'Time for a little rest! Wiggle your toes!',
    "Let's stretch up high! Reach for the sky!",
    'Wiggle time! Shake your hands!',
  ],
  welcomeBack: [
    "You're back! I missed you!", 'Hiya! Yay, you came back!',
    "Hello again! I'm so happy you're here!",
    "Yay, you're back! Let's play!",
    'Welcome back! Pip missed you!',
  ],
  upYouCome: [
    'Up you come! There we go!', 'Whoops-a-daisy! Up you come!',
    'Hup! Up you come!',
    'There we go! Up you pop!',
    'Whoops! Let me help you up!',
  ],
};

/** Pick a variant for a key, never the same one twice in a row. */
export function pickLine(key: LineKey, last: string | undefined, rng: () => number = Math.random): string {
  const variants = LINES[key];
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
