// The music box: plays a melody plan's notes and chords through Web Audio, so
// the plan can be heard on its own, apart from the recording. One box for the
// app; starting it again replaces what it was playing.

import { chordNotes } from '@engine/domain/melodyPlan';
import type { BoxEvent } from '@engine/domain/songMap';

let ctx: AudioContext | null = null;
let out: DynamicsCompressorNode | null = null;
let bus: GainNode | null = null;
let timer = 0;
let events: BoxEvent[] = [];
let next = 0;
let t0 = 0;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function strike(ac: AudioContext, to: GainNode, e: BoxEvent, when: number): void {
  const g = ac.createGain();
  g.connect(to);
  if (e.kind === 'chord') {
    // The band: a soft pad under everything.
    const c = chordNotes(e.name);
    if (!c) return;
    const d = Math.max(0.25, e.d);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.045, when + 0.07);
    g.gain.setTargetAtTime(0, when + d - 0.04, 0.09);
    [c.bass, ...c.notes].forEach((m, i) => {
      const o = ac.createOscillator();
      o.type = i ? 'sine' : 'triangle';
      o.frequency.value = hz(m);
      o.connect(g);
      o.start(when);
      o.stop(when + d + 0.6);
    });
    return;
  }
  if (e.kind === 'singer') {
    // The singer: a held, rounded tone for as long as the note is written.
    const d = Math.max(0.09, e.d);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    filter.connect(g);
    const body = ac.createOscillator();
    body.type = 'triangle';
    body.frequency.value = hz(e.midi);
    body.connect(filter);
    const air = ac.createOscillator();
    const airGain = ac.createGain();
    air.type = 'sine';
    air.frequency.value = hz(e.midi) * 2.004;
    airGain.gain.value = 0.16;
    air.connect(airGain);
    airGain.connect(filter);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.24, when + 0.025);
    g.gain.setTargetAtTime(0.17, when + 0.03, 0.3);
    g.gain.setTargetAtTime(0, when + d - 0.02, 0.05);
    for (const o of [body, air]) {
      o.start(when);
      o.stop(when + d + 0.4);
    }
    return;
  }
  // The instrument: a plucked tine that rings and fades.
  const tau = Math.min(0.9, Math.max(0.14, e.d * 0.55));
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(0.2, when + 0.006);
  g.gain.setTargetAtTime(0, when + 0.008, tau);
  for (const [harmonic, level] of [[1, 1], [2, 0.32], [3, 0.1]]) {
    const o = ac.createOscillator();
    const og = ac.createGain();
    o.type = 'sine';
    o.frequency.value = hz(e.midi) * harmonic;
    og.gain.value = level;
    o.connect(og);
    og.connect(g);
    o.start(when);
    o.stop(when + tau * 6);
  }
}

// Notes are handed to the audio clock a third of a second ahead, so a busy
// page cannot make the box stumble.
function pump(): void {
  if (!ctx || !bus) return;
  const now = ctx.currentTime;
  while (next < events.length && events[next].t < now - t0 + 0.3) {
    // Moved past before it is struck: a note the audio clock refuses is
    // left out, not tried again on every tick with the rest waiting behind it.
    const e = events[next++];
    strike(ctx, bus, e, Math.max(now, t0 + e.t));
  }
}

/** Starts playing `score` (times in seconds from now). False when this machine has no audio output to give. */
export function boxStart(score: BoxEvent[], volume: number): boolean {
  boxStop();
  try {
    if (!ctx) {
      ctx = new AudioContext();
      out = ctx.createDynamicsCompressor();
      out.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    return false;
  }
  bus = ctx.createGain();
  bus.gain.value = Math.max(0, Math.min(1, volume)) * 1.1;
  bus.connect(out!);
  events = score;
  next = 0;
  t0 = ctx.currentTime + 0.09;
  timer = window.setInterval(pump, 30);
  pump();
  return true;
}

export function boxStop(): void {
  window.clearInterval(timer);
  timer = 0;
  if (!ctx || !bus) return;
  const old = bus;
  bus = null;
  // A short fade, not a cut: notes already handed over would click.
  old.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
  window.setTimeout(() => old.disconnect(), 220);
}

/** Seconds of the score played so far. */
export function boxElapsed(): number {
  return ctx && bus ? Math.max(0, ctx.currentTime - t0) : 0;
}
