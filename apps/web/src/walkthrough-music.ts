/** A brief original reggae-style sting for the guided tour. No media download. */
export const WALKTHROUGH_MUSIC_SECONDS = 7;
export const WALKTHROUGH_SKANK_BEATS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5] as const;

let context: AudioContext | null = null;
let finishTimer = 0;

function tone(
  ctx: AudioContext,
  output: AudioNode,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType,
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(output);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/**
 * Starts on a user gesture. The offbeat chord chops and walking bass make the
 * rhythm legible at low volume without competing with the tour captions.
 */
export function playWalkthroughMusic(onFinished?: () => void): boolean {
  stopWalkthroughMusic();
  const AudioContextClass = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return false;

  try {
    const ctx = new AudioContextClass();
    context = ctx;
    void ctx.resume();

    const master = ctx.createGain();
    const start = ctx.currentTime + 0.035;
    const beat = 60 / 78;
    const end = start + WALKTHROUGH_MUSIC_SECONDS;
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.34, start + 0.08);
    master.gain.setValueAtTime(0.34, end - 0.75);
    master.gain.exponentialRampToValueAtTime(0.0001, end);
    master.connect(ctx.destination);

    const chords = [
      [261.63, 329.63, 392.00], // C
      [220.00, 261.63, 329.63], // Am
      [174.61, 220.00, 261.63], // F
      [196.00, 246.94, 293.66], // G
    ];
    WALKTHROUGH_SKANK_BEATS.forEach((beatNumber, index) => {
      const chord = chords[Math.floor(index / 2) % chords.length];
      const at = start + beatNumber * beat;
      chord.forEach((frequency) => tone(ctx, master, frequency, at, 0.115, 0.045, 'triangle'));
      tone(ctx, master, 1_180, at, 0.04, 0.018, 'square');
    });

    const bass = [65.41, 65.41, 55.00, 55.00, 43.65, 43.65, 49.00, 49.00];
    bass.forEach((frequency, index) => {
      const at = start + index * beat;
      tone(ctx, master, frequency, at, beat * 0.62, 0.12, 'sine');
      if (index % 2 === 0) {
        const kick = ctx.createOscillator();
        const kickGain = ctx.createGain();
        kick.frequency.setValueAtTime(105, at);
        kick.frequency.exponentialRampToValueAtTime(48, at + 0.12);
        kickGain.gain.setValueAtTime(0.12, at);
        kickGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
        kick.connect(kickGain).connect(master);
        kick.start(at);
        kick.stop(at + 0.16);
      }
    });

    finishTimer = window.setTimeout(() => {
      finishTimer = 0;
      if (context === ctx) context = null;
      void ctx.close().catch(() => {});
      onFinished?.();
    }, WALKTHROUGH_MUSIC_SECONDS * 1000 + 120);
    return true;
  } catch {
    context = null;
    return false;
  }
}

export function stopWalkthroughMusic(): void {
  window.clearTimeout(finishTimer);
  finishTimer = 0;
  const active = context;
  context = null;
  if (active) void active.close().catch(() => {});
}

