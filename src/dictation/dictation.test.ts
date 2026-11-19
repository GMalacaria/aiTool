import { describe, expect, it } from 'vitest';
import { PauseDetector } from './pauses';
import { joinDraft, LiveTranscript } from './transcript';

const QUIET = 0.002;
const VOICE = 0.1;

/** Feeds 100 ms frames and collects the decisions. */
function feed(detector: PauseDetector, levels: number[], start = 0) {
  return levels.map((level, index) => detector.frame(level, start + index * 100));
}

describe('PauseDetector', () => {
  it('sends nothing while silent, then the held pre-roll with the first speech frame', () => {
    const detector = new PauseDetector(0);
    const decisions = feed(detector, [QUIET, QUIET, QUIET, QUIET, QUIET, VOICE, VOICE]);

    expect(decisions.slice(0, 5).every((decision) => decision.send === 0 && !decision.commit)).toBe(true);
    // Three frames of pre-roll plus the speech frame.
    expect(decisions[5].send).toBe(4);
    expect(decisions[6].send).toBe(1);
    expect(detector.openSegment).toBe(true);
  });

  it('closes the segment after a pause and sends the pause itself until then', () => {
    const detector = new PauseDetector(0);
    const decisions = feed(detector, [VOICE, VOICE, ...Array(8).fill(QUIET)]);

    const commits = decisions.map((decision, index) => (decision.commit ? index : -1)).filter((index) => index >= 0);
    // Last voice at 100 ms; 700 ms later (frame at 800 ms, index 8) the segment closes.
    expect(commits).toEqual([8]);
    expect(decisions.slice(2, 8).every((decision) => decision.send === 1)).toBe(true);
    expect(detector.openSegment).toBe(false);
  });

  it('ends the dictation after a long silence that follows speech', () => {
    const detector = new PauseDetector(0);
    const decisions = feed(detector, [VOICE, ...Array(31).fill(QUIET)]);

    expect(decisions.findIndex((decision) => decision.stop === 'silence')).toBe(30);
  });

  it('ends the dictation when nothing is said', () => {
    const detector = new PauseDetector(0);
    const decisions = feed(detector, Array(81).fill(QUIET));

    expect(decisions.findIndex((decision) => decision.stop === 'no-speech')).toBe(80);
    expect(decisions.every((decision) => decision.send === 0)).toBe(true);
  });

  it('learns a steady background noise and does not take it for speech', () => {
    const detector = new PauseDetector(0);
    const hum = 0.02;
    const decisions = feed(detector, Array(60).fill(hum));

    // Taken for speech at first, then learnt as background within about three seconds.
    expect(decisions.slice(40).every((decision) => decision.send === 0)).toBe(true);
    expect(detector.frame(0.3, 6000).send).toBeGreaterThan(0);
  });
});

describe('LiveTranscript', () => {
  it('shows partial text, replaces it with the final text and keeps the order of segments', () => {
    const transcript = new LiveTranscript();
    transcript.delta('a', ' Buon');
    transcript.delta('a', 'giorno,');
    expect(transcript.text).toBe('Buongiorno,');

    transcript.committed('a');
    transcript.delta('b', ' vorrei');
    expect(transcript.settled).toBe(false);

    // The second segment completes first: the order stays the spoken one.
    transcript.completed('b', 'vorrei sapere.');
    transcript.completed('a', 'Buongiorno,');
    expect(transcript.text).toBe('Buongiorno, vorrei sapere.');
    expect(transcript.settled).toBe(true);
  });

  it('keeps the partial text of a segment that failed and ignores late pieces', () => {
    const transcript = new LiveTranscript();
    transcript.delta('a', 'ciao');
    transcript.failed('a');
    transcript.delta('a', ' altro');
    expect(transcript.text).toBe('ciao');
    expect(transcript.settled).toBe(true);
  });
});

describe('joinDraft', () => {
  it('adds the dictated text after what was written, with one space', () => {
    expect(joinDraft('', 'ciao')).toBe('ciao');
    expect(joinDraft('Scrivi', 'ciao')).toBe('Scrivi ciao');
    expect(joinDraft('Scrivi ', 'ciao')).toBe('Scrivi ciao');
    expect(joinDraft('Scrivi', '')).toBe('Scrivi');
  });
});
