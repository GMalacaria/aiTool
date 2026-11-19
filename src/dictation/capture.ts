/**
 * Audio worklet that turns the microphone into what the transcription service
 * expects: mono PCM16 at the session's sample rate, in 100 ms frames, each with
 * its loudness (RMS) for pause detection. The microphone runs at the device's
 * own rate (usually 48 kHz), so samples are converted by linear interpolation.
 * Loaded from a Blob URL: there is no separate file to serve.
 */
const WORKLET_SOURCE = `
class DictationCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameLength = Math.round(options.processorOptions.targetRate / 10);
    this.step = sampleRate / options.processorOptions.targetRate;
    this.position = 0;
    this.frame = new Int16Array(this.frameLength);
    this.filled = 0;
    this.energy = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    while (this.position < input.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const next = index + 1 < input.length ? input[index + 1] : input[index];
      const sample = Math.max(-1, Math.min(1, input[index] + (next - input[index]) * fraction));
      this.frame[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.energy += sample * sample;
      if (this.filled === this.frameLength) {
        this.port.postMessage({ pcm: this.frame.buffer, level: Math.sqrt(this.energy / this.filled) }, [this.frame.buffer]);
        this.frame = new Int16Array(this.frameLength);
        this.filled = 0;
        this.energy = 0;
      }
      this.position += this.step;
    }
    this.position -= input.length;
    return true;
  }
}
registerProcessor('dictation-capture', DictationCapture);
`;

export interface CapturedFrame {
  pcm: ArrayBuffer;
  level: number;
}

export interface Capture {
  stop(): void;
}

/** Starts sending frames of the microphone stream to `onFrame`. */
export async function startCapture(
  context: AudioContext,
  stream: MediaStream,
  targetRate: number,
  onFrame: (frame: CapturedFrame) => void,
): Promise<Capture> {
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  await context.resume();

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'dictation-capture', { processorOptions: { targetRate } });
  // Some browsers only run nodes that reach the output: a muted gain keeps it silent.
  const mute = context.createGain();
  mute.gain.value = 0;
  node.port.onmessage = (event: MessageEvent<CapturedFrame>) => onFrame(event.data);
  source.connect(node).connect(mute).connect(context.destination);

  return {
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      mute.disconnect();
    },
  };
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}
