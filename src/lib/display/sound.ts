/**
 * The exhibit's sound (issue #27): background music for waiting and for the
 * replay, a cue when a visitor's QR is read, and a closing cue at ShibaLab.
 *
 * The sounds themselves come from @newcocone as files in public/display/sound/
 * (see the README there). sounds.json names each file and where its loop runs,
 * so a new take is a file swap, not a code change. Until a file is there (or if
 * it fails to load) a placeholder made right here in the browser plays instead,
 * so the booth always has sound.
 *
 * Browsers stay silent until the page has been clicked or a key pressed, so the
 * engine starts suspended: `unlock()` from any user gesture (the 音を出す
 * button, or the test buttons) starts it, and the scene asked for so far plays.
 */

export type Cue = "wait" | "scan" | "play" | "arrive";
export type Scene = "top" | "playback" | "arrived";

/** One entry of public/display/sound/sounds.json. */
interface CueSpec {
  /** File names in public/display/sound/, tried in order (e.g. an MP3 and an OGG of the same sound). */
  files: string[];
  /** Background music loops; cues play once. */
  loop?: boolean;
  /** Where the loop runs, in seconds (default: the whole file). */
  loopStart?: number;
  loopEnd?: number;
  /** 0–1, on top of the master volume. */
  volume?: number;
}

const BASE = "/display/sound/";
const CUES: Cue[] = ["wait", "scan", "play", "arrive"];
const DEFAULTS: Record<Cue, CueSpec> = {
  wait: { files: ["wait-bgm.mp3", "wait-bgm.ogg"], loop: true, volume: 0.5 },
  scan: { files: ["scan.mp3", "scan.ogg"], volume: 0.9 },
  play: { files: ["play-bgm.mp3", "play-bgm.ogg"], loop: true, volume: 0.6 },
  arrive: { files: ["arrive.mp3", "arrive.ogg"], volume: 0.9 },
};
/** Seconds to fade one background music into the next. */
const FADE = 1.5;
/** The replay music comes in after the scan cue has had its moment. */
const PLAY_AFTER_SCAN = 0.35;

export interface SoundOptions {
  /** Master volume, 0–1 (?volume=). */
  volume: number;
  /** No sound at all (?mute=1). */
  muted: boolean;
}

export interface SoundEngine {
  /** True once the browser lets the page make sound. */
  readonly unlocked: boolean;
  /** Where each cue's sound came from: a file name, or "仮" for the placeholder. */
  readonly sources: Readonly<Record<Cue, string>>;
  /** Call from a click or key press. Resolves once sound can play. */
  unlock(): Promise<void>;
  /** The screen changed: fade the music over and play that moment's cue. */
  scene(next: Scene): void;
  /** Tell me when `unlocked` or `sources` change (for the button and the ?sound=1 readout). */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createSound(opts: SoundOptions): SoundEngine {
  const AudioContextClass: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const sources = Object.fromEntries(CUES.map((c) => [c, "…"])) as Record<Cue, string>;

  if (!AudioContextClass || opts.muted) {
    return {
      unlocked: true,
      sources,
      unlock: async () => {},
      scene: () => {},
      subscribe: () => () => {},
      dispose: () => {},
    };
  }

  const ctx = new AudioContextClass();
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, opts.volume));
  master.connect(ctx.destination);

  const specs: Record<Cue, CueSpec> = { ...DEFAULTS };
  const buffers = new Map<Cue, AudioBuffer>();
  let current: Scene | null = null;
  let music: { cue: Cue; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  let disposed = false;

  const ready = (async () => {
    try {
      const res = await fetch(`${BASE}sounds.json`, { cache: "no-cache" });
      if (res.ok) {
        const json = (await res.json()) as Partial<Record<Cue, CueSpec>>;
        for (const cue of CUES) if (json[cue]) specs[cue] = { ...DEFAULTS[cue], ...json[cue] };
      }
    } catch {
      // No manifest: the default file names.
    }
    await Promise.all(
      CUES.map(async (cue) => {
        const loaded = await loadFirst(ctx, specs[cue].files);
        buffers.set(cue, loaded?.buffer ?? placeholder(ctx, cue));
        sources[cue] = loaded?.file ?? "仮";
      }),
    );
    notify();
  })();

  function startMusic(cue: Cue, at: number) {
    const buffer = buffers.get(cue);
    if (!buffer) return;
    if (music?.cue === cue) return;
    stopMusic(at);
    const spec = specs[cue];
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    if (spec.loopStart !== undefined) source.loopStart = spec.loopStart;
    if (spec.loopEnd !== undefined) source.loopEnd = spec.loopEnd;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(spec.volume ?? 1, at + FADE);
    source.connect(gain).connect(master);
    source.start(at);
    music = { cue, source, gain };
  }

  function stopMusic(at: number, fade = FADE) {
    if (!music) return;
    const { source, gain } = music;
    gain.gain.cancelScheduledValues(at);
    gain.gain.setValueAtTime(gain.gain.value, at);
    gain.gain.linearRampToValueAtTime(0, at + fade);
    source.stop(at + fade + 0.05);
    music = null;
  }

  function cue(name: Cue, at: number) {
    const buffer = buffers.get(name);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = specs[name].volume ?? 1;
    source.connect(gain).connect(master);
    source.start(at);
  }

  /** Plays what `next` calls for. One-off cues only when the scene really changes. */
  function apply(next: Scene, withCue: boolean) {
    if (ctx.state !== "running" || buffers.size < CUES.length) return;
    const now = ctx.currentTime;
    if (next === "top") {
      startMusic("wait", now);
    } else if (next === "playback") {
      if (withCue) cue("scan", now);
      startMusic("play", now + (withCue ? PLAY_AFTER_SCAN : 0));
    } else {
      // The closing cue ends the replay music.
      stopMusic(now, 1.0);
      if (withCue) cue("arrive", now);
    }
  }

  const engine: SoundEngine = {
    get unlocked() {
      return ctx.state === "running";
    },
    sources,
    async unlock() {
      if (disposed) return;
      if (ctx.state !== "running") await ctx.resume();
      await ready;
      // Whatever screen is up starts its music now (its one-off cue has passed).
      if (current) apply(current, false);
      notify();
    },
    scene(next) {
      if (next === current) return;
      current = next;
      // Before unlock this only remembers the screen; after it, the moment's cue plays too.
      void ready.then(() => apply(next, true));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      void ctx.close();
    },
  };
  ctx.addEventListener("statechange", notify);
  return engine;
}

async function loadFirst(ctx: AudioContext, files: string[]): Promise<{ file: string; buffer: AudioBuffer } | null> {
  for (const file of files) {
    try {
      const res = await fetch(BASE + file);
      if (!res.ok) continue;
      return { file, buffer: await ctx.decodeAudioData(await res.arrayBuffer()) };
    } catch {
      // Missing or a format this browser can't decode: try the next one.
    }
  }
  return null;
}

/**
 * Stand-in sounds until the real ones arrive: soft synth tones in the spirit of
 * RAY (light, clean, electronic). Loops are built so their ends meet.
 */
function placeholder(ctx: AudioContext, cue: Cue): AudioBuffer {
  const rate = ctx.sampleRate;
  const make = (seconds: number, fill: (t: number) => number) => {
    const buffer = ctx.createBuffer(2, Math.round(seconds * rate), rate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < left.length; i++) left[i] = right[i] = fill(i / rate);
    return buffer;
  };
  const tau = Math.PI * 2;
  switch (cue) {
    case "wait": {
      // A quiet pad, breathing once every 8 s (every partial fits a whole number of cycles).
      const notes = [220, 277.5, 330, 440];
      return make(8, (t) => {
        const swell = 0.6 + 0.4 * Math.sin((tau * t) / 8);
        return (swell * notes.reduce((s, f, k) => s + Math.sin(tau * f * t + k) / (k + 1), 0)) * 0.12;
      });
    }
    case "play": {
      // A light pulse: a pentatonic arpeggio of short plucks, 8 a second, over a low hum.
      const scale = [440, 523.25, 587.33, 659.25, 783.99, 880, 783.99, 659.25];
      return make(4, (t) => {
        const step = Math.floor(t * 8);
        const local = t * 8 - step;
        const f = scale[step % scale.length];
        const pluck = Math.sin(tau * f * t) * Math.exp(-local * 6) * 0.22;
        const hum = Math.sin(tau * 110 * t) * 0.06 * (0.7 + 0.3 * Math.sin((tau * t) / 4));
        return pluck + hum;
      });
    }
    case "scan":
      // Two rising blips.
      return make(0.6, (t) => {
        const f = t < 0.12 ? 880 : 1320;
        const local = t < 0.12 ? t : t - 0.12;
        return Math.sin(tau * f * t) * Math.exp(-local * 9) * 0.35;
      });
    case "arrive":
      // A bright chord that swells and fades.
      return make(4, (t) => {
        const env = Math.min(1, t / 0.15) * Math.exp(-t * 0.9);
        return [523.25, 659.25, 783.99, 1174.66].reduce((s, f) => s + Math.sin(tau * f * t), 0) * env * 0.12;
      });
  }
}
