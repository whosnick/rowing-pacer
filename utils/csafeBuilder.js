// utils/csafeBuilder.js
// CSAFE Protocol Frame Builder & Workout Programmer for Concept2 PM5
//
// Reference: Concept2 PM CSAFE Communication Definition Rev 0.25
//
// Frame structure:   F1 [contents] [checksum] F2
// Byte stuffing:     F0→F3,00  F1→F3,01  F2→F3,02  F3→F3,03
//
// Proprietary wrapper:  0x76 (CSAFE_SETPMCFG_CMD)
// Followed by:          [byte_count of inner commands] [inner commands...]
//
// Duration identifier byte (used in WORKOUTDURATION and SPLITDURATION):
//   0x00 = Time     (unit: 0.01 sec,  4 bytes big-endian)
//   0x40 = Calories (unit: 1 cal,     4 bytes big-endian)
//   0x80 = Distance (unit: 1 metre,   4 bytes big-endian)
//
// C2 Proprietary Long Set Configuration Commands (inside 0x76 wrapper):
const CSAFE_PM_SET_WORKOUTTYPE        = 0x01;  // 1 byte:  workout type enum
const CSAFE_PM_SET_WORKOUTDURATION    = 0x03;  // 5 bytes: identifier + 4-byte value (big-endian)
const CSAFE_PM_SET_RESTDURATION       = 0x04;  // 2 bytes: seconds (big-endian, 1 sec LSB)
const CSAFE_PM_SET_SPLITDURATION      = 0x05;  // 5 bytes: same format as WORKOUTDURATION
const CSAFE_PM_SET_TARGETPACETIME     = 0x06;  // 4 bytes: pace seconds * 100, big-endian (0.01s units)
const CSAFE_PM_SET_TARGETAVGWATTS     = 0x15;  // 2 bytes: watts (big-endian) [NEW]
const CSAFE_PM_SET_INTERVALTYPE       = 0x17;  // 1 byte:  interval type enum
const CSAFE_PM_CONFIGURE_WORKOUT      = 0x14;  // 1 byte:  0x01 = enable
const CSAFE_PM_SET_SCREENSTATE        = 0x13;  // 2 bytes: screen type + screen value
const CSAFE_PM_WORKOUTINTERVALCOUNT   = 0x18;  // 1 byte:  interval index (0-based)
const CSAFE_PM_SET_DISPLAYUPDATERATE  = 0x19;  // 1 byte:  display update rate

// Workout Type enum (WORKOUTTYPE_*)
export const WORKOUT_TYPE = {
  JUSTROW_NOSPLITS:           0x00,
  JUSTROW_SPLITS:             0x01,
  FIXEDDIST_NOSPLITS:         0x02,
  FIXEDDIST_SPLITS:           0x03,
  FIXEDTIME_NOSPLITS:         0x04,
  FIXEDTIME_SPLITS:           0x05,
  FIXEDTIME_INTERVAL:         0x06,
  FIXEDDIST_INTERVAL:         0x07,
  VARIABLE_INTERVAL:          0x08,
  VARIABLE_UNDEFINEDREST:     0x09,
  FIXEDCALORIE_SPLITS:        0x0A,
  FIXEDWATTMINUTE_SPLITS:     0x0B,
  FIXEDCALS_INTERVAL:         0x0C,
};

// Interval Type enum (INTERVALTYPE_*)
export const INTERVAL_TYPE = {
  TIME:                       0x00,
  DIST:                       0x01,
  REST:                       0x02,
  TIME_RESTUNDEFINED:         0x03,
  DIST_RESTUNDEFINED:         0x04,
  RESTUNDEFINED:              0x05,
  CALORIE:                    0x06,
  CALORIE_RESTUNDEFINED:      0x07,
  WATTMINUTE:                 0x08,
  WATTMINUTE_RESTUNDEFINED:   0x09,
};

// Duration identifier bytes
const DUR_TIME     = 0x00;
const DUR_CALORIES = 0x40;
const DUR_DISTANCE = 0x80;

// Screen constants for SCREENSTATE command
const SCREENTYPE_WORKOUT      = 0x01;
const SCREENVALUE_PREPARETOROW = 0x01;

export const WORKOUT_STATE = {
  WAITTOBEGIN:                     0,
  WORKOUTROW:                      1,
  COUNTDOWNPAUSE:                  2,
  INTERVALREST:                    3,
  INTERVALWORKTIME:                4,
  INTERVALWORKDISTANCE:            5,
  INTERVALRESTENDTOWORKTIME:       6,
  INTERVALRESTENDTOWORKDISTANCE:   7,
  INTERVALWORKTIMETOREST:          8,
  INTERVALWORKDISTANCETOREST:      9,
  WORKOUTEND:                      10,
  TERMINATE:                       11,
  WORKOUTLOGGED:                   12,
  REARM:                           13,
};

// Rowing State enum
export const ROWING_STATE = {
  INACTIVE: 0,
  ACTIVE:   1,
};

// -------------------------------------------------------------------
// buildFrame(commandBytes[]) -> Uint8Array
// Wraps command bytes in a standard CSAFE frame with checksum
// and byte-stuffing.
// -------------------------------------------------------------------
export function buildFrame(commandBytes) {
  // 1. Compute raw checksum (XOR of all command bytes)
  let checksum = 0;
  for (const b of commandBytes) {
    checksum ^= b;
  }

  // 2. Stuff bytes (replace F0-F3 in content + checksum)
  const rawContent = [...commandBytes, checksum];
  const stuffed = [];
  for (const b of rawContent) {
    if (b === 0xF0 || b === 0xF1 || b === 0xF2 || b === 0xF3) {
      stuffed.push(0xF3);
      stuffed.push(b - 0xF0);
    } else {
      stuffed.push(b);
    }
  }

  // 3. Build full frame: F1 [stuffed content + stuffed checksum] F2
  return new Uint8Array([0xF1, ...stuffed, 0xF2]);
}

// -------------------------------------------------------------------
// buildWrapperFrame(innerCommands[]) -> Uint8Array
// Wraps inner proprietary commands in the 0x76 SETPMCFG wrapper
// -------------------------------------------------------------------
function buildWrapperFrame(innerCommands) {
  const inner = [...innerCommands];
  const byteCount = inner.length;
  if (byteCount > 115) {
    console.warn('[CSAFE] Warning: wrapper payload may exceed max frame size');
  }
  return buildFrame([0x76, byteCount, ...inner]);
}

// -------------------------------------------------------------------
// Helpers: encode a 4-byte big-endian duration value
// -------------------------------------------------------------------
function encode4(value) {
  return [
    (value >> 24) & 0xFF,
    (value >> 16) & 0xFF,
    (value >> 8)  & 0xFF,
     value        & 0xFF,
  ];
}

function encode2(value) {
  return [(value >> 8) & 0xFF, value & 0xFF];
}

// -------------------------------------------------------------------
// Interval duration command builder
// -------------------------------------------------------------------
function durationCommand(cmdId, type, value) {
  // type: 'time' (value in seconds), 'distance' (value in metres)
  let identifier, encoded;
  if (type === 'time') {
    identifier = DUR_TIME;
    encoded = encode4(Math.round(value * 100)); // 0.01s units
  } else if (type === 'distance') {
    identifier = DUR_DISTANCE;
    encoded = encode4(Math.round(value));       // 1m units
  } else if (type === 'calories') {
    identifier = DUR_CALORIES;
    encoded = encode4(Math.round(value));
  } else {
    throw new Error(`[CSAFE] Unknown duration type: ${type}`);
  }
  // Command: [cmdId, 5, identifier, B3, B2, B1, B0]
  return [cmdId, 5, identifier, ...encoded];
}

// -------------------------------------------------------------------
// buildJustRowFrame() – Free-row / no programmed workout
// -------------------------------------------------------------------
export function buildJustRowFrame() {
  const inner = [
    // SET_WORKOUTTYPE: JUSTROW_NOSPLITS
    CSAFE_PM_SET_WORKOUTTYPE, 1, WORKOUT_TYPE.JUSTROW_NOSPLITS,
    // CONFIGURE_WORKOUT: enable programming
    CSAFE_PM_CONFIGURE_WORKOUT, 1, 0x01,
    // SET_SCREENSTATE: PREPARETOROW screen
    CSAFE_PM_SET_SCREENSTATE, 2, SCREENTYPE_WORKOUT, SCREENVALUE_PREPARETOROW,
  ];
  return buildWrapperFrame(inner);
}

// -------------------------------------------------------------------
// buildFixedTimeFrame(durationSec, splitSec) – Single time-based workout
// -------------------------------------------------------------------
export function buildFixedTimeFrame(durationSec, splitSec = null) {
  const safeSplit = splitSec || (durationSec > 300 ? 300 : durationSec); // Default to 5 min or less
  const inner =[
    CSAFE_PM_SET_WORKOUTTYPE, 1, WORKOUT_TYPE.FIXEDTIME_SPLITS,
    ...durationCommand(CSAFE_PM_SET_WORKOUTDURATION, 'time', durationSec),
    ...durationCommand(CSAFE_PM_SET_SPLITDURATION, 'time', safeSplit),
    CSAFE_PM_CONFIGURE_WORKOUT, 1, 0x01,
    CSAFE_PM_SET_SCREENSTATE, 2, SCREENTYPE_WORKOUT, SCREENVALUE_PREPARETOROW,
  ];
  return buildWrapperFrame(inner);
}

// -------------------------------------------------------------------
// buildFixedDistFrame(distanceM, splitM) – Single distance-based workout
// -------------------------------------------------------------------
export function buildFixedDistFrame(distanceM, splitM = null) {
  const safeSplit = splitM || (distanceM > 500 ? 500 : distanceM); // Default to 500m or less
  const inner =[
    CSAFE_PM_SET_WORKOUTTYPE, 1, WORKOUT_TYPE.FIXEDDIST_SPLITS,
    ...durationCommand(CSAFE_PM_SET_WORKOUTDURATION, 'distance', distanceM),
    ...durationCommand(CSAFE_PM_SET_SPLITDURATION, 'distance', safeSplit),
    CSAFE_PM_CONFIGURE_WORKOUT, 1, 0x01,
    CSAFE_PM_SET_SCREENSTATE, 2, SCREENTYPE_WORKOUT, SCREENVALUE_PREPARETOROW,
  ];
  return buildWrapperFrame(inner);
}

// -------------------------------------------------------------------
// buildVariableIntervalFrame(intervals[]) -> Uint8Array[]
// Programs a variable interval workout on the PM5.
//
// Each interval object: {
//   type: 'time' | 'distance',
//   val:  seconds (time) | metres (distance),
//   restType: 'time' | undefined,
//   restVal:  seconds | 0 (if no rest),
//   targetPaceSec: seconds per 500m (optional),
// }
//
// Returns an ARRAY of frames (because large interval sets may need
// multiple BLE write calls; caller should send them sequentially).
//
// PM5 limit: 30 intervals (from spec)
// -------------------------------------------------------------------
export function buildVariableIntervalFrames(intervals) {
  if (!intervals || intervals.length === 0) return [buildJustRowFrame()];

  const capped = intervals.slice(0, 30);
  const hasUndefinedRest = capped.some(iv => iv.restType === 'undefined' || iv.restVal === undefined);
  const frames = [];

  for (let i = 0; i < capped.length; i++) {
    const iv = capped[i];
    const isLast = (i === capped.length - 1);
    const intervalType = iv.type === 'distance'
      ? (hasUndefinedRest ? INTERVAL_TYPE.DIST_RESTUNDEFINED : INTERVAL_TYPE.DIST)
      : (hasUndefinedRest ? INTERVAL_TYPE.TIME_RESTUNDEFINED : INTERVAL_TYPE.TIME);

    const restSec = (iv.restVal !== undefined && iv.restVal !== null) ? iv.restVal : 0;

    const inner = [
      CSAFE_PM_WORKOUTINTERVALCOUNT, 1, i,
    ];

    // Per spec: WORKOUTTYPE is always VARIABLE_INTERVAL in interval 0.
    // VARIABLE_UNDEFINEDREST is set AFTER the last CONFIGURE_WORKOUT (see isLast block below).
    if (i === 0) {
      inner.push(CSAFE_PM_SET_WORKOUTTYPE, 1, WORKOUT_TYPE.VARIABLE_INTERVAL);
    }

    inner.push(CSAFE_PM_SET_INTERVALTYPE, 1, intervalType);
    inner.push(...durationCommand(CSAFE_PM_SET_WORKOUTDURATION, iv.type, iv.val));
    inner.push(CSAFE_PM_SET_RESTDURATION, 2, ...encode2(Math.round(restSec)));

    if (iv.targetPaceSec && iv.targetPaceSec > 0) {
      const paceUnits = Math.round(iv.targetPaceSec * 100);
      inner.push(CSAFE_PM_SET_TARGETPACETIME, 4, ...encode4(paceUnits));
    } else if (iv.targetWatts && iv.targetWatts > 0) {
      inner.push(CSAFE_PM_SET_TARGETAVGWATTS, 2, ...encode2(Math.round(iv.targetWatts)));
    }

    // CONFIGURE_WORKOUT goes after every interval (matches spec v500m/1:00r example).
    inner.push(CSAFE_PM_CONFIGURE_WORKOUT, 1, 0x01);

    if (isLast) {
      if (hasUndefinedRest) {
        // Override workout type to VARIABLE_UNDEFINEDREST after the last CONFIGURE_WORKOUT,
        // then zero SPLITDURATION to prevent biathlon-mode penalty logic (per spec).
        inner.push(CSAFE_PM_SET_WORKOUTTYPE, 1, WORKOUT_TYPE.VARIABLE_UNDEFINEDREST);
        inner.push(...durationCommand(CSAFE_PM_SET_SPLITDURATION, 'distance', 0));
      }
      inner.push(CSAFE_PM_SET_SCREENSTATE, 2, SCREENTYPE_WORKOUT, SCREENVALUE_PREPARETOROW);
    }

    frames.push(buildWrapperFrame(inner));
  }

  return frames;
}

// -------------------------------------------------------------------
// buildTerminateFrame() – Send CSAFE terminate command
// Public CSAFE: SCREENVALUE_TERMINATE = 0x02;
// -------------------------------------------------------------------
export function buildTerminateFrame() {
  const CSAFE_PM_SET_SCREENSTATE = 0x13;
  const SCREENTYPE_WORKOUT = 0x01;
  const SCREENVALUE_TERMINATE = 0x02;
  
  const inner = [
    CSAFE_PM_SET_SCREENSTATE, 2, SCREENTYPE_WORKOUT, SCREENVALUE_TERMINATE
  ];
  
  // Wrap in 0x76 Proprietary Wrapper
  return buildWrapperFrame(inner);
}

// -------------------------------------------------------------------
// parseResponseFrame(bytes) -> { status, commands[] }
// Parses a CSAFE response frame from the PM5
// -------------------------------------------------------------------
export function parseResponseFrame(bytes) {
  if (!bytes || bytes.length < 3) return null;
  if (bytes[0] !== 0xF1) return null; // Must start with standard frame flag

  // Un-stuff bytes (find real content between F1 and F2)
  const unstuffed = [];
  let i = 1;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0xF2) break; // Stop flag
    if (b === 0xF3 && i + 1 < bytes.length) {
      unstuffed.push(0xF0 + bytes[i + 1]);
      i += 2;
    } else {
      unstuffed.push(b);
      i++;
    }
  }

  if (unstuffed.length < 2) return null;

  // Verify checksum (last byte XOR with rest should = 0)
  const checksum = unstuffed[unstuffed.length - 1];
  let xor = 0;
  for (let j = 0; j < unstuffed.length - 1; j++) xor ^= unstuffed[j];
  if (xor !== checksum) {
    console.warn('[CSAFE] Checksum mismatch in response frame');
  }

  const status = unstuffed[0];
  const stateMachineState = status & 0x0F;
  const prevFrameStatus   = (status & 0x30) >> 4;
  const frameToggle       = (status & 0x80) >> 7;

  return { status, stateMachineState, prevFrameStatus, frameToggle };
}

// -------------------------------------------------------------------
// App-level helper: convert app workout intervals → PM5 intervals
//
// App interval schema:
//   { type: 'time'|'distance', val: seconds|metres, phase: string, spm: number, zone: number }
//
// PM5 interval schema:
//   { type, val, restVal, targetPaceSec }
//
// Strategy:
//   - Group intervals into [work, rest?] pairs
//   - "work"   = any phase with isPM5Work: true (warmup, steady, push, power, recovery)
//   - "rest"   = phase === 'rest' immediately following a power interval (isPM5Work: false)
//   - Multiple consecutive rest intervals: summed
//   - targetPaceSec: not set (allow PM5 to use pace freely)
//
// Phase rules:
//   • warmup    → start only, isPM5Work: true
//   • steady    → mid-workout, isPM5Work: true
//   • push      → mid-workout, isPM5Work: true
//   • power     → sprint intervals, isPM5Work: true, always followed by 'rest'
//   • rest      → only after power, isPM5Work: false (PM5 rest period)
//   • recovery  → end only, isPM5Work: true (cooldown, meters count)
// -------------------------------------------------------------------

export function buildGetDragFactorCommand() {
  // 0x7E = Concept2 Proprietary GET wrapper
  // 1 = The byte count of the commands inside the wrapper
  // 0xC1 = The actual GET_DRAGFACTOR command
  return buildFrame([0x7E, 1, 0xC1]);
}

export function appWorkoutToPM5Intervals(appIntervals) {
  if (!appIntervals || appIntervals.length === 0) return [];

  const pm5Intervals = [];
  let i = 0;

  while (i < appIntervals.length) {
    const iv = appIntervals[i];
    const isRest = iv.phase === 'rest';

    if (!isRest) {
      // This is a work interval (warmup, steady, push, power, recovery)
      const workInterval = {
        type: iv.type,
        val:  iv.val,
        restVal: 0,
        // Map targets from App to PM5 format
        targetPaceSec: iv.targetPace, // Editor should save this in seconds (e.g. 120 for 2:00)
        targetWatts: iv.targetWatts
      };

      // Look ahead for rest intervals (phase === 'rest')
      let j = i + 1;
      let restSec = 0;
      while (j < appIntervals.length && appIntervals[j].phase === 'rest') {
        const rv = appIntervals[j];
        if (rv.type === 'time') {
          restSec += rv.val;
        } else if (rv.type === 'distance') {
          restSec += rv.val / 2.5;
        }
        j++;
      }

      workInterval.restVal = Math.round(restSec);
      pm5Intervals.push(workInterval);
      i = j;
    } else {
      // Skip standalone rest intervals (shouldn't happen with proper templates)
      i++;
    }
  }

  return pm5Intervals;
}