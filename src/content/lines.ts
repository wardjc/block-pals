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
  | 'upYouCome'
  | 'letsMeetNeighbours'
  | 'comeOn'
  | 'thisWay'
  | 'weAreHere'
  | 'cosyHome'
  // Farm and eating (Village step 2). Plain words only: excitement comes from sounds and animation.
  | 'plantSome'
  | 'needWaterSun'
  | 'cropReady'
  | 'harvested'
  | 'tryMunch'
  | 'ateApple'
  | 'ateCarrot'
  | 'atePotato'
  | 'drankMilk'
  | 'holdOutFood'
  | 'fedAnimal'
  | 'animalFull'
  | 'petAnimal'
  | 'gotEgg'
  | 'gotMilk'
  | 'gotWool';

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
  // Pip leading him to the village (first time only). Each is true wherever it can fire.
  letsMeetNeighbours: [
    "Let's go and meet the neighbours!",
    'Shall we go and meet our neighbours?',
    "Let's visit the neighbours. Follow me!",
    'There are neighbours to meet. Come with me!',
  ],
  comeOn: [
    "I'll wait for you. Come along!",
    'Come along, no rush!',
    "I'm waiting right here for you!",
    'Come along. Slowly does it!',
  ],
  thisWay: [
    'This way, follow me!',
    'Follow me along the path!',
    'The path goes this way!',
    "I'll show you the way!",
  ],
  weAreHere: [
    'Here we are! This is the village!',
    "We're in the village! Let's say hello!",
    'This is the village. Lots of neighbours live here!',
    'Here we are, at the village!',
  ],
  cosyHome: [
    'This is your very own cottage!',
    'What a cosy little home!',
    'Your own cottage. How lovely!',
    'Home sweet home!',
  ],
  // Farm and eating. Each is true wherever and however often it can fire; none claims what he can see.
  plantSome: [
    'Seeds grow into plants. Shall we plant some?',
    'Shall we plant our seeds?',
    'Seeds like soil. Shall we plant some?',
    'Plants start as seeds. Shall we grow some?',
  ],
  needWaterSun: [
    'Plants need water and sunshine. Give it a little help!',
    'A little water and sunshine helps plants grow.',
    'Plants grow with water and sunshine.',
    'Give your plant some help to grow!',
  ],
  cropReady: [
    "It's ready! Press and hold to pick it.",
    'A plant is ready. Press and hold to pick it!',
    'Ready to pick! Press and hold it.',
    'Press and hold a ripe plant to pick it.',
  ],
  harvested: [
    'You picked it! Well done!',
    "Lovely picking! That's in your bag.",
    'Nicely picked! Now you can plant again.',
    "You're a very good farmer!",
  ],
  tryMunch: [
    'Shall we have a little snack?',
    'Press the big mouth to eat it.',
    'Hungry? The big mouth is for eating.',
    'Want a snack? Press the mouth.',
  ],
  ateApple: [
    'What a crunchy apple!',
    'A sweet, juicy apple!',
    'Apples grow on trees.',
    'A lovely red apple!',
  ],
  ateCarrot: [
    'What a crunchy carrot!',
    'Carrots are good for you.',
    'A lovely orange carrot!',
    'Carrots grow under the ground.',
  ],
  atePotato: [
    'A crunchy little potato!',
    'Potatoes grow under the ground.',
    'A raw potato. How crunchy!',
    'What a funny little potato!',
  ],
  drankMilk: [
    'Fresh milk, straight from the cow!',
    'A lovely drink of milk!',
    'Milk is good for you.',
    'Milk from the cow. How lovely!',
  ],
  holdOutFood: [
    'Pick some food and go near the animals.',
    'Choose a food, then visit the animals.',
    'Animals like food. Pick some and visit them.',
    'Pick a food and walk over to the animals.',
  ],
  fedAnimal: [
    'What a happy animal!',
    'They loved that!',
    'That made someone happy!',
    'A very happy animal!',
  ],
  animalFull: [
    "They've had enough for now.",
    "Let's give them a little rest.",
    "They'd like a rest now.",
    'A little rest first, then more.',
  ],
  petAnimal: [
    'Such a gentle animal!',
    'What a gentle pat!',
    'A nice cuddle!',
    'A friendly animal!',
  ],
  gotEgg: [
    'You got an egg!',
    'A fresh egg for your bag!',
    'Eggs come from chickens.',
    'A lovely fresh egg!',
  ],
  gotMilk: [
    'You got some milk!',
    'Fresh milk for your bag!',
    'Cows give us milk.',
    'Thank you, cow!',
  ],
  gotWool: [
    'You got some wool!',
    'Soft wool for your bag!',
    'Sheep give us wool.',
    'Wool can be made into coloured blocks.',
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
  letsMeetNeighbours: '🏘️',
  comeOn: '👋',
  thisWay: '➡️',
  weAreHere: '🎉',
  cosyHome: '🏠',
  plantSome: '🌱',
  needWaterSun: '🌦️',
  cropReady: '🧺',
  harvested: '🥕',
  tryMunch: '👄',
  ateApple: '🍎',
  ateCarrot: '🥕',
  atePotato: '🥔',
  drankMilk: '🥛',
  holdOutFood: '🐔',
  fedAnimal: '💛',
  animalFull: '😴',
  petAnimal: '🐑',
  gotEgg: '🥚',
  gotMilk: '🥛',
  gotWool: '🧶',
};
