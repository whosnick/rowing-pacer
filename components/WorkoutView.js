// components/WorkoutView.js

import { getCurrentHRZone, getHRZoneBoundaries, INTERVAL_PHASES, UNITS } from '../utils/constants.js';
import { formatTime, formatPace, formatHR, formatSPM, formatWatts, formatDistance } from '../utils/formatters.js';
import SPMPacer from '../utils/spmPacer.js';
import { initCoaching, updateCoaching, resetCoaching, setCoachingEnabled, getCurrentMessage } from '../utils/CoachingEngine.js';
import { speak } from '../utils/tts.js';
import { icon } from '../utils/icons.js';
import { emit, BUS } from '../utils/telemetryBus.js';

// Helper to get SPM color based on deviation from target
function getSPMColor(roundedSPM, targetSPM) {
  if (roundedSPM === null || !targetSPM) return 'white';
  const diff = Math.abs(roundedSPM - targetSPM);
  if (diff === 0) return 'var(--primary)';
  if (diff <= 1) return '#c0e635';  // lime-400
  if (diff <= 2) return '#facc15';  // yellow-400
  return 'var(--danger)';
}

// Helper to get Pace color based on deviation from target (in seconds)
function getPaceColor(actualSec, targetSec) {
  if (!actualSec || !targetSec) return 'white';
  const diff = actualSec - targetSec; 
  if (Math.abs(diff) <= 2) return 'var(--primary)'; 
  if (diff > 2 && diff <= 5) return '#facc15';      
  if (diff < -2 && diff >= -5) return '#c0e635';    
  return 'var(--danger)';
}

let spmPacer = null;
let hrHistoryCanvas = null;
let hrHistoryContext = null;
let hrHistoryData =[];
let resizeHandler = null;
let cachedMaxHR = 176;
let cachedRestHR = 60;

let cachedDisplayMinHR = 98;
let cachedDisplayMaxHR = 176;
let cachedZones        =[];

let lastOverMaxAlertTime = 0;
const OVER_MAX_ALERT_COOLDOWN_MS = 20000; 

const HR_HISTORY_LENGTH = 240;

let coachingEngine = null;
let smoothedViewCenterHR = null;
const activeTimers = new Set();
let uiCache = {};
let _lastMetrics = {};

function getDashboardMetricsHTML(state) {
  const metrics = [
    { key: 'distance', label: 'Dist', id: 'display-dist', value: `${Math.round(state.rowerData?.distance || 0)}m` },
    { key: 'watts', label: 'Watts', id: 'display-watts', value: `${Math.round(state.rowerData?.watts || 0)}` },
    { key: 'strokes', label: 'Strokes', id: 'display-strokes', value: `${state.rowerData?.strokes || 0}` },
    { key: 'cals', label: 'Cals', id: 'display-cals', value: `${Math.round(state.rowerData?.cals || 0)}` },
    { key: 'duration', label: 'Time', id: 'display-duration', value: formatTime(state.rowerData?.duration || 0) },
  ];

  return metrics
    .map(metric => `<div class="metric-item"><div class="metric-label muted">${metric.label}</div><div id="${metric.id}" class="metric-value">${metric.value}</div></div>`)
    .join('');
}


function scheduleTimer(callback, delay) {
  const timerId = setTimeout(() => {
    callback();
    activeTimers.delete(timerId);
  }, delay);
  activeTimers.add(timerId);
  return timerId;
}

function buildZoneGradient(zones, displayMinHR, displayMaxHR) {
  const displayRange = Math.max(1, displayMaxHR - displayMinHR);
  const toPct = bpm => Math.min(100, Math.max(0, ((displayMaxHR - bpm) / displayRange) * 100)).toFixed(2);

  const zonesForGradient = zones
    .filter(z => z.zone >= 0 && z.zone <= 5)
    .sort((a, b) => b.zone - a.zone);

  const zoneStops = zonesForGradient
    .map(zone => {
      const top    = toPct(zone.max);
      const bottom = toPct(zone.min);
      return `var(${zone.colorVar}) ${top}%, var(${zone.colorVar}) ${bottom}%`;
    }).join(', ');

  return `linear-gradient(to bottom, ${zoneStops})`;
}

function updateZoneViewport(hr, zones, hrMax, restHR) {
  const bg        = document.getElementById('hr-zone-bg');
  const container = document.getElementById('hr-zone-display');
  if (!bg || !container || !hr) return;

  const zoneWidth   = (hrMax - restHR) * 0.10;   
  const visibleRange = zoneWidth * 2;              

  const globalMin  = computeDisplayMinHR(zones, restHR, hrMax);
  const globalMax  = hrMax;
  const totalRange = Math.max(1, globalMax - globalMin);

  smoothedViewCenterHR = smoothedViewCenterHR != null
    ? smoothedViewCenterHR + (hr - smoothedViewCenterHR) * 0.08
    : hr;

  const viewMin = smoothedViewCenterHR - zoneWidth;
  const viewMax = smoothedViewCenterHR + zoneWidth;

  cachedDisplayMinHR = viewMin;
  cachedDisplayMaxHR = viewMax;
  cachedZones        = zones;

  const containerH = container.offsetHeight;
  const gradH      = containerH * (totalRange / visibleRange);

  const translateY = -((globalMax - viewMax) / totalRange) * gradH;

  bg.style.height    = `${gradH}px`;
  bg.style.transform = `translateY(${translateY}px)`;
}

function computeDisplayMinHR(zones, restHR, hrMax) {
  const zone1 = zones.find(z => z.zone === 1);
  const zone1Min = zone1 ? zone1.min : (zones[1]?.min || restHR);
  const zoneWidth = (hrMax - restHR) * 0.10;   
  return Math.round(zone1Min - zoneWidth);
}

export function renderWorkoutView(state) {
  const container = document.createElement('div');
  container.className = 'workout-view';

  const currentInterval = getCurrentInterval(state);
  const hrMax  = state.userSettings?.hrMax  || 176;
  const restHR = state.userSettings?.restHR || 60;

  cachedMaxHR  = hrMax;
  cachedRestHR = restHR;

  const zones       = getHRZoneBoundaries(restHR, hrMax);
  const currentZone = getCurrentHRZone(state.hrData?.hr, restHR, hrMax);

  const displayMinHR = computeDisplayMinHR(zones, restHR, hrMax);
  const displayMaxHR = hrMax;
  cachedDisplayMinHR = displayMinHR;
  cachedDisplayMaxHR = displayMaxHR;

  const bgGradient = buildZoneGradient(zones, displayMinHR, displayMaxHR);
  
  const globalRange = Math.max(1, displayMaxHR - displayMinHR);
  const linesHTML = zones.filter(z => z.zone > 0 && z.zone <= 5).map(zone => {
    const pctFromTop = ((displayMaxHR - zone.min) / globalRange) * 100;
    return `<div class="zone-line" style="top: ${pctFromTop}%;"><span>Z${zone.zone} ${zone.min}</span></div>`;
  }).join('');

  const phaseData = currentInterval
    ? INTERVAL_PHASES[currentInterval.phase] || INTERVAL_PHASES.steady
    : INTERVAL_PHASES.steady;

  const intervals = state.workout?.intervals ||[];
  const segmentsHTML = intervals.map((interval, index) => {
    const pd        = INTERVAL_PHASES[interval.phase] || INTERVAL_PHASES.steady;
    const flexValue = interval.type === 'time' ? interval.val : 120;
    return `
    <div class="progress-segment" id="segment-${index}" style="
      flex: ${flexValue};
      background: var(--slate-700);
      height: 100%;
      border-radius: 2px;
      overflow: hidden;
    ">
      <div class="segment-fill" style="
        width: 0%;
        height: 100%;
        background: var(${pd.colorVar});
        transition: width 0.2s linear;
      "></div>
    </div>
  `}).join('');

  const isOverMax = state.hrData?.hr != null && state.hrData.hr > hrMax;
  const zoneText  = isOverMax
    ? '⚠ Over Max HR — Ease Off!'
    : (currentZone ? `Zone ${currentZone.zone} — ${currentZone.name}` : 'No HR Data');
  const zoneColorClass = isOverMax ? 'over-max' : 'normal';

  container.innerHTML = `
      <!-- STATUS BAR -->
      <div class="status-bar">
        <div class="status-indicators">
          <div class="status-indicator ${state.bleConnected ? 'active' : ''}" title="Rower">
            ${state.bleConnected ? icon('broadcast', 'icon') : icon('broadcastSlash', 'icon')}
          </div>
          <div class="status-indicator ${state.hrConnected ? 'active' : ''}" title="Heart Rate">
            ${state.hrConnected ? icon('heart', 'icon') : icon('heartSlash', 'icon')}
          </div>
        </div>
        <div id="status-text" class="status-text muted">
          ${state.workoutStatus === 'active' ? 'Active' : state.workoutStatus === 'paused' ? 'Paused' : 'Ready'}
        </div>
        <div style="position: relative;">
          <button id="workoutMenuBtn" class="menu-btn">
            ${icon('dotsThreeVertical', 'icon')}
          </button>
          <div id="workoutMenuDropdown" class="dropdown-menu hidden">
            <button id="endWorkoutBtn" class="dropdown-item text-danger">
              ${icon('x', 'icon')} End Workout
            </button>
          </div>
        </div>
      </div>

      <!-- MAIN WORKOUT LAYOUT -->
      <div class="workout-layout-grid">
        
        <!-- ZONE DISPLAY -->
        <div class="area-zone hr-zone-display" id="hr-zone-display">
          <div id="hr-zone-bg" class="hr-zone-bg" style="background: ${bgGradient};">
            ${linesHTML}
          </div>
          <canvas id="hrHistoryCanvas" class="hr-history-canvas" style="z-index: 2;"></canvas>
          
          <div class="hr-zone-content" style="z-index: 3;">
            <div class="hr-value-container">
              <span id="display-hr" class="hr-value">${state.hrData?.hr || '--'}</span>
              <span class="hr-unit">bpm</span>
            </div>
            <div id="display-zone" class="hr-zone-label ${zoneColorClass}">
              ${zoneText}
            </div>
            <div id="display-target-hr" class="metric-target muted" style="margin-top: 0.5rem; background: rgba(0,0,0,0.5); padding: 2px 8px; border-radius: 4px;">
              Target: ${currentInterval?.zone ? `Zone ${currentInterval.zone}` : 'None'}
            </div>
          </div>

          <div id="guidanceMessage" class="guidance-strip overlaid">
            ${state.workoutStatus === 'active' ? (getCurrentMessage() || '') : (getCurrentMessage() || 'Start rowing')}
          </div>
        </div>

        <!-- HOLY TRINITY OVERLAY -->
        <div class="area-trinity holy-trinity-side">
          <!-- Pace Card -->
          <div class="hero-card">
            <div class="metric-label muted">Pace /500m</div>
            <div id="display-pace-hero" class="hero-value" style="color: ${getPaceColor(state.rowerData?.pace, currentInterval?.targetPace)}">
              ${formatPace(state.rowerData?.pace || 0, { showUnit: false })}
            </div>
            <div id="display-target-pace" class="metric-target muted">
              ${currentInterval?.targetPace ? `T: ${formatPace(currentInterval.targetPace, {showUnit: false})}` : 'No target'}
            </div>
          </div>

          <!-- SPM Card -->
          <div class="hero-card pacer">
            <div class="pacer-container">
              <svg id="pacer-svg" class="pacer-svg" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" fill="none" stroke="var(--slate-700)" stroke-width="8" />
                <circle id="pacerRing" cx="50" cy="50" r="45" fill="none" stroke="var(--primary)" stroke-width="8" stroke-linecap="round"
                  style="transform: rotate(-90deg); transform-origin: 50% 50%; stroke-dasharray: ${2 * Math.PI * 45}; stroke-dashoffset: ${2 * Math.PI * 45}; transition: none; will-change: stroke-dashoffset;"
                />
                ${(() => {
                  const actualSPM  = state.rowerData?.spm;
                  const targetSPM  = currentInterval?.spm;
                  const roundedSPM = actualSPM ? Math.round(actualSPM) : null;
                  const spmText    = roundedSPM !== null ? roundedSPM : '--';
                  const color      = getSPMColor(roundedSPM, targetSPM);
                  return `
                    <text id="pacerSPM" class="pacer-spm-text" x="50" y="42" text-anchor="middle" dominant-baseline="middle" style="fill: ${color};">${spmText}</text>
                    <text id="pacerTargetSPM" class="pacer-target-text" x="50" y="66" text-anchor="middle" dominant-baseline="middle" style="fill: var(--text-muted); font-size: 14px; font-weight: 600;">T: ${targetSPM || '--'}</text>
                  `;
                })()}
              </svg>
            </div>
          </div>
        </div>

        <!-- PROGRESS -->
        <div class="area-progress interval-progress-card">
          <div class="workout-time-row">
            <div class="workout-time-label muted">Workout Time</div>
            <div id="display-workout-time" class="workout-time-value">${formatTime(state.workoutTime || 0)}</div>
          </div>
          <div class="interval-header">
            <div id="display-interval-name" class="interval-name" style="color: var(${phaseData.colorVar});">
              ${phaseData.label}
            </div>
            <div id="display-interval-type" class="interval-type muted">
              ${currentInterval?.type === 'distance' ? 'Distance' : 'Time'} Interval
            </div>
          </div>
          <div class="progress-segments"><div class="progress-segments-row">${segmentsHTML}</div></div>
          <div>
            <div class="interval-progress-container">
              <div id="progress-interval" class="interval-progress-bar" style="background: ${currentInterval?.phase === 'rest' ? 'var(--slate-500)' : 'linear-gradient(90deg, var(--primary), var(--accent))'};"></div>
            </div>
            <div class="interval-progress-text">
              <span class="muted">Progress</span>
              <span id="display-interval-text" class="interval-progress-value">-- / --</span>
            </div>
          </div>
        </div>

        <!-- DASHBOARD -->
        <div class="area-dashboard dashboard-scroll-wrapper">
          <div class="secondary-metrics">
            ${getDashboardMetricsHTML(state)}
          </div>
        </div>
      </div>
    `;

  scheduleTimer(() => {
    const svg = container.querySelector('#pacer-svg');

    if (spmPacer) spmPacer.destroy();

    if (svg) {
      spmPacer = new SPMPacer(svg, state.userSettings?.enableAudio !== false);
      if (currentInterval) spmPacer.setTargetSPM(currentInterval.spm);
      if (state.workoutStatus === 'active') spmPacer.start();
    }

    initHRHistoryCanvas(container);

    coachingEngine = initCoaching();
    coachingEngine.reset();
    setCoachingEnabled(state.userSettings?.enableCoaching !== false);

    cacheDOMElements(state);

    // Menu Logic
    const menuBtn = container.querySelector('#workoutMenuBtn');
    const dropdown = container.querySelector('#workoutMenuDropdown');
    const endWorkoutBtn = container.querySelector('#endWorkoutBtn');

    if (menuBtn && dropdown) {
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
      };

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!menuBtn.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.classList.add('hidden');
        }
      }, { once: true }); // simple auto-cleanup
    }

    if (endWorkoutBtn) {
      endWorkoutBtn.onclick = () => {
        if (confirm('End workout? Progress will not be saved.')) {
          window.dispatchEvent(new CustomEvent('workout:cancel'));
        }
      };
    }

  }, 0);

  return container;
}

function cacheDOMElements(state) {
  uiCache = {
    intervalName:     document.getElementById('display-interval-name'),
    intervalType:     document.getElementById('display-interval-type'),
    displayPaceHero:  document.getElementById('display-pace-hero'),
    displayTargetPace:document.getElementById('display-target-pace'),
    pacerTargetSPM:   document.getElementById('pacerTargetSPM'),
    displayTargetHR:  document.getElementById('display-target-hr'),
    workoutTimeEl:    document.getElementById('display-workout-time'),
    intervalText:     document.getElementById('display-interval-text'),
    intervalProgress: document.getElementById('progress-interval'),
    displayHR:        document.getElementById('display-hr'),
    displayZone:      document.getElementById('display-zone'),
    displayDist:      document.getElementById('display-dist'),
    displayStrokes:   document.getElementById('display-strokes'),
    displayWatts:     document.getElementById('display-watts'),
    displayCals:      document.getElementById('display-cals'),
    displayDuration:  document.getElementById('display-duration'),
    pacerSPM:         document.getElementById('pacerSPM'),
    guidanceEl:       document.getElementById('guidanceMessage'),
    statusText:       document.getElementById('status-text'),
    segments:         []
  };

  const intervals = state.workout?.intervals || [];
  for (let i = 0; i < intervals.length; i++) {
    const segment = document.getElementById(`segment-${i}`);
    if (segment) {
      const fill = segment.querySelector('.segment-fill');
      uiCache.segments[i] = { segment, fill };
    }
  }
}

export function updateWorkoutView(state) {
  const currentInterval = getCurrentInterval(state);
  const hrMax  = state.userSettings?.hrMax  || 176;
  const restHR = state.userSettings?.restHR || 60;

  cachedMaxHR  = hrMax;
  cachedRestHR = restHR;

  const zones       = getHRZoneBoundaries(restHR, hrMax);
  const currentZone = getCurrentHRZone(state.hrData?.hr, restHR, hrMax);

  cachedDisplayMinHR = computeDisplayMinHR(zones, restHR, hrMax);
  cachedDisplayMaxHR = hrMax;

  // 1. Update Interval Header
  if (uiCache.intervalName && currentInterval) {
    const phaseData = INTERVAL_PHASES[currentInterval.phase] || INTERVAL_PHASES.steady;
    uiCache.intervalName.textContent = phaseData.label;
    uiCache.intervalName.style.color = `var(${phaseData.colorVar})`;
  }
  if (uiCache.intervalType) {
    uiCache.intervalType.textContent = `${currentInterval?.type === 'distance' ? 'Distance' : 'Time'} Interval`;
  }

  // 2. Update Pace Hero and Target
  if (uiCache.displayPaceHero) {
    const actualPace = state.rowerData?.pace || 0;
    const targetPace = currentInterval?.targetPace || null;
    uiCache.displayPaceHero.textContent = formatPace(actualPace, { showUnit: false });
    uiCache.displayPaceHero.style.color = getPaceColor(actualPace, targetPace);
  }
  if (uiCache.displayTargetPace) {
    uiCache.displayTargetPace.textContent = currentInterval?.targetPace
      ? `T: ${formatPace(currentInterval.targetPace, { showUnit: false })}`
      : 'No target';
  }

  // 3. Update Targets
  if (uiCache.pacerTargetSPM) {
    uiCache.pacerTargetSPM.textContent = `T: ${currentInterval?.spm || '--'}`;
  }
  if (spmPacer && currentInterval?.spm) {
    spmPacer.setTargetSPM(currentInterval.spm);
  }
  if (uiCache.displayTargetHR) {
    uiCache.displayTargetHR.textContent = currentInterval?.zone ? `Target: Zone ${currentInterval.zone}` : 'No target';
  }

  // 4. Update Time
  if (uiCache.workoutTimeEl) {
    uiCache.workoutTimeEl.textContent = formatTime(state.workoutTime || 0);
  }

  // 5. Update Current Interval Progress
  if (uiCache.intervalText && currentInterval) {
    const isRest = currentInterval.phase === 'rest';
    const remaining = Math.max(0, currentInterval.val - state.intervalCurrentProgress);
    const text = currentInterval.type === 'distance'
      ? `${Math.round(remaining)}m remaining`
      : `${formatTime(remaining)} remaining`;

    uiCache.intervalText.textContent = isRest ? `Rest: ${text}` : text;
    uiCache.intervalText.style.color = isRest ? 'var(--text-muted)' : 'var(--text-primary)';
  }

  if (uiCache.intervalProgress && currentInterval) {
    const pct = Math.min(100, (state.intervalCurrentProgress / currentInterval.val) * 100);
    uiCache.intervalProgress.style.width = `${pct}%`;
    uiCache.intervalProgress.style.background = currentInterval.phase === 'rest'
      ? 'var(--slate-500)'
      : 'linear-gradient(90deg, var(--primary), var(--accent))';
  }

  // 6. Update Segmented Progress Bar
  const currentIndex = state.currentIntervalIndex;
  if (uiCache.segments && uiCache.segments.length > 0) {
    for (let i = 0; i < uiCache.segments.length; i++) {
      const cached = uiCache.segments[i];
      if (cached?.fill) {
        if (i < currentIndex) cached.fill.style.width = '100%';
        else if (i === currentIndex) {
          const pct = currentInterval ? Math.min(100, (state.intervalCurrentProgress / currentInterval.val) * 100) : 0;
          cached.fill.style.width = `${pct}%`;
        } else cached.fill.style.width = '0%';
      }
    }
  }

  // 7. Update HR Display & Canvas
  const hr       = state.hrData?.hr ?? null;
  const zone0Max = zones.find(z => z.zone === 0)?.max ?? 0;

  if (uiCache.displayHR) uiCache.displayHR.textContent = hr || '--';

  if (hr) updateZoneViewport(hr, zones, hrMax, restHR);

  _lastMetrics = {
    pace: formatPace(state.rowerData?.pace || 0, { showUnit: false }),
    hr: state.hrData?.hr,
    spm: state.rowerData?.spm,
  };

  const isOverMax = hr != null && hr > hrMax;
  const isZero    = hr != null && hr <= zone0Max;

  if (uiCache.displayZone) {
    uiCache.displayZone.classList.remove('over-max', 'resting', 'normal');
    if (isOverMax) {
      uiCache.displayZone.textContent = '\u26a0 Over Max HR';
      uiCache.displayZone.classList.add('over-max');
    } else if (isZero) {
      uiCache.displayZone.textContent = 'Zone 0 \u2014 Resting';
      uiCache.displayZone.classList.add('resting');
    } else {
      uiCache.displayZone.textContent = currentZone ? `Zone ${currentZone.zone} \u2014 ${currentZone.name}` : 'No HR Data';
      uiCache.displayZone.classList.add('normal');
    }
  }

  if (hr) updateHRHistory(hr);

  // 8. Update Dashboard Metrics
  if (uiCache.displayDist) uiCache.displayDist.textContent = `${Math.round(state.rowerData?.distance || 0)}m`;
  if (uiCache.displayWatts) uiCache.displayWatts.textContent = Math.round(state.rowerData?.watts || 0);
  if (uiCache.displayStrokes) uiCache.displayStrokes.textContent = state.rowerData?.strokes || 0;
  if (uiCache.displayCals) uiCache.displayCals.textContent = Math.round(state.rowerData?.cals || 0);
  if (uiCache.displayDuration) uiCache.displayDuration.textContent = formatTime(state.rowerData?.duration || 0);

  // 9. Update Pacer Actual Value
  if (uiCache.pacerSPM) {
    const actualSPM  = state.rowerData?.spm;
    const targetSPM  = currentInterval?.spm;
    const roundedSPM = actualSPM ? Math.round(actualSPM) : null;
    uiCache.pacerSPM.textContent = roundedSPM !== null ? roundedSPM : '--';
    uiCache.pacerSPM.style.fill  = getSPMColor(roundedSPM, targetSPM);
  }
  if (spmPacer && state.rowerData?.spm) {
    spmPacer.updateActualSPM(state.rowerData.spm);
  }

  // 10. Update Coaching Engine
  if (isOverMax) {
    if (uiCache.guidanceEl) {
      uiCache.guidanceEl.textContent = '\u26a0 Ease off! You are over your maximum heart rate!';
    }
    const now = Date.now();
    if (state.workoutStatus === 'active' && now - lastOverMaxAlertTime > OVER_MAX_ALERT_COOLDOWN_MS) {
      lastOverMaxAlertTime = now;
      speak('Ease off! You are over your maximum heart rate! Ease off now!');
    }
  } else {
    if (coachingEngine && state.workoutStatus === 'active') {
      updateCoaching(state, currentInterval, currentZone);
    }
    if (uiCache.guidanceEl) {
      const msg = getCurrentMessage();
      if (state.workoutStatus === 'active') {
        uiCache.guidanceEl.textContent = msg || '';
      } else {
        uiCache.guidanceEl.textContent = msg || 'Start rowing';
      }
    }
  }

  if (uiCache.statusText) {
    uiCache.statusText.textContent = state.workoutStatus === 'active' ? 'Active' : state.workoutStatus === 'paused' ? 'Paused' : 'Ready';
  }
}

export function cleanupWorkoutView() {
  activeTimers.forEach(id => clearTimeout(id));
  activeTimers.clear();

  if (spmPacer) {
    spmPacer.destroy();
    spmPacer = null;
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }

  hrHistoryCanvas      = null;
  hrHistoryContext     = null;
  smoothedViewCenterHR = null;
  hrHistoryData        =[];
  uiCache              = {};
  lastOverMaxAlertTime = 0;

  if (coachingEngine) {
    resetCoaching();
    coachingEngine = null;
  }
}

function getCurrentInterval(state) {
  if (!state.workout?.intervals) return null;
  return state.workout.intervals[state.currentIntervalIndex || 0];
}

function updateHRHistory(hr) {
  if (!hr || !hrHistoryCanvas || !hrHistoryContext) return;
  hrHistoryData.push(hr);
  if (hrHistoryData.length > HR_HISTORY_LENGTH) hrHistoryData.shift();
  drawHRHistory();
}

function initHRHistoryCanvas(container) {
  hrHistoryCanvas = container.querySelector('#hrHistoryCanvas');
  if (!hrHistoryCanvas) return;

  const parent = hrHistoryCanvas.parentElement;
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);

  const setupCanvas = () => {
    if (!hrHistoryCanvas || !parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w   = parent.offsetWidth;
    const h   = parent.offsetHeight;

    hrHistoryCanvas.width  = Math.round(w * dpr);
    hrHistoryCanvas.height = Math.round(h * dpr);
    hrHistoryCanvas.style.width  = `${w}px`;
    hrHistoryCanvas.style.height = `${h}px`;

    hrHistoryContext = hrHistoryCanvas.getContext('2d');
    hrHistoryContext.scale(dpr, dpr);

    if (hrHistoryData.length > 0) drawHRHistory();
  };

  setupCanvas();
  resizeHandler = () => setupCanvas();
  window.addEventListener('resize', resizeHandler);
}

function drawHRHistory() {
  if (!hrHistoryContext || hrHistoryData.length < 2) return;

  const width  = hrHistoryCanvas.offsetWidth;
  const height = hrHistoryCanvas.offsetHeight;

  hrHistoryContext.clearRect(0, 0, width, height);

  const minHR   = cachedDisplayMinHR;
  const maxHR   = cachedDisplayMaxHR;
  const hrRange = Math.max(1, maxHR - minHR);

  hrHistoryContext.shadowColor = 'rgba(0, 0, 0, 0.5)';
  hrHistoryContext.shadowBlur = 4;
  hrHistoryContext.strokeStyle = 'rgba(255, 0, 0, 0.8)';
  hrHistoryContext.lineWidth = 4;
  hrHistoryContext.lineCap     = 'round';
  hrHistoryContext.lineJoin    = 'round';
  hrHistoryContext.beginPath();

  const n    = hrHistoryData.length;
  const step = width / (HR_HISTORY_LENGTH - 1);

  hrHistoryData.forEach((hr, i) => {
    const x = width - ((n - 1 - i) * step);
    const clampedHR = Math.max(minHR, hr);
    const y = height * (1 - (clampedHR - minHR) / hrRange);

    if (i === 0) hrHistoryContext.moveTo(x, y);
    else         hrHistoryContext.lineTo(x, y);
  });

  hrHistoryContext.stroke();
}

export function renderReconnectOverlay(lastMetrics) {
  document.getElementById('reconnect-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'reconnect-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(15, 23, 42, 0.92);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 2rem; z-index: 200;
  `;

  overlay.innerHTML = `
    <div style="color: var(--text-muted); font-size: 0.875rem; letter-spacing: 0.05em;">
      CONNECTION LOST
    </div>

    <div style="opacity: 0.4; text-align: center;">
      <div style="font-size: 3rem; font-weight: bold; font-variant-numeric: tabular-nums;">
        ${lastMetrics.pace ?? '--:--'} <span style="font-size:1rem">${UNITS.pace}</span>
      </div>
      <div style="font-size: 1.25rem; color: var(--text-muted);">
        ${lastMetrics.hr ?? '--'} ${UNITS.hr} · ${lastMetrics.spm ?? '--'} ${UNITS.spm}
      </div>
    </div>

    <button id="btn-reconnect" style="
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 0.75rem;
      padding: 1rem 3rem;
      font-size: 1.25rem;
      font-weight: 600;
      cursor: pointer;
      min-width: 200px;
    ">
      Reconnect
    </button>

    <button id="btn-end-from-disconnect" style="
      background: none;
      border: 1px solid var(--slate-600);
      color: var(--text-muted);
      border-radius: 0.5rem;
      padding: 0.5rem 1.5rem;
      font-size: 0.875rem;
      cursor: pointer;
    ">
      End workout
    </button>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#btn-reconnect').onclick = () => {
    overlay.querySelector('#btn-reconnect').textContent = 'Reconnecting…';
    overlay.querySelector('#btn-reconnect').disabled = true;
    emit(BUS.RECONNECT_REQUEST, {});
  };

  overlay.querySelector('#btn-end-from-disconnect').onclick = () => {
    removeReconnectOverlay();
    window.dispatchEvent(new CustomEvent('workout:cancel'));
  };
}

export function removeReconnectOverlay() {
  document.getElementById('reconnect-overlay')?.remove();
}

export function updateLastMetrics(metrics) {
  _lastMetrics = { ...metrics };
}