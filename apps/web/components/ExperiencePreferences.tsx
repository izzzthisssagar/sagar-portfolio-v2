'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { degradeQuality, type QualityLevel } from '@portfolio/three';

export type MotionPreference = 'auto' | 'reduced';
export type QualityPreference = 'auto' | Exclude<QualityLevel, 'poster'>;
interface Preferences {
  sound: boolean;
  motion: MotionPreference;
  quality: QualityPreference;
  systemReducedMotion: boolean;
  effectiveReducedMotion: boolean;
  effectiveQuality: QualityLevel;
  setSound(value: boolean): void;
  setMotion(value: MotionPreference): void;
  setQuality(value: QualityPreference): void;
  degrade(): void;
}
const STORAGE_KEY = 'portfolio-experience-preferences-v1';
const Context = createContext<Preferences | null>(null);

export function ExperiencePreferencesProvider({ children }: { children: React.ReactNode }) {
  const [sound, setSound] = useState(false);
  const [motion, setMotion] = useState<MotionPreference>('auto');
  const [quality, setQuality] = useState<QualityPreference>('auto');
  const [adaptiveQuality, setAdaptiveQuality] = useState<QualityLevel>('high');
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const value = JSON.parse(saved) as Pick<Preferences, 'sound' | 'motion' | 'quality'>;
        queueMicrotask(() => {
          setSound(Boolean(value.sound));
          setMotion(value.motion);
          setQuality(value.quality);
        });
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sound, motion, quality }));
  }, [sound, motion, quality]);
  const effectiveQuality = quality === 'auto' ? adaptiveQuality : quality;
  const degrade = useCallback(() => setAdaptiveQuality((level) => degradeQuality(level)), []);
  const value = useMemo(
    () => ({
      sound,
      motion,
      quality,
      systemReducedMotion,
      effectiveReducedMotion: motion === 'reduced' || (motion === 'auto' && systemReducedMotion),
      effectiveQuality,
      setSound,
      setMotion,
      setQuality,
      degrade,
    }),
    [sound, motion, quality, systemReducedMotion, effectiveQuality, degrade],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useExperiencePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('ExperiencePreferencesProvider is required');
  return value;
}
export { STORAGE_KEY };
