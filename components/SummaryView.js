// SummaryView.js - Workout summary with zone distribution

import { formatTime, formatDistance } from '../utils/formatters.js';
import { HR_ZONES, getCurrentHRZone } from '../utils/constants.js';
import { getZoneDistribution, startHRRecoveryMeasurement, getHRRecoveryStatus } from '../utils/zoneTracker.js';
import { icon } from '../utils/icons.js';

export default function renderSummary(state) {
  const workoutId = state.currentWorkoutId;
  const container = document.createElement('div');
  container.className = 'view-container animate-fade-in';
  container.style.background = 'var(--slate-900)';
  container.style.padding = '2rem 1rem';

  const zoneDistribution = getZoneDistribution(state.workoutTime);
  const avgSPM = state.workoutTime > 0
    ? Math.round(state.rowerData.strokes / (state.workoutTime / 60))
    : 0;

  const workDistance = state.rowerData.distance || 0;
  const restDistance = state.peakRestDistanceM || 0;
  const totalDistance = workDistance + restDistance;
  const hasRestDistance = restDistance > 0;

  // Get current HR zone to check if recovery measurement should start
  const hrMax = state.userSettings?.hrMax || 176;
  const restHR = state.userSettings?.restHR || 60;
  const currentZone = state.hrData?.hr ? getCurrentHRZone(state.hrData.hr, restHR, hrMax) : null;

  // Start HR recovery measurement when summary is displayed
  // (will be skipped if HR is already in Zone 1)
  if (state.hrConnected) {
    startHRRecoveryMeasurement(currentZone);
  }

  // Determine if workout was BP-friendly
  const z4Plus = zoneDistribution
    ? zoneDistribution.filter(z => z.zone >= 4).reduce((sum, z) => sum + z.percentage, 0)
    : 0;
  const isBPFriendly = z4Plus <= 15;

  container.innerHTML = `
    <!-- Success Header -->
    <div style="text-align: center; margin-bottom: 2rem;">
      <div style="
        width: 5rem;
        height: 5rem;
        margin: 0 auto 1rem;
        border-radius: 50%;
        background: rgba(16, 185, 129, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        ${icon('starFill', 'icon-xl')}
      </div>
      <h1 style="font-size: 2rem; font-weight: 700; color: white; margin-bottom: 0.5rem;">
        Workout Complete!
      </h1>
      <p style="color: var(--text-muted);">
        ${isBPFriendly ? '✓ Aerobic & BP-friendly session' : 'Workout saved to history'}
      </p>
    </div>

    <!-- Primary Metrics -->
    <div class="card" style="margin-bottom: 1.5rem; padding: 1.5rem;">
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem;">
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            ${hasRestDistance ? 'Work Distance' : 'Distance'}
          </div>
          <div style="font-size: 2rem; font-weight: 700; color: var(--text-primary);">
            ${formatDistance(workDistance)}
          </div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Time
          </div>
          <div style="font-size: 2rem; font-weight: 700; color: var(--text-primary);">
            ${formatTime(state.workoutTime)}
          </div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Avg SPM
          </div>
          <div style="font-size: 2rem; font-weight: 700; color: var(--text-primary);">
            ${avgSPM}
          </div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Calories
          </div>
          <div style="font-size: 2rem; font-weight: 700; color: var(--text-primary);">
            ${Math.floor(state.rowerData.cals)}
          </div>
        </div>
      </div>
      ${hasRestDistance ? `
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--slate-700);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em;">
                Total Distance (incl. rest)
              </div>
              <div style="font-size: 0.875rem; color: var(--text-muted);">
                Rest meters: ${Math.round(restDistance)}m
              </div>
            </div>
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary);">
              ${formatDistance(totalDistance)}
            </div>
          </div>
        </div>
      ` : ''}
    </div>

    <!-- HR Zone Distribution -->
    ${state.hrConnected && zoneDistribution ? `
      <div class="card" style="margin-bottom: 1.5rem; padding: 1.5rem;">
        <h3 style="font-size: 1.125rem; font-weight: 600; color: white; margin-bottom: 1rem;">
          Heart Rate Zones
        </h3>

        <!-- Zone Details -->
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          ${zoneDistribution.map(zd => {
            const zone = HR_ZONES.find(z => z.zone === zd.zone);
            return zd.seconds > 0 ? `
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
            ` : '';
          }).join('')}
        </div>

        <!-- Recovery Metric -->
        ${state.hrConnected ? `
          <div id="recovery-section" style="
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid var(--slate-700);
          ">
            <div id="recovery-content">
              <!-- Content will be updated by JavaScript -->
            </div>
          </div>
        ` : ''}
      </div>
    ` : ''}

    <!-- Action Buttons -->
    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
      <button id="showDetailsBtn" class="btn-secondary" style="
        width: 100%;
        padding: 1rem;
        font-weight: 600;
        border-radius: 0.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      ">
        ${icon('chartLineUp', 'icon')} Show Details
      </button>

      <button id="finishBtn" class="btn-primary" style="
        width: 100%;
        padding: 1rem;
        font-weight: 600;
        border-radius: 0.75rem;
      ">
        ${icon('house', 'icon')} Back to Home
      </button>
    </div>
  `;

  setTimeout(() => {
    const finishBtn = document.getElementById('finishBtn');
    const showDetailsBtn = document.getElementById('showDetailsBtn');

    if (finishBtn) {
      finishBtn.onclick = () => {
        window.dispatchEvent(new CustomEvent('nav:home'));
      };
    }

    if (showDetailsBtn) {
      showDetailsBtn.onclick = () => {
        const workoutId = state.currentWorkoutId;
        if (workoutId) {
          window.dispatchEvent(new CustomEvent('workout:showDetail', {
            detail: { workoutId }
          }));
        }
      };
    }

    // Start HR recovery countdown if HR is connected
    if (state.hrConnected) {
      startRecoveryCountdown();
    }
  }, 0);

  return container;
}

function startRecoveryCountdown() {
  const recoveryContent = document.getElementById('recovery-content');
  if (!recoveryContent) return;

  let recoveryInterval = null; // 1. Define variable first

  const updateRecoveryDisplay = () => {
    const status = getHRRecoveryStatus();

    if (status.status === 'skipped') {
      recoveryContent.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 0.875rem; color: var(--text-muted);">
            ${icon('info', 'icon')}
            ${status.reason}
          </div>
        </div>
      `;
      if (recoveryInterval) clearInterval(recoveryInterval); // 2. Check existence
    } else if (status.status === 'measuring') {
      recoveryContent.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
            ${icon('heartbeat', 'icon')}
            Measuring HR recovery... Sit still and relax
          </div>
          <div style="font-size: 2rem; font-weight: 700; color: var(--primary);">
            ${formatTime(status.remaining)}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary);">
            Starting HR: ${status.startHR} bpm
          </div>
        </div>
      `;
    } else if (status.status === 'complete') {
      const recovery = status.recovery;
      const startZone = status.startZone; // Get the locked-in zone
      const label = getRecoveryLabel(recovery, startZone);
      const color = getRecoveryColor(label);

      recoveryContent.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase;">
              HR Recovery (From Zone ${startZone})
            </div>
            <div style="font-size: 0.875rem; color: var(--text-secondary);">
              ${label}
            </div>
          </div>
          <div style="font-size: 1.5rem; font-weight: 700; color: ${color};">
            -${Math.abs(recovery)} bpm
          </div>
        </div>
      `;
      if (recoveryInterval) clearInterval(recoveryInterval);
    }
  };

  // Update immediately
  updateRecoveryDisplay();
  // Start interval
  recoveryInterval = setInterval(updateRecoveryDisplay, 1000);
}

function getRecoveryLabel(recovery, startZone) {
  // Logic: The higher the zone, the higher the "requirement" for an 'Excellent' score.
  // We use a base threshold and add a 'penalty/bonus' based on the zone.
  
  let thresholds = { excellent: 25, good: 15, normal: 10 };

  if (startZone >= 5) {
    thresholds = { excellent: 35, good: 22, normal: 15 }; // Hardest to achieve
  } else if (startZone === 4) {
    thresholds = { excellent: 30, good: 18, normal: 12 };
  } else if (startZone === 2) {
    thresholds = { excellent: 20, good: 12, normal: 8 };  // Most forgiving
  }

  if (recovery >= thresholds.excellent) return 'Excellent';
  if (recovery >= thresholds.good)      return 'Good';
  if (recovery >= thresholds.normal)    return 'Normal';
  return 'Keep training';
}

function getRecoveryColor(label) {
  const colors = {
    'Excellent': 'var(--primary)', // Green/Gold
    'Good': '#3b82f6',             // Blue
    'Normal': 'var(--accent)',     // Yellow/Orange
    'Keep training': 'var(--danger)' // Red
  };
  return colors[label] || 'var(--text-secondary)';
}