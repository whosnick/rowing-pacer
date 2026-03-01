// app.js - Pure Data Version (Trusts Stroke & Distance Physics)

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
  reconnect,
  sendMachineCommand
} from './bluetooth/ftmsService.js';

import {
  connectHRMonitor,
  disconnectHRMonitor,
  isHRMonitorConnected
} from './bluetooth/hrService.js';

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
  programs: [],

  // Rower data
  rowerData: {
    spm: null,
    strokes: 0,
    distance: 0,
    pace: 0,
    watts: 0,
    cals: 0,
    duration: 0,
    heartrate: null,
    workoutState: 0,
    rowingState: 0,
    isActive: false,
    workoutActive: false,
  },

  // Baseline values at workout start
  sessionOffsets: {
    strokeCount: 0,
    distanceMeters: 0,
    totalCals: 0,
    elapsedTimeSec: 0,
  },

  hrData: { hr: null, zone: null },
  peakHR: null,
  peakRestDistanceM: 0,
  splits: [],
  currentWorkoutId: null,
  history: [],
  detailWorkoutId: null
};

let workoutTimer = null;
let zoneTrackingTimer = null;
let wakeLock = null;
let fsm = null;
let busUnsubs = [];

async function init() {
  console.log('[App] Initializing...');
  try {
    await initDB();
    await migrateFromLocalStorage();
    console.log('[App] IndexedDB ready');
  } catch (error) {
    console.error('[App] Failed to initialize IndexedDB:', error);
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
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (err) { console.error(`[App] Wake lock error: ${err.message}`); }
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); wakeLock = null; } 
    catch (err) { console.error(`[App] Wake lock release error: ${err.message}`); }
  }
}

function loadUserSettings() {
  const saved = localStorage.getItem('userSettings');
  if (saved) {
    state.userSettings = JSON.parse(saved);
    if (!state.userSettings.restHR) state.userSettings.restHR = DEFAULT_USER_SETTINGS.restHR;
  } else {
    state.userSettings = { ...DEFAULT_USER_SETTINGS };
  }
  if (!state.userSettings.hrMax) state.userSettings.hrMax = calculateHRMax(state.userSettings.age);
  saveUserSettings();
}

function saveUserSettings() {
  localStorage.setItem('userSettings', JSON.stringify(state.userSettings));
}

async function loadHistory() {
  try {
    state.history = await getAllWorkouts(50);
  } catch (error) {
    state.history = [];
  }
}

async function loadPrograms() {
  try {
    let programs = await getAllPrograms();
    if (programs.length === 0) {
      for (const template of Object.values(WORKOUT_TEMPLATES)) {
        await saveProgram(template);
      }
      programs = await getAllPrograms();
    }
    state.programs = programs;
  } catch (error) {
    state.programs = [];
  }
}

function setupEventListeners() {
  window.addEventListener('workout:start', handleWorkoutStart);
  window.addEventListener('workout:pause', handleWorkoutPause);
  window.addEventListener('workout:stop', handleWorkoutStop);
  window.addEventListener('workout:cancel', handleWorkoutCancel);

  window.addEventListener('nav:home', () => navigateTo('home'));
  window.addEventListener('nav:programs', () => navigateTo('programs'));
  window.addEventListener('nav:history', () => navigateTo('history'));
  window.addEventListener('nav:summary', () => {
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
    
    // Reset Everything
    fsm.reset(); 
    resetRowerSession();
    resetRowerData();
    resetZoneTracking();

    navigateTo('workout');
  });

  window.addEventListener('program:save', async () => { await loadPrograms(); navigateTo('programs'); });
  window.addEventListener('program:delete', async (e) => { await deleteProgram(e.detail.id); await loadPrograms(); render(); });
  window.addEventListener('program:restore', async () => {
    if (confirm('Restore defaults?')) { for (const t of Object.values(WORKOUT_TEMPLATES)) await saveProgram(t); await loadPrograms(); render(); }
  });
  window.addEventListener('program:toggleFavorite', async (e) => {
    const { getProgram } = await import('./utils/storage.js');
    const program = await getProgram(e.detail.id);
    if (program) {
      program.isFavorite = !program.isFavorite;
      await saveProgram(program); await loadPrograms(); render();
    }
  });

  window.addEventListener('connect:rower', handleConnectRower);
  window.addEventListener('disconnect:rower', handleDisconnectRower);
  window.addEventListener('connect:hr', handleConnectHR);
  window.addEventListener('disconnect:hr', handleDisconnectHR);
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
        state.currentWorkoutId = workoutId;
        initBuffer(workoutId, state.workout?.id);
        startWorkoutTimers();
      } else if (from === WS.PAUSED || from === WS.DISCONNECTED) {
        startWorkoutTimers();
      }
      
      sendMachineCommand('START'); 
      state.workoutStatus = 'active';
      render();
    }
  });

  fsm.on(WS.PAUSED, {
    onEnter: () => {
      stopWorkoutTimers();
      sendMachineCommand('PAUSE'); 
      state.workoutStatus = 'paused';
      render();
    }
  });

  fsm.on(WS.FINISHED, {
    onEnter: async () => {
      stopWorkoutTimers();
      sendMachineCommand('STOP');
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
    
    // Stroke event for data logging
    on(BUS.STROKE, (data) => {
      if (fsm.state === WS.ACTIVE) {
        pushStroke(data);
      }
    }),
    
    // We only listen for STOP because that is an explicit termination.
    // Pause/Resume is handled 100% by the isActive flag logic in driveFSMFromData.
    on(BUS.MACHINE_STOPPED, () => {
      if (fsm.state === WS.ACTIVE || fsm.state === WS.PAUSED) {
        fsm.send(WE.USER_STOP);
      }
    }),

    on(BUS.DISCONNECTED, () => {
      if (fsm.state === WS.ACTIVE || fsm.state === WS.PAUSED) fsm.send(WE.BLE_DISCONNECT);
      else if (fsm.state === WS.IDLE) { state.bleConnected = false; render(); }
    }),
    on(BUS.RECONNECTED, () => { if (fsm.state === WS.DISCONNECTED) fsm.send(WE.BLE_RECONNECT); }),
    on(BUS.CONNECTED, () => { state.bleConnected = true; render(); }),
    on(BUS.RECONNECT_REQUEST, async () => { await reconnect(); }),
    on(BUS.HR_DATA, (data) => {
      state.hrData.hr = data.heartrate;
      state.hrConnected = true;
      if (state.userSettings?.hrMax) state.hrData.zone = getCurrentHRZone(data.heartrate, state.userSettings.restHR, state.userSettings.hrMax);
      if (data.heartrate) state.peakHR = Math.max(state.peakHR || 0, data.heartrate);
      if (state.view === 'workout') updateWorkoutView(state);
      else render();
    }),
    on(BUS.HR_DISCONNECTED, () => {
      state.hrConnected = false; state.hrData.hr = null; state.hrData.zone = null;
      if (state.view === 'workout') updateWorkoutView(state); else render();
    }),
  ];
}

function handleBusTick(data) {
  const relativeStrokeCount = Math.max(0, (data.strokeCount || 0) - (state.sessionOffsets.strokeCount || 0));
  const relativeDistance = Math.max(0, (data.distanceMeters || 0) - (state.sessionOffsets.distanceMeters || 0));
  const relativeCals = Math.max(0, (data.totalCals || 0) - (state.sessionOffsets.totalCals || 0));
  const relativeElapsed = Math.max(0, (data.elapsedTimeSec || 0) - (state.sessionOffsets.elapsedTimeSec || 0));

  if (data.heartrate) state.peakHR = Math.max(state.peakHR || 0, data.heartrate);
  if (data.restDistanceM) state.peakRestDistanceM = Math.max(state.peakRestDistanceM || 0, data.restDistanceM);

  state.rowerData = {
    spm: data.spm, strokes: relativeStrokeCount, distance: relativeDistance,
    pace: data.currentPaceSec, watts: data.avgPowerWatts, cals: relativeCals,
    duration: relativeElapsed, heartrate: data.heartrate,
    workoutState: data.workoutState, rowingState: data.rowingState,
    isActive: data.isActive, workoutActive: data.isActive,
  };

  if (!isHRMonitorConnected() && data.heartrate !== null) {
    state.hrData.hr = data.heartrate;
    state.hrConnected = true;
    if (state.userSettings?.hrMax) state.hrData.zone = getCurrentHRZone(data.heartrate, state.userSettings.restHR, state.userSettings.hrMax);
  }

  // DRIVE FSM BASED PURELY ON PHYSICS (isActive)
  driveFSMFromData(data);

  if (state.workoutStatus === 'active' && state.workout) checkIntervalCompletion();
  if (state.view === 'workout') updateWorkoutView(state);
}

function driveFSMFromData(data) {
  if (!state.workout) return;

  const currentInterval = state.workout.intervals[state.currentIntervalIndex];
  const isRestingPhase = currentInterval?.phase === 'rest';

  // 1. AUTO-START (Start on first stroke)
  if (fsm.state === WS.IDLE && data.isActive) {
    handleWorkoutStart();
    return;
  }

  // 2. AUTO-PAUSE (Stop when physics says stop)
  // We only pause if the user physically stops (isActive=false) 
  // AND we are not in a rest interval (where stopping is expected).
  if (fsm.state === WS.ACTIVE && !data.isActive && !isRestingPhase) {
    fsm.send(WE.PAUSE);
  }
  
  // 3. AUTO-RESUME (Resume on next stroke)
  else if (fsm.state === WS.PAUSED && data.isActive) {
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
      updateZoneTime(getCurrentHRZone(hr, state.userSettings.restHR, state.userSettings.hrMax));
    }
  }, 1000);
}

function stopWorkoutTimers() {
  if (workoutTimer) { clearInterval(workoutTimer); workoutTimer = null; }
  if (zoneTrackingTimer) { clearInterval(zoneTrackingTimer); zoneTrackingTimer = null; }
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
  state.view = view;
  const isWorkoutOrSummary = view === 'workout' || view === 'summary';
  const wasWorkoutOrSummary = state.view === 'workout' || state.view === 'summary';

  if (isWorkoutOrSummary && !wasWorkoutOrSummary) await acquireWakeLock();
  else if (!isWorkoutOrSummary && wasWorkoutOrSummary) await releaseWakeLock();

  if (view !== 'workout' && view !== 'summary') cleanupWorkoutView();
  
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

function setupIntervalStart() {
    const interval = state.workout?.intervals[state.currentIntervalIndex];
    if (!interval) return;
    state.intervalTime = 0;
    state.intervalStartValue = interval.type === 'distance' ? (state.rowerData.distance || 0) : 0;
    state.intervalCurrentProgress = 0;

    // We still SEND commands to the machine to keep the LCD in sync
    if (interval.phase === 'rest') {
        sendMachineCommand('PAUSE');
    } else if (fsm.state === WS.ACTIVE) {
        sendMachineCommand('START');
    }
}

function resetRowerData() {
  state.rowerData = {
    spm: null, strokes: 0, distance: 0, pace: 0, watts: 0, cals: 0,
    duration: 0, heartrate: null, workoutState: 0, rowingState: 0,
    isActive: false, workoutActive: false
  };
  state.sessionOffsets = { strokeCount: 0, distanceMeters: 0, totalCals: 0, elapsedTimeSec: 0 };
}

function checkIntervalCompletion() {
    const interval = state.workout?.intervals[state.currentIntervalIndex];
    if (!interval) return;
    state.intervalCurrentProgress = interval.type === 'distance' 
        ? Math.max(0, (state.rowerData.distance || 0) - state.intervalStartValue)
        : state.intervalTime;

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
  state.sessionOffsets = {
    strokeCount: state.rowerData.strokes || 0,
    distanceMeters: state.rowerData.distance || 0,
    totalCals: state.rowerData.cals || 0,
    elapsedTimeSec: state.rowerData.duration || 0,
  };
  setupIntervalStart();
  state.peakHR = null; state.peakRestDistanceM = 0; state.splits = [];
  acquireWakeLock();
  fsm.send(WE.START);
}

function handleWorkoutPause() {
  fsm.send(WE.PAUSE);
}

async function handleWorkoutStop() {
  fsm.send(WE.USER_STOP);
}

function handleWorkoutCancel() {
  stopWorkoutTimers();
  sendMachineCommand('STOP');
  state.workoutStatus = 'idle';
  state.workout = null;
  state.currentIntervalIndex = 0;
  state.workoutTime = 0;
  state.intervalTime = 0;
  state.currentWorkoutId = null;
  state.splits = [];
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
  if (!state.workout) return;
  const zoneDistribution = getZoneDistribution(state.workoutTime);
  const workoutId = state.currentWorkoutId || `workout_${Date.now()}`;
  const fallbackWorkDistance = state.rowerData.distance || 0;
  const fallbackAvgPace = fallbackWorkDistance > 0 ? (state.workoutTime / (fallbackWorkDistance / 500)) : 0;
  const fallbackAvgSPM = state.workoutTime > 0 ? state.rowerData.strokes / (state.workoutTime / 60) : 0;
  const restDistance = state.peakRestDistanceM || 0;

  const workout = {
    id: workoutId, date: new Date().toISOString(), name: state.workout?.name || 'Custom Workout',
    duration: state.workoutTime, distance: fallbackWorkDistance,
    restDistanceM: restDistance, totalDistanceM: fallbackWorkDistance + restDistance,
    avgSPM: fallbackAvgSPM, avgPace: fallbackAvgPace,
    avgHR: state.hrData?.hr || null, peakHR: state.peakHR || null,
    strokes: state.rowerData.strokes, calories: state.rowerData.cals,
    zoneDistribution: zoneDistribution, intervalCount: state.workout?.intervals?.length || 0,
    intervals: state.workout?.intervals || [], splits: state.splits || [],
  };

  const intervalBoundaries = [];
  let currentTime = 0;
  for (let i = 0; i < state.workout.intervals.length; i++) {
    intervalBoundaries.push({ index: i, startTime: currentTime, type: state.workout.intervals[i].type, target: state.workout.intervals[i].target || state.workout.intervals[i].val });
    if (state.workout.intervals[i].type === 'time') currentTime += state.workout.intervals[i].val;
  }
  workout.intervalBoundaries = intervalBoundaries;

  try { await saveWorkout(workout); await enforceWorkoutLimit(50); await loadHistory(); } 
  catch (e) { console.error('[App] Save error:', e); }
}

async function handleConnectRower() { try { await connectRower(); state.bleConnected = true; render(); } catch (e) { alert(e.message); } }
function handleDisconnectRower() { disconnectRower(); state.bleConnected = false; render(); }
async function handleConnectHR() { try { await connectHRMonitor(); state.hrConnected = true; render(); } catch (e) { alert(e.message); } }
function handleDisconnectHR() { disconnectHRMonitor(); state.hrConnected = false; state.hrData.hr = null; state.hrData.zone = null; render(); }

export function getFSM() { return fsm; }
export function getBusUnsubs() { return busUnsubs; }

init();