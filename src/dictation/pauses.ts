/**
 * Pause detection for live dictation, fed with the loudness of each ~100 ms
 * audio frame. It decides:
 * - which frames to send (only speech and the moment around it: silence is
 *   not sent, because the service is paid per minute of audio);
 * - when a pause closes a segment (the service then returns its final text);
 * - when the dictation ends by itself (a long silence after speaking, or no
 *   speech at all).
 */
export interface PauseSettings {
  /** A pause this long closes the segment. */
  segmentPauseMs: number;
  /** Silence this long after speaking ends the dictation. */
  endSilenceMs: number;
  /** With no speech at all, the dictation ends after this long. */
  noSpeechMs: number;
  /** Audio kept from before speech starts, so the first syllable is not cut. */
  preRollFrames: number;
  /** Below this loudness (RMS, 0–1) a frame is never speech. */
  minLevel: number;
}

export const DEFAULT_PAUSES: PauseSettings = {
  segmentPauseMs: 700,
  endSilenceMs: 3000,
  noSpeechMs: 8000,
  preRollFrames: 3,
  minLevel: 0.012,
};

export interface FrameDecision {
  /** Frames to send now, oldest first (the kept pre-roll plus this one). */
  send: number;
  /** Close the current segment after sending. */
  commit: boolean;
  /** End the dictation. */
  stop: 'silence' | 'no-speech' | null;
}

export class PauseDetector {
  private noiseFloor = 0.005;
  private active = false;
  private heldFrames = 0;
  private spokeInSegment = false;
  private spokeEver = false;
  private lastVoiceAt = 0;

  constructor(
    private readonly startedAt: number,
    private readonly settings: PauseSettings = DEFAULT_PAUSES,
  ) {}

  /** True when part of the speech has been sent but its segment is not closed yet. */
  get openSegment(): boolean {
    return this.spokeInSegment;
  }

  frame(level: number, now: number): FrameDecision {
    const { segmentPauseMs, endSilenceMs, noSpeechMs, preRollFrames, minLevel } = this.settings;
    const speech = level > Math.max(minLevel, this.noiseFloor * 3);
    // The background level follows quiet moments at once and rises slowly, so a
    // steady noise (a fan, traffic) stops counting as speech after a few seconds,
    // while the gaps between words keep it low during real speech.
    this.noiseFloor = level < this.noiseFloor ? level : this.noiseFloor * 0.995 + level * 0.005;

    if (speech) {
      this.lastVoiceAt = now;
      this.spokeInSegment = true;
      this.spokeEver = true;
      if (!this.active) {
        this.active = true;
        const send = this.heldFrames + 1;
        this.heldFrames = 0;
        return { send, commit: false, stop: null };
      }
      return { send: 1, commit: false, stop: null };
    }

    if (this.active) {
      if (now - this.lastVoiceAt < segmentPauseMs) return { send: 1, commit: false, stop: null };
      // The pause is long enough: the segment is closed.
      this.active = false;
      this.spokeInSegment = false;
      this.heldFrames = 0;
      return { send: 0, commit: true, stop: null };
    }

    this.heldFrames = Math.min(preRollFrames, this.heldFrames + 1);
    if (this.spokeEver && now - this.lastVoiceAt >= endSilenceMs) return { send: 0, commit: false, stop: 'silence' };
    if (!this.spokeEver && now - this.startedAt >= noSpeechMs) return { send: 0, commit: false, stop: 'no-speech' };
    return { send: 0, commit: false, stop: null };
  }
}
