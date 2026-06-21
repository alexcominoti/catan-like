/**
 * Efeitos sonoros sintetizados via Web Audio API — sem arquivos, sem copyright.
 * Cada acao toca um cue curto e distinto.
 */

export type SoundKind =
  | 'dice'
  | 'road'
  | 'settlement'
  | 'city'
  | 'card'
  | 'longestRoad'
  | 'largestArmy'
  | 'win'
  | 'robber'
  | 'trade';

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Destrava o audio numa interacao do usuario (politica de autoplay). */
export function unlockAudio(): void {
  ac();
}

export function setMuted(m: boolean): void {
  muted = m;
}
export function isMuted(): boolean {
  return muted;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.2): void {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(c.destination);
  const t = c.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function noise(start: number, dur: number, gain = 0.15, cutoff = 1800): void {
  const c = ac();
  if (!c) return;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = c.createGain();
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  const t = c.currentTime + start;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.start(t);
  src.stop(t + dur);
}

function arpeggio(freqs: number[], step: number, type: OscillatorType = 'triangle', gain = 0.2): void {
  freqs.forEach((f, i) => tone(f, i * step, step * 1.8, type, gain));
}

export function play(kind: SoundKind): void {
  if (muted) return;
  if (!ac()) return;
  switch (kind) {
    case 'dice': // chacoalhar + batida
      noise(0, 0.11, 0.16, 2600);
      noise(0.12, 0.09, 0.12, 2200);
      tone(170, 0.22, 0.13, 'sine', 0.18);
      break;
    case 'road':
      tone(300, 0, 0.07, 'square', 0.1);
      tone(210, 0.05, 0.1, 'square', 0.1);
      break;
    case 'settlement':
      tone(440, 0, 0.08, 'triangle', 0.18);
      tone(660, 0.07, 0.12, 'triangle', 0.18);
      break;
    case 'city':
      arpeggio([330, 494, 659], 0.08, 'sawtooth', 0.15);
      break;
    case 'card':
      noise(0, 0.16, 0.09, 3500);
      tone(880, 0.02, 0.1, 'sine', 0.07);
      break;
    case 'longestRoad':
      arpeggio([523, 659, 784], 0.1, 'triangle', 0.2);
      break;
    case 'largestArmy':
      arpeggio([392, 523, 659, 784], 0.1, 'sawtooth', 0.18);
      break;
    case 'win':
      arpeggio([523, 659, 784, 1047, 1319], 0.13, 'triangle', 0.22);
      break;
    case 'robber':
      tone(150, 0, 0.18, 'sawtooth', 0.18);
      tone(110, 0.1, 0.16, 'sawtooth', 0.14);
      break;
    case 'trade':
      tone(680, 0, 0.06, 'sine', 0.16);
      tone(920, 0.06, 0.08, 'sine', 0.16);
      break;
  }
}
