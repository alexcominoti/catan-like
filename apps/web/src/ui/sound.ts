/**
 * Efeitos sonoros sintetizados via Web Audio API — sem arquivos, sem copyright.
 * Estetica natural/medieval. Para soar menos artificial usamos:
 *  - Karplus-Strong (corda dedilhada real: alaude/harpa) no lugar de osciladores;
 *  - batidas de madeira com transiente de ruido + corpo ressonante;
 *  - metais (trompa) com vibrato e abertura de filtro;
 *  - chocalho de dados com timing/altura aleatorios + assentamento.
 * Tudo passa por um leve reverb de "salao".
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
let volume = 0.8; // 0..1 — controlado pelas setas ↑/↓ (atalhos de teclado)

function init(): boolean {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      // Reverb de salao (impulso curto gerado).
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 1.6, 2.8);
      const wet = ctx.createGain();
      wet.gain.value = 0.18;
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

/** Volume atual (0..1). */
export function getVolume(): number {
  return volume;
}

/** Define o volume (0..1) e aplica no ganho principal (se o áudio já iniciou). */
export function setVolume(v: number): number {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
  return volume;
}

/** Ajusta o volume por um delta (para as setas ↑/↓). Retorna o novo valor. */
export function nudgeVolume(delta: number): number {
  return setVolume(Math.round((volume + delta) * 20) / 20);
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

/**
 * Corda dedilhada por Karplus-Strong: ruido inicial num anel de comprimento
 * = sampleRate/freq, realimentado com media (passa-baixa) e decaimento R. Soa
 * como uma corda de verdade (alaude/violao/harpa), bem mais natural que somar
 * osciladores. Renderiza o tom inteiro num buffer e o reproduz.
 */
function ksString(freq: number, start: number, dur = 1.0, gain = 0.42, R = 0.996): void {
  if (!ctx || !master) return;
  const sr = ctx.sampleRate;
  const t = ctx.currentTime + start;
  const N = Math.max(2, Math.round(sr / freq));
  const len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  const ring = new Float32Array(N);
  // Excitacao: ruido levemente suavizado (mais "corda dedilhada", menos sopro).
  let prev = 0;
  for (let i = 0; i < N; i++) {
    prev = ((Math.random() * 2 - 1) + prev) * 0.5;
    ring[i] = prev;
  }
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx]!;
    const val = (cur + ring[(idx + 1) % N]!) * 0.5 * R;
    ring[idx] = val;
    out[i] = cur;
    idx = (idx + 1) % N;
  }
  // Envelope: ataque rapido + fade final (evita clique).
  const atk = Math.floor(sr * 0.004);
  const rel = Math.min(len, Math.floor(sr * 0.05));
  for (let i = 0; i < atk; i++) out[i] = out[i]! * (i / atk);
  for (let i = 0; i < rel; i++) out[len - 1 - i] = out[len - 1 - i]! * (i / rel);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(lp);
  lp.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** Batida de madeira: transiente de ruido curtissimo + corpo ressonante "tok". */
function woodHit(start: number, pitch = 300, gain = 0.2): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + start;
  // Transiente (impacto seco).
  const len = Math.floor(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 8);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = pitch * 2.2;
  bp.Q.value = 1.8;
  const tg = ctx.createGain();
  tg.gain.value = gain * 0.7;
  src.connect(bp);
  bp.connect(tg);
  tg.connect(master);
  src.start(t);
  src.stop(t + 0.06);
  // Corpo ressonante (a madeira "fala").
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.68, t + 0.05);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.linearRampToValueAtTime(gain, t + 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  o.connect(og);
  og.connect(master);
  o.start(t);
  o.stop(t + 0.15);
}

/** Trompa/metal: saws desafinados com vibrato e abertura de filtro (sopro). */
function brass(freq: number, start: number, dur = 0.5, gain = 0.15): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + start;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(650, t);
  lp.frequency.linearRampToValueAtTime(2300, t + 0.09);
  lp.frequency.linearRampToValueAtTime(1500, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.06);
  g.gain.setValueAtTime(gain, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(g);
  g.connect(master);
  // Vibrato compartilhado.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const lg = ctx.createGain();
  lg.gain.value = freq * 0.006;
  lfo.connect(lg);
  for (const [det, w] of [[-6, 1], [6, 1], [0, 0.55]] as [number, number][]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = det;
    lg.connect(o.detune);
    const og = ctx.createGain();
    og.gain.value = w;
    o.connect(og);
    og.connect(lp);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  lfo.start(t);
  lfo.stop(t + dur + 0.05);
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

/** Chocalho de dados: toques de madeira com altura/timing aleatorios + assentar. */
function diceRoll(): void {
  let t = 0;
  for (let i = 0; i < 7; i++) {
    woodHit(t, 260 + Math.random() * 380, 0.09 + Math.random() * 0.06);
    t += 0.028 + Math.random() * 0.045;
  }
  woodHit(t + 0.05, 175, 0.2); // assentamento final, mais grave
  woodHit(t + 0.12, 150, 0.13);
}

export function play(kind: SoundKind): void {
  if (muted || !init()) return;
  switch (kind) {
    case 'dice':
      diceRoll();
      break;
    case 'road':
      woodHit(0, 300, 0.22);
      ksString(196, 0.02, 0.6, 0.34); // G3 grave
      break;
    case 'settlement':
      woodHit(0, 360, 0.18);
      ksString(330, 0.03, 0.9, 0.4); // E4
      ksString(494, 0.1, 0.9, 0.32); // B4
      break;
    case 'city':
      woodHit(0, 210, 0.22);
      ksString(262, 0.04, 1.1, 0.4); // C4
      ksString(330, 0.05, 1.1, 0.34); // E4
      ksString(392, 0.06, 1.1, 0.3); // G4
      break;
    case 'card':
      ksString(587, 0, 0.85, 0.4); // D5 — dedilhado de alaude
      break;
    case 'longestRoad':
      brass(392, 0, 0.42); // G4
      brass(494, 0.17, 0.42); // B4
      brass(587, 0.34, 0.6); // D5
      break;
    case 'largestArmy':
      woodHit(0, 160, 0.2);
      brass(262, 0.02, 0.42); // C4
      brass(392, 0.19, 0.42); // G4
      brass(523, 0.36, 0.7); // C5
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => brass(f, i * 0.17, 0.7, 0.16));
      ksString(1047, 0.68, 1.4, 0.4);
      break;
    case 'robber':
      brass(98, 0, 0.55, 0.16); // G2 grave
      woodHit(0.06, 120, 0.18);
      break;
    case 'trade':
      bell(880, 0);
      bell(1175, 0.08);
      break;
    case 'yourTurn': // harpa ascendente suave
      ksString(523, 0, 0.8, 0.32);
      ksString(659, 0.1, 0.8, 0.32);
      ksString(784, 0.2, 1.0, 0.36);
      break;
  }
}
