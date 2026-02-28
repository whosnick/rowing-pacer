// components/WorkoutDetailView.js - Detailed workout analysis with graphs

import { formatTime, formatPace, formatDistance, formatHR, formatSPM } from '../utils/formatters.js';
import { HR_ZONES, UNITS } from '../utils/constants.js';
import { getWorkout, getBleDataForWorkout } from '../utils/storage.js';
import { icon } from '../utils/icons.js';
import { uploadToConcept2, buildIntervalBoundaries } from '../utils/c2Service.js';

// Canvas and graph state
let canvas = null;
let ctx = null;
let chartData = null;
let resizeHandler = null;

// View state
let viewMode = 'whole'; // 'whole' or 'interval'
let selectedInterval = 0;
let visibleMetrics = {
  hr: true,
  pace: true,
  spm: true
};

export default function renderWorkoutDetail(state) {
  const container = document.createElement('div');
  container.className = 'view-container animate-fade-in';
  container.style.cssText = `
    background: var(--slate-900);
    min-height: 100vh;
    padding: 1rem;
    padding-bottom: 2rem;
  `;

  const workoutId = state.detailWorkoutId;

  container.innerHTML = `
    <div id="detail-content">
      <div style="text-align: center; padding: 3rem 1rem;">
        <div class="loading"></div>
        <p style="color: var(--text-muted); margin-top: 1rem;">Loading workout data...</p>
      </div>
    </div>
  `;

  // Load data asynchronously
  setTimeout(() => loadWorkoutData(workoutId, container, state), 0);

  return container;
}

async function loadWorkoutData(workoutId, container, state) {
  try {
    console.log('[WorkoutDetail] Loading workout from DB:', workoutId);
    const workout = await getWorkout(workoutId);
    if (!workout) {
      container.innerHTML = renderError('Workout not found');
      return;
    }
    console.log('[WorkoutDetail] Loaded workout:', workout.name, 'ID:', workout.id);

    let rawStrokes = null;
    
    const rawBleData = await getBleDataForWorkout(workoutId);
    const strokeRecord = rawBleData.find(r => r.type === 'concept2_strokes');

    if (strokeRecord && strokeRecord.data) {
      console.log('[WorkoutDetail] Found high-res per-stroke data:', strokeRecord.data.length, 'strokes');
      rawStrokes = strokeRecord.data;
    } else {
      console.warn('[WorkoutDetail] No telemetry data found for this workout.');
    }

    chartData = processBleData(workout, rawStrokes, state);
    console.log('[WorkoutDetail] Processed chart data:', {
      timestamps: chartData.timestamps.length,
      hrValues: chartData.hrValues.filter(v => v !== null).length,
      paceValues: chartData.paceValues.filter(v => v > 0).length,
      spmValues: chartData.spmValues.filter(v => v > 0).length
    });

    if (chartData.intervalBoundaries) {
      workout.intervalBoundaries = chartData.intervalBoundaries;
    }

    const contentDiv = container.querySelector('#detail-content');
    if (contentDiv) {
      contentDiv.innerHTML = renderContent(workout, state, rawStrokes);
      setupEventHandlers(container, workout, state, rawStrokes);
      initChart(container, workout, state);
    }
  } catch (error) {
    console.error('[WorkoutDetail] Failed to load data:', error);
    container.innerHTML = renderError('Failed to load workout data');
  }
}

function processBleData(workout, rawStrokes, state) {
  const boundaries = buildIntervalBoundaries(workout);
  
  const timestamps = [];
  const hrValues = [];
  const paceValues = [];
  const spmValues = [];
  const distanceValues = [];
  const intervalIndices = [];

  if (rawStrokes && rawStrokes.length > 0) {
    rawStrokes.forEach(s => {
      timestamps.push(s.t / 10);
      paceValues.push(s.p / 10);
      spmValues.push(s.spm || 0);
      distanceValues.push(s.d / 10);
      hrValues.push(s.hr ?? null);
      intervalIndices.push(0);
    });
  }

  let hrSum = 0, hrCount = 0;
  let paceSum = 0, paceCount = 0;
  let spmSum = 0, spmCount = 0;

  for (let i = 0; i < hrValues.length; i++) {
    if (hrValues[i] !== null) {
      hrSum += hrValues[i];
      hrCount++;
    }
    if (paceValues[i] > 0) {
      paceSum += paceValues[i];
      paceCount++;
    }
    if (spmValues[i] > 0) {
      spmSum += spmValues[i];
      spmCount++;
    }
  }

  const avgHR = hrCount > 0 ? hrSum / hrCount : 0;
  const avgPace = paceCount > 0 ? paceSum / paceCount : 0;
  const avgSPM = spmCount > 0 ? spmSum / spmCount : 0;

  const intervalStats = [];
  const intervalStrokeData = [];
  
  if (boundaries.length > 0 && rawStrokes && rawStrokes.length > 0) {
    let actualEndTime = 0;
    let actualEndDist = 0;
    
    for (let i = 0; i < boundaries.length; i++) {
      const boundary = boundaries[i];
      const nextBoundary = boundaries[i + 1];
      
      if (workout.intervals[i]?.phase === 'rest') continue;
      
      const intervalDef = workout.intervals[i];
      const isTimeBased = intervalDef.type === 'time';
      
      let intervalStrokes;
      
      if (isTimeBased) {
        const filterStartTime = actualEndTime;
        const filterEndTime = filterStartTime + intervalDef.val;
        
        intervalStrokes = rawStrokes.filter(s => {
          const strokeTime = s.t / 10;
          return strokeTime >= filterStartTime && strokeTime < filterEndTime;
        });
        
        actualEndTime = filterEndTime;
        if (intervalStrokes.length > 0) {
          actualEndDist = intervalStrokes[intervalStrokes.length - 1].d / 10;
        }
      } else {
        const filterStartDist = actualEndDist;
        const filterEndDist = filterStartDist + intervalDef.val;
        
        intervalStrokes = rawStrokes.filter(s => {
          const strokeDist = s.d / 10;
          return strokeDist >= filterStartDist && strokeDist < filterEndDist;
        });
        
        if (intervalStrokes.length > 0) {
          actualEndDist = intervalStrokes[intervalStrokes.length - 1].d / 10;
          actualEndTime = intervalStrokes[intervalStrokes.length - 1].t / 10;
        } else {
          actualEndDist = filterEndDist;
        }
      }

      if (intervalStrokes.length > 0) {
        const baseT = intervalStrokes[0].t / 10;
        const baseD = intervalStrokes[0].d / 10;
        
        const strokesWithResetTime = intervalStrokes.map(s => ({
          t: (s.t / 10) - baseT,
          p: s.p / 10,
          spm: s.spm || 0,
          d: (s.d / 10) - baseD,
          hr: s.hr
        }));
        
        intervalStrokeData.push(strokesWithResetTime);
        
        const avgIntervalPace = strokesWithResetTime.reduce((sum, s) => sum + (s.p || 0), 0) / strokesWithResetTime.length;
        const avgIntervalSPM = strokesWithResetTime.reduce((sum, s) => sum + (s.spm || 0), 0) / strokesWithResetTime.length;
        const hrPoints = strokesWithResetTime.filter(s => s.hr != null && s.hr < 255);
        const avgIntervalHR = hrPoints.length > 0
          ? hrPoints.reduce((sum, s) => sum + s.hr, 0) / hrPoints.length
          : 0;

        intervalStats.push({
          index: intervalStats.length,
          originalIntervalIndex: i,
          startTime: baseT,
          endTime: intervalStrokes[intervalStrokes.length - 1].t / 10,
          duration: intervalStrokes[intervalStrokes.length - 1].t / 10 - baseT,
          avgPace: avgIntervalPace,
          avgSPM: avgIntervalSPM,
          avgHR: avgIntervalHR,
          distance: intervalStrokes[intervalStrokes.length - 1].d / 10 - baseD,
          type: intervalDef.type,
          target: intervalDef.val
        });
      }
    }
  }

  return {
    timestamps,
    hrValues,
    paceValues,
    spmValues,
    distanceValues,
    intervalIndices,
    avgHR,
    avgPace,
    avgSPM,
    intervalStats,
    intervalBoundaries: boundaries,
    intervalStrokeData,
    rawStrokes
  };
}

function renderContent(workout, state, rawStrokes) {
  const date = new Date(workout.date);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `
    <!-- Header -->
    <div style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <button id="backBtn" style="
          background: none; border: none; color: var(--text-muted); cursor: pointer;
          padding: 0.5rem 0; font-size: 0.875rem; display: flex; align-items: center; gap: 0.25rem;
        ">
          ${icon('caretLeft', 'icon')} Back
        </button>
        <h1 style="font-size: 1.5rem; font-weight: 700; color: white; margin-top: 0.5rem;">
          ${workout.name}
        </h1>
        <p style="color: var(--text-muted); font-size: 0.875rem;">${dateStr}</p>
      </div>
      
      <!-- Upload Button -->
      ${rawStrokes && rawStrokes.length > 0 ? `
        <button id="c2SyncBtn" class="btn-primary" style="
          display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; padding: 0.5rem 1rem; margin-top: 0.5rem;
        ">
          ${icon('activity', 'icon-sm')} To Logbook
        </button>
      ` : ''}
    </div>

    <!-- Static Stats Grid -->
    <div class="card" style="margin-bottom: 1rem; padding: 1rem;">
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
        <div style="text-align: center;">
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.25rem;">
            Distance
          </div>
          <div style="font-size: 1.75rem; font-weight: 700; color: var(--text-primary);">
            ${formatDistance(workout.distance)}
          </div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.25rem;">
            Time
          </div>
          <div style="font-size: 1.75rem; font-weight: 700; color: var(--text-primary);">
            ${formatTime(workout.duration)}
          </div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.25rem;">
            Avg Pace
          </div>
          <div style="font-size: 1.75rem; font-weight: 700; color: var(--text-primary);">
            ${formatPace(chartData?.avgPace || workout.avgPace || 0)}
          </div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.25rem;">
            Avg SPM
          </div>
          <div style="font-size: 1.75rem; font-weight: 700; color: var(--text-primary);">
            ${Math.round(chartData?.avgSPM || workout.avgSPM || 0)}
          </div>
        </div>
      </div>
    </div>

    <!-- View Mode Toggle -->
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
      <button id="viewWhole" class="view-toggle ${viewMode === 'whole' ? 'active' : ''}" style="flex: 1;">
        Whole Workout
      </button>
      <button id="viewInterval" class="view-toggle ${viewMode === 'interval' ? 'active' : ''}" style="flex: 1;">
        By Interval
      </button>
    </div>

    <div id="interval-selector-container" style="display: ${viewMode === 'interval' ? 'block' : 'none'};">
      ${renderIntervalSelector(workout, chartData)}
    </div>

    <!-- Chart Legend -->
    <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
      <button id="toggleHR" class="legend-btn ${visibleMetrics.hr ? 'active' : ''}" style="--metric-color: #ef4444;">
        <span class="legend-dot"></span> HR (${UNITS.hr})
      </button>
      <button id="togglePace" class="legend-btn ${visibleMetrics.pace ? 'active' : ''}" style="--metric-color: #06b6d4;">
        <span class="legend-dot"></span> Pace (${UNITS.pace})
      </button>
      <button id="toggleSPM" class="legend-btn ${visibleMetrics.spm ? 'active' : ''}" style="--metric-color: #f59e0b;">
        <span class="legend-dot"></span> SPM (${UNITS.spm})
      </button>
    </div>

    <!-- Chart Container -->
    <div class="card" style="padding: 1rem; margin-bottom: 1rem;">
      <canvas id="workoutChart" style="width: 100%; height: 300px;"></canvas>
    </div>

    <!-- Interval Stats (when in interval view) -->
    <div id="interval-stats-container" style="display: ${viewMode === 'interval' && chartData?.intervalStats[selectedInterval] ? 'block' : 'none'};">
      ${viewMode === 'interval' && chartData?.intervalStats[selectedInterval] ? renderIntervalStats(chartData.intervalStats[selectedInterval]) : ''}
    </div>

    <!-- Zone Distribution -->
    ${workout.zoneDistribution ? renderZoneDistribution(workout.zoneDistribution) : ''}
  `;
}

function renderIntervalSelector(workout, chartData) {
  if (!chartData?.intervalStats || chartData.intervalStats.length === 0) return '';

  return `
    <div style="margin-bottom: 1rem;">
      <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.5rem;">
        Select Interval
      </div>
      <div style="display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.5rem;">
        ${chartData.intervalStats.map((stat, idx) => {
          const isDistance = stat.type === 'distance';
          const targetLabel = isDistance
            ? `${stat.target}m`
            : formatTime(stat.target);

          return `
            <button
              class="interval-btn ${selectedInterval === idx ? 'active' : ''}"
              data-interval="${idx}"
              style="flex-shrink: 0; min-width: 100px;"
            >
              <div style="font-size: 0.875rem; font-weight: 600;">Interval ${idx + 1}</div>
              <div style="font-size: 0.65rem; opacity: 0.7; text-transform: uppercase;">${isDistance ? 'Distance' : 'Time'}: ${targetLabel}</div>
              <div style="font-size: 0.75rem; opacity: 0.8;">${formatTime(stat.duration)}</div>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderIntervalStats(stats) {
  return `
    <div class="card" style="padding: 1rem; margin-bottom: 1rem;">
      <h3 style="font-size: 1rem; font-weight: 600; color: white; margin-bottom: 0.75rem;">
        Interval ${stats.index + 1} Stats
      </h3>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary);">Avg Heart Rate</div>
          <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary);">
            ${formatHR(stats.avgHR)}
          </div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary);">Avg Pace</div>
          <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary);">
            ${formatPace(stats.avgPace)}
          </div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary);">Avg SPM</div>
          <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary);">
            ${formatSPM(stats.avgSPM)}
          </div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary);">Distance</div>
          <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary);">
            ${formatDistance(stats.distance)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderZoneDistribution(zoneDistribution) {
  return `
    <div class="card" style="padding: 1rem;">
      <h3 style="font-size: 1rem; font-weight: 600; color: white; margin-bottom: 0.75rem;">
        Heart Rate Zones
      </h3>
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        ${zoneDistribution.filter(z => z.seconds > 0).map(zd => {
          const zone = HR_ZONES.find(z => z.zone === zd.zone);
          return `
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div style="
                  width: 0.75rem;
                  height: 0.75rem;
                  border-radius: 50%;
                  background: var(${zone.colorVar});
                "></div>
                <span style="color: var(--text-secondary); font-size: 0.875rem;">
                  Zone ${zone.zone} - ${zone.name}
                </span>
              </div>
              <div style="color: var(--text-primary); font-weight: 600; font-size: 0.875rem;">
                ${formatTime(zd.seconds)} (${zd.percentage}%)
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderError(message) {
  return `
    <div style="text-align: center; padding: 3rem 1rem;">
      ${icon('warningCircle', 'icon-xl')}
      <p style="color: var(--text-muted);">${message}</p>
      <button id="backBtn" class="btn-secondary" style="margin-top: 1rem;">
        Go Back
      </button>
    </div>
  `;
}

function setupEventHandlers(container, workout, state, rawStrokes) {
  const backBtn = container.querySelector('#backBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      cleanupWorkoutDetail();
      const previous = state.detailPreviousView || 'history';
      window.dispatchEvent(new CustomEvent(`nav:${previous}`));
    };
  }

  // Concept2 Upload Handler
  const c2SyncBtn = container.querySelector('#c2SyncBtn');
  if (c2SyncBtn && rawStrokes) {
    c2SyncBtn.onclick = async () => {
      try {
        c2SyncBtn.disabled = true;
        c2SyncBtn.innerHTML = '<div class="loading" style="width: 1rem; height: 1rem; min-height: auto;"></div> Uploading...';
        
        await uploadToConcept2(workout, rawStrokes);
        
        c2SyncBtn.innerHTML = '&#10003; Uploaded'; 
        c2SyncBtn.classList.replace('btn-primary', 'btn-secondary');
      } catch (err) {
        console.error("C2 Upload Error:", err);
        alert('Upload failed: ' + err.message);
        c2SyncBtn.disabled = false;
        c2SyncBtn.innerHTML = `${icon('activity', 'icon-sm')} To Logbook`;
      }
    };
  }

  const viewWhole = container.querySelector('#viewWhole');
  const viewInterval = container.querySelector('#viewInterval');

  if (viewWhole) {
    viewWhole.onclick = () => {
      viewMode = 'whole';
      updateView(container, workout, state);
    };
  }

  if (viewInterval) {
    viewInterval.onclick = () => {
      viewMode = 'interval';
      updateView(container, workout, state);
    };
  }

  const toggleHR = container.querySelector('#toggleHR');
  const togglePace = container.querySelector('#togglePace');
  const toggleSPM = container.querySelector('#toggleSPM');

  if (toggleHR) {
    toggleHR.onclick = () => {
      visibleMetrics.hr = !visibleMetrics.hr;
      toggleHR.classList.toggle('active', visibleMetrics.hr);
      redrawChart(container, workout, state);
    };
  }

  if (togglePace) {
    togglePace.onclick = () => {
      visibleMetrics.pace = !visibleMetrics.pace;
      togglePace.classList.toggle('active', visibleMetrics.pace);
      redrawChart(container, workout, state);
    };
  }

  if (toggleSPM) {
    toggleSPM.onclick = () => {
      visibleMetrics.spm = !visibleMetrics.spm;
      toggleSPM.classList.toggle('active', visibleMetrics.spm);
      redrawChart(container, workout, state);
    };
  }

  const intervalBtns = container.querySelectorAll('.interval-btn');
  intervalBtns.forEach(btn => {
    btn.onclick = () => {
      selectedInterval = parseInt(btn.dataset.interval);
      intervalBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateView(container, workout, state);
    };
  });
}

function updateView(container, workout, state) {
  const viewWhole = container.querySelector('#viewWhole');
  const viewInterval = container.querySelector('#viewInterval');

  if (viewWhole && viewInterval) {
    viewWhole.classList.toggle('active', viewMode === 'whole');
    viewInterval.classList.toggle('active', viewMode === 'interval');
  }

  const intervalSelector = container.querySelector('#interval-selector-container');
  if (intervalSelector) {
    intervalSelector.style.display = viewMode === 'interval' ? 'block' : 'none';
  }

  const intervalStats = container.querySelector('#interval-stats-container');
  if (intervalStats) {
    if (viewMode === 'interval' && chartData?.intervalStats[selectedInterval]) {
      intervalStats.innerHTML = renderIntervalStats(chartData.intervalStats[selectedInterval]);
      intervalStats.style.display = 'block';
    } else {
      intervalStats.style.display = 'none';
    }
  }

  redrawChart(container, workout, state);
}

function redrawChart(container, workout, state) {
  const canvas = container.querySelector('#workoutChart');
  if (!canvas || !chartData) return;

  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  drawChart(canvas.getContext('2d'), width, height, workout, state);
}

function initChart(container, workout, state) {
  canvas = container.querySelector('#workoutChart');
  if (!canvas || !chartData) return;

  const parent = canvas.parentElement;

  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
  }

  const setupCanvas = () => {
    if (!canvas || !parent) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    const width = rect.width - 32; 
    const height = 300;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    drawChart(ctx, width, height, workout, state);
  };

  setupCanvas();

  resizeHandler = () => setupCanvas();
  window.addEventListener('resize', resizeHandler);
}

function drawChart(ctx, width, height, workout, state) {
  if (!chartData) return;

  const padding = { top: 20, right: 60, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);

  let dataPoints = [];
  let timeRange = 0;
  let startTime = 0;
  let endTime = 0;

  if (viewMode === 'interval' && chartData.intervalStrokeData && chartData.intervalStrokeData[selectedInterval]) {
    dataPoints = chartData.intervalStrokeData[selectedInterval];
    if (dataPoints.length > 0) {
      startTime = 0;
      endTime = dataPoints[dataPoints.length - 1].t;
      timeRange = endTime || 1;
    }
  } else {
    startTime = chartData.timestamps.length > 0 ? chartData.timestamps[0] : 0;
    endTime = chartData.timestamps.length > 0 ? chartData.timestamps[chartData.timestamps.length - 1] : workout.duration;
    timeRange = endTime - startTime || 1;
    
    dataPoints = chartData.timestamps.map((t, i) => ({
      t: t - startTime,
      p: chartData.paceValues[i],
      spm: chartData.spmValues[i],
      hr: chartData.hrValues[i],
      d: chartData.distanceValues[i]
    }));
  }

  if (dataPoints.length < 2) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Not enough data', width / 2, height / 2);
    return;
  }

  const hrValues = dataPoints.map(s => s.hr).filter(v => v !== null && v < 255);
  const paceValues = dataPoints.map(s => s.p).filter(v => v > 0);
  const spmValues = dataPoints.map(s => s.spm).filter(v => v > 0);

  const hrMin = hrValues.length > 0 ? Math.min(...hrValues) * 0.9 : 60;
  const hrMax = hrValues.length > 0 ? Math.max(...hrValues) * 1.1 : 180;
  const hrRange = hrMax - hrMin || 1;

  const paceMin = paceValues.length > 0 ? Math.min(...paceValues) * 0.9 : 100;
  const paceMax = paceValues.length > 0 ? Math.max(...paceValues) * 1.1 : 180;
  const paceRange = paceMax - paceMin || 1;

  const spmMin = spmValues.length > 0 ? Math.min(...spmValues) * 0.8 : 15;
  const spmMax = spmValues.length > 0 ? Math.max(...spmValues) * 1.2 : 35;
  const spmRange = spmMax - spmMin || 1;

  const timeToX = (t) => padding.left + (t / timeRange) * chartWidth;
  const hrToY = (hr) => padding.top + chartHeight - ((hr - hrMin) / hrRange) * chartHeight;
  const paceToY = (pace) => padding.top + ((pace - paceMin) / paceRange) * chartHeight;
  const spmToY = (spm) => padding.top + chartHeight - ((spm - spmMin) / spmRange) * chartHeight;

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  const timeStep = timeRange > 600 ? 120 : timeRange > 300 ? 60 : 30;
  for (let t = 0; t <= timeRange; t += timeStep) {
    const x = timeToX(t);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
  }

  if (viewMode === 'whole' && workout.intervalBoundaries) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;

    for (const boundary of workout.intervalBoundaries) {
      if (boundary.startTime > startTime && boundary.startTime < endTime) {
        const x = timeToX(boundary.startTime - startTime);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, height - padding.bottom);
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);
  }

  if (visibleMetrics.hr && hrValues.length > 0) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();

    let firstPoint = true;
    for (const s of dataPoints) {
      if (s.hr !== null && s.hr < 255) {
        const x = timeToX(s.t);
        const y = hrToY(s.hr);
        if (firstPoint) {
          ctx.moveTo(x, y);
          firstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();
  }

  if (visibleMetrics.pace && paceValues.length > 0) {
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2;
    ctx.beginPath();

    let firstPoint = true;
    for (const s of dataPoints) {
      if (s.p > 0) {
        const x = timeToX(s.t);
        const y = paceToY(s.p);
        if (firstPoint) {
          ctx.moveTo(x, y);
          firstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();
  }

  if (visibleMetrics.spm && spmValues.length > 0) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();

    let firstPoint = true;
    for (const s of dataPoints) {
      if (s.spm > 0) {
        const x = timeToX(s.t);
        const y = spmToY(s.spm);
        if (firstPoint) {
          ctx.moveTo(x, y);
          firstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();
  }

  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';

  if (visibleMetrics.hr) {
    ctx.fillStyle = '#ef4444';
    for (let i = 0; i <= 4; i++) {
      const value = hrMin + (hrRange / 4) * (4 - i);
      const y = padding.top + (chartHeight / 4) * i;
      ctx.fillText(`${Math.round(value)} ${UNITS.hr}`, padding.left - 8, y + 4);
    }
  }

  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  for (let t = 0; t <= timeRange; t += timeStep) {
    const x = timeToX(t);
    ctx.fillText(formatTime(t), x, height - padding.bottom + 16);
  }

  ctx.textAlign = 'left';

  if (visibleMetrics.pace) {
    ctx.fillStyle = '#06b6d4';
    for (let i = 0; i <= 4; i++) {
      const value = paceMin + (paceRange / 4) * i;
      const y = padding.top + (chartHeight / 4) * i;
      ctx.fillText(formatPace(value, { showUnit: false }) + ' ' + UNITS.pace, width - padding.right + 8, y + 4);
    }
  }

  if (visibleMetrics.spm && !visibleMetrics.pace) {
    ctx.fillStyle = '#f59e0b';
    for (let i = 0; i <= 4; i++) {
      const value = spmMin + (spmRange / 4) * (4 - i);
      const y = padding.top + (chartHeight / 4) * i;
      ctx.fillText(`${Math.round(value)} ${UNITS.spm}`, width - padding.right + 8, y + 4);
    }
  }
}

export function cleanupWorkoutDetail() {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  canvas = null;
  ctx = null;
  chartData = null;
}