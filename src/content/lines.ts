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
  | 'gotWool'
  // The wizard's tower. Each is true wherever it can fire (letsVisitWizard is only offered with a gem).
  | 'seeTowerLight'
  | 'letsVisitWizard'
  | 'meetWizard'
  | 'puzzleStuck'
  | 'gotMagicBlock'
  // The caves (7h). Bright and calm; each is true wherever it can fire.
  /** The second idle hint, once, after the village walk and before he has ever been deep. */
  | 'digDown'
  /** The first time he stands in a real cave (not merely his own pit). */
  | 'cavesLit'
  /** His first gem dug out of a wall. */
  | 'gemFound'
  /** Pip offers to lead him up, and does (along the way home). */
  | 'goUp'
  /** Back on the surface after the Home lift, or after walking up behind Pip. */
  | 'backUp'
  /** A treasure chest has just opened. */
  | 'treasureFound'
  /** The first time he stands in the Old Hideout. */
  | 'oldBase'
  // The grumps (sulky little visitors on the farm) and the friendly weapons. Plain words only; each
  // is true whenever it can fire. Pip never calls a grump bad: it is "sulky", "cheered up" or "a friend".
  | 'grumpArrives'
  | 'plantsWaiting'
  | 'craftWeapon'
  | 'pickWeapon'
  | 'cheerHalf'
  | 'cheeredUp'
  | 'grumpGift'
  | 'friendMade'
  | 'friendHelps';

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
  seeTowerLight: [
    'What is that glowing light far away?',
    'A light is shining far away.',
    'Something is glowing over there.',
    'Someone has a light on a hill.',
  ],
  letsVisitWizard: [
    "Let's go and visit the wizard in his tower.",
    'You have a gem. The wizard likes gems.',
    'Shall we visit the wizard? Follow me.',
    'There is a wizard in the tower. Follow me.',
  ],
  meetWizard: [
    "Here we are at the wizard's tower.",
    "This is the wizard's tower. Let's go in.",
    'Look how tall it is. Shall we go in?',
    "We are at the tower. Let's say hello.",
  ],
  // Hint 2 of every puzzle kind, so never about counting or dots.
  puzzleStuck: [
    'Shall we look at it together?',
    "Let's look at each picture slowly.",
    'Take your time. I will help.',
    'Look closely. What do you notice?',
  ],
  gotMagicBlock: [
    'A magic block! Where will you put it?',
    "That looks lovely. Let's build something.",
    'What a shiny new block!',
    'Your bag has a new magic block.',
  ],
  digDown: [
    "Let's dig down and find caves.",
    "I wonder what is under the ground. Let's dig!",
    'Shall we dig down and look for a cave?',
    'There might be sparkly caves down below.',
  ],
  cavesLit: [
    'What a bright, sparkly cave!',
    'So many things glow here. How pretty!',
    'Look at all the glowing things!',
    'This cave is full of shiny things.',
  ],
  gemFound: [
    'You found a gem! It is so shiny.',
    'A shiny gem for your bag.',
    'Look at that gem sparkle!',
    'A gem! Well spotted.',
  ],
  goUp: [
    'Shall we go back up to the sunshine?',
    'Follow me. I know the way up.',
    'The way home is this way.',
    "Let's walk up to the daylight.",
  ],
  backUp: [
    'Here we are, back in the sunshine.',
    'Up we come! It is lovely up here.',
    'Back in the daylight. That was a good trip.',
    'Back up top again. What a lovely trip!',
  ],
  treasureFound: [
    'You opened a treasure chest!',
    'A treasure chest, full of nice things!',
    'Look what was in the chest.',
    'Treasure for your bag!',
  ],
  oldBase: [
    'What a lovely old hideout!',
    'Somebody lived here once. We could fix it up.',
    "An old base! Let's tidy it up.",
    'Such a cosy old hideout. We can build here.',
  ],
  grumpArrives: [
    'Look, someone small and sulky has wobbled onto the farm.',
    'A sulky little visitor is on the farm.',
    'Someone grumpy has come to sit by the plants.',
    "There's a sulky one by the plants.",
  ],
  plantsWaiting: [
    "The plants are waiting. They grow again when it's happy.",
    'Plants wait while someone is sulking nearby.',
    'The little plants are resting until it cheers up.',
    'Our plants will grow again when it smiles.',
  ],
  craftWeapon: [
    'We could make a bubble blaster, a wand or a squirter.',
    "Something friendly might cheer it up. Let's make one.",
    'Try the crafting screen. A friendly helper is in there.',
    'Shall we make something friendly to cheer it up?',
  ],
  pickWeapon: [
    'Choose your friendly helper from the bar.',
    'Pick your friendly helper, then point it at the sulky one.',
    'Your friendly helper is ready. Pick it from the bar.',
    'Choose a helper from the bar to cheer it up.',
  ],
  cheerHalf: [
    "It's feeling a bit better.",
    "Look, it's less sulky now.",
    "One more and it'll be smiling.",
    "It's starting to cheer up.",
  ],
  cheeredUp: [
    "It's cheered up! Look at all the confetti!",
    "It's all smiles now!",
    'No more sulking. Look at that confetti!',
    "It's happy again!",
  ],
  grumpGift: [
    'It left you something nice.',
    'Look what it left in your bag.',
    'A little thank you for you.',
    "You've got a present.",
  ],
  friendMade: [
    "A new friend for the farm! It's staying.",
    'It wants to stay and be your friend.',
    "You've made a friend. It lives here now.",
    'Your farm has a new friend.',
  ],
  friendHelps: [
    'Your little friend is helping the plants.',
    'A friend is helping one of the plants.',
    'A friend is giving a plant a hand.',
    'Your friend helped a plant grow.',
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
  seeTowerLight: '✨',
  letsVisitWizard: '🧙',
  meetWizard: '🧙',
  puzzleStuck: '🧩',
  gotMagicBlock: '✨',
  digDown: '🕳️',
  cavesLit: '💎',
  gemFound: '💎',
  goUp: '🏠',
  backUp: '🌞',
  treasureFound: '🎁',
  oldBase: '🧱',
  grumpArrives: '☁️',
  plantsWaiting: '🌱',
  craftWeapon: '🫧',
  pickWeapon: '🪄',
  cheerHalf: '🙂',
  cheeredUp: '🎊',
  grumpGift: '🎁',
  friendMade: '💛',
  friendHelps: '💦',
};
