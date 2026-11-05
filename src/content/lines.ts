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
  | 'welcomeBack';

/** Lines spoken by Pip. British English, short and warm. */
export const LINES: Record<LineKey, string[]> = {
  hello: ["Hiya! I'm Pip. Let's go exploring!", "Hello! I'm Pip. Shall we play?"],
  letsFindWood: ["Let's find some wood. Look for a tree!", 'Trees have wood. Can you spot one?'],
  collectedFirst: ['Well done! You got your first one!', 'Ooh, lovely! Your first block!'],
  collectedMore: ['Nice one! Keep going!', 'Super! You got another!', 'Hooray! Look at that!'],
  full: ['Your bag is full of those!', 'No more room for those. Try something else!'],
  crafted: ['Brilliant! You made it!', 'Wow, look what you made!', 'Fantastic! Well done!'],
  placed: ['Lovely building!', 'Nice! That looks great!', 'Ooh, what are you making?'],
  noPath: ["Hmm, I can't get there. Let's try another way!", "That's tricky! Let's go a different way."],
  idleHint: ['Tap a block to collect it!', 'What shall we build today?', 'Look, a tree! Shall we go?'],
  craftNeedMore: ['We need a few more blocks first.', 'Almost! Collect a few more.'],
  breakTime: ["Let's have a stretch! Wiggle your arms!", 'Time for a wiggle! Jump up and down!'],
  welcomeBack: ["You're back! I missed you!", 'Hiya! Yay, you came back!'],
};

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
};
