import { saveBleData } from './storage.js';

let buffer = [];
let currentWorkoutId = null;
let currentTemplateId = null;

/**
 * Initializes the buffer for a new workout session.
 * @param {string} workoutId 
 * @param {string|null} templateId 
 */
export function initBuffer(workoutId, templateId = null) {
  currentWorkoutId = workoutId;
  currentTemplateId = templateId;
  buffer = [];
  console.log(`[TelemetryBuffer] Initialized for workout: ${workoutId}`);
}

/**
 * Captures a single completed stroke and formats it for workout analysis compatibility.
 * This should be called whenever the rower telemetry emits a completed stroke.
 * @param {Object} data - The data payload from the FTMS telemetry service
 */
export function pushStroke(data) {
  if (!currentWorkoutId) return;

  const stroke = {
    t: data.t || 0,
    d: data.d || 0,
    p: data.p || 0,
    spm: data.spm || 0,
    hr: (data.hr && data.hr < 255) ? data.hr : null,
    watts: data.p > 0 ? Math.round(2.8 / Math.pow(data.p / 500, 3)) : 0,
    elapsed_time: data.t || 0
  };

  if (stroke.hr) {
    console.log('[TelemetryBuffer] Stroke saved with HR:', stroke.hr);
  }

  buffer.push(stroke);
}

/**
 * Saves the accumulated stroke data to IndexedDB as a single record.
 * @returns {Promise<Array>} The final array of stroke objects.
 */
export async function finalizeBuffer() {
  if (!currentWorkoutId) {
    console.warn("[TelemetryBuffer] No active workout ID to finalize.");
    return [];
  }

  if (buffer.length === 0) {
    console.warn("[TelemetryBuffer] Buffer is empty. Nothing to save.");
    return [];
  }

  try {
    // Save the entire array as a single block in IndexedDB for efficiency
    await saveBleData(currentWorkoutId, buffer);
    console.log(`[TelemetryBuffer] Saved ${buffer.length} strokes to storage.`);
    
    const finalData = [...buffer];
    
    // Reset state
    buffer = [];
    currentWorkoutId = null;
    currentTemplateId = null;
    
    return finalData;
  } catch (error) {
    console.error("[TelemetryBuffer] Error saving workout data:", error);
    return [];
  }
}