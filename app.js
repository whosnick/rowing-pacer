// app.js - Main application controller

import {
  DEFAULT_USER_SETTINGS,
  calculateHRMax,
  WORKOUT_TEMPLATES,
  getCurrentHRZone
} from './utils/constants.js';

import {
  connectRower,
  disconnectRower,
  resetRowerSession,
  reconnect
} from './bluetooth/ftmsService.js';
import { on, BUS } from './utils/telemetryBus.js';
import { WorkoutFSM, WS, WE } from './utils/WorkoutFSM.js';
import { initBuffer, pushStroke, finalizeBuffer } from './utils/telemetryBuffer.js';
import { updateZoneTime, getZoneDistribution, resetZoneTracking } from './utils/zoneTracker.js';

import { renderWorkoutView, updateWorkoutView, cleanupWorkoutView, renderReconnectOverlay, removeReconnectOverlay } from './components/WorkoutView.js';
import renderHome from './components/HomeView.js';
import renderProgramList from './components/ProgramListView.js';
import renderHistory from './components/HistoryView.js';
import renderSummary from './components/SummaryView.js';
import renderBottomNav from './components/BottomNav.js';
import { renderEditorView, attachEditorHandlers } from './components/EditorView.js';
import renderWorkoutDetail from './components/WorkoutDetailView.js';
import { formatPace } from './utils/formatters.js';
import {
  initDB,
  migrateFromLocalStorage,
  getAllPrograms,
  saveProgram,
  deleteProgram,
  getAllWorkouts,
  saveWorkout,
  enforceWorkoutLimit,
} from './utils/storage.js';

// Global state
const state = {
  view: 'home',
  workoutStatus: 'idle',
  bleConnected: false,
  // NOTE: hrConnected is now derived from rower data (heartrate !== null)
  // Kept for backwards compatibility with views that render based on it.
  hrConnected: false,

  // User settings
  userSettings: null,

  // Workout data
  workout: null,
  currentIntervalIndex: 0,
  workoutTime: 0,

  // Interval Tracking
  intervalTime: 0,
  intervalStartValue: 0,
  intervalCurrentProgress: 0,

  // Editor & Programs
  editingWorkout: null,
  programs: [], // Unified list (templates + custom)

  // Rower data – now sourced from rower consolidated dataPayload
  rowerData: {
    spm: null,
    strokes: 0,
    distance: 0,
    pace: 0,
    watts: 0,
    cals: 0,
    duration: 0,
    heartrate: null,      // from rower's paired chest strap (null if not paired/invalid)
    workoutState: 0,      // rower workout state enum
    rowingState: 0,       // rower rowing state enum
    isActive: false,
    workoutActive: false,  // alias kept for backward compat
    driveLength: 0, // NEW
    driveTime: 0,   // NEW
    dragFactor: 0   // NEW
  },

  // hrData is now populated from rower rower data (no separate HR monitor needed)
  hrData: {
    hr: null,
    zone: null
  },

  // Session peak values (tracked during workout)
  peakHR: null,
  peakRestDistanceM: 0,

  // Split/Interval data captured during workout
  splits: [],

  // Current workout session ID
  currentWorkoutId: null,

  // History
  history: [],

  // Detail view state
  detailWorkoutId: null
};

let workoutTimer = null;
let zoneTrackingTimer = null;
let wakeLock = null;
let fsm = null;
let busUnsubs = [];
let currentWorkoutId = null;

async function init() {
  console.log('[App] Initializing...');

  try {
    await initDB();
    await migrateFromLocalStorage();
    console.log('[App] IndexedDB ready');
  } catch (error) {
    console.error('[App] Failed to initialize IndexedDB:', error);
    alert('Failed to initialize storage. Some features may not work.');
  }

  loadUserSettings();
  await loadHistory();
  await loadPrograms();
  setupEventListeners();
  setupFSM();
  setupBusSubscriptions();
  render();
  console.log('[App] Initialization complete');
}

async function acquireWakeLock() {
  if ('wakeLock' in navigator && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('[App] Screen wake lock acquired');

      wakeLock.addEventListener('release', () => {
        console.log('[App] Screen wake lock released');
        wakeLock = null;
      });
    } catch (err) {
      console.error(`[App] Wake lock acquire error: ${err.name}, ${err.message}`);
    }
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    try {
      await wakeLock.release();
      wakeLock = null;
      console.log('[App] Screen wake lock released');
    } catch (err) {
      console.error(`[App] Wake lock release error: ${err.name}, ${err.message}`);
    }
  }
}

function loadUserSettings() {
  const saved = localStorage.getItem('userSettings');
  if (saved) {
    state.userSettings = JSON.parse(saved);
    if (!state.userSettings.restHR) {
        state.userSettings.restHR = DEFAULT_USER_SETTINGS.restHR;
    }
    console.log('[App] User settings loaded from storage');
  } else {
    state.userSettings = { ...DEFAULT_USER_SETTINGS };
    console.log('[App] Default user settings applied');
  }
  if (!state.userSettings.hrMax) {
    state.userSettings.hrMax = calculateHRMax(state.userSettings.age);
  }
  saveUserSettings();
}

function saveUserSettings() {
  localStorage.setItem('userSettings', JSON.stringify(state.userSettings));
}

async function loadHistory() {
  try {
    state.history = await getAllWorkouts(50);
    console.log(`[App] History loaded: ${state.history.length} workouts`);
  } catch (error) {
    console.error('[App] Failed to load history:', error);
    state.history = [];
  }
}

async function loadPrograms() {
  try {
    let programs = await getAllPrograms();

    // If no programs exist, seed with defaults
    if (programs.length === 0) {
      console.log('[App] First run detected. Seeding default templates...');
      for (const template of Object.values(WORKOUT_TEMPLATES)) {
        await saveProgram(template);
      }
      programs = await getAllPrograms();
    }

    state.programs = programs;
    console.log(`[App] Programs loaded: ${state.programs.length} programs`);
  } catch (error) {
    console.error('[App] Failed to load programs:', error);
    state.programs = [];
  }
}

function setupEventListeners() {
  console.log('[App] Event listeners registered');
  window.addEventListener('workout:start', handleWorkoutStart);
  window.addEventListener('workout:pause', handleWorkoutPause);
  window.addEventListener('workout:stop', handleWorkoutStop);
  window.addEventListener('workout:cancel', handleWorkoutCancel);

  window.addEventListener('nav:home', () => navigateTo('home'));
  window.addEventListener('nav:programs', () => navigateTo('programs'));
  window.addEventListener('nav:history', () => navigateTo('history'));
  window.addEventListener('nav:summary', () => {
    // Special navigation to summary that doesn't reset state
    state.view = 'summary';
    render();
  });

  window.addEventListener('nav:editor', (e) => {
    if (e.detail && e.detail.workout) {
      state.editingWorkout = JSON.parse(JSON.stringify(e.detail.workout));
    } else {
      state.editingWorkout = null;
    }
    navigateTo('editor');
  });

  window.addEventListener('workout:select', async (e) => {
    const rawWorkout = e.detail;

    const normalizedWorkout = {
      ...rawWorkout,
      intervals: rawWorkout.intervals.map(i => ({
          ...i,
          target: (i.target !== undefined) ? i.target : (i.val || 0),
          val: (i.val !== undefined) ? i.val : (i.target || 0)
      }))
    };

    state.workout = normalizedWorkout;
    state.currentIntervalIndex = 0;
    state.workoutTime = 0;
    state.intervalTime = 0;
    state.intervalStartValue = 0;
    state.intervalCurrentProgress = 0;
    state.workoutStatus = 'idle';
    state._lastSplitNumber = -1;
    fsm.reset(); // Returns FSM to IDLE so it accepts ROWING events again

    resetRowerSession();
    resetRowerData();
    resetZoneTracking();

    navigateTo('workout');
  });

  window.addEventListener('program:save', async () => {
    await loadPrograms();
    navigateTo('programs');
  });

  window.addEventListener('program:delete', async (e) => {
    const id = e.detail.id;
    try {
      await deleteProgram(id);
      await loadPrograms();
      render();
    } catch (error) {
      console.error('[App] Failed to delete program:', error);
    }
  });

  window.addEventListener('program:restore', async () => {
    if (confirm('Restore default workout templates? This will add back any missing defaults. Your custom created programs will remain safe.')) {
      for (const template of Object.values(WORKOUT_TEMPLATES)) {
        await saveProgram(template);
      }
      await loadPrograms();
      render();
    }
  });

  window.addEventListener('program:toggleFavorite', async (e) => {
    const id = e.detail.id;

    try {
      const { getProgram } = await import('./utils/storage.js');
      const program = await getProgram(id);

      if (program) {
        const wasFavorite = !!program.isFavorite;

        // Get all programs and reset favorites
        const allPrograms = await getAllPrograms();
        for (const p of allPrograms) {
          if (p.isFavorite) {
            p.isFavorite = false;
            await saveProgram(p);
          }
        }

        // Set new favorite if it wasn't already
        if (!wasFavorite) {
          program.isFavorite = true;
          await saveProgram(program);
        }

        await loadPrograms();
        render();
      }
    } catch (error) {
      console.error('[App] Failed to toggle favorite:', error);
    }
  });

  window.addEventListener('connect:rower', handleConnectRower);
  window.addEventListener('disconnect:rower', handleDisconnectRower);

  // Legacy HR events are now no-ops since HR comes from the rower
  window.addEventListener('connect:hr', () => {
    console.log('[App] HR monitor connection requested — HR is now provided by the rower chest strap.');
  });
  window.addEventListener('disconnect:hr', () => {
    console.log('[App] HR disconnect requested — pair/unpair chest strap directly with the rower.');
  });

  window.addEventListener('workout:showDetail', (e) => {
    state.detailWorkoutId = e.detail.workoutId;
    state.detailPreviousView = state.view; 
    navigateTo('workout-detail');
  });
}

function setupFSM() {
  fsm = new WorkoutFSM();

  fsm.on(WS.ACTIVE, {
    onEnter: ({ from }) => {
      if (from === WS.IDLE) {
        const workoutId = `workout_${Date.now()}`;
        currentWorkoutId = workoutId;
        state.currentWorkoutId = workoutId;
        initBuffer(workoutId, state.workout?.id);
        startWorkoutTimers();
      } else if (from === WS.PAUSED || from === WS.DISCONNECTED) {
        startWorkoutTimers();
      }
      state.workoutStatus = 'active';
      render();
    },
    onExit: () => {}
  });

  fsm.on(WS.PAUSED, {
    onEnter: () => {
      stopWorkoutTimers();
      state.workoutStatus = 'paused';
      render();
    }
  });

  fsm.on(WS.FINISHED, {
    onEnter: async () => {
      stopWorkoutTimers();
      state.workoutStatus = 'finished';

      const summary = buildWorkoutSummary();
      await finalizeBuffer(summary);
      await saveWorkoutToHistory();
      state.view = 'summary';
      render();
    }
  });

  fsm.on(WS.DISCONNECTED, {
    onEnter: ({ from }) => {
      if (from === WS.ACTIVE || from === WS.PAUSED) {
        stopWorkoutTimers();
        renderReconnectOverlay({
          pace: state.rowerData?.pace ? formatPace(state.rowerData.pace, { showUnit: false }) : '--:--',
          hr: state.hrData?.hr,
          spm: state.rowerData?.spm,
        });
      }
      state.bleConnected = false;
      render();
    },
    onExit: () => {
      removeReconnectOverlay();
      state.bleConnected = true;
      render();
    }
  });

  fsm.on(WS.IDLE, {
    onEnter: () => {
      state.workoutStatus = 'idle';
      render();
    }
  });
}

function setupBusSubscriptions() {
  busUnsubs = [
    on(BUS.TICK, handleBusTick),
    on(BUS.STROKE, (data) => {
      if (fsm.state === WS.ACTIVE) {
        pushStroke(data);
      }
    }),    
    on(BUS.DISCONNECTED, () => {
      if (fsm.state === WS.ACTIVE || fsm.state === WS.PAUSED) {
        fsm.send(WE.BLE_DISCONNECT);
      } else if (fsm.state === WS.IDLE) {
        state.bleConnected = false;
        render();
      }
    }),
    on(BUS.RECONNECTED, () => {
      if (fsm.state === WS.DISCONNECTED) {
        fsm.send(WE.BLE_RECONNECT);
      }
    }),
    on(BUS.CONNECTED, () => {
      state.bleConnected = true;
      render();
    }),
    on(BUS.RECONNECT_REQUEST, async () => {
      await reconnect();
    }),
  ];
}

function handleBusTick(data) {
  if (data.heartrate !== null && data.heartrate !== undefined) {
    state.peakHR = Math.max(state.peakHR || 0, data.heartrate);
  }

  if (data.restDistanceM !== undefined && data.restDistanceM !== null) {
    state.peakRestDistanceM = Math.max(state.peakRestDistanceM || 0, data.restDistanceM);
  }

  state.rowerData = {
    spm: data.spm,
    strokes: data.strokeCount,
    distance: data.distanceMeters,
    pace: data.currentPaceSec,
    watts: data.avgPowerWatts,
    cals: data.totalCals,
    duration: data.elapsedTimeSec,
    driveLength: data.driveLength,
    driveTime: data.driveTime,
    dragFactor: data.dragFactor,
    heartrate: data.heartrate,
    workoutState: data.workoutState,
    rowingState: data.rowingState,
    isActive: data.isActive,
    workoutActive: data.isActive,
    ...data
  };

  if (data.heartrate !== null) {
    state.hrData.hr = data.heartrate;
    state.hrConnected = true;
    if (state.userSettings?.hrMax) {
      state.hrData.zone = getCurrentHRZone(data.heartrate, state.userSettings.restHR, state.userSettings.hrMax);
    }
  } else {
    state.hrData.hr = null;
    state.hrData.zone = null;
  }

  driveFSMFromRower(data);

  if (state.workoutStatus === 'active' && state.workout) {
    checkIntervalCompletion();
  }

  if (state.view === 'workout') {
    updateWorkoutView(state);
  }
}

function driveFSMFromRower(data) {
  if (!state.workout) return;

  if (fsm.state === WS.IDLE && data.isActive) {
    handleWorkoutStart();
    return;
  }

  if (fsm.state === WS.ACTIVE && !data.isActive) {
    fsm.send(WE.PAUSE);
  } else if (fsm.state === WS.PAUSED && data.isActive) {
    fsm.send(WE.RESUME);
  }
}

function startWorkoutTimers() {
  if (workoutTimer) clearInterval(workoutTimer);
  if (zoneTrackingTimer) clearInterval(zoneTrackingTimer);

  workoutTimer = setInterval(() => {
    state.workoutTime++;
    state.intervalTime++;
    checkIntervalCompletion();
    if (state.view === 'workout') updateWorkoutView(state);
  }, 1000);

  zoneTrackingTimer = setInterval(() => {
    const hr = state.rowerData.heartrate;
    if (hr && state.userSettings?.hrMax) {
      const zone = getCurrentHRZone(hr, state.userSettings.restHR, state.userSettings.hrMax);
      updateZoneTime(zone);
    }
  }, 1000);
}

function stopWorkoutTimers() {
  if (workoutTimer) { clearInterval(workoutTimer); workoutTimer = null; }
  if (zoneTrackingTimer) { clearInterval(zoneTrackingTimer); zoneTrackingTimer = null; }
}

function buildWorkoutSummary() {
  const zoneDistribution = getZoneDistribution(state.workoutTime);
  return {
    duration: state.workoutTime,
    distance: state.rowerData.distance,
    strokes: state.rowerData.strokes,
    avgSPM: state.workoutTime > 0 ? state.rowerData.strokes / (state.workoutTime / 60) : 0,
    avgPace: state.rowerData.distance > 0 ? (state.workoutTime / (state.rowerData.distance / 500)) : 0,
    calories: state.rowerData.cals,
    avgHR: state.hrData?.hr || null,
    peakHR: state.peakHR || null,
    zoneDistribution,
  };
}

async function navigateTo(view) {
  const previousView = state.view;
  state.view = view;

  // Manage wake lock based on view
  const isWorkoutOrSummary = view === 'workout' || view === 'summary';
  const wasWorkoutOrSummary = previousView === 'workout' || previousView === 'summary';

  if (isWorkoutOrSummary && !wasWorkoutOrSummary) {
    await acquireWakeLock();
  } else if (!isWorkoutOrSummary && wasWorkoutOrSummary) {
    await releaseWakeLock();
  }

  if (view !== 'workout' && view !== 'summary') {
    cleanupWorkoutView();
  }
  if (view === 'home' && state.workoutStatus === 'finished') {
    resetRowerData();
    state.workout = null;
    state.currentIntervalIndex = 0;
    state.workoutTime = 0;
    state.intervalTime = 0;
    state.workoutStatus = 'idle';
  }
  render();
}

export function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  let viewComponent;
  switch (state.view) {
    case 'home':
      viewComponent = renderHome(state);
      break;
    case 'workout':
      viewComponent = renderWorkoutView(state);
      break;
    case 'programs':
      viewComponent = renderProgramList(state);
      break;
    case 'history':
      viewComponent = renderHistory(state);
      break;
    case 'summary':
      viewComponent = renderSummary(state);
      break;
    case 'workout-detail':
      viewComponent = renderWorkoutDetail(state);
      break;
    case 'editor':
      const div = document.createElement('div');
      div.innerHTML = renderEditorView(state);
      viewComponent = div;

      setTimeout(() => {
        attachEditorHandlers(state, (updates) => {
            Object.assign(state, updates);
            if (state.view === 'editor') render();
        });
      }, 0);
      break;
    default:
      viewComponent = renderHome(state);
  }

  app.appendChild(viewComponent);

  if (state.view !== 'workout' && state.view !== 'summary' && state.view !== 'editor' && state.view !== 'workout-detail') {
    app.appendChild(renderBottomNav(state));
  }
}

function setupIntervalStart() {
    const interval = state.workout?.intervals[state.currentIntervalIndex];
    if (!interval) return;
    state.intervalTime = 0;
    if (interval.type === 'distance') {
        state.intervalStartValue = state.rowerData.distance || 0;
    } else {
        state.intervalStartValue = 0;
    }
    state.intervalCurrentProgress = 0;
}

function resetRowerData() {
  state.rowerData = {
    spm: null, strokes: 0, distance: 0, pace: 0, watts: 0, cals: 0,
    duration: 0, heartrate: null, workoutState: 0, rowingState: 0,
    isActive: false, workoutActive: false
  };
}

function calculateIntervalProgress() {
    const interval = state.workout?.intervals[state.currentIntervalIndex];
    if (!interval) return;
    if (interval.type === 'distance') {
        const currentDist = state.rowerData.distance || 0;
        state.intervalCurrentProgress = Math.max(0, currentDist - state.intervalStartValue);
    } else {
        state.intervalCurrentProgress = state.intervalTime;
    }
}

function checkIntervalCompletion() {
    const interval = state.workout?.intervals[state.currentIntervalIndex];
    if (!interval) return;
    calculateIntervalProgress();

    if (state.intervalCurrentProgress >= interval.target) {
        state.currentIntervalIndex++;
        if (state.currentIntervalIndex >= state.workout.intervals.length) {
            handleWorkoutStop();
        } else {
            setupIntervalStart();
            notifyIntervalChange();
            updateWorkoutView(state);
        }
    }
}

function handleWorkoutStart() {
  console.log('[App] Starting new workout...');
  resetZoneTracking();
  // removed: resetRowerSession();  <-- Was destroying data arriving in the same tick!
  // removed: resetRowerData();   <-- Was destroying data arriving in the same tick!
  setupIntervalStart();

  state.peakHR = null;
  state.peakRestDistanceM = 0;
  state.splits =[];

  acquireWakeLock(); // Call asynchronously without await to avoid freezing the tick

  fsm.send(WE.START);
}

function handleWorkoutPause() {
  fsm.send(WE.USER_STOP);
}

async function handleWorkoutStop() {
  fsm.send(WE.USER_STOP);
}

function handleWorkoutCancel() {
  stopWorkoutTimers();
  state.workoutStatus = 'idle';
  state.workout = null;
  state.currentIntervalIndex = 0;
  state.workoutTime = 0;
  state.intervalTime = 0;
  state.currentWorkoutId = null;
  
  state.splits = [];
  state.workoutPaceHistory = [];
  state.workoutHrHistory = [];
  state.lastSavedState = null;
  resetZoneTracking();

  releaseWakeLock();

  fsm.send(WE.USER_STOP);
  fsm.send(WE.RESET);
  navigateTo('home');
}

function notifyIntervalChange() {
  if (state.userSettings?.enableHaptics && navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
}

async function saveWorkoutToHistory() {
  if (!state.workout) {
    console.log('[App] No workout to save (cancelled)');
    return;
  }

  const zoneDistribution = getZoneDistribution(state.workoutTime);
  const workoutId = currentWorkoutId || `workout_${Date.now()}`;

  // 1. Define Fallbacks (App's internal tracking)
  const fallbackWorkDistance = state.rowerData.distance || 0;
  const fallbackAvgPace = fallbackWorkDistance > 0 
    ? (state.workoutTime / (fallbackWorkDistance / 500)) 
    : 0;
  const fallbackAvgSPM = state.workoutTime > 0 
    ? state.rowerData.strokes / (state.workoutTime / 60) 
    : 0;

  const restDistance = state.peakRestDistanceM || 0;

  const workout = {
    id: workoutId,
    date: new Date().toISOString(),
    name: state.workout?.name || 'Custom Workout',
    
    duration: state.workoutTime,
    distance: fallbackWorkDistance,
    
    restDistanceM: restDistance,
    // Note: totalDistanceM is work + rest. 
    // If summary.distM exists, use it. Otherwise use fallback.
    totalDistanceM: fallbackWorkDistance + restDistance,

    avgSPM: fallbackAvgSPM,
    avgPace: fallbackAvgPace,
    
    avgHR: state.hrData?.hr || null,
    peakHR: state.peakHR || null,
    dragFactor: state.rowerData.dragFactor || null,

    strokes: state.rowerData.strokes,
    calories: state.rowerData.cals,
    zoneDistribution: zoneDistribution,
    intervalCount: state.workout?.intervals?.length || 0,
    intervals: state.workout?.intervals || [],
    splits: state.splits || [],
  };

  // Add interval boundaries for later analysis (unchanged)
  const intervalBoundaries = [];
  let currentTime = 0;
  for (let i = 0; i < state.workout.intervals.length; i++) {
    intervalBoundaries.push({
      index: i,
      startTime: currentTime,
      type: state.workout.intervals[i].type,
      target: state.workout.intervals[i].target || state.workout.intervals[i].val
    });
    if (state.workout.intervals[i].type === 'time') {
      currentTime += state.workout.intervals[i].val;
    }
  }
  workout.intervalBoundaries = intervalBoundaries;

  try {
    await saveWorkout(workout);
    await enforceWorkoutLimit(50);
    await loadHistory();
  } catch (error) {
    console.error('[App] Failed to save workout:', error);
  }
}

// ─── rower Connection ──────────────────────────────────────────────────────────

async function handleConnectRower() {
  try {
    await connectRower();
    state.bleConnected = true;
    render();
  } catch (error) {
    console.error('[Rower Connect Error]', error);
    alert(`Failed to connect to the rowing machine.

Reason: ${error.message || error}

Tips:
• Use Chrome on Android or desktop
• iOS/Safari/Firefox do not support Web Bluetooth
• Keep the rower powered on and nearby
• The page must be served over HTTPS`);
  }
}

function handleDisconnectRower() {
  disconnectRower();
  state.bleConnected = false;
  state.hrConnected = false;
  render();
}

export function getFSM() {
  return fsm;
}

export function getBusUnsubs() {
  return busUnsubs;
}

init();