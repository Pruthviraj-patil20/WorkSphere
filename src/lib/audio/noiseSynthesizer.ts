export type NoiseLayerType = "white" | "pink" | "rain";
export type AmbientSoundType = "white" | "pink" | "brown" | "rain";

export interface SoundscapePreset {
  id: string;
  name: string;
  masterGain: number;
  layers: Record<NoiseLayerType, number>;
}

export interface LayerMixLevels {
  white: number;
  pink: number;
  brown: number;
  rain: number;
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface AudioGainParamLike {
  value: number;
  setTargetAtTime?: (
    target: number,
    startTime: number,
    timeConstant: number,
  ) => void;
  linearRampToValueAtTime?: (value: number, endTime: number) => void;
}

export interface AudioContextLike {
  sampleRate?: number;
  currentTime?: number;
  state?: AudioContextState | string;
  destination?: AudioNode;
  audioWorklet?: {
    addModule: (moduleURL: string | URL) => Promise<void>;
  };
  createBuffer?: (
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ) => AudioBuffer;
  createBufferSource?: () => AudioBufferSourceNode;
  createBiquadFilter?: () => BiquadFilterNode;
  createGain?: () => any;
  resume?: () => Promise<void> | void;
  suspend?: () => Promise<void> | void;
  close?: () => Promise<void> | void;
}

export interface NoiseSynthesizerOptions {
  soundType?: AmbientSoundType;
  volume?: number;
  cutoffFrequency?: number;
  layerLevels?: Partial<LayerMixLevels>;
  muted?: boolean;
  bufferDurationSeconds?: number;
  audioContextFactory?: () => AudioContextLike;
  workerFactory?: () => Worker;
  useWorker?: boolean;
}

export const DEFAULT_SOUNDSCAPE_PRESET: SoundscapePreset = {
  id: "nomad-focus",
  name: "Nomad Focus",
  masterGain: 0.6,
  layers: {
    white: 0.15,
    pink: 0.45,
    rain: 0.55,
  },
};

export const PRESET_STORAGE_KEY = "worksphere:ambient_presets:v1";

export function clampGain(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function normalizeLayerLevels(
  levels?: Partial<LayerMixLevels>,
  activePreset: AmbientSoundType = "pink",
): LayerMixLevels {
  return {
    white: clampVolume(levels?.white ?? (activePreset === "white" ? 0.8 : 0)),
    pink: clampVolume(levels?.pink ?? (activePreset === "pink" ? 0.8 : 0)),
    brown: clampVolume(levels?.brown ?? (activePreset === "brown" ? 0.8 : 0)),
    rain: clampVolume(levels?.rain ?? (activePreset === "rain" ? 0.8 : 0)),
  };
}

export function createNoiseSampleBuffer(
  sampleRate: number,
  durationSeconds: number,
  layer: NoiseLayerType,
  seed = 42,
): Float32Array {
  const safeRate =
    typeof sampleRate === "number" &&
    Number.isFinite(sampleRate) &&
    sampleRate > 0
      ? Math.floor(sampleRate)
      : 44_100;
  const safeDuration =
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
      ? durationSeconds
      : 2;

  const length = Math.max(1, Math.floor(safeRate * safeDuration));
  const output = new Float32Array(length);

  let state = seed >>> 0 || 1;
  const nextRand = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let brownOut = 0;

  for (let i = 0; i < length; i += 1) {
    const white = nextRand() * 2 - 1;
    if (layer === "white") {
      output[i] = white * 0.5;
    } else if (layer === "pink") {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      output[i] = Math.max(-1, Math.min(1, pink));
    } else {
      brownOut = (brownOut + 0.04 * white) / 1.04;
      const dropletGate = nextRand() > 0.9965 ? (nextRand() * 2 - 1) * 0.35 : 0;
      output[i] = Math.max(-1, Math.min(1, brownOut * 2.4 + dropletGate));
    }
  }

  return output;
}

export function generateNoiseSamples(
  type: AmbientSoundType,
  length: number,
  _sampleRate = 44100,
  seed = 42,
): Float32Array {
  const safeLength = Math.max(1, Math.floor(length));
  const samples = new Float32Array(safeLength);
  let state = seed >>> 0 || 1;
  const rng = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  if (type === "brown") {
    let lastOut = 0;
    for (let i = 0; i < safeLength; i += 1) {
      const white = rng() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      const val = lastOut * 3.5;
      samples[i] = Math.max(-1, Math.min(1, val));
    }
    return samples;
  }

  if (type === "pink") {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < safeLength; i += 1) {
      const white = rng() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      samples[i] = Math.max(-1, Math.min(1, pink));
    }
    return samples;
  }

  if (type === "rain") {
    let brownOut = 0;
    for (let i = 0; i < safeLength; i += 1) {
      const white = rng() * 2 - 1;
      brownOut = (brownOut + 0.04 * white) / 1.04;
      const dropletGate = rng() > 0.9965 ? (rng() * 2 - 1) * 0.35 : 0;
      samples[i] = Math.max(-1, Math.min(1, brownOut * 2.4 + dropletGate));
    }
    return samples;
  }

  // white noise
  for (let i = 0; i < safeLength; i += 1) {
    const white = rng() * 2 - 1;
    samples[i] = Math.max(-1, Math.min(1, white * 0.5));
  }
  return samples;
}

export function loadSoundscapePresets(
  storage?: StorageLike | null,
  storageKey = PRESET_STORAGE_KEY,
): SoundscapePreset[] {
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== "undefined" && window.localStorage
        ? window.localStorage
        : null;

  if (!targetStorage) return [DEFAULT_SOUNDSCAPE_PRESET];

  try {
    const raw = targetStorage.getItem(storageKey);
    if (!raw) return [DEFAULT_SOUNDSCAPE_PRESET];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [DEFAULT_SOUNDSCAPE_PRESET];
    }
    return parsed.map((item) => ({
      id: String(item.id || `preset-${Date.now()}`),
      name: String(item.name || "Untitled Soundscape"),
      masterGain: clampGain(
        item.masterGain ?? DEFAULT_SOUNDSCAPE_PRESET.masterGain,
      ),
      layers: {
        white: clampGain(
          item.layers?.white ?? DEFAULT_SOUNDSCAPE_PRESET.layers.white,
        ),
        pink: clampGain(
          item.layers?.pink ?? DEFAULT_SOUNDSCAPE_PRESET.layers.pink,
        ),
        rain: clampGain(
          item.layers?.rain ?? DEFAULT_SOUNDSCAPE_PRESET.layers.rain,
        ),
      },
    }));
  } catch {
    return [DEFAULT_SOUNDSCAPE_PRESET];
  }
}

export function saveSoundscapePresets(
  presets: SoundscapePreset[],
  storage?: StorageLike | null,
  storageKey = PRESET_STORAGE_KEY,
): boolean {
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== "undefined" && window.localStorage
        ? window.localStorage
        : null;

  if (!targetStorage) return false;

  try {
    targetStorage.setItem(storageKey, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

export function rampGainSmoothly(
  param: AudioGainParamLike | undefined,
  targetGain: number,
  currentTime = 0,
  rampSeconds = 0.08,
): number {
  const safeTarget = clampGain(targetGain);
  if (!param) return safeTarget;

  const safeTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const safeRamp =
    typeof rampSeconds === "number" &&
    Number.isFinite(rampSeconds) &&
    rampSeconds > 0
      ? rampSeconds
      : 0.05;

  if (typeof param.setTargetAtTime === "function") {
    param.setTargetAtTime(safeTarget, safeTime, safeRamp / 3);
  } else if (typeof param.linearRampToValueAtTime === "function") {
    param.linearRampToValueAtTime(safeTarget, safeTime + safeRamp);
  } else {
    param.value = safeTarget;
  }

  return safeTarget;
}

export class NoiseSoundscapeEngine {
  private readonly ctx: AudioContextLike | null;
  private isPlaying = false;
  private isMuted = false;
  private isTabHidden = false;
  private masterGainValue = DEFAULT_SOUNDSCAPE_PRESET.masterGain;
  private layerGains: Record<NoiseLayerType, number> = {
    ...DEFAULT_SOUNDSCAPE_PRESET.layers,
  };
  private readonly activeSources: Array<{
    stop?: () => void;
    disconnect?: () => void;
  }> = [];

  constructor(ctx: AudioContextLike | null = null) {
    this.ctx = ctx;
  }

  public getState(): {
    isPlaying: boolean;
    isMuted: boolean;
    isTabHidden: boolean;
    masterGain: number;
    layers: Record<NoiseLayerType, number>;
  } {
    return {
      isPlaying: this.isPlaying,
      isMuted: this.isMuted,
      isTabHidden: this.isTabHidden,
      masterGain: this.masterGainValue,
      layers: { ...this.layerGains },
    };
  }

  public async start(): Promise<boolean> {
    if (this.isTabHidden) {
      this.isPlaying = false;
      return false;
    }

    if (this.ctx && typeof this.ctx.resume === "function") {
      await this.ctx.resume();
    }

    this.isPlaying = true;
    return true;
  }

  public async pause(): Promise<void> {
    this.isPlaying = false;
    if (this.ctx && typeof this.ctx.suspend === "function") {
      await this.ctx.suspend();
    }
  }

  public async setMuted(muted: boolean): Promise<void> {
    this.isMuted = Boolean(muted);
    if (this.isMuted && this.isPlaying) {
      await this.pause();
    }
  }

  public async handleVisibilityChange(hidden: boolean): Promise<void> {
    this.isTabHidden = Boolean(hidden);
    if (this.isTabHidden && this.isPlaying) {
      await this.pause();
    }
  }

  public setMasterGain(gain: number, rampSeconds = 0.08): number {
    this.masterGainValue = clampGain(gain);
    const now = this.ctx?.currentTime ?? 0;
    if (this.ctx && typeof this.ctx.createGain === "function") {
      const node = this.ctx.createGain();
      rampGainSmoothly(node.gain, this.masterGainValue, now, rampSeconds);
    }
    return this.masterGainValue;
  }

  public setLayerGain(
    layer: NoiseLayerType,
    gain: number,
    rampSeconds = 0.08,
  ): number {
    const clamped = clampGain(gain);
    this.layerGains[layer] = clamped;
    const now = this.ctx?.currentTime ?? 0;
    if (this.ctx && typeof this.ctx.createGain === "function") {
      const node = this.ctx.createGain();
      rampGainSmoothly(
        node.gain,
        clamped * this.masterGainValue,
        now,
        rampSeconds,
      );
    }
    return clamped;
  }

  public applyPreset(preset: SoundscapePreset): void {
    this.setMasterGain(preset.masterGain);
    this.setLayerGain("white", preset.layers.white);
    this.setLayerGain("pink", preset.layers.pink);
    this.setLayerGain("rain", preset.layers.rain);
  }

  public async dispose(): Promise<void> {
    this.isPlaying = false;
    for (const src of this.activeSources) {
      try {
        src.stop?.();
      } catch {
        // Ignore already stopped nodes
      }
      try {
        src.disconnect?.();
      } catch {
        // Ignore disconnect errors
      }
    }
    this.activeSources.length = 0;

    if (this.ctx && typeof this.ctx.close === "function") {
      await this.ctx.close();
    }
  }
}

export function getDefaultWorkerFactory(): () => Worker {
  return () => {
    return new Worker(
      new URL("../../workers/audioSynthesizerWorker.ts", "http://localhost"),
      { type: "module" },
    );
  };
}

export function getDefaultAudioContextFactory(): () => AudioContextLike {
  return () => {
    if (typeof window === "undefined") {
      throw new Error("AudioContext not available outside browser environment");
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Web Audio API not supported in this browser");
    }
    return new AudioCtx() as unknown as AudioContextLike;
  };
}

interface LayerGraph {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class NoiseSynthesizer {
  private ctx: AudioContextLike | null = null;
  private layers: Partial<Record<AmbientSoundType, LayerGraph>> = {};
  private masterGain: GainNode | null = null;
  private masterCutoffFilter: BiquadFilterNode | null = null;

  private soundType: AmbientSoundType;
  private volume: number;
  private cutoffFrequency: number;
  private layerLevels: LayerMixLevels;
  private muted: boolean;
  private isPlaying = false;
  private isTabHidden = false;
  private readonly bufferDurationSeconds: number;
  private readonly createContext: () => AudioContextLike;
  private readonly workerFactory?: () => Worker;
  private readonly useWorker: boolean;
  private worker: Worker | null = null;
  private listenersAttached = false;
  private onVisibilityChange: (() => void) | null = null;

  constructor(options: NoiseSynthesizerOptions = {}) {
    this.soundType = options.soundType ?? "pink";
    this.volume = clampVolume(options.volume ?? 0.5);
    this.cutoffFrequency = Math.max(
      200,
      Math.min(20000, options.cutoffFrequency ?? 12000),
    );
    this.layerLevels = normalizeLayerLevels(
      options.layerLevels,
      this.soundType,
    );
    this.muted = Boolean(options.muted);
    this.bufferDurationSeconds = Math.max(
      1,
      options.bufferDurationSeconds ?? 3,
    );
    this.createContext =
      options.audioContextFactory ?? getDefaultAudioContextFactory();
    this.workerFactory = options.workerFactory;
    this.useWorker = options.useWorker ?? true;
    this.attachLifecycleListeners();
  }

  private setParamSmooth(param: any, target: number, rampSeconds = 0.05): void {
    if (!param) return;
    const now = this.ctx?.currentTime ?? 0;
    if (typeof param.setTargetAtTime === "function") {
      param.setTargetAtTime(target, now, rampSeconds / 3);
    } else if (typeof param.linearRampToValueAtTime === "function") {
      param.linearRampToValueAtTime(target, now + rampSeconds);
    } else {
      param.value = target;
    }
  }

  private attachLifecycleListeners(): void {
    if (typeof document === "undefined" || this.listenersAttached) return;
    this.onVisibilityChange = () => {
      void this.handleVisibilityChange(document.hidden);
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.listenersAttached = true;
  }

  private detachLifecycleListeners(): void {
    if (typeof document === "undefined" || !this.listenersAttached) return;
    if (this.onVisibilityChange) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
    this.listenersAttached = false;
  }

  private applyGains(): void {
    if (this.masterGain?.gain) {
      const vol = this.muted ? 0 : clampVolume(this.volume);
      this.setParamSmooth(this.masterGain.gain, vol);
    }
    (["white", "pink", "brown", "rain"] as const).forEach((type) => {
      const layer = this.layers[type];
      if (!layer) return;
      const level = this.muted ? 0 : clampVolume(this.layerLevels[type]);
      this.setParamSmooth(layer.gain.gain, level);
    });
  }

  private applyCutoff(): void {
    if (this.masterCutoffFilter?.frequency) {
      this.setParamSmooth(
        this.masterCutoffFilter.frequency,
        this.cutoffFrequency,
      );
    }
    if (this.worker) {
      try {
        this.worker.postMessage({
          type: "SET_CUTOFF",
          cutoffFrequency: this.cutoffFrequency,
        });
      } catch {
        // Safe postMessage
      }
    }
  }

  private stopLayersOnly(): void {
    (["white", "pink", "brown", "rain"] as const).forEach((type) => {
      const layer = this.layers[type];
      if (!layer) return;
      try {
        layer.source.stop();
      } catch {
        // Already stopped
      }
      try {
        layer.source.disconnect();
        layer.filter.disconnect();
        layer.gain.disconnect();
      } catch {
        // Already disconnected
      }
      delete this.layers[type];
    });
  }

  private async createLayerBuffer(
    ctx: AudioContextLike,
    type: AmbientSoundType,
    frameCount: number,
    sampleRate: number,
  ): Promise<AudioBuffer> {
    const buffer = ctx.createBuffer!(2, frameCount, sampleRate);

    if (this.useWorker) {
      try {
        const workerData = await this.synthesizeWithWorker(
          type,
          frameCount,
          sampleRate,
        );
        if (workerData && workerData.length === 2) {
          for (let ch = 0; ch < 2; ch++) {
            const channelFloat = new Float32Array(workerData[ch]);
            if (typeof buffer.copyToChannel === "function") {
              buffer.copyToChannel(channelFloat, ch);
            } else if (typeof buffer.getChannelData === "function") {
              buffer.getChannelData(ch).set(channelFloat);
            }
          }
          return buffer;
        }
      } catch {
        // Fall back to main thread generator
      }
    }

    for (let ch = 0; ch < 2; ch++) {
      const samples = generateNoiseSamples(type, frameCount, sampleRate);
      if (typeof buffer.copyToChannel === "function") {
        buffer.copyToChannel(samples, ch);
      } else if (typeof buffer.getChannelData === "function") {
        buffer.getChannelData(ch).set(samples);
      }
    }

    return buffer;
  }

  private synthesizeWithWorker(
    noiseType: AmbientSoundType,
    frameCount: number,
    sampleRate: number,
  ): Promise<Float32Array[]> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        const factory = this.workerFactory ?? getDefaultWorkerFactory();
        this.worker = factory();
      }

      const workerInstance = this.worker;
      if (!workerInstance) {
        return reject(new Error("Worker unavailable"));
      }

      const onMessage = (e: MessageEvent) => {
        workerInstance.removeEventListener("message", onMessage);
        workerInstance.removeEventListener("error", onError);
        if (e.data?.error) {
          reject(new Error(e.data.error));
        } else if (e.data?.buffers) {
          resolve(e.data.buffers);
        } else {
          reject(new Error("Invalid worker response"));
        }
      };

      const onError = (err: ErrorEvent) => {
        workerInstance.removeEventListener("message", onMessage);
        workerInstance.removeEventListener("error", onError);
        reject(err);
      };

      workerInstance.addEventListener("message", onMessage);
      workerInstance.addEventListener("error", onError);

      workerInstance.postMessage({
        type: "SYNTHESIZE",
        noiseType,
        sampleRate,
        channels: 2,
        bufferSize: frameCount,
        cutoffFrequency: this.cutoffFrequency,
      });
    });
  }

  private async buildMixerGraph(ctx: AudioContextLike): Promise<void> {
    this.stopLayersOnly();

    const sampleRate = ctx.sampleRate || 44100;
    const frameCount = Math.floor(sampleRate * this.bufferDurationSeconds);

    const master = ctx.createGain!();
    const cutoffFilter = ctx.createBiquadFilter!();
    cutoffFilter.type = "lowpass";
    cutoffFilter.frequency.value = this.cutoffFrequency;

    master.connect(cutoffFilter);
    cutoffFilter.connect(ctx.destination!);
    this.masterGain = master;
    this.masterCutoffFilter = cutoffFilter;

    const layerTypes: AmbientSoundType[] = ["white", "pink", "brown", "rain"];

    await Promise.all(
      layerTypes.map(async (type) => {
        const buffer = await this.createLayerBuffer(
          ctx,
          type,
          frameCount,
          sampleRate,
        );

        const source = ctx.createBufferSource!();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter!();
        if (type === "rain") {
          filter.type = "lowpass";
          filter.frequency.value = 1100;
        } else if (type === "pink") {
          filter.type = "lowshelf";
          filter.frequency.value = 600;
        } else if (type === "brown") {
          filter.type = "lowpass";
          filter.frequency.value = 400;
        } else {
          filter.type = "allpass";
          filter.frequency.value = 1000;
        }

        const layerGain = ctx.createGain!();
        layerGain.gain.value = this.layerLevels[type];

        source.connect(filter);
        filter.connect(layerGain);
        layerGain.connect(master);
        source.start();

        this.layers[type] = {
          source,
          filter,
          gain: layerGain,
        };
      }),
    );

    this.applyGains();
    this.applyCutoff();
  }

  public async start(): Promise<boolean> {
    if (this.isTabHidden) {
      this.isPlaying = false;
      return false;
    }

    if (!this.ctx) {
      this.ctx = this.createContext();
    }

    if (this.ctx && typeof this.ctx.resume === "function") {
      await this.ctx.resume();
    }

    await this.buildMixerGraph(this.ctx);
    this.isPlaying = true;
    return true;
  }

  public async play(): Promise<boolean> {
    return this.start();
  }

  public async pause(): Promise<void> {
    this.isPlaying = false;
    if (this.ctx && typeof this.ctx.suspend === "function") {
      await this.ctx.suspend();
    }
  }

  public setSoundType(nextType: AmbientSoundType): void {
    this.soundType = nextType;
    this.layerLevels = {
      white: nextType === "white" ? Math.max(0.7, this.layerLevels.white) : 0,
      pink: nextType === "pink" ? Math.max(0.7, this.layerLevels.pink) : 0,
      brown: nextType === "brown" ? Math.max(0.7, this.layerLevels.brown) : 0,
      rain: nextType === "rain" ? Math.max(0.7, this.layerLevels.rain) : 0,
    };
    this.applyGains();
  }

  public async handleVisibilityChange(hidden: boolean): Promise<void> {
    this.isTabHidden = Boolean(hidden);
    if (this.isTabHidden && this.isPlaying) {
      await this.pause();
    }
  }

  public setMasterGain(gain: number, _rampSeconds = 0.08): number {
    this.volume = clampVolume(gain);
    this.applyGains();
    return this.volume;
  }

  public setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    this.applyGains();
  }

  public setLayerLevel(type: AmbientSoundType, level: number): void {
    this.layerLevels[type] = clampVolume(level);
    this.applyGains();
  }

  public setCutoffFrequency(nextCutoff: number): void {
    this.cutoffFrequency = Math.max(200, Math.min(20000, nextCutoff));
    this.applyCutoff();
  }

  public setMuted(nextMuted: boolean): void {
    this.muted = Boolean(nextMuted);
    if (this.muted && this.isPlaying) {
      void this.pause();
    } else {
      this.applyGains();
    }
  }

  public getState() {
    return {
      isPlaying: this.isPlaying,
      soundType: this.soundType,
      volume: this.volume,
      cutoffFrequency: this.cutoffFrequency,
      layerLevels: { ...this.layerLevels },
      muted: this.muted,
      activeLayerCount: Object.keys(this.layers).length,
      hasMasterGain: Boolean(this.masterGain),
      hasCutoffFilter: Boolean(this.masterCutoffFilter),
    };
  }

  public async dispose(): Promise<void> {
    await this.pause();
    this.detachLifecycleListeners();
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // Safe terminate
      }
      this.worker = null;
    }
    this.stopLayersOnly();
    if (
      this.masterCutoffFilter &&
      typeof this.masterCutoffFilter.disconnect === "function"
    ) {
      try {
        this.masterCutoffFilter.disconnect();
      } catch {
        // Already disconnected
      }
      this.masterCutoffFilter = null;
    }
    if (this.masterGain && typeof this.masterGain.disconnect === "function") {
      try {
        this.masterGain.disconnect();
      } catch {
        // Already disconnected
      }
      this.masterGain = null;
    }
    if (this.ctx && typeof this.ctx.close === "function") {
      await this.ctx.close();
    }
    this.ctx = null;
  }
}
