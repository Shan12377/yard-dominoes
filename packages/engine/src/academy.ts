/**
 * The Academy curriculum, as data.
 *
 * Lessons carry stable ids because the Coach references them by id when it
 * explains a mistake. Changing an id breaks that link — add, don't renumber.
 *
 * The strategy here is a synthesis of the Latin partnership school and the
 * Caribbean blocking school. The American "Fives" school is deliberately
 * excluded: Jamaican dominoes scores nothing during play, so board-count
 * arithmetic teaches the wrong instincts.
 */

export type BeltId = 'yard-baby' | 'learner' | 'player' | 'yard-champion' | 'table-general';

export type DrillKind =
  | 'match-tile'      // Belt 1: drag the tile that matches
  | 'legal-move'      // pick any legal move
  | 'choose-pose'     // given a hand, pick the opening tile
  | 'read-the-pass'   // name the suits a passer is void in
  | 'count-the-block' // work out who wins a jammed board
  | 'feed-check'      // pick the play that gives away least
  | 'partner-read'    // what is your partner telling you
  | 'score-the-set';  // six-love bookkeeping

export interface Lesson {
  id: string;
  title: string;
  body: string;
  /** Patois or table terms this lesson introduces. */
  terms?: string[];
}

export interface Drill {
  id: string;
  kind: DrillKind;
  prompt: string;
  /** Passing score out of 10. */
  pass: number;
}

export interface Belt {
  id: BeltId;
  index: number;
  title: string;
  subtitle: string;
  /** Reading level target. Belt 1 is voiced and near-wordless by design. */
  voiced: boolean;
  lessons: Lesson[];
  drills: Drill[];
  examPass: number;
}

export const BELTS: Belt[] = [
  {
    id: 'yard-baby',
    index: 1,
    title: 'Yard Baby',
    subtitle: 'Never touched a tile before',
    voiced: true,
    lessons: [
      { id: 'B1L1', title: 'What a tile is', body: 'Every tile has two halves. Each half has spots. Count them.' },
      { id: 'B1L2', title: 'Matching', body: 'Put your tile next to one with the same number. Four goes on four.' },
      { id: 'B1L3', title: 'The line', body: 'The tiles make one long line. You can add to either end.' },
      { id: 'B1L4', title: 'Your hand', body: 'The tiles in front of you are yours. Nobody else can see them.' },
      { id: 'B1L5', title: 'Playing out', body: 'Get rid of all your tiles before anybody else. That is how you win.' },
    ],
    drills: [
      { id: 'B1D1', kind: 'match-tile', prompt: 'Which tile fits here?', pass: 8 },
      { id: 'B1D2', kind: 'legal-move', prompt: 'Play any tile you can', pass: 8 },
    ],
    examPass: 8,
  },
  {
    id: 'learner',
    index: 2,
    title: 'Learner',
    subtitle: 'Sit at a table without embarrassing yourself',
    voiced: true,
    lessons: [
      {
        id: 'B2L1', title: 'The full twenty-eight',
        body: 'A set is 28 tiles, and every suit appears on exactly seven of them. Seven blanks, seven ones, all the way up. Remember that number. Everything you learn later is built on it.',
      },
      {
        id: 'B2L2', title: 'The pose',
        body: 'The first hand of a set is opened by whoever holds the double six, and he lays it. Opening is called posing. Some yards let a friendly game go sporting, where the poser says so and opens with another bone instead — here a set always starts on the six. After that first hand the winner poses, and he can lead whatever he likes.',
        terms: ['pose', 'sporting'],
      },
      {
        id: 'B2L3', title: 'Which way round',
        body: 'Play runs anti-clockwise. The next person to play is the one on your right. Your partner sits opposite you, so you never play one after the other.',
      },
      {
        id: 'B2L4', title: 'When you cannot go',
        body: 'If neither end matches anything in your hand, you pass. You are not out. You just wait.',
      },
      {
        id: 'B2L5', title: 'Blocked boards and counting',
        body: 'If everybody passes in a row the board is blocked. Now you count the spots left in your hand. Low count wins.',
        terms: ['count'],
      },
      {
        id: 'B2L6', title: 'The rule that surprises people',
        body: 'On a blocked board it is the LOWEST SINGLE HAND that wins, and in partners that player\'s team takes it regardless of what the partner holds. A team can win while holding more spots overall. Learn this one properly; plenty of people play their whole lives getting it wrong.',
      },
      {
        id: 'B2L7', title: 'Six love',
        body: 'Winning six hands in a row while they stay on nothing is six love. If they win one, your score bruks. Back to nothing, start again. Being on nothing is being under love.',
        terms: ['six love', 'bruk', 'under love'],
      },
      {
        id: 'B2L8', title: 'One all, play two',
        body: 'Many yards play that when it reaches one all you do not start over. You play one more hand and the winner jumps straight to two.',
      },
      {
        id: 'B2L9', title: 'Cut throat and partner',
        body: 'In partner you play with the person opposite. In cut throat it is every man for himself: every tub on its own bottom.',
      },
    ],
    drills: [
      { id: 'B2D1', kind: 'count-the-block', prompt: 'Board is jammed. Who takes it?', pass: 8 },
      { id: 'B2D2', kind: 'score-the-set', prompt: 'What is the score after this hand?', pass: 8 },
    ],
    examPass: 8,
  },
  {
    id: 'player',
    index: 3,
    title: 'Player',
    subtitle: 'Fundamentals. Most players live here',
    voiced: false,
    lessons: [
      {
        id: 'B3L1', title: 'Read your hand first',
        body: 'Before you touch a tile, look at what you actually have. How many of each suit? Where are you long, with three or more? Where are you void? How many doubles? Every skill after this depends on the habit.',
      },
      {
        id: 'B3L2', title: 'The pose that does three jobs',
        body: 'Open your strongest suit, and open it with the double if you hold it. It gives you a way back into the board, it denies that suit to everyone else, and it quietly tells your partner where you live. One tile, three jobs.',
      },
      {
        id: 'B3L3', title: 'Suit control',
        body: 'Work to keep the ends showing suits you are long in. The board should keep coming back to you. Give up control and you spend the rest of the hand reacting.',
      },
      {
        id: 'B3L4', title: 'Do not feed the table',
        body: 'Before you play, ask what you are opening up for the person on your right. The best tile for your hand is sometimes the worst tile for your position.',
      },
      {
        id: 'B3L5', title: 'Shedding weight',
        body: 'Heavy tiles are a liability. If the board jams, that is what beats you. Move them early unless they are doing real work.',
      },
      {
        id: 'B3L6', title: 'Doubles',
        body: 'A double leaves the same suit showing, so it does not move the board on. Holding one means one fewer live tile for everybody else. Play it when it buys you something, not just because you can.',
      },
    ],
    drills: [
      { id: 'B3D1', kind: 'choose-pose', prompt: 'Here is your hand. What do you pose?', pass: 7 },
      { id: 'B3D2', kind: 'feed-check', prompt: 'Which play gives away least?', pass: 7 },
    ],
    examPass: 7,
  },
  {
    id: 'yard-champion',
    index: 4,
    title: 'Yard Champion',
    subtitle: 'Tracking and partnership',
    voiced: false,
    lessons: [
      {
        id: 'B4L1', title: 'A pass is permanent',
        body: 'When somebody passes, he has just told you he holds nothing in either suit showing. That never stops being true for the rest of the hand. Most players notice a pass and forget it two turns later. Champions never do. This single habit is worth more than everything in Belt 3 combined.',
      },
      {
        id: 'B4L2', title: 'Counting a suit out',
        body: 'Seven tiles carry each suit. Count what has shown. When six fives are down and you hold the seventh, that suit belongs to you. Leaving it open is safe for you and death for everybody else.',
      },
      {
        id: 'B4L3', title: 'The void map',
        body: 'Track all three opponents at once. It sounds like a lot; it is really just three short lists that only ever grow.',
      },
      {
        id: 'B4L4', title: 'Talking without talking',
        body: 'Your first tile names your suit. If your partner passes on a suit, stop feeding it immediately and for good. If he plays a suit twice, he is long there; open it for him. When you cannot go out yourself, play to put him out.',
      },
      {
        id: 'B4L5', title: 'Jamming the board',
        body: 'When going out looks unlikely, stop trying. Close the board on purpose: play the suits they are void in, force the passes, and win it on count.',
      },
      {
        id: 'B4L6', title: 'The endgame switch',
        body: 'Around three tiles left, change what you are optimising. Stop racing to go out and start protecting your count, because if it jams it is your own hand that decides it, not your partner\'s.',
      },
      {
        id: 'B4L7', title: 'Hard ends, dead doubles, and the key',
        body: 'Lesson 2 showed you how to count a suit out. Three named reads follow straight from that count, and real tables call all three by name. A HARD END is an open end where only one tile of that suit is still unaccounted for anywhere. Whoever holds it is the only player left who can ever answer there. A DEAD DOUBLE is a double sitting in your own hand that the board can no longer reach at all: every other tile of its suit is already gone, and it never comes home. Hold the last tile of two different suits at the same time and you have a KEY, a position nobody at the table can break because you decide where the board goes in both suits at once. Learn to spot all three on sight and the Coach will start naming them in your own hands.',
        terms: ['hard end', 'dead double', 'key'],
      },
    ],
    drills: [
      { id: 'B4D1', kind: 'read-the-pass', prompt: 'He just passed. What do you know?', pass: 8 },
      { id: 'B4D2', kind: 'partner-read', prompt: 'What is your partner telling you?', pass: 7 },
      { id: 'B4D3', kind: 'count-the-block', prompt: 'Can you win this on count?', pass: 7 },
    ],
    examPass: 8,
  },
  {
    id: 'table-general',
    index: 5,
    title: 'Table General',
    subtitle: 'Tournament craft',
    voiced: false,
    lessons: [
      {
        id: 'B5L1', title: 'Reasoning about what is left',
        body: 'You know your seven. You can see what is down. You know who passed on what. That is enough to narrow what each player can be holding. You are not memorising, just ruling things out.',
      },
      {
        id: 'B5L2', title: 'The six love meta',
        body: 'The scoreline changes the correct play, and almost nobody thinks about it. Five nil up, take the safe block and close it out. Do not gamble for style. Nil five down, play for the jam, because any hand you win bruks them straight back to nothing. If one all play two is on, that hand is worth double: play it like a final.',
      },
      {
        id: 'B5L3', title: 'Lying with your tiles',
        body: 'Once your signalling is automatic you can send a false one. Not before. You cannot lie in a language you do not speak.',
      },
      {
        id: 'B5L4', title: 'Reading the player',
        body: 'Aggressive players dump heavy tiles early. Careful ones sit on them. You can usually tell inside two hands. Play the person, not just the board.',
      },
      {
        id: 'B5L5', title: 'Tempo and tilt',
        body: 'Play at the same speed whether your hand is beautiful or hopeless. Hesitation is information you are giving away free. And have a plan for the hand after a bad one.',
      },
      {
        id: 'B5L6', title: 'Tournament rules',
        body: 'No sporting. The six six must be led. Know the etiquette before you sit down for something that matters.',
      },
    ],
    drills: [
      { id: 'B5D1', kind: 'feed-check', prompt: 'Five nil up. What is the safe play?', pass: 8 },
      { id: 'B5D2', kind: 'read-the-pass', prompt: 'Narrow their hand', pass: 8 },
    ],
    examPass: 8,
  },
];

export function belt(id: BeltId): Belt {
  const found = BELTS.find((b) => b.id === id);
  if (!found) throw new Error(`unknown belt: ${id}`);
  return found;
}

/** Resolve a Coach reference like "Belt 4 · Lesson 1" to the lesson itself. */
export function lessonByRef(ref: string): Lesson | null {
  const m = ref.match(/Belt\s*(\d+).*?Lesson\s*(\d+)/i);
  if (!m) return null;
  const b = BELTS.find((x) => x.index === Number(m[1]));
  return b?.lessons[Number(m[2]) - 1] ?? null;
}

export function lessonById(id: string): Lesson | null {
  for (const b of BELTS) {
    const l = b.lessons.find((x) => x.id === id);
    if (l) return l;
  }
  return null;
}
