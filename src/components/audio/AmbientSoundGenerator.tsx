"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  DEFAULT_SOUNDSCAPE_PRESET,
  loadSoundscapePresets,
  NoiseSoundscapeEngine,
  NoiseSynthesizer,
  saveSoundscapePresets,
  clampVolume,
  normalizeLayerLevels,
  type AmbientSoundType,
  type LayerMixLevels,
  type NoiseLayerType,
  type SoundscapePreset,
  type StorageLike,
  type AudioContextLike,
} from "@/lib/audio/noiseSynthesizer";

export const AMBIENT_PRESET_STORAGE_KEY = "worksphere:ambient_soundscape:v1";

export interface SavedAmbientPreset {
  soundType: AmbientSoundType;
  volume: number;
  layerLevels: LayerMixLevels;
  cutoffFrequency?: number;
}

export interface AmbientSoundGeneratorProps {
  storage?: StorageLike | null;
  initialPresets?: SoundscapePreset[];
  audioContext?: AudioContextLike | null;
  audioContextFactory?: () => AudioContextLike | null;
  initialSound?: AmbientSoundType;
  initialVolume?: number;
  initialCutoff?: number;
  storageKey?: string;
  className?: string;
}

const SOUND_OPTIONS: { id: AmbientSoundType; label: string; hint: string }[] = [
  { id: "white", label: "White Noise", hint: "Balanced masking for chatter" },
  { id: "pink", label: "Pink Noise", hint: "Softer deep-focus warmth" },
  { id: "brown", label: "Brown Noise", hint: "Deep low-frequency rumble" },
  { id: "rain", label: "Rain Sound", hint: "Gentle steady rainfall" },
];

export function loadSavedAmbientPreset(
  fallbackSound: AmbientSoundType,
  fallbackVolume: number,
  storageKey = AMBIENT_PRESET_STORAGE_KEY,
): SavedAmbientPreset {
  const safeVol = clampVolume(fallbackVolume);
  const defaultLevels = normalizeLayerLevels(undefined, fallbackSound);

  if (typeof window === "undefined") {
    return {
      soundType: fallbackSound,
      volume: safeVol,
      layerLevels: defaultLevels,
      cutoffFrequency: 12000,
    };
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {
        soundType: fallbackSound,
        volume: safeVol,
        layerLevels: defaultLevels,
        cutoffFrequency: 12000,
      };
    }
    const parsed = JSON.parse(raw) as Partial<SavedAmbientPreset>;
    const soundType: AmbientSoundType =
      parsed.soundType === "white" ||
      parsed.soundType === "pink" ||
      parsed.soundType === "brown" ||
      parsed.soundType === "rain"
        ? parsed.soundType
        : fallbackSound;
    const volume = clampVolume(parsed.volume ?? safeVol);
    const layerLevels = normalizeLayerLevels(parsed.layerLevels, soundType);
    const cutoffFrequency =
      typeof parsed.cutoffFrequency === "number" &&
      Number.isFinite(parsed.cutoffFrequency)
        ? Math.max(200, Math.min(20000, parsed.cutoffFrequency))
        : 12000;
    return { soundType, volume, layerLevels, cutoffFrequency };
  } catch {
    return {
      soundType: fallbackSound,
      volume: safeVol,
      layerLevels: defaultLevels,
      cutoffFrequency: 12000,
    };
  }
}

export function saveAmbientPreset(
  preset: SavedAmbientPreset,
  storageKey = AMBIENT_PRESET_STORAGE_KEY,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preset));
  } catch {
    // Ignore storage quota or private-browsing errors
  }
}

export const AmbientSoundGenerator: React.FC<AmbientSoundGeneratorProps> = ({
  storage,
  initialPresets,
  audioContext,
  audioContextFactory,
  initialSound = "pink",
  initialVolume,
  initialCutoff = 12000,
  storageKey = AMBIENT_PRESET_STORAGE_KEY,
  className = "",
}) => {
  const presets = useMemo(
    () => initialPresets ?? loadSoundscapePresets(storage),
    [initialPresets, storage],
  );

  const activePreset = presets[0] ?? DEFAULT_SOUNDSCAPE_PRESET;

  const startingVolume =
    initialVolume !== undefined ? initialVolume : activePreset.masterGain;
  const [soundType, setSoundType] = useState<AmbientSoundType>(initialSound);
  const [masterGain, setMasterGain] = useState(startingVolume);
  const [cutoffFrequency, setCutoffFrequency] = useState(initialCutoff);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const [layers, setLayers] = useState<Record<AmbientSoundType, number>>({
    white: activePreset.layers?.white ?? 0.15,
    pink: activePreset.layers?.pink ?? 0.45,
    brown: 0.3,
    rain: activePreset.layers?.rain ?? 0.55,
  });

  const audioContextRef = useRef<AudioContextLike | null>(null);
  const engineRef = useRef<NoiseSoundscapeEngine | null>(null);
  const synthRef = useRef<NoiseSynthesizer | null>(null);

  if (!engineRef.current) {
    let ctx: AudioContextLike | null = null;
    if (audioContext !== undefined) {
      ctx = audioContext;
    } else if (audioContextFactory) {
      ctx = audioContextFactory();
    } else if (typeof window !== "undefined") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        try {
          ctx = new AudioCtx();
        } catch {
          ctx = null;
        }
      }
    }
    audioContextRef.current = ctx;
    engineRef.current = new NoiseSoundscapeEngine(ctx);
    engineRef.current.applyPreset(activePreset);
  }

  if (!synthRef.current) {
    synthRef.current = new NoiseSynthesizer({
      soundType,
      volume: masterGain,
      cutoffFrequency,
      layerLevels: layers,
      muted: isMuted,
      audioContextFactory: () => audioContextRef.current || ({} as any),
      useWorker: false,
    });
  }

  useEffect(() => {
    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        void engineRef.current?.handleVisibilityChange(true);
        void synthRef.current?.handleVisibilityChange(true);
        setIsPlaying(false);
      } else {
        void engineRef.current?.handleVisibilityChange(false);
        void synthRef.current?.handleVisibilityChange(false);
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      void engineRef.current?.dispose();
      void synthRef.current?.dispose();
    };
  }, []);

  const persistCurrent = (
    nextSound: AmbientSoundType,
    nextVol: number,
    nextLayers: LayerMixLevels,
    nextCutoff: number,
  ) => {
    saveAmbientPreset(
      {
        soundType: nextSound,
        volume: nextVol,
        layerLevels: nextLayers,
        cutoffFrequency: nextCutoff,
      },
      storageKey,
    );
  };

  const togglePlayback = async () => {
    const nextPlaying = !isPlaying;
    const ctx = audioContextRef.current;
    if (nextPlaying) {
      if (
        ctx &&
        typeof ctx.resume === "function" &&
        ctx.state === "suspended"
      ) {
        try {
          await ctx.resume();
        } catch {
          // Autoplay policy or user gesture required
        }
      }
      try {
        await engineRef.current?.start();
      } catch {
        // Safe start
      }
      try {
        await synthRef.current?.start();
      } catch {
        // Safe start
      }
      setIsPlaying(true);
    } else {
      try {
        await engineRef.current?.pause();
      } catch {
        // Safe pause
      }
      try {
        await synthRef.current?.pause();
      } catch {
        // Safe pause
      }
      setIsPlaying(false);
    }
  };

  const toggleMute = async () => {
    const nextMuted = !isMuted;
    if (nextMuted) {
      engineRef.current?.setMasterGain(0, 0.05);
      await engineRef.current?.setMuted(true);
      synthRef.current?.setMuted(true);
      setIsMuted(true);
    } else {
      await engineRef.current?.setMuted(false);
      engineRef.current?.setMasterGain(masterGain, 0.05);
      synthRef.current?.setMuted(false);
      setIsMuted(false);
    }
  };

  const handleMasterChange = (value: number) => {
    setMasterGain(value);
    if (!isMuted) {
      engineRef.current?.setMasterGain(value, 0.05);
      synthRef.current?.setVolume(value);
    }
    persistCurrent(soundType, value, layers, cutoffFrequency);
  };

  const handleCutoffChange = (nextCutoff: number) => {
    const clamped = Math.max(200, Math.min(20000, nextCutoff));
    setCutoffFrequency(clamped);
    synthRef.current?.setCutoffFrequency(clamped);
    persistCurrent(soundType, masterGain, layers, clamped);
  };

  const handleLayerChange = (layer: AmbientSoundType, rawValue: number) => {
    const val = rawValue > 1 ? rawValue / 100 : rawValue;
    const clamped = clampVolume(val);
    setLayers((prev) => {
      const updated = { ...prev, [layer]: clamped };
      persistCurrent(soundType, masterGain, updated, cutoffFrequency);
      return updated;
    });
    if (layer === "white" || layer === "pink" || layer === "rain") {
      engineRef.current?.setLayerGain(layer as NoiseLayerType, clamped, 0.05);
    }
    synthRef.current?.setLayerLevel(layer, clamped);
  };

  const handleSelectSound = (nextType: AmbientSoundType) => {
    setSoundType(nextType);
    synthRef.current?.setSoundType(nextType);
    persistCurrent(nextType, masterGain, layers, cutoffFrequency);
  };

  const handleSavePreset = () => {
    const customPreset: SoundscapePreset = {
      id: `custom-${Date.now()}`,
      name: "Custom Nomad Mix",
      masterGain,
      layers: {
        white: layers.white,
        pink: layers.pink,
        rain: layers.rain,
      },
    };
    saveSoundscapePresets([customPreset, ...presets], storage);
  };

  return (
    <section
      data-testid="ambient-sound-generator"
      aria-label="Ambient focus soundscape mixer"
      className={`space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Focus Soundscape Mixer
          </h3>
          <p data-testid="soundscape-status" className="text-xs text-slate-500">
            Status: {isMuted ? "Muted" : isPlaying ? "Playing" : "Paused"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="toggle-play-btn"
            onClick={() => void togglePlayback()}
            className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            data-testid="ambient-play-toggle-btn"
            onClick={() => void togglePlayback()}
            aria-hidden="true"
            className="sr-only"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            data-testid="toggle-mute-btn"
            onClick={() => void toggleMute()}
            aria-label={isMuted ? "Unmute sound" : "Mute sound"}
            aria-pressed={isMuted}
            title={
              isMuted ? "Unmute master soundscape" : "Mute master soundscape"
            }
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isMuted ? (
              <>
                <VolumeX
                  className="h-3.5 w-3.5 text-red-500"
                  aria-hidden="true"
                />
                <span>Unmute</span>
              </>
            ) : (
              <>
                <Volume2
                  className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400"
                  aria-hidden="true"
                />
                <span>Mute</span>
              </>
            )}
          </button>
          <button
            type="button"
            data-testid="save-preset-btn"
            onClick={handleSavePreset}
            className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            Save Preset
          </button>
        </div>
      </div>

      <div
        role="group"
        aria-label="Noise type"
        className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4"
      >
        {SOUND_OPTIONS.map((opt) => {
          const active = soundType === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              data-testid={`sound-option-${opt.id}`}
              onClick={() => handleSelectSound(opt.id)}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                active
                  ? "border-indigo-600 bg-indigo-50/80 text-indigo-950 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-100"
                  : "border-slate-200 bg-slate-50/50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300"
              }`}
            >
              <div className="text-xs font-semibold">{opt.label}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {opt.hint}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-2.5">
        <div className="flex items-center gap-3">
          <label
            htmlFor="ambient-volume-slider"
            className="w-20 text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            Master
          </label>
          <input
            id="ambient-volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={masterGain}
            data-testid="master-gain-slider"
            onChange={(e) => handleMasterChange(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </div>

        <div className="flex items-center gap-3">
          <label
            htmlFor="ambient-cutoff-slider"
            className="w-20 text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            Cutoff
          </label>
          <input
            id="ambient-cutoff-slider"
            type="range"
            min={200}
            max={20000}
            step={100}
            value={cutoffFrequency}
            data-testid="ambient-cutoff-slider"
            onChange={(e) => handleCutoffChange(Number(e.target.value))}
            className="h-2 w-full cursor-pointer accent-indigo-600"
          />
          <span
            data-testid="ambient-cutoff-value"
            className="w-10 text-right text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            {cutoffFrequency >= 1000
              ? `${(cutoffFrequency / 1000).toFixed(1)}k`
              : `${cutoffFrequency}`}
            Hz
          </span>
        </div>

        {(["white", "pink", "brown", "rain"] as const).map((layerKey) => (
          <div key={layerKey} className="flex items-center gap-3">
            <label
              htmlFor={`layer-slider-${layerKey}`}
              className="w-20 text-xs capitalize text-slate-500 dark:text-slate-400"
            >
              {layerKey}
            </label>
            <input
              id={`layer-slider-${layerKey}`}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={layers[layerKey]}
              data-testid={`layer-slider-${layerKey}`}
              onChange={(e) =>
                handleLayerChange(layerKey, Number(e.target.value))
              }
              className="mt-1 w-full"
            />
          </div>
        ))}
      </div>
    </section>
  );
};

export default AmbientSoundGenerator;
