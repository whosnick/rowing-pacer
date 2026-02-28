// utils/CoachingEngine.js - Minimal coaching system

import { renderTemplate } from './templateEngine.js';
import { speak, setTTSEnabled } from './tts.js';

// Simple templates - only 5 messages total
const TEMPLATES = {
  preIntervalTime: "Next interval in {timeLeft} seconds. {nextTargetSPM} SPM, Zone {nextTargetZone}.",
  preIntervalDistance: "Next interval in {intervalDistanceLeft} meters. {nextTargetSPM} SPM, Zone {nextTargetZone}.",
  zoneTooHigh: "Heart rate too high. Ease off. Target zone is {targetZone}.",
  zoneTooLow: "Heart rate too low. Increase effort. Target zone is {targetZone}.",
  zonePerfect: "Nice! You are in the correct heart rate zone."
};

class CoachingEngine {
  constructor() {
    this.enabled = true;
    this.currentMessage = null;
    this.lastIntervalIndex = -1;
    this.warnedIntervals = new Set();
    
    // Track last zone state to avoid repetition
    this.lastZoneState = null; // 'high', 'low', 'perfect'
    this.lastZoneCheck = 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    setTTSEnabled(enabled);
  }

  reset() {
    this.currentMessage = null;
    this.lastIntervalIndex = -1;
    this.warnedIntervals.clear();
    this.lastZoneState = null;
    this.lastZoneCheck = 0;
  }

  update(state, currentInterval, currentZone) {
    if (!this.enabled || state.workoutStatus !== 'active') {
      return;
    }

    const now = Date.now();
    const intervalChanged = state.currentIntervalIndex !== this.lastIntervalIndex;
    
    // Reset on interval change
    if (intervalChanged) {
      this.lastIntervalIndex = state.currentIntervalIndex;
      this.lastZoneState = null;
      this.warnedIntervals.delete(state.currentIntervalIndex);
    }

    // 1. Check for pre-interval warning (highest priority)
    const preIntervalMsg = this.checkPreIntervalWarning(state, currentInterval);
    if (preIntervalMsg) {
      this.setMessage(preIntervalMsg);
      return;
    }

    // 2. Check zone guidance (only every 5 seconds to avoid spam)
    if (now - this.lastZoneCheck > 5000 && currentZone && currentInterval?.zone) {
      const zoneMsg = this.checkZoneDeviation(currentInterval.zone, currentZone.zone);
      if (zoneMsg) {
        this.setMessage(zoneMsg);
      }
      this.lastZoneCheck = now;
    }
  }

  checkPreIntervalWarning(state, currentInterval) {
    if (!currentInterval) return null;
    
    const intervalKey = state.currentIntervalIndex;
    if (this.warnedIntervals.has(intervalKey)) return null;
    
    const nextInterval = state.workout?.intervals?.[intervalKey + 1];
    if (!nextInterval) return null;

    const context = {
      timeLeft: Math.round(currentInterval.val - (state.intervalCurrentProgress || 0)),
      intervalDistanceLeft: Math.round(currentInterval.val - (state.intervalDistanceProgress || state.intervalCurrentProgress || 0)),
      nextTargetSPM: nextInterval.spm,
      nextTargetZone: nextInterval.zone
    };

    // Time-based warning (10 seconds before)
    if (currentInterval.type === 'time') {
      const remaining = context.timeLeft;
      if (remaining <= 10 && remaining > 0) {
        this.warnedIntervals.add(intervalKey);
        return renderTemplate(TEMPLATES.preIntervalTime, context);
      }
    }
    
    // Distance-based warning (50 meters before)
    if (currentInterval.type === 'distance') {
      const remaining = context.intervalDistanceLeft;
      if (remaining <= 50 && remaining > 0) {
        this.warnedIntervals.add(intervalKey);
        return renderTemplate(TEMPLATES.preIntervalDistance, context);
      }
    }

    return null;
  }

  checkZoneDeviation(targetZone, currentZoneNum) {
    const diff = currentZoneNum - targetZone;
    let newState = null;
    let message = null;

    if (diff > 0) {
      newState = 'high';
      if (this.lastZoneState !== 'high') {
        message = renderTemplate(TEMPLATES.zoneTooHigh, { targetZone });
      }
    } else if (diff < 0) {
      newState = 'low';
      if (this.lastZoneState !== 'low') {
        message = renderTemplate(TEMPLATES.zoneTooLow, { targetZone });
      }
    } else {
      newState = 'perfect';
      if (this.lastZoneState !== 'perfect') {
        message = TEMPLATES.zonePerfect;
      }
    }

    this.lastZoneState = newState;
    return message;
  }

  setMessage(text) {
    this.currentMessage = text;
    if (this.enabled) {
      speak(text);
    }
  }

  getCurrentMessage() {
    return this.currentMessage;
  }
}

// Singleton
let engineInstance = null;

export function getCoachingEngine() {
  if (!engineInstance) {
    engineInstance = new CoachingEngine();
  }
  return engineInstance;
}

export function initCoaching() {
  return getCoachingEngine();
}

export function updateCoaching(state, currentInterval, currentZone) {
  getCoachingEngine().update(state, currentInterval, currentZone);
}

export function resetCoaching() {
  getCoachingEngine().reset();
}

export function setCoachingEnabled(enabled) {
  getCoachingEngine().setEnabled(enabled);
}

export function getCurrentMessage() {
  return getCoachingEngine().getCurrentMessage();
}

export { setTTSEnabled } from './tts.js';
