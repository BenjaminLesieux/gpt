import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type * as alphaTab from '@coderline/alphatab';
import type { LucideIcon } from 'lucide-react';
import {
  AudioWaveform,
  Drum,
  Guitar,
  KeyboardMusic,
  Mic,
  Music,
  Music2,
  Piano,
} from 'lucide-react';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function getInstrumentIcon(track: alphaTab.model.Track): LucideIcon {
  if (track.isPercussion) return Drum;

  const p = track.playbackInfo.program;
  if (p <= 7) return Piano;
  if (p <= 15) return Music;
  if (p <= 23) return KeyboardMusic;
  if (p <= 31) return Guitar;
  if (p <= 39) return Guitar;
  if (p <= 47) return Music2;
  if (p <= 55) return Mic;
  if (p <= 79) return Music;
  if (p <= 103) return AudioWaveform;
  if (p <= 119) return Drum;
  return Music;
}
