// components/ProgramListView.js
import { INTERVAL_PHASES } from '../utils/constants.js';
import { icon } from '../utils/icons.js';

export default function renderProgramList(state) {
  const container = document.createElement('div');
  container.className = 'view-container';
  container.style.padding = '1.5rem';
  container.style.paddingBottom = '5rem';

  const allWorkouts = state.programs || [];

  container.innerHTML = `
    <div style="margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 style="font-size: 2rem; font-weight: 700; color: white; margin-bottom: 0.5rem;">
          Programs
        </h1>
        <p style="color: var(--text-muted); font-size: 0.875rem;">
          Select or star your favorite
        </p>
      </div>
      <button id="createNewBtn" class="btn-primary" style="padding: 0.5rem 1rem;">
        ${icon('plus', 'icon')} New
      </button>
    </div>

    <!-- Unified List -->
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      ${allWorkouts.length > 0 
        ? allWorkouts.map(w => renderWorkoutCard(w)).join('') 
        : '<div style="text-align:center; padding: 2rem; border: 2px dashed var(--slate-700); border-radius: 0.5rem; color: var(--text-muted);">No programs found</div>'
      }
    </div>

    <!-- RESTORE BUTTON -->
    <div style="margin-top: 3rem; text-align: center; border-top: 1px solid var(--slate-800); padding-top: 1.5rem;">
        <button id="restoreBtn" style="background: transparent; color: var(--text-muted); border: 1px solid var(--slate-700); padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-size: 0.875rem; cursor: pointer;">
            ${icon('arrowCounterClockwise', 'icon')} Restore Default Templates
        </button>
    </div>
  `;

  setTimeout(() => {
    document.getElementById('createNewBtn').onclick = () => window.dispatchEvent(new CustomEvent('nav:editor', { detail: null }));
    document.getElementById('restoreBtn').onclick = () => window.dispatchEvent(new CustomEvent('program:restore'));

    // Handle Buttons
    container.querySelectorAll('.btn-action').forEach(btn => {
      btn.onclick = (e) => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const workout = allWorkouts.find(w => w.id === id);
        if (!workout) return;

        if (action === 'start') {
             window.dispatchEvent(new CustomEvent('workout:select', { detail: workout }));
        } else if (action === 'edit') {
            window.dispatchEvent(new CustomEvent('nav:editor', { detail: { workout } }));
        } else if (action === 'delete') {
            if (confirm(`Delete "${workout.name}"?`)) {
                window.dispatchEvent(new CustomEvent('program:delete', { detail: { id: workout.id } }));
            }
        } else if (action === 'fav') {
            window.dispatchEvent(new CustomEvent('program:toggleFavorite', { detail: { id: workout.id } }));
        }
      };
    });
  }, 0);

  return container;
}

function renderWorkoutCard(workout) {
  const meta = analyzeWorkout(workout);
  const isFav = !!workout.isFavorite;
  
  return `
    <div class="card" style="padding: 1.5rem; border: 1px solid var(--slate-700); border-left: ${isFav ? '4px solid var(--accent)' : '1px solid var(--slate-700)'};">
      <div style="display: flex; align-items: start; justify-content: space-between; margin-bottom: 1rem;">
        <div style="flex: 1;">
          <h3 style="font-size: 1.125rem; font-weight: 600; color: white; margin-bottom: 0.25rem;">
            ${workout.name}
          </h3>
          <p style="font-size: 0.875rem; color: var(--text-muted);">
            ${meta.description}
          </p>
        </div>
        <!-- Favorite Button -->
        <button class="btn-action" data-action="fav" data-id="${workout.id}" style="
            background: none; 
            color: ${isFav ? 'var(--accent)' : 'var(--text-muted)'}; 
            padding: 0.5rem;
        ">
            ${icon(isFav ? 'starFill' : 'star')}
        </button>
      </div>

      <div style="display: flex; gap: 1.5rem; margin-bottom: 1.5rem;">
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase;">Duration</div>
          <div style="font-size: 1rem; font-weight: 600; color: var(--text-primary);">~${meta.durationMin} min</div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase;">Intervals</div>
          <div style="font-size: 1rem; font-weight: 600; color: var(--text-primary);">${workout.intervals.length}</div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase;">Intensity</div>
          <div style="font-size: 1rem; font-weight: 600; color: ${meta.intensityColor};">${meta.intensityLabel}</div>
        </div>
      </div>

      <div style="display: flex; gap: 2px; height: 6px; border-radius: 3px; overflow: hidden; opacity: 0.8; margin-bottom: 1.25rem;">
        ${workout.intervals.map(i => `
          <div style="flex: ${i.type === 'time' ? i.val : 120}; background: var(${INTERVAL_PHASES[i.phase]?.colorVar || '--slate-500'});"></div>
        `).join('')}
      </div>

      <div style="display: flex; gap: 0.75rem;">
        <button class="btn-primary btn-action" data-action="start" data-id="${workout.id}" style="flex: 1; padding: 0.75rem;">
            Start
        </button>
        <button class="btn-secondary btn-action" data-action="edit" data-id="${workout.id}" style="padding: 0.75rem;">
            ${icon('pencilSimple', 'icon')}
        </button>
        <button class="btn-danger btn-action" data-action="delete" data-id="${workout.id}" style="padding: 0.75rem;">
            ${icon('trash', 'icon')}
        </button>
      </div>
    </div>
  `;
}

function analyzeWorkout(workout) {
  let totalSeconds = 0;
  let maxZone = 1;
  workout.intervals.forEach(i => {
    const duration = i.type === 'time' ? i.val : (i.val / 500) * 150;
    totalSeconds += duration;
    if (i.zone > maxZone) maxZone = i.zone;
  });
  const durationMin = Math.round(totalSeconds / 60);
  let intensityLabel = "Easy";
  let intensityColor = "#64748b"; 
  if (maxZone >= 5) { intensityLabel = "Peak"; intensityColor = "#ef4444"; }
  else if (maxZone === 4) { intensityLabel = "Hard"; intensityColor = "#f59e0b"; }
  else if (maxZone === 3) { intensityLabel = "Moderate"; intensityColor = "#10b981"; }

  const phaseCounts = {};
  workout.intervals.forEach(i => { phaseCounts[i.phase] = (phaseCounts[i.phase] || 0) + 1; });
  const dominant = Object.keys(phaseCounts).length > 0 
    ? Object.keys(phaseCounts).reduce((a, b) => phaseCounts[a] > phaseCounts[b] ? a : b)
    : 'steady';
  const description = `${INTERVAL_PHASES[dominant]?.label || 'Mixed'} Focus`;

  return { durationMin, intensityLabel, intensityColor, description };
}