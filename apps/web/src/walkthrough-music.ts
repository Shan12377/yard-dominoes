/**
 * The guided-tour backing track. It is loaded only after the player presses
 * the music control, so the landing page and players who prefer silence pay
 * no network or decoding cost.
 */
export const WALKTHROUGH_MUSIC_URL = '/audio/tour-riddim.m4a';
export const WALKTHROUGH_MUSIC_VOLUME = 0.16;
export const WALKTHROUGH_MUSIC_REPEATS = true;

let track: HTMLAudioElement | null = null;

export function playWalkthroughMusic(): boolean {
  stopWalkthroughMusic();

  try {
    const audio = new Audio(WALKTHROUGH_MUSIC_URL);
    audio.loop = WALKTHROUGH_MUSIC_REPEATS;
    audio.preload = 'auto';
    audio.volume = WALKTHROUGH_MUSIC_VOLUME;
    track = audio;
    void audio.play().catch(() => {
      if (track === audio) track = null;
    });
    return true;
  } catch {
    track = null;
    return false;
  }
}

export function stopWalkthroughMusic(): void {
  const active = track;
  track = null;
  if (!active) return;
  active.pause();
  active.currentTime = 0;
}
