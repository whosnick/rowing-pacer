// utils/constants.js - Core configuration and workout templates
// FTMS-compatible constants for Merach rowers

// ─── FTMS BLE UUIDs (Merach-compatible) ─────────────────────────────────────
export const FTMS_SERVICE_UUID = '00001826-0000-1000-8000-00805f9b34fb';
export const ROWER_DATA_CHAR_UUID = '00002ad1-0000-1000-8000-00805f9b34fb';

// ─── HR Zone Configuration (Karvonen HRR) ────────────────────────────────────
// NOTE: HR data comes from FTMS rower telemetry when available.
// No separate HR monitor BLE connection is needed.

export const HR_ZONES = [
  { zone: 0, name: 'Resting',    colorVar: '--zone-0', minPct: 0,   maxPct: 50  },
  { zone: 1, name: 'Recovery',   colorVar: '--zone-1', minPct: 50,  maxPct: 60  },
  { zone: 2, name: 'Aerobic',    colorVar: '--zone-2', minPct: 60,  maxPct: 70  },
  { zone: 3, name: 'Controlled', colorVar: '--zone-3', minPct: 70,  maxPct: 80  },
  { zone: 4, name: 'Threshold',  colorVar: '--zone-4', minPct: 80,  maxPct: 90  },
  { zone: 5, name: 'Maximum',    colorVar: '--zone-5', minPct: 90,  maxPct: 100 },
  { zone: 6, name: 'Over Max',   colorVar: '--zone-6', minPct: 100, maxPct: 120 },
];

// Tanaka formula for HRmax estimation
export function calculateHRMax(age) {
  return Math.round(208 - (0.7 * age));
}

/**
 * Calculate HR zone boundaries using Karvonen (HRR) formula.
 * Target = RestHR + pct * (HRmax - RestHR)
 */
export function getHRZoneBoundaries(restHR, hrMax) {
  if (!restHR || !hrMax) return HR_ZONES.map(z => ({ ...z, min: 0, max: 0 }));

  const hrr  = hrMax - restHR;
  const minHR = Math.max(30, Math.round(restHR - (hrr * 0.20)));

  return HR_ZONES.map(zone => {
    let min, max;
    if (zone.zone === 0) {
      min = minHR;
      max = Math.round(restHR + hrr * (zone.maxPct / 100));
    } else if (zone.zone === 6) {
      min = hrMax;
      max = Math.round(restHR + hrr * (zone.maxPct / 100));
    } else {
      min = Math.round(restHR + hrr * (zone.minPct / 100));
      max = Math.round(restHR + hrr * (zone.maxPct / 100));
    }
    return { ...zone, min, max };
  });
}

/**
 * Get current HR zone for a measured heart rate.
 */
export function getCurrentHRZone(hr, restHR, hrMax) {
  if (!hr || !restHR || !hrMax) return null;
  const zones = getHRZoneBoundaries(restHR, hrMax);
  const zone0 = zones.find(z => z.zone === 0);
  const zone6 = zones.find(z => z.zone === 6);
  if (zone0 && hr <= zone0.max) return zone0;
  if (zone6 && hr > hrMax)      return zone6;
  return zones.find(z => hr >= z.min && hr <= z.max) || zones[1] || zones[0];
}

// ─── Default User Settings ────────────────────────────────────────────────────
export const DEFAULT_USER_SETTINGS = {
  age:           45,
  restHR:        60,
  hrMax:         null,  // Calculated from age if null
  enableAudio:   true,
  enableHaptics: true,
  enableCoaching: true,
};

// ─── Interval Phase Configuration ────────────────────────────────────────────
// Phase rules:
//   • warmup    → start only (spm:20, zone:1)
//   • steady    → mid-workout aerobic base (spm:22, zone:2)
//   • push      → mid-workout zone 3 blocks (spm:24, zone:3)
//   • power     → sprint intervals only (spm:26, zone:4), always followed by rest
//   • rest      → immediately after power only (spm:18, zone:1, isWorkInterval:false)
//   • recovery  → end only (spm:20, zone:1)
export const INTERVAL_PHASES = {
  warmup: {
    label:           'Warm Up',
    defaultGuidance: 'Gradually raise heart rate',
    colorVar:        '--phase-warmup',
    defaultSPM:      20,
    defaultZone:     1,
    isWorkInterval:       true,
  },

  steady: {
    label:           'Steady State',
    defaultGuidance: 'Find a sustainable rhythm',
    colorVar:        '--phase-steady',
    defaultSPM:      22,
    defaultZone:     2,
    isWorkInterval:       true,
  },

  push: {
    label:           'Push',
    defaultGuidance: 'Drive hard with legs',
    colorVar:        '--phase-push',
    defaultSPM:      24,
    defaultZone:     3,
    isWorkInterval:       true,
  },

  power: {
    label:           'Power / Sprint',
    defaultGuidance: 'Maximum effort',
    colorVar:        '--phase-power',
    defaultSPM:      26,
    defaultZone:     4,
    isWorkInterval:       true,
  },

  recovery: {
    label:           'Active Recovery',
    defaultGuidance: 'Ease off, keep the wheel turning',
    colorVar:        '--phase-recovery',
    defaultSPM:      20,
    defaultZone:     1,
    isWorkInterval:       true,
  },

  rest: {
    label:           'Rest',
    defaultGuidance: 'Paddle lightly, breathe',
    colorVar:        '--phase-rest',
    defaultSPM:      18,
    defaultZone:     1,
    isWorkInterval:       false,
  },
};

// ─── Input Constraints for Editor ────────────────────────────────────────────
// rower limits (from spec Table 19):
//   Max time:      9:59:59.99 → effectively unlimited for our use
//   Max distance:  200,000m
//   Max intervals: 30
export const INPUT_CONSTRAINTS = {
  time: {
    step:           30,
    min:            30,
    max:            3600,
    displayUnit:    'min',
    convertForDisplay: (val) => val / 60,
    convertForSave:    (val) => val * 60,
  },
  distance: {
    step:  100,
    min:   100,
    max:   10000,
    displayUnit: 'm',
  },
  spm: {
    min:  16,
    max:  36,
    step: 1,
  },
  zone: {
    min: 0,
    max: 6,
  },
};

// ─── Helper: Generate workout description ─────────────────────────────────────
export function generateWorkoutDescription(workout) {
  const count = workout.intervals.length;
  let totalSeconds = 0;
  workout.intervals.forEach(i => {
    if (i.type === 'time') {
      totalSeconds += i.val;
    } else {
      totalSeconds += i.val / 2.5;
    }
  });
  const minutes = Math.round(totalSeconds / 60);
  const hasPower = workout.intervals.some(i => i.phase === 'power');
  const hasPush  = workout.intervals.some(i => i.phase === 'push');
  const type = hasPower ? 'High Intensity' : hasPush ? 'Interval Training' : 'Endurance';
  return `${minutes} min • ${count} Segments • ${type}`;
}

// ─── Workout Templates (rower-compatible) ───────────────────────────────────────
//
// Schema: intervals[] where each interval is:
//   { type: 'time'|'distance', val: seconds|metres, phase: string, spm: number, zone: number }
//
// Phase rules enforced in all templates:
//   • warmup    → start only (spm:20, zone:1)
//   • steady    → mid-workout aerobic base (spm:22, zone:2)
//   • push      → mid-workout zone 3 blocks (spm:24, zone:3)
//   • power     → sprint intervals only (spm:26, zone:4), always followed by rest
//   • rest      → immediately after power only (spm:18, zone:1, isWorkInterval:false)
//   • recovery  → end only (spm:20, zone:1)
//
// No mid-workout recovery phases — active rest between work blocks is just
// steady at zone 2, which keeps meters counting continuously on the rower.
//
export const WORKOUT_TEMPLATES = {

  // ── Free Row ───────────────────────────────────────────────────────────────
  justRow: {
    id:      'just-row',
    name:    'JustRow — Free Row',
    created: Date.now(),
    machineType: 'justRow',
    intervals: [],
  },

  // ── The Commute ─────────────────────────────────────────────────────────────
  // 20 min | Zone 2 throughout | For short days or first weeks of training.
  // The evidence is clear: even 20 continuous minutes of zone 2 aerobic work,
  // done consistently 3×/week, produces measurable resting BP reduction in
  // previously sedentary individuals within 6-8 weeks. No tricks needed.
  //
  //  3min warmup  +  14min steady  +  3min recovery  =  20min
  //
  theCommute: {
    id:      'the-commute',
    name:    'The Commute — 20min',
    created: Date.now(),
    intervals: [
      { type: 'time', val: 120, phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 60,  phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 840, phase: 'steady',   spm: 22, zone: 2 },
      { type: 'time', val: 120, phase: 'recovery', spm: 20, zone: 1 },
      { type: 'time', val: 60,  phase: 'recovery', spm: 20, zone: 1 },
    ],
  },

  // ── Parasympathetic Reset ───────────────────────────────────────────────────
  // 25 min | Mostly zone 2, small zone 3 finish | After stressful workdays.
  // Sustained moderate aerobic work elevates vagal tone and reduces circulating
  // cortisol — both direct contributors to elevated resting BP. The 3-minute
  // push finish at zone 3 is enough to drive cardiac adaptation without a
  // meaningful acute pressure spike. If HR drifts above zone 3 during the
  // push, lower SPM to 22 and revisit in two weeks.
  //
  //  3min warmup  +  14min steady  +  3min push  +  5min recovery  =  25min
  //
  parasympatheticReset: {
    id:      'parasympathetic-reset',
    name:    'Parasympathetic Reset — 25min',
    created: Date.now(),
    intervals: [
      { type: 'time', val: 120, phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 60,  phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 840, phase: 'steady',   spm: 22, zone: 2 },
      { type: 'time', val: 180, phase: 'push',     spm: 24, zone: 3 },
      { type: 'time', val: 180, phase: 'recovery', spm: 20, zone: 1 },
      { type: 'time', val: 120, phase: 'recovery', spm: 20, zone: 1 },
    ],
  },

  // ── Blood Pressure Club ─────────────────────────────────────────────────────
  // 30 min | Pure zone 2 | The core session. Row this 3×/week.
  // Thirty continuous minutes of zone 2 is the clinical sweet spot for
  // cardiovascular adaptation in sedentary individuals. Boring on purpose —
  // the adaptation happens in the 48 hours after the session, not during it.
  // Don't be tempted to push harder. Staying in zone 2 is the whole point.
  //
  //  5min warmup  +  20min steady  +  5min recovery  =  30min
  //
  bloodPressureClub: {
    id:      'blood-pressure-club',
    name:    'Blood Pressure Club — 30min',
    created: Date.now(),
    intervals: [
      { type: 'time', val: 180,  phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 120,  phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 1200, phase: 'steady',   spm: 22, zone: 2 },
      { type: 'time', val: 180,  phase: 'recovery', spm: 20, zone: 1 },
      { type: 'time', val: 120,  phase: 'recovery', spm: 20, zone: 1 },
    ],
  },

  // ── Gentle Climb ───────────────────────────────────────────────────────────
  // ~30 min | Distance pyramid | Zone 2 base, zone 3 at the peak.
  // 200 / 400 / 600 / 400 / 200m — 1800m total work distance.
  // No mid-workout rest: all intervals are work (isWorkInterval:true), so every
  // meter counts continuously. The ascending distances teach even pacing —
  // the instinct is always to go out too hard. The 600m peak briefly enters
  // zone 3. If HR hits zone 4 on the 600m piece, drop SPM to 22.
  //
  //  5min warmup  +  ~22min distance work  +  5min recovery  ≈  32min
  //
  gentleClimb: {
    id:      'gentle-climb',
    name:    'Gentle Climb — 200/400/600/400/200m',
    created: Date.now(),
    intervals: [
      { type: 'time',     val: 180, phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time',     val: 120, phase: 'warmup',   spm: 20, zone: 1 },

      { type: 'distance', val: 200, phase: 'steady',   spm: 22, zone: 2 },
      { type: 'distance', val: 400, phase: 'steady',   spm: 22, zone: 2 },
      { type: 'distance', val: 600, phase: 'push',     spm: 24, zone: 3 },
      { type: 'distance', val: 400, phase: 'steady',   spm: 22, zone: 2 },
      { type: 'distance', val: 200, phase: 'steady',   spm: 22, zone: 2 },

      { type: 'time',     val: 180, phase: 'recovery', spm: 20, zone: 1 },
      { type: 'time',     val: 120, phase: 'recovery', spm: 20, zone: 1 },
    ],
  },

  // ── The Threshold ──────────────────────────────────────────────────────────
  // 35 min | Zone 2 base → sustained zone 3 finish | Weeks 4-8.
  // A 15-minute zone 2 base followed by a sustained 10-minute zone 3 block.
  // This is the session to introduce once you can complete Blood Pressure Club
  // comfortably without HR drifting above zone 2. The zone 3 block drives
  // threshold adaptations — increased stroke volume, improved lactate clearance
  // — without producing the acute BP spikes of zone 4-5 work.
  //
  //  5min warmup  +  15min steady  +  10min push  +  5min recovery  =  35min
  //
  theThreshold: {
    id:      'the-threshold',
    name:    'The Threshold — 35min',
    created: Date.now(),
    intervals: [
      { type: 'time', val: 180, phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 120, phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 900, phase: 'steady',   spm: 22, zone: 2 },
      { type: 'time', val: 600, phase: 'push',     spm: 24, zone: 3 },
      { type: 'time', val: 180, phase: 'recovery', spm: 20, zone: 1 },
      { type: 'time', val: 120, phase: 'recovery', spm: 20, zone: 1 },
    ],
  },

  // ── The Desk Antidote ──────────────────────────────────────────────────────
  // 40 min | Long zone 2 with zone 3 finish | The weekly long session.
  // Mitochondrial biogenesis accelerates meaningfully past 30 minutes of zone 2.
  // The 5-minute push finish is a cardiac stimulus — it briefly elevates output
  // then the recovery period trains the parasympathetic rebound. Build toward
  // this session in week 6-8 once the 30min sessions feel manageable.
  //
  //  5min warmup  +  25min steady  +  5min push  +  5min recovery  =  40min
  //
  theDeskAntidote: {
    id:      'the-desk-antidote',
    name:    'The Desk Antidote — 40min',
    created: Date.now(),
    intervals: [
      { type: 'time', val: 180,  phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 120,  phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 1500, phase: 'steady',   spm: 22, zone: 2 },
      { type: 'time', val: 300,  phase: 'push',     spm: 24, zone: 3 },
      { type: 'time', val: 180,  phase: 'recovery', spm: 20, zone: 1 },
      { type: 'time', val: 120,  phase: 'recovery', spm: 20, zone: 1 },
    ],
  },

  // ── Six Shooter ────────────────────────────────────────────────────────────
  // 20 min | 6 × 1min power / 1min rest | Sprint example.
  // The only template using 'rest' (isWorkInterval:false). Rest follows power
  // exclusively — this is the design rule. During each 1-minute rest the rower
  // enters its rest period and broadcasts restDistanceM in real time over BLE
  // (Additional Status 1, bytes 11-12). The app should display this as a live
  // "rest meters" counter so no effort feels invisible.
  //
  // Note: do not attempt this workout until you have 6+ weeks of consistent
  // zone 2 base. Acute systolic BP during 1-minute power pieces is high.
  //
  //  3min warmup  +  6×(1min power + 1min rest)  +  5min recovery  =  20min
  //
  sixShooter: {
    id:      'six-shooter',
    name:    'Six Shooter — 6×1min Sprints',
    created: Date.now(),
    intervals: [
      { type: 'time', val: 120, phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'time', val: 60,  phase: 'warmup',   spm: 20, zone: 1 },

      { type: 'time', val: 60,  phase: 'power',    spm: 26, zone: 4 },
      { type: 'time', val: 60,  phase: 'rest',     spm: 18, zone: 1 },
      { type: 'time', val: 60,  phase: 'power',    spm: 26, zone: 4 },
      { type: 'time', val: 60,  phase: 'rest',     spm: 18, zone: 1 },
      { type: 'time', val: 60,  phase: 'power',    spm: 26, zone: 4 },
      { type: 'time', val: 60,  phase: 'rest',     spm: 18, zone: 1 },
      { type: 'time', val: 60,  phase: 'power',    spm: 26, zone: 4 },
      { type: 'time', val: 60,  phase: 'rest',     spm: 18, zone: 1 },
      { type: 'time', val: 60,  phase: 'power',    spm: 26, zone: 4 },
      { type: 'time', val: 60,  phase: 'rest',     spm: 18, zone: 1 },
      { type: 'time', val: 60,  phase: 'power',    spm: 26, zone: 4 },
      { type: 'time', val: 60,  phase: 'rest',     spm: 18, zone: 1 },

      { type: 'time', val: 180, phase: 'recovery', spm: 20, zone: 1 },
      { type: 'time', val: 120, phase: 'recovery', spm: 20, zone: 1 },
    ],
  },
  debug: {
    id:      'debug',
    name:    'Quick for debug using rower simulator',
    created: Date.now(),
    intervals: [
      { type: 'time', val: 30, phase: 'warmup',   spm: 20, zone: 1 },
      { type: 'distance', val: 100, phase: 'warmup',   spm: 20, zone: 2 },
    ],
  },
};
