import type { DuppyLevel } from './bots.ts';

/**
 * Table talk.
 *
 * A yard is loud. A domino game played in silence is not the game, and the
 * incumbent's tables are silent. These are the lines the duppies say, in
 * patois, triggered by things that actually happened at the table.
 *
 * The talk is tied to the duppy's LEVEL, not sprinkled at random, so how an
 * opponent speaks tells you what you are up against before it beats you. A
 * pickney chatters and gives itself away. A don barely speaks. By the time
 * you can hear the difference you have learned something real about the game.
 *
 * Text only, and deliberately so: it works with the sound off, on every
 * device, in every seat, and it needs no recording. Recorded voices are a
 * separate layer that plays alongside these — see docs/duppy-voice-script.md.
 */

export type TalkTrigger =
  /** Opened the hand. */
  | 'pose'
  /** Laid a double crosswise. */
  | 'slam'
  /** The human passed — the duppy noticed what that gave away. */
  | 'theyPass'
  /** The duppy itself could not play. */
  | 'iPass'
  /** Down to one tile. */
  | 'lastTile'
  /** Played out. */
  | 'win'
  /** Took a blocked hand on count. */
  | 'winCount'
  /** Lost the hand. */
  | 'lose'
  /** Its side took six love. */
  | 'sixLove'
  /** Its side conceded six love. */
  | 'sixLoveAgainst'
  /** A score was bruk back to nothing. */
  | 'bruk'
  /**
   * Nobody has played for a while and the duppy has noticed. Unlike every
   * other trigger here this one fires from the absence of a move rather than
   * from a move, so it needs a timer at the callsite, not a game event.
   */
  | 'waiting';

type Lines = Partial<Record<TalkTrigger, string[]>>;

/**
 * Everything a duppy might say, whatever its level. Levels below override the
 * lines that carry personality and inherit the rest, so adding a trigger here
 * gives every duppy something to say without writing it out five times.
 */
const BASE: Lines = {
  pose: ['Mi a start.', 'Come we go.', 'Sit down, den.'],
  slam: ['Boom!', 'Tek dat.', 'Right deh so.'],
  theyPass: ['Mm hmm.', 'Mi see yuh.', 'Noted.'],
  iPass: ['Cho.', 'Mi cyaan play.', 'Mm.'],
  lastTile: ['One left.', 'Mi nearly done.'],
  win: ['Dat done.', 'Game.', 'Easy.'],
  winCount: ['Count it.', 'Lickle bit less.'],
  lose: ['Yuh get me dat time.', 'Awright, awright.', 'Nice play.'],
  sixLove: ['SIX LOVE!', 'Six love, man!'],
  sixLoveAgainst: ['Lawd.', 'Alright. Mi deserve dat.'],
  bruk: ['All a dat gone.', 'Back to zero.'],
  waiting: ['Why yuh nuh play?', 'Play nuh, man.', 'Yuh a sleep?'],
};

/**
 * Per level, only where the personality actually differs. A pickney talks too
 * much and tells you what it holds; a don says almost nothing and means it.
 */
const BY_LEVEL: Record<DuppyLevel, Lines> = {
  pickney: {
    pose: ['Mi first! Mi first!', 'Mi a go start!'],
    slam: ['Yesss!', 'Boom! Yuh see dat?', 'Mi have nuff a dem!'],
    theyPass: ['Yuh cyaan play? Hehe.', 'Yuh stick!'],
    iPass: ['Aww.', 'Mi nuh have none.', 'Dat nuh fair.'],
    lastTile: ['One more! One more!', 'Mi a go win!'],
    win: ['Mi win! Mi win!', 'Yes man!'],
    waiting: ['Play nuh! Mi a wait!', 'Yuh a sleep?', 'Hurry up nuh man!'],
    lose: ['Aww, man.', 'Nex time.', 'Mi did close!'],
  },
  yard: {
    pose: ['Come we go.', 'Mek we play.'],
    theyPass: ['Mm hmm.', 'So yuh nuh have none.'],
    win: ['Dat done.', 'Easy nuh.'],
    lose: ['Yuh play good.', 'Awright, run it back.'],
    waiting: ['Why yuh nuh play?', 'Play nuh, man.'],
  },
  ranker: {
    slam: ['Mi did a wait pon dat.', 'Tek dat.'],
    theyPass: ['Aight. Mi see yuh.', 'So yuh nuh have none a dat.', 'Noted.'],
    iPass: ['Mm.', 'Cho.'],
    lastTile: ['Watch mi now.', 'One left.'],
    win: ['Tell dem.', 'Dat done.'],
    winCount: ['Mi did a count.', 'Count it.'],
    waiting: ['Time a run.', 'Duppy, stop hold di game.'],
  },
  don: {
    pose: ['Sit down.'],
    slam: ['Not today.', 'Mm.'],
    theyPass: ['Mm.', 'Good.'],
    iPass: ['...'],
    lastTile: ['One.'],
    win: ['Done.', 'Yuh see it?'],
    winCount: ['Count it.'],
    lose: ['Mm. Again.'],
    sixLove: ['Six love.'],
    // The don nags in one syllable, and TALK_CHANCE means it almost never
    // gets to. A silent opponent that suddenly speaks is the point of it.
    waiting: ['Mm.'],
  },
  general: {
    pose: ['Mek we see what yuh have.'],
    slam: ['Dat was di one.', 'Right deh so.'],
    theyPass: ['Mi did know dat already.', 'Dat tell mi everyting.'],
    iPass: ['Mm. Interesting.'],
    lastTile: ['One left. Yuh cyaan stop it now.'],
    win: ['Dat was over from long time.', 'Game.'],
    winCount: ['Mi count dat six move back.'],
    lose: ['Well played. Truly.', 'Yuh read mi. Respect.'],
    waiting: ['Tek yuh time. Nuh rush.'],
  },
};

/**
 * A line for this duppy, or null when it has nothing to say — silence is a
 * valid and frequent answer. `roll` is any number in [0, 1); callers pass
 * their own randomness so this stays pure and testable.
 *
 * `chance` is how often a duppy speaks at all. Constant chatter stops being
 * atmosphere and becomes noise within about three hands.
 */
export function duppyLine(
  level: DuppyLevel,
  trigger: TalkTrigger,
  roll: number,
  chance = 1,
): string | null {
  const lines = BY_LEVEL[level][trigger] ?? BASE[trigger];
  if (!lines || lines.length === 0) return null;
  if (chance < 1 && roll >= chance) return null;
  // Reuse the same roll for the pick, rescaled, so one number does both jobs.
  const scaled = chance < 1 ? roll / chance : roll;
  return lines[Math.min(lines.length - 1, Math.floor(scaled * lines.length))];
}

/** How talkative each level is, for triggers that fire many times a hand. */
export const TALK_CHANCE: Record<DuppyLevel, number> = {
  pickney: 0.9,
  yard: 0.5,
  ranker: 0.45,
  don: 0.2,
  general: 0.35,
};
