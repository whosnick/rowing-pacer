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

  const pace = data.currentPaceSec || 0;
  const watts = pace > 0 ? Math.round(2.8 / Math.pow(pace / 500, 3)) : 0;

  const stroke = {
    // --- Normalized stroke properties ---
    t: Math.round((data.elapsedTimeSec || 0) * 10), // Time in tenths of a second
    d: Math.round((data.distanceMeters || 0) * 10), // Distance in decimeters
    p: Math.round(pace * 10),                       // Pace in tenths of a second
    spm: Math.round(data.spm || 0),                 // Strokes per minute
    hr: (data.heartrate && data.heartrate < 255) ? data.heartrate : null,

    // --- Extended metrics for local PWA features ---
    drive_time: Math.round((data.driveTime || 0) * 1000),
    recovery_time: Math.round((data.recoveryTime || 0) * 1000),
    watts: watts,
    elapsed_time: Math.round((data.elapsedTimeSec || 0) * 10) 
  };

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