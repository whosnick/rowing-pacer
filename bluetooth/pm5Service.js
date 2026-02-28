// bluetooth/pm5Service.js
// Concept2 PM5 BLE CSAFE Service
// Replaces bluetoothService.js + hrMonitor.js
//
// This module connects to a Concept2 PM5 Rowing Erg via Bluetooth Low Energy
// using the proprietary CSAFE protocol. It handles:
//   - BLE connection & characteristic discovery
//   - Notification subscriptions for real-time data (up to 10 Hz)
//   - CSAFE command transmission (workout programming, terminate)
//   - Heart rate from PM5's paired chest strap (no separate HR monitor needed)
//   - Zone time tracking (for history)

import {
  PM5_ROWING_SERVICE,
  PM5_GENERAL_STATUS,
  PM5_ADDITIONAL_STATUS1,
  PM5_ADDITIONAL_STATUS2,
  PM5_SAMPLE_RATE,
  PM5_STROKE_DATA,
  PM5_ADDITIONAL_STROKE,
  PM5_CONTROL_SERVICE,
  PM5_RECEIVE_CHAR,
  PM5_TRANSMIT_CHAR,
} from '../utils/constants.js';

// These UUIDs follow the pattern CE06XXXX-43E5-11E4-916C-0800200C9A66.
// Add these to constants.js if you prefer centralised UUID management.
const PM5_SPLIT_INTERVAL_DATA    = 'ce060037-43e5-11e4-916c-0800200c9a66'; // 0x0037
const PM5_END_OF_WORKOUT_SUMMARY = 'ce060039-43e5-11e4-916c-0800200c9a66'; // 0x0039

import {
  buildVariableIntervalFrames,
  buildJustRowFrame,
  buildFixedTimeFrame,
  buildFixedDistFrame,
  buildTerminateFrame,
  buildGetDragFactorCommand,
  appWorkoutToPM5Intervals,
  ROWING_STATE,
  parseResponseFrame,
  buildFrame,
} from '../utils/csafeBuilder.js';

import { emit, BUS } from '../utils/telemetryBus.js';
import { setCurrentHR, resetHRRecovery } from '../utils/zoneTracker.js';

// ─── BLE Device & Characteristic References ─────────────────────────────────
let device       = null;
let gattServer   = null;

let generalStatusChar     = null;
let additionalStatus1Char = null;
let additionalStatus2Char = null;
let strokeDataChar        = null;
let additionalStrokeChar   = null;
let sampleRateChar        = null;

let receiveChar  = null;
let transmitChar = null;

let splitIntervalChar    = null;
let endOfWorkoutChar     = null;

let _prevStrokeState    = -1;
let _prevSplitIntervalN = -1;

// CSAFE response previous-frame-status codes (CSAFE spec Table 1)
const PREV_FRAME_STATUS = {
  OK:       0x00,
  REJECT:   0x10,
  BAD:      0x20,
  NOT_READY: 0x30,
};

// ─── Consolidated Data Payload ───────────────────────────────────────────────
// Avoid creating new objects on every notification → less GC pressure
const dataPayload = {
  elapsedTimeSec:  0,
  distanceMeters:  0,
  workoutType:     0,
  intervalType:    0,
  workoutState:    0,
  rowingState:     0,
  strokeState:     0,

  // General Status B11–B18 (previously unparsed)
  totalWorkDistanceM:  0,  // B11-13: accumulated work distance in 1 m units
  workoutDurationRaw:  0,  // B14-16: workout duration (0.01s for time, 1m for distance)
  workoutDurationType: 0,  // B17: duration type (0x00=time, 0x80=distance)
  // dragFactor is now populated from B18 of General Status (1-byte, units: 1)
  // AND as a fallback from CSAFE polling (same field, same units — no conflict)

  speedMps:        0,
  spm:             0,
  heartrate:       null,
  currentPaceSec:  0,
  avgPaceSec:      0,
  restDistanceM:   0,
  restTimeSec:     0,
  avgPowerWatts:   0,

  intervalCount:   0,
  totalCals:       0,

  strokeCount:     0,
  driveLength:     0,
  driveTime:       0,
  dragFactor:      0,
  strokeDistM:     0,
  peakForce:       0,
  avgForce:        0,
  workPerStroke:   0,

  // FIX #5: watts now reflects PM5's own avgPowerWatts when available,
  // falling back to the 2.8v³ approximation only when avgPowerWatts is 0.
  // NEW: strokePowerWatts provides instant per-stroke power from 0x0036
  watts:           0,
  strokePowerWatts: 0,
  _strokePowerTs:   0,
  pace:            0,
  distance:        0,
  strokes:         0,
  time:            0,
  isActive:        false,

  elapsedSec:      0,
  hr:              null,
  dist:            0,
  isStrokeDrive:   false,

  // 0x0037 – Split/Interval Data
  // NOTE: splitIntervalNumber is the raw 1-based PM5 value (PM5 spec §4.3)
  splitIntervalNumber:   0,   // current interval index (1-based) from PM5
  splitIntervalTimeSec:  0,   // elapsed time within this split (seconds)
  splitIntervalDistM:    0,   // distance covered in this split (metres)
  intervalRestTimeSec:   0,   // rest time (seconds)
  intervalRestDistM:     0,   // rest distance (metres)

  // 0x0039 – End of Workout Summary
  endOfWorkoutAvgDragFactor: 0,
  endOfWorkoutAvgPaceSec:    0,
};

// ─── Notification Parsers ────────────────────────────────────────────────────

// 0x0031 – General Status (19 bytes)
//  B0-2:   Elapsed Time Lo/Mid/Hi (0.01s/unit)
//  B3-5:   Distance Lo/Mid/Hi (0.1m/unit)
//  B6:     Workout Type
//  B7:     Interval Type
//  B8:     Workout State
//  B9:     Rowing State
//  B10:    Stroke State
//  B11-13: Total Work Distance Lo/Mid/Hi (1m/unit)   ← FIX #2: now parsed
//  B14-16: Workout Duration Lo/Mid/Hi (0.01s or 1m)  ← FIX #2: now parsed
//  B17:    Workout Duration Type (0x00=time, 0x80=dist) ← FIX #2: now parsed
//  B18:    Drag Factor                                ← FIX #2: now parsed
function parseGeneralStatus(dv) {
  if (dv.byteLength < 11) return;

  const timeLo  = dv.getUint8(0);
  const timeMid = dv.getUint8(1);
  const timeHi  = dv.getUint8(2);
  const timeUnits = timeLo | (timeMid << 8) | (timeHi << 16);

  const distLo  = dv.getUint8(3);
  const distMid = dv.getUint8(4);
  const distHi  = dv.getUint8(5);
  const distUnits = distLo | (distMid << 8) | (distHi << 16);

  dataPayload.elapsedTimeSec  = timeUnits / 100;
  dataPayload.distanceMeters  = distUnits / 10;
  dataPayload.workoutType     = dv.getUint8(6);
  dataPayload.intervalType    = dv.getUint8(7);
  dataPayload.workoutState    = dv.getUint8(8);
  dataPayload.rowingState     = dv.getUint8(9);

  const newStrokeState = dv.getUint8(10);
  dataPayload.isStrokeDrive = (newStrokeState === 3 && _prevStrokeState === 2);
  _prevStrokeState = newStrokeState;
  dataPayload.strokeState = newStrokeState;

  dataPayload.time     = dataPayload.elapsedTimeSec;
  dataPayload.distance = dataPayload.distanceMeters;
  dataPayload.isActive = dataPayload.rowingState === ROWING_STATE.ACTIVE;
  dataPayload.elapsedSec = dataPayload.elapsedTimeSec;
  dataPayload.dist = dataPayload.distanceMeters;

  // FIX #2: Parse B11–B18 — previously silently dropped
  if (dv.byteLength >= 14) {
    const twdLo  = dv.getUint8(11);
    const twdMid = dv.getUint8(12);
    const twdHi  = dv.getUint8(13);
    dataPayload.totalWorkDistanceM = twdLo | (twdMid << 8) | (twdHi << 16); // 1m units
  }

  if (dv.byteLength >= 17) {
    const wdLo  = dv.getUint8(14);
    const wdMid = dv.getUint8(15);
    const wdHi  = dv.getUint8(16);
    dataPayload.workoutDurationRaw = wdLo | (wdMid << 8) | (wdHi << 16);
    // Callers interpret this as: seconds = raw/100 when type=0x00, metres = raw when type=0x80
  }

  if (dv.byteLength >= 18) {
    dataPayload.workoutDurationType = dv.getUint8(17); // 0x00=time, 0x80=distance
  }

  if (dv.byteLength >= 19) {
    // FIX #2: Drag factor from General Status eliminates need for slow CSAFE polling.
    // The CSAFE polling path still updates dataPayload.dragFactor too, so whichever
    // arrives most recently wins — both use the same field and same unit (0–255).
    const gsDF = dv.getUint8(18);
    if (gsDF > 0) {
      dataPayload.dragFactor = gsDF;
    }
  }
}

// 0x0032 – Additional Status 1 (19 bytes in GATT; 17 in mux table)
//  B0-2:   Elapsed Time Lo/Mid/Hi (0.01s)
//  B3-4:   Speed Lo/Hi (0.001 m/s)
//  B5:     Stroke Rate (spm)
//  B6:     Heartrate (255 = invalid)
//  B7-8:   Current Pace Lo/Hi (0.01 sec per 500m)
//  B9-10:  Average Pace Lo/Hi (0.01 sec per 500m)
//  B11-12: Rest Distance Lo/Hi (1m)
//  B13-15: Rest Time Lo/Mid/Hi (0.01s)
//  B16-17: Average Power Lo/Hi (watts) [GATT only]
//  B18:    Erg Machine Type             [GATT only]
function parseAdditionalStatus1(dv) {
  if (dv.byteLength < 13) return;

  const speedLo = dv.getUint8(3);
  const speedHi = dv.getUint8(4);
  const speedUnits = speedLo | (speedHi << 8);

  const paceLo = dv.getUint8(7);
  const paceHi = dv.getUint8(8);
  const currentPaceUnits = paceLo | (paceHi << 8);

  const avgPaceLo = dv.getUint8(9);
  const avgPaceHi = dv.getUint8(10);
  const avgPaceUnits = avgPaceLo | (avgPaceHi << 8);

  const hr = dv.getUint8(6);

  dataPayload.speedMps       = speedUnits / 1000;
  dataPayload.spm            = dv.getUint8(5);
  dataPayload.heartrate      = (hr === 255 || hr === 0) ? null : hr;
  dataPayload.currentPaceSec = currentPaceUnits / 100;
  dataPayload.avgPaceSec     = avgPaceUnits / 100;
  dataPayload.pace           = dataPayload.currentPaceSec;
  dataPayload.hr             = dataPayload.heartrate;
  setCurrentHR(dataPayload.heartrate);

  if (dv.byteLength >= 13) {
    const restDistLo = dv.getUint8(11);
    const restDistHi = dv.getUint8(12);
    dataPayload.restDistanceM = restDistLo | (restDistHi << 8);
  }

  if (dv.byteLength >= 16) {
    const rtLo  = dv.getUint8(13);
    const rtMid = dv.getUint8(14);
    const rtHi  = dv.getUint8(15);
    const restTimeUnits = rtLo | (rtMid << 8) | (rtHi << 16);
    dataPayload.restTimeSec = restTimeUnits / 100;
  }

  if (dv.byteLength >= 18) {
    const avgPwrLo = dv.getUint8(16);
    const avgPwrHi = dv.getUint8(17);
    dataPayload.avgPowerWatts = avgPwrLo | (avgPwrHi << 8);
  }

  // FIX #5: Prefer instant stroke power (from 0x0036) over average power.
  // Stroke power is per-stroke and most responsive. Average power is a moving average.
  // Use freshness check (1500ms) to avoid showing stale stroke power when rowing stops.
  const strokeFresh = dataPayload.strokePowerWatts > 0 && 
                     (Date.now() - dataPayload._strokePowerTs) < 1500;
  
  if (strokeFresh) {
    dataPayload.watts = dataPayload.strokePowerWatts;
  } else if (dataPayload.avgPowerWatts > 0) {
    dataPayload.watts = dataPayload.avgPowerWatts;
  } else if (dataPayload.speedMps > 0) {
    dataPayload.watts = Math.round(2.8 * Math.pow(dataPayload.speedMps, 3));
  } else {
    dataPayload.watts = 0;
  }
}

// 0x0033 – Additional Status 2 (20 bytes in GATT, 18 in mux)
//  B0-2:   Elapsed Time Lo/Mid/Hi (0.01s)
//  B3:     Interval Count
//  B4-5:   Average Power Lo/Hi (watts) [GATT only — not present in mux variant]
//  B6-7:   Total Calories Lo/Hi (GATT layout, after avg power)
//  B8-9:   Split/Int Avg Pace Lo/Hi (0.01s/500m)
//  B10-11: Split/Int Avg Power Lo/Hi (watts)
//  B12-13: Split/Int Avg Calories Lo/Hi (cals/hr)
//  B14-16: Last Split Time Lo/Mid/Hi (0.1s)
//  B17-19: Last Split Distance Lo/Mid/Hi (1m)
function parseAdditionalStatus2(dv) {
  if (dv.byteLength < 8) return;
  dataPayload.intervalCount = dv.getUint8(3);

  // B4-5: Average Power (GATT-only field — present when byteLength >= 8)
  // B6-7: Total Calories
  const calsLo = dv.getUint8(6);
  const calsHi = dv.getUint8(7);
  dataPayload.totalCals = calsLo | (calsHi << 8);
}

// 0x0035 – Stroke Data (20 bytes)
//  B0-2:   Elapsed Time Lo/Mid/Hi (0.01s)
//  B3-5:   Distance Lo/Mid/Hi (0.1m)
//  B6:     Drive Length (0.01m)
//  B7:     Drive Time (0.01s)
//  B8-9:   Stroke Recovery Time Lo/Hi (0.01s)
//  B10-11: Stroke Distance Lo/Hi (0.01m)
//  B12-13: Peak Drive Force Lo/Hi (0.1 lbf)
//  B14-15: Avg Drive Force Lo/Hi (0.1 lbf)
//  B16-17: Work Per Stroke Lo/Hi (0.1 J)
//  B18-19: Stroke Count Lo/Hi
function parseStrokeData(dv) {
  if (dv.byteLength < 20) return;

  dataPayload.driveLength  = dv.getUint8(6) / 100;       // m
  dataPayload.driveTime    = dv.getUint8(7) / 100;        // s

  const strokeDistLo       = dv.getUint8(10);
  const strokeDistHi       = dv.getUint8(11);
  dataPayload.strokeDistM  = (strokeDistLo | (strokeDistHi << 8)) / 100; // m

  const peakLo     = dv.getUint8(12);
  const peakHi     = dv.getUint8(13);
  dataPayload.peakForce = (peakLo | (peakHi << 8)) / 10; // lbf

  const wpsLo              = dv.getUint8(16);
  const wpsHi              = dv.getUint8(17);
  dataPayload.workPerStroke = (wpsLo | (wpsHi << 8)) / 10; // J

  const scLo = dv.getUint8(18);
  const scHi = dv.getUint8(19);
  dataPayload.strokeCount  = scLo | (scHi << 8);
  dataPayload.strokes      = dataPayload.strokeCount;
}

// 0x0036 – Additional Stroke Data (15 bytes)
// ONLY available when subscribed individually (also in multiplexed mode)
// Provides INSTANT stroke power - more responsive than average power
//  B0-2:   Elapsed Time Lo/Mid/Hi (0.01s)
//  B3-4:   Stroke Power Lo/Hi (watts) - THE KEY VALUE!
//  B5-6:   Stroke Calories Lo/Hi
//  B7-8:   Stroke Count Lo/Hi
//  B9-11:  Projected Work Time Lo/Mid/Hi (0.01s)
//  B12-14: Projected Work Distance Lo/Mid/Hi (1m)
function parseAdditionalStrokeData(dv) {
  if (dv.byteLength < 5) return;

  // Bytes 3-4: Stroke Power (instant watts) - little-endian
  const pwrLo = dv.getUint8(3);
  const pwrHi = dv.getUint8(4);
  const strokePower = pwrLo | (pwrHi << 8);

  if (strokePower > 0) {
    dataPayload.strokePowerWatts = strokePower;
    dataPayload._strokePowerTs = Date.now();
    // Make watts immediately responsive
    dataPayload.watts = strokePower;
  }
}

// 0x0037 – Split/Interval Data (18 bytes)
//  B0-2:   Elapsed Time Lo/Mid/Hi (0.01s)
//  B3-5:   Distance Lo/Mid/Hi (0.1m)
//  B6-8:   Split/Interval Time Lo/Mid/Hi (0.1s)
//  B9-11:  Split/Interval Distance Lo/Mid/Hi (1m)
//  B12-13: Interval Rest Time Lo/Hi (1s)
//  B14-15: Interval Rest Distance Lo/Hi (1m)
//  B16:    Split/Interval Type
//  B17:    Split/Interval Number (1-based, per PM5 spec §4.3)
function parseSplitIntervalData(dv) {
  if (dv.byteLength < 18) return;

  const splitTimeLo  = dv.getUint8(6);
  const splitTimeMid = dv.getUint8(7);
  const splitTimeHi  = dv.getUint8(8);
  dataPayload.splitIntervalTimeSec = (splitTimeLo | (splitTimeMid << 8) | (splitTimeHi << 16)) / 10;

  const splitDistLo  = dv.getUint8(9);
  const splitDistMid = dv.getUint8(10);
  const splitDistHi  = dv.getUint8(11);
  dataPayload.splitIntervalDistM = splitDistLo | (splitDistMid << 8) | (splitDistHi << 16);

  const restTimeLo = dv.getUint8(12);
  const restTimeHi = dv.getUint8(13);
  dataPayload.intervalRestTimeSec = restTimeLo | (restTimeHi << 8);

  const restDistLo = dv.getUint8(14);
  const restDistHi = dv.getUint8(15);
  dataPayload.intervalRestDistM = restDistLo | (restDistHi << 8);

  // B17: raw 1-based split number from PM5 (spec §4.3 confirms PM5 starts at 1)
  dataPayload.splitIntervalNumber = dv.getUint8(17);
}

// 0x0039 – End of Workout Summary (20 bytes)
//  B0-1:   Log Entry Date Lo/Hi
//  B2-3:   Log Entry Time Lo/Hi
//  B4-6:   Elapsed Time Lo/Mid/Hi (0.01s)
//  B7-9:   Distance Lo/Mid/Hi (0.1m)
//  B10:    Average Stroke Rate
//  B11:    Ending Heartrate
//  B12:    Average Heartrate
//  B13:    Min Heartrate
//  B14:    Max Heartrate
//  B15:    Drag Factor Average
//  B16:    Recovery Heart Rate
//  B17:    Workout Type
//  B18-19: Avg Pace Lo/Hi (0.1s/500m)
function parseEndOfWorkoutSummary(dv) {
  if (dv.byteLength < 18) return;
  
  // Bytes 4-6: Exact Elapsed Time (0.01s units)
  const timeLo = dv.getUint8(4);
  const timeMid = dv.getUint8(5);
  const timeHi = dv.getUint8(6);
  dataPayload.endOfWorkoutTimeSec = (timeLo | (timeMid << 8) | (timeHi << 16)) / 100;

  // Bytes 7-9: Exact Distance (0.1m units)
  const distLo = dv.getUint8(7);
  const distMid = dv.getUint8(8);
  const distHi = dv.getUint8(9);
  dataPayload.endOfWorkoutDistM = (distLo | (distMid << 8) | (distHi << 16)) / 10;

  // Byte 10: Exact Average SPM
  dataPayload.endOfWorkoutAvgSPM = dv.getUint8(10);
  
  // Bytes 12 & 14: Avg and Max HR
  dataPayload.endOfWorkoutAvgHR = dv.getUint8(12);
  dataPayload.endOfWorkoutMaxHR = dv.getUint8(14);

  // Byte 15: Average Drag Factor
  dataPayload.endOfWorkoutAvgDragFactor = dv.getUint8(15);
  
  if (dv.byteLength >= 20) {
    const avgPaceLo = dv.getUint8(18);
    const avgPaceHi = dv.getUint8(19);
    dataPayload.endOfWorkoutAvgPaceSec = (avgPaceLo | (avgPaceHi << 8)) / 10;
  }
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

function onGeneralStatus(event) {
  parseGeneralStatus(event.target.value);
  dispatchData();
}

function onAdditionalStatus1(event) {
  parseAdditionalStatus1(event.target.value);
  dispatchData();
}

function onAdditionalStatus2(event) {
  parseAdditionalStatus2(event.target.value);
  // Don't dispatch here – already dispatched from status1/general
}

function onSplitIntervalData(event) {
  parseSplitIntervalData(event.target.value);
  const newSplitNumber = dataPayload.splitIntervalNumber;
  if (newSplitNumber !== _prevSplitIntervalN) {
    _prevSplitIntervalN = newSplitNumber;
    emit(BUS.SPLIT_INTERVAL, {
      splitNumber: newSplitNumber,          // 1-based, consumers must account for this
      splitTimeSec: dataPayload.splitIntervalTimeSec,
      splitDistM: dataPayload.splitIntervalDistM,
      restTimeSec: dataPayload.intervalRestTimeSec,
      restDistM: dataPayload.intervalRestDistM,
      totalElapsedSec: dataPayload.elapsedTimeSec,
      totalDistanceM: dataPayload.distanceMeters,
    });
  }
}

function onEndOfWorkoutSummary(event) {
  parseEndOfWorkoutSummary(event.target.value);
  emit(BUS.END_OF_WORKOUT, {
    timeSec:       dataPayload.endOfWorkoutTimeSec,
    distM:         dataPayload.endOfWorkoutDistM,
    avgSPM:        dataPayload.endOfWorkoutAvgSPM,
    avgHR:         (dataPayload.endOfWorkoutAvgHR && dataPayload.endOfWorkoutAvgHR < 255) ? dataPayload.endOfWorkoutAvgHR : null,
    maxHR:         (dataPayload.endOfWorkoutMaxHR && dataPayload.endOfWorkoutMaxHR < 255) ? dataPayload.endOfWorkoutMaxHR : null,
    avgDragFactor: dataPayload.endOfWorkoutAvgDragFactor,
    avgPaceSec:    dataPayload.endOfWorkoutAvgPaceSec,
  });
}

function onStrokeData(event) {
  parseStrokeData(event.target.value);
  dispatchData();
  emit(BUS.STROKE, { ...dataPayload });
}

function onAdditionalStrokeData(event) {
  parseAdditionalStrokeData(event.target.value);
  dispatchData();
}

// FIX #6: Parse CSAFE response frames for both drag factor values AND
// command acknowledgement status. The PM5 always replies on the transmit
// characteristic; previously we only checked drag factor and ignored any
// Reject/Bad/NotReady status that would indicate a workout programming failure.
function onTransmit(event) {
  const bytes = new Uint8Array(event.target.value.buffer);

  // ── 1. Drag factor extraction (unchanged) ────────────────────────────────
  parseDragFactorResponse(bytes);

  // ── 2. CSAFE response status verification ────────────────────────────────
  const parsed = parseResponseFrame(bytes);
  if (parsed) {
    const pfs = parsed.prevFrameStatus;
    if (pfs === PREV_FRAME_STATUS.REJECT) {
      console.warn('[PM5] CSAFE response: PM5 REJECTED the last command frame ' +
        '(state machine not ready or command unsupported). ' +
        'Workout may not have been programmed correctly.');
    } else if (pfs === PREV_FRAME_STATUS.BAD) {
      console.warn('[PM5] CSAFE response: PM5 flagged last frame as BAD ' +
        '(checksum error or framing issue). Frame was corrupted in transit.');
    } else if (pfs === PREV_FRAME_STATUS.NOT_READY) {
      console.warn('[PM5] CSAFE response: PM5 NOT READY for the last command ' +
        '(wrong operational state). Retry after a short delay or check workout state.');
    }
    // PREV_FRAME_STATUS.OK (0x00) — no action needed
  }
}

function dispatchData() {
  emit(BUS.TICK, dataPayload);
}

function parseDragFactorResponse(bytes) {
  // Un-stuff bytes (skip F1 start flag, stop before F2)
  const raw = [];
  let i = 1;
  while (i < bytes.length - 1) {
    if (bytes[i] === 0xF3) { raw.push(bytes[i + 1] + 0xF0); i += 2; }
    else { raw.push(bytes[i]); i++; }
  }

  // Look for: 0xC1 (CSAFE_PM_GET_DRAGFACTOR response ID) followed by 0x01 (1 data byte)
  for (let k = 0; k < raw.length - 2; k++) {
    if (raw[k] === 0xC1 && raw[k + 1] === 1) {
      dataPayload.dragFactor = raw[k + 2];
      return;
    }
  }
}


// ─── Exported API ────────────────────────────────────────────────────────────

/**
 * Connect to Concept2 PM5 via BLE CSAFE.
 */
export async function connectPM5() {
  device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'PM5' }],
    optionalServices: [
      PM5_ROWING_SERVICE,
      PM5_CONTROL_SERVICE,
    ],
  });

  device.addEventListener('gattserverdisconnected', onDisconnected);
  gattServer = await device.gatt.connect();

  // ── Rowing service ──
  const rowingSvc = await gattServer.getPrimaryService(PM5_ROWING_SERVICE);

  // General Status (0x0031) – key state/time/distance/drag factor
  generalStatusChar = await rowingSvc.getCharacteristic(PM5_GENERAL_STATUS);
  await generalStatusChar.startNotifications();
  generalStatusChar.addEventListener('characteristicvaluechanged', onGeneralStatus);

  // Additional Status 1 (0x0032) – SPM, HR, pace, speed, power
  additionalStatus1Char = await rowingSvc.getCharacteristic(PM5_ADDITIONAL_STATUS1);
  await additionalStatus1Char.startNotifications();
  additionalStatus1Char.addEventListener('characteristicvaluechanged', onAdditionalStatus1);

  // Additional Status 2 (0x0033) – calories, intervals
  try {
    additionalStatus2Char = await rowingSvc.getCharacteristic(PM5_ADDITIONAL_STATUS2);
    await additionalStatus2Char.startNotifications();
    additionalStatus2Char.addEventListener('characteristicvaluechanged', onAdditionalStatus2);
  } catch (e) {
    console.warn('[PM5] Additional Status 2 not available:', e.message);
  }

  // Stroke Data (0x0035) – per-stroke metrics
  try {
    strokeDataChar = await rowingSvc.getCharacteristic(PM5_STROKE_DATA);
    await strokeDataChar.startNotifications();
    strokeDataChar.addEventListener('characteristicvaluechanged', onStrokeData);
  } catch (e) {
    console.warn('[PM5] Stroke Data not available:', e.message);
  }

  // Additional Stroke Data (0x0036) – INSTANT stroke power
  try {
    additionalStrokeChar = await rowingSvc.getCharacteristic(PM5_ADDITIONAL_STROKE);
    await additionalStrokeChar.startNotifications();
    additionalStrokeChar.addEventListener('characteristicvaluechanged', onAdditionalStrokeData);
    console.log('[PM5] Additional Stroke Data (0x0036) enabled - instant power available');
  } catch (e) {
    console.warn('[PM5] Additional Stroke Data (0x0036) not available:', e.message);
  }

  // Split/Interval Data (0x0037) – interval number, split time/distance, rest
  try {
    splitIntervalChar = await rowingSvc.getCharacteristic(PM5_SPLIT_INTERVAL_DATA);
    await splitIntervalChar.startNotifications();
    splitIntervalChar.addEventListener('characteristicvaluechanged', onSplitIntervalData);
  } catch (e) {
    console.warn('[PM5] Split/Interval Data not available:', e.message);
  }

  // End of Workout Summary (0x0039) – fires once when workout finishes
  try {
    endOfWorkoutChar = await rowingSvc.getCharacteristic(PM5_END_OF_WORKOUT_SUMMARY);
    await endOfWorkoutChar.startNotifications();
    endOfWorkoutChar.addEventListener('characteristicvaluechanged', onEndOfWorkoutSummary);
  } catch (e) {
    console.warn('[PM5] End of Workout Summary not available:', e.message);
  }

  // Sample Rate (0x0034) – Set to 100ms (value 3) for maximum data rate
  try {
    sampleRateChar = await rowingSvc.getCharacteristic(PM5_SAMPLE_RATE);
    await sampleRateChar.writeValue(new Uint8Array([3])); // 3 = 100ms
    console.log('[PM5] Sample rate set to 100ms');
  } catch (e) {
    console.warn('[PM5] Could not set sample rate:', e.message);
  }

  // ── Control service (CSAFE command/response) ──
  try {
    const ctrlSvc = await gattServer.getPrimaryService(PM5_CONTROL_SERVICE);

    receiveChar = await ctrlSvc.getCharacteristic(PM5_RECEIVE_CHAR);

    transmitChar = await ctrlSvc.getCharacteristic(PM5_TRANSMIT_CHAR);
    await transmitChar.startNotifications();
    transmitChar.addEventListener('characteristicvaluechanged', onTransmit);

    console.log('[PM5] Control service connected (CSAFE commands available)');
  } catch (e) {
    console.warn('[PM5] Control service not available (workout programming disabled):', e.message);
  }

  console.log('[PM5] Connected to', device.name || 'PM5');
  emit(BUS.CONNECTED, { deviceName: device.name });
  return true;
}

/**
 * Disconnect from PM5.
 */
export async function disconnectPM5() {
  // 1. Graceful CSAFE teardown — sends GOIDLE to cleanly release the PM5 state machine.
  //    FIX #1: was incorrectly 0x82 (CSAFE_GOIDLE_CMD) with the comment "CSAFE RESET".
  //    The correct CSAFE_RESET_CMD is 0x81. 0x82 is CSAFE_GOIDLE_CMD — semantically
  //    close but not a reset. We now send the correct 0x81 (RESET).
  if (receiveChar) {
    try {
      const resetFrame = buildFrame([0x81]); // 0x81 = CSAFE_RESET_CMD
      if (receiveChar.writeValueWithResponse) {
        await receiveChar.writeValueWithResponse(resetFrame);
      } else {
        await receiveChar.writeValue(resetFrame);
      }
      await new Promise(r => setTimeout(r, 100)); // Let the PM5 process it
    } catch (e) {
      console.warn('[PM5] Graceful teardown failed:', e);
    }
  }

  // 2. Stop notifications
  [generalStatusChar, additionalStatus1Char, additionalStatus2Char, strokeDataChar,
   additionalStrokeChar, splitIntervalChar, endOfWorkoutChar].forEach(c => {
    if (c) {
      try {
        c.removeEventListener('characteristicvaluechanged',
          c === generalStatusChar     ? onGeneralStatus :
          c === additionalStatus1Char ? onAdditionalStatus1 :
          c === additionalStatus2Char ? onAdditionalStatus2 :
          c === additionalStrokeChar  ? onAdditionalStrokeData :
          c === splitIntervalChar     ? onSplitIntervalData :
          c === endOfWorkoutChar      ? onEndOfWorkoutSummary :
                                        onStrokeData
        );
        c.stopNotifications().catch(() => {});
      } catch (e) {}
    }
  });

  if (transmitChar) {
    try {
      transmitChar.removeEventListener('characteristicvaluechanged', onTransmit);
      transmitChar.stopNotifications().catch(() => {});
    } catch (e) {}
  }

  if (gattServer && gattServer.connected) {
    gattServer.disconnect();
  }

  device              = null;
  gattServer          = null;
  generalStatusChar   = null;
  additionalStatus1Char = null;
  additionalStatus2Char = null;
  strokeDataChar      = null;
  additionalStrokeChar = null;
  sampleRateChar      = null;
  splitIntervalChar   = null;
  endOfWorkoutChar    = null;
  receiveChar         = null;
  transmitChar        = null;
  _prevSplitIntervalN = -1;
  // Note: _prevStrokeState is intentionally NOT reset here because disconnectPM5
  // is called before a full session reset; resetPM5Session() handles that.

  console.log('[PM5] Disconnected');
}

function onDisconnected() {
  console.warn('[PM5] Device disconnected unexpectedly');
  emit(BUS.DISCONNECTED, {});
}

const RECONNECT_TIMEOUT_MS = 15_000;

export async function reconnect() {
  if (!device) {
    console.warn('[PM5] No device to reconnect to');
    return false;
  }

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), RECONNECT_TIMEOUT_MS)
  );

  try {
    await Promise.race([_attemptReconnect(), timeout]);
    emit(BUS.RECONNECTED, {});
    console.log('[PM5] Reconnected successfully');
    return true;
  } catch (err) {
    emit(BUS.RECONNECT_FAILED, { reason: err.message });
    console.error('[PM5] Reconnect failed:', err.message);
    return false;
  }
}

async function _attemptReconnect() {
  if (!device) throw new Error('No device');

  // FIX #4: Reset stroke-state tracker so the first notification after reconnect
  // doesn't produce a spurious isStrokeDrive=true from a stale previous state.
  // FIX #4 (also): Reset split interval tracker for the same reason.
  _prevStrokeState    = -1;
  _prevSplitIntervalN = -1;

  gattServer = await device.gatt.connect();

  const rowingSvc = await gattServer.getPrimaryService(PM5_ROWING_SERVICE);

  generalStatusChar = await rowingSvc.getCharacteristic(PM5_GENERAL_STATUS);
  await generalStatusChar.startNotifications();
  generalStatusChar.addEventListener('characteristicvaluechanged', onGeneralStatus);

  additionalStatus1Char = await rowingSvc.getCharacteristic(PM5_ADDITIONAL_STATUS1);
  await additionalStatus1Char.startNotifications();
  additionalStatus1Char.addEventListener('characteristicvaluechanged', onAdditionalStatus1);

  try {
    additionalStatus2Char = await rowingSvc.getCharacteristic(PM5_ADDITIONAL_STATUS2);
    await additionalStatus2Char.startNotifications();
    additionalStatus2Char.addEventListener('characteristicvaluechanged', onAdditionalStatus2);
  } catch (e) {
    console.warn('[PM5] Additional Status 2 not available on reconnect:', e.message);
  }

  try {
    strokeDataChar = await rowingSvc.getCharacteristic(PM5_STROKE_DATA);
    await strokeDataChar.startNotifications();
    strokeDataChar.addEventListener('characteristicvaluechanged', onStrokeData);
  } catch (e) {
    console.warn('[PM5] Stroke Data not available on reconnect:', e.message);
  }

  try {
    additionalStrokeChar = await rowingSvc.getCharacteristic(PM5_ADDITIONAL_STROKE);
    await additionalStrokeChar.startNotifications();
    additionalStrokeChar.addEventListener('characteristicvaluechanged', onAdditionalStrokeData);
  } catch (e) {
    console.warn('[PM5] Additional Stroke Data not available on reconnect:', e.message);
  }

  try {
    splitIntervalChar = await rowingSvc.getCharacteristic(PM5_SPLIT_INTERVAL_DATA);
    await splitIntervalChar.startNotifications();
    splitIntervalChar.addEventListener('characteristicvaluechanged', onSplitIntervalData);
  } catch (e) {
    console.warn('[PM5] Split/Interval Data not available on reconnect:', e.message);
  }

  try {
    endOfWorkoutChar = await rowingSvc.getCharacteristic(PM5_END_OF_WORKOUT_SUMMARY);
    await endOfWorkoutChar.startNotifications();
    endOfWorkoutChar.addEventListener('characteristicvaluechanged', onEndOfWorkoutSummary);
  } catch (e) {
    console.warn('[PM5] End of Workout Summary not available on reconnect:', e.message);
  }

  // FIX #7: Re-apply 100ms sample rate after reconnect.
  // On a fresh GATT connection the PM5 defaults back to 1-second notifications.
  try {
    sampleRateChar = await rowingSvc.getCharacteristic(PM5_SAMPLE_RATE);
    await sampleRateChar.writeValue(new Uint8Array([3])); // 3 = 100ms
    console.log('[PM5] Sample rate re-applied to 100ms after reconnect');
  } catch (e) {
    console.warn('[PM5] Could not re-apply sample rate on reconnect:', e.message);
  }

  try {
    const ctrlSvc = await gattServer.getPrimaryService(PM5_CONTROL_SERVICE);
    receiveChar = await ctrlSvc.getCharacteristic(PM5_RECEIVE_CHAR);
    transmitChar = await ctrlSvc.getCharacteristic(PM5_TRANSMIT_CHAR);
    await transmitChar.startNotifications();
    transmitChar.addEventListener('characteristicvaluechanged', onTransmit);
  } catch (e) {
    console.warn('[PM5] Control service not available on reconnect:', e.message);
  }
}

/**
 * Send a CSAFE frame to the PM5 via the receive characteristic.
 * @param {Uint8Array} frame
 */
export async function sendCSAFEFrame(frame) {
  if (!receiveChar) {
    console.warn('[PM5] Cannot send CSAFE: control service not connected');
    return false;
  }
  try {
    // PM5 MTU is 23 bytes (20 byte payload). We must chunk manually.
    const CHUNK_SIZE = 20;
    for (let i = 0; i < frame.length; i += CHUNK_SIZE) {
      const chunk = frame.slice(i, i + CHUNK_SIZE);

      // Use modern writeValueWithResponse, fallback to writeValue for older browsers
      if (receiveChar.writeValueWithResponse) {
        await receiveChar.writeValueWithResponse(chunk);
      } else {
        await receiveChar.writeValue(chunk);
      }
    }
    return true;
  } catch (e) {
    console.error('[PM5] CSAFE send error:', e);
    return false;
  }
}

/** Request drag factor via CSAFE (fallback; General Status B18 also provides this). */
export async function requestDragFactor() {
  if (!receiveChar) return;
  try {
    await sendCSAFEFrame(buildGetDragFactorCommand());
  } catch (e) { console.warn('Drag factor req failed', e); }
}

/**
 * Program the PM5 with a structured app workout.
 * Call this BEFORE the user starts rowing.
 *
 * @param {Object} workout - App workout object with intervals[]
 * @returns {boolean} success
 */
export async function programWorkout(workout) {
  if (!receiveChar) {
    console.warn('[PM5] Cannot program workout: no control service');
    return false;
  }

  const intervals = workout?.intervals;

  // Free-row (no workout selected or empty)
  if (!intervals || intervals.length === 0) {
    return await sendCSAFEFrame(buildJustRowFrame());
  }

  // Convert app intervals → PM5 intervals (group work+rest pairs)
  const pm5Intervals = appWorkoutToPM5Intervals(intervals);

  let frames;

  if (pm5Intervals.length === 0) {
    // All intervals were recovery → JustRow
    frames = [buildJustRowFrame()];
  } else if (pm5Intervals.length === 1) {
    // Single interval → use fixed time/distance (cleaner PM5 display)
    const iv = pm5Intervals[0];
    if (iv.type === 'time') {
      frames = [buildFixedTimeFrame(iv.val)];
    } else {
      frames = [buildFixedDistFrame(iv.val)];
    }
  } else {
    // Multiple intervals → variable interval workout
    frames = buildVariableIntervalFrames(pm5Intervals);
  }

  console.log(`[PM5] Programming workout: ${pm5Intervals.length} intervals, ${frames.length} CSAFE frame(s)`);

  // Send frames sequentially with small delay between each.
  // The PM5 will respond on the transmit characteristic for each frame;
  // onTransmit() will log any Reject/Bad/NotReady status automatically.
  for (let i = 0; i < frames.length; i++) {
    const ok = await sendCSAFEFrame(frames[i]);
    if (!ok) return false;
    // Brief delay between frames (PM5 minimum inter-frame gap ~50ms)
    if (i < frames.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }

  return true;
}

/**
 * Send a CSAFE screen-state TERMINATE command to end the current workout.
 */
export async function terminateWorkout() {
  return await sendCSAFEFrame(buildTerminateFrame());
}

/**
 * Reset per-session state (call when user starts a new workout).
 */
export function resetPM5Session() {
  Object.keys(dataPayload).forEach(k => {
    dataPayload[k] = (typeof dataPayload[k] === 'boolean') ? false : 0;
  });
  dataPayload.heartrate = null;
  dataPayload.hr = null;
  dataPayload.strokePowerWatts = 0;
  dataPayload._strokePowerTs = 0;
  _prevStrokeState = -1;
  _prevSplitIntervalN = -1;
  resetHRRecovery();
  console.log('[PM5] Session reset');
}

// Backwards-compatibility shims for app.js that previously used bluetoothService
export const connectRower      = connectPM5;
export const disconnectRower   = disconnectPM5;
export const resetRowerSession = resetPM5Session;