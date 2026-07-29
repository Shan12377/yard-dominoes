import type { TalkTrigger } from '@yard/engine';

/**
 * The duppy's recorded voice.
 *
 * Real Jamaican voice, recorded for this game — not text-to-speech, which
 * cannot do patois without landing somewhere between wrong and offensive.
 * That is the whole reason these are recordings.
 *
 * One voice means ONE seat speaks. Three duppies sharing a single recorded
 * voice would sound like one woman arguing with herself, so the others stay
 * quiet until there are more voices to give them. A second voice pack simply
 * adds another entry to `VOICES`.
 *
 * This is pre-recorded playback and has nothing to do with `voice.ts`, which
 * is the live WebRTC mesh between real players.
 */

interface Clip {
  file: string;
  /** Exactly what is said, so the caption on screen matches the audio — and
   *  so a player with the sound off reads the same words. */
  text: string;
}

const IVY: Partial<Record<TalkTrigger, Clip[]>> = {
  theyPass: [{ file: 'theypass-01', text: 'Mm hmm. So yuh nuh have none?' }],
  slam: [{ file: 'slam-01', text: 'Tek dat.' }],
  win: [{ file: 'win-01', text: 'Easy nuh, man.' }],
  winCount: [{ file: 'wincount-01', text: 'Count it.' }],
  sixLove: [{ file: 'sixlove-01', text: 'A six love dat!' }],
  sixLoveAgainst: [{ file: 'sixloveagainst-01', text: 'Awright, mi deserve dat.' }],
};

/** Seat number to voice pack. One recorded voice, so one seat. */
const VOICES: Record<number, Partial<Record<TalkTrigger, Clip[]>>> = { 1: IVY };

const MUTE_KEY = 'yard:mute-duppy';

/** Muting must be one tap and must stick between sessions. */
export function muted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function setMuted(next: boolean) {
  try { localStorage.setItem(MUTE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  if (next) stop();
}

/** True when this seat has a voice at all. */
export function hasVoice(seat: number): boolean {
  return seat in VOICES;
}

let playing: HTMLAudioElement | null = null;

function stop() {
  if (!playing) return;
  playing.pause();
  playing = null;
}

/**
 * The line this seat would say out loud, or null. Returned rather than played
 * so the caller can show the same words on screen whether or not the sound is
 * on — the text is the accessible version of the audio, not a substitute for
 * a missing one.
 */
export function lineFor(seat: number, trigger: TalkTrigger, roll: number): string | null {
  const clips = VOICES[seat]?.[trigger];
  if (!clips || clips.length === 0) return null;
  return clips[Math.min(clips.length - 1, Math.floor(roll * clips.length))].text;
}

/**
 * Play what this seat just said. Silent and harmless when the seat has no
 * voice, when sound is off, or when the browser refuses to play — a missing
 * clip must never interrupt a hand.
 */
export function speak(seat: number, trigger: TalkTrigger, roll: number) {
  if (muted()) return;
  const clips = VOICES[seat]?.[trigger];
  if (!clips || clips.length === 0) return;
  const clip = clips[Math.min(clips.length - 1, Math.floor(roll * clips.length))];

  // One voice at a time: a duppy interrupting itself sounds broken.
  stop();
  const audio = new Audio(`${import.meta.env.BASE_URL}voice/${clip.file}.m4a`);
  audio.volume = 0.9;
  playing = audio;
  // Autoplay is refused until the player has interacted with the page. They
  // got here by tapping a tile, so this normally resolves; when it does not,
  // the caption on screen still carries the line.
  void audio.play().catch(() => {});
  audio.onended = () => { if (playing === audio) playing = null; };
}
