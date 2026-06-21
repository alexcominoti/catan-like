/**
 * Efeitos sonoros sintetizados via Web Audio API — sem arquivos, sem copyright.
 * Estetica natural/medieval: cordas dedilhadas (alaude/harpa), trompas e batidas
 * de madeira, com um leve reverb de "salao".
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
  | 'trade'
  | 'yourTurn';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function init(): boolean {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
      // Reverb de salao (impulso curto gerado).
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 1.3, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      master.connect(wet);
      wet.connect(conv);
      conv.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

export function unlockAudio(): void {
  init();
}
export function setMuted(m: boolean): void {
  muted = m;
}
export function isMuted(): boolean {
  return muted;
}

function impulse(c: AudioContext, dur: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Corda dedilhada (alaude/harpa): fundamental + harmonicos, ataque rapido. */
function pluck(freq: number, start: number, dur = 0.9, gain = 0.18): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + start;
  const harmonics = [1, 2, 3, 4];
  const weights = [1, 0.5, 0.28, 0.14];
  harmonics.forEach((h, i) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = 'triangle';
    o.frequency.value = freq * h;
    o.connect(g);
    g.connect(master!);
    const peak = gain * weights[i]!;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (1 - i * 0.12));
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

/** Trompa/metal: saws levemente desafinados num passa-baixa, ataque medio. */
function horn(freq: number, start: number, dur = 0.5, gain = 0.16): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + start;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1800;
  const g = ctx.createGain();
  filt.connect(g);
  g.connect(master);
  for (const det of [-5, 5]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(filt);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.04);
  g.gain.setValueAtTime(gain, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

/** Batida de madeira: ruido curto e ressonante. */
function clack(start: number, pitch = 320, gain = 0.22): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + start;
  const len = Math.floor(ctx.sampleRate * 0.08);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = pitch;
  bp.Q.value = 4;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + 0.09);
}

/** Sino/moeda: fundamental + parciais inarmonicos. */
function bell(freq: number, start: number, gain = 0.12): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + start;
  for (const [mult, w] of [[1, 1], [2.01, 0.5], [3.02, 0.25]] as [number, number][]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    o.connect(g);
    g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * w, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.start(t);
    o.stop(t + 0.75);
  }
}

export function play(kind: SoundKind): void {
  if (muted || !init()) return;
  switch (kind) {
    case 'dice': // chacoalho de madeira + assentar
      clack(0, 520, 0.14);
      clack(0.06, 420, 0.13);
      clack(0.13, 300, 0.15);
      clack(0.2, 240, 0.18);
      break;
    case 'road':
      clack(0, 300, 0.2);
      pluck(196, 0.02, 0.5, 0.12); // G3
      break;
    case 'settlement':
      clack(0, 360, 0.16);
      pluck(330, 0.03, 0.8, 0.16); // E4
      pluck(494, 0.12, 0.8, 0.14); // B4
      break;
    case 'city':
      clack(0, 200, 0.22);
      pluck(262, 0.04, 1.0, 0.16); // C4
      pluck(330, 0.04, 1.0, 0.14); // E4
      pluck(392, 0.04, 1.0, 0.13); // G4
      break;
    case 'card':
      pluck(587, 0, 0.7, 0.16); // D5 — dedilhado de alaude
      break;
    case 'longestRoad':
      horn(392, 0, 0.4); // G4
      horn(494, 0.16, 0.4); // B4
      horn(587, 0.32, 0.6); // D5
      break;
    case 'largestArmy':
      clack(0, 160, 0.2);
      horn(262, 0.02, 0.4); // C4
      horn(392, 0.18, 0.4); // G4
      horn(523, 0.34, 0.7); // C5
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => horn(f, i * 0.16, 0.7, 0.17));
      pluck(1047, 0.64, 1.4, 0.16);
      break;
    case 'robber':
      horn(98, 0, 0.5, 0.16); // G2 grave
      clack(0.05, 120, 0.18);
      break;
    case 'trade':
      bell(880, 0);
      bell(1175, 0.08);
      break;
    case 'yourTurn': // harpa ascendente suave
      pluck(523, 0, 0.7, 0.14);
      pluck(659, 0.1, 0.7, 0.14);
      pluck(784, 0.2, 0.9, 0.15);
      break;
  }
}
