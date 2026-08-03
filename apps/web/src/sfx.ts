/**
 * The table's own noise: bone on board, a shuffle, and the sound a six love
 * makes.
 *
 * These are real recordings of real dominoes, not synthesised clicks. That
 * matters more here than it looks — the slam is the whole physical pleasure of
 * this game, and a thin digital tick where a bone should land is the tell that
 * separates a domino app from a domino table.
 *
 * Own mute flag, separate from speak.ts's duppy-voice mute. They used to
 * share one flag on the theory that two toggles is how someone ends up
 * hunting for whichever one is still making noise — but online play never
 * triggers the duppy voice at all (speak.ts is offline-only), so an online
 * player had no in-context control over the knock/shuffle sfx whatsoever:
 * whatever this flag happened to be, inherited silently from whatever was
 * last toggled in offline play, was final. A real report: table sound gone,
 * no toggle in reach to check or fix it.
 */

const SFX_MUTE_KEY = 'yard:mute-sfx';

export function muted(): boolean {
  try { return localStorage.getItem(SFX_MUTE_KEY) === '1'; } catch { return false; }
}

export function setMuted(next: boolean) {
  try { localStorage.setItem(SFX_MUTE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  if (next) silence();
}

type Sound = 'knock' | 'shuffle' | 'sixLove';

const FILES: Record<Sound, string> = {
  knock: 'knock',
  shuffle: 'shuffle',
  sixLove: 'six-love',
};

/**
 * Levelled by ear against each other, not left at 1. The knock fires on every
 * single move and the six love fires once a set, so equal volumes would make
 * the common sound tiring and the rare one unremarkable.
 */
const VOLUME: Record<Sound, number> = {
  knock: 0.55,
  shuffle: 0.45,
  sixLove: 0.85,
};

/**
 * Built once and reused. `speak.ts` constructs a fresh `Audio` per line, which
 * is fine for a voice clip that follows a move — but a knock has to land WITH
 * the tile. Constructing and fetching on the click puts the sound a few
 * hundred milliseconds behind the animation, which does not read as latency;
 * it reads as a bug.
 */
let pool: Record<Sound, HTMLAudioElement> | null = null;

/**
 * Built on the first gesture rather than at import, so the front door does not
 * spend ~180 KB of a phone's data on sounds for a game that visitor may never
 * start. By the time a tile can be played, `unlock()` has long since run.
 */
function load(): Record<Sound, HTMLAudioElement> {
  if (pool) return pool;
  const made = {} as Record<Sound, HTMLAudioElement>;
  for (const name of Object.keys(FILES) as Sound[]) {
    const audio = new Audio(`${import.meta.env.BASE_URL}sfx/${FILES[name]}.m4a`);
    audio.preload = 'auto';
    audio.volume = VOLUME[name];
    made[name] = audio;
  }
  pool = made;
  return made;
}

let unlocked = false;

/**
 * Browsers refuse to play audio until the player has interacted with the page,
 * and iOS refuses hardest: an element that has never been played inside a
 * gesture stays silent forever, however many gestures happen later. So the
 * first touch plays every clip muted and immediately stops it — after which
 * the elements are considered "unlocked" and can be played from anywhere.
 *
 * This is the same failure `.claude/rules/voice.md` documents for the mic.
 * Getting it wrong is silent by definition: everything looks fine and no sound
 * ever comes out, on the one platform most of these players use.
 */
export function unlock() {
  if (unlocked) return;
  unlocked = true;
  const sounds = load();
  for (const audio of Object.values(sounds)) {
    const volume = audio.volume;
    audio.volume = 0;
    void audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = volume;
      })
      .catch(() => { audio.volume = volume; });
  }
}

/**
 * Play a sound, or don't — a missing file, a refused autoplay, or a muted
 * player must never interrupt a hand. Restarts rather than overlaps: two
 * knocks close together is one table, not two.
 */
export function play(name: Sound) {
  if (muted()) return;
  const audio = load()[name];
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    // Some browsers throw on currentTime before the media is seekable.
  }
}

/** Stop everything at once, for the mute toggle. */
export function silence() {
  if (!pool) return;
  for (const audio of Object.values(pool)) {
    audio.pause();
    audio.currentTime = 0;
  }
}
