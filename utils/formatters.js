import { UNITS } from './constants.js';

export function formatTime(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatPace(paceSeconds, { showUnit = true } = {}) {
  if (!paceSeconds || paceSeconds <= 0) return `--:--${showUnit ? ' ' + UNITS.pace : ''}`;
  
  const mins = Math.floor(paceSeconds / 60);
  const secs = Math.floor(paceSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}${showUnit ? ' ' + UNITS.pace : ''}`;
}

export function formatDistance(meters, { showUnit = true } = {}) {
  if (!meters || meters < 0) return `--${showUnit ? ' ' + UNITS.distance : ''}`;
  
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)}k${showUnit ? '' : ''}`;
  }
  return `${Math.round(meters)}${showUnit ? ' ' + UNITS.distance : ''}`;
}

export function formatHR(bpm, { showUnit = true } = {}) {
  if (!bpm) return `--${showUnit ? ' ' + UNITS.hr : ''}`;
  return `${Math.round(bpm)}${showUnit ? ' ' + UNITS.hr : ''}`;
}

export function formatSPM(spm, { showUnit = true } = {}) {
  if (!spm) return `--${showUnit ? ' ' + UNITS.spm : ''}`;
  return `${Math.round(spm)}${showUnit ? ' ' + UNITS.spm : ''}`;
}

export function formatWatts(w, { showUnit = true } = {}) {
  if (!w) return `--${showUnit ? ' ' + UNITS.watts : ''}`;
  return `${Math.round(w)}${showUnit ? ' ' + UNITS.watts : ''}`;
}

export function formatCalories(cals, { showUnit = true } = {}) {
  if (!cals) return `--${showUnit ? ' ' + UNITS.calories : ''}`;
  return `${Math.round(cals)}${showUnit ? ' ' + UNITS.calories : ''}`;
}
