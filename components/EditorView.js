// components/EditorView.js
import { INTERVAL_PHASES, INPUT_CONSTRAINTS, generateWorkoutDescription } from '../utils/constants.js';
import { saveProgram } from '../utils/storage.js';
import { icon } from '../utils/icons.js';

// Pre-generated static option strings for performance (memoization)
const TIME_OPTIONS_HTML = generateTimeOptionsStatic();
const DISTANCE_OPTIONS_HTML = generateDistanceOptionsStatic();
const SPM_OPTIONS_HTML = generateSPMOptionsStatic();

// Generate static time options HTML (runs once at module load)
function generateTimeOptionsStatic() {
  const { min, max, step, convertForDisplay } = INPUT_CONSTRAINTS.time;
  let options = '';
  for (let val = min; val <= max; val += step) {
    const display = convertForDisplay(val).toFixed(1);
    options += `<option value="${val}">${display} min</option>`;
  }
  return options;
}

// Generate static distance options HTML (runs once at module load)
function generateDistanceOptionsStatic() {
  const { min, max, step } = INPUT_CONSTRAINTS.distance;
  let options = '';
  for (let val = min; val <= max; val += step) {
    options += `<option value="${val}">${val} m</option>`;
  }
  return options;
}

// Generate static SPM options HTML (runs once at module load)
function generateSPMOptionsStatic() {
  const { min, max, step } = INPUT_CONSTRAINTS.spm;
  let options = '';
  for (let val = min; val <= max; val += step) {
    options += `<option value="${val}">${val}</option>`;
  }
  return options;
}

// Dynamic option generators that mark the selected value
function generateTimeOptions(currentVal) {
  const { step } = INPUT_CONSTRAINTS.time;
  // Replace the matching option with selected version
  return TIME_OPTIONS_HTML.replace(
    new RegExp(`<option value="${currentVal}"`),
    `<option value="${currentVal}" selected`
  );
}

function generateDistanceOptions(currentVal) {
  const { step } = INPUT_CONSTRAINTS.distance;
  // Find nearest value to currentVal
  const nearestVal = Math.round(currentVal / step) * step;
  const clampedVal = Math.max(INPUT_CONSTRAINTS.distance.min, 
                              Math.min(INPUT_CONSTRAINTS.distance.max, nearestVal));
  return DISTANCE_OPTIONS_HTML.replace(
    new RegExp(`<option value="${clampedVal}"`),
    `<option value="${clampedVal}" selected`
  );
}

function generateSPMOptions(currentSPM) {
  return SPM_OPTIONS_HTML.replace(
    new RegExp(`<option value="${currentSPM}"`),
    `<option value="${currentSPM}" selected`
  );
}

export function renderEditorView(state) {
  const workout = state.editingWorkout || {
    id: `workout-${Date.now()}`,
    name: 'New Workout',
    created: Date.now(),
    intervals: []
  };

  const intervalsHTML = workout.intervals.map((interval, index) =>
    renderIntervalRow(interval, index)
  ).join('');

  const description = workout.intervals.length > 0
    ? generateWorkoutDescription(workout)
    : 'Add intervals to begin';

  return `
    <div class="view-container editor-view" style="padding: 1rem; padding-bottom: 5rem;">
      <!-- Header -->
      <div class="editor-header" style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1.5rem;">
        <button id="btn-back" class="btn-secondary" style="padding: 0.5rem;">
          ${icon('arrowLeft', 'icon')}
        </button>
        <div class="editor-title" style="flex: 1;">
          <input type="text" id="workout-name" value="${workout.name}" placeholder="Workout Name" 
            style="width: 100%; background: transparent; border: none; border-bottom: 1px solid var(--slate-700); color: white; font-size: 1.25rem; font-weight: bold; padding: 0.25rem 0;" />
          <p class="workout-description" style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">${description}</p>
        </div>
        <button id="btn-save" class="btn-primary" style="padding: 0.5rem;">
          ${icon('floppyDisk', 'icon')}
        </button>
      </div>

      <!-- Intervals List -->
      <div class="intervals-editor">
        <div id="intervals-container" style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 2rem;">
          ${intervalsHTML.length > 0 ? intervalsHTML : '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No intervals yet</div>'}
        </div>

        <!-- Add Interval Button -->
        <button id="btn-add-interval" class="btn-secondary" style="width: 100%; margin-bottom: 2rem; border-style: dashed;">
          ${icon('plus', 'icon')} Add Interval
        </button>
      </div>
    </div>
  `;
}

function renderIntervalRow(interval, index) {
  const phaseOptions = Object.keys(INTERVAL_PHASES).map(phaseKey => {
    const phase = INTERVAL_PHASES[phaseKey];
    return `<option value="${phaseKey}" ${interval.phase === phaseKey ? 'selected' : ''}>${phase.label}</option>`;
  }).join('');

  const isTime = interval.type === 'time';
  const displayValue = isTime
    ? (interval.val / 60).toFixed(1)
    : interval.val;

  const phaseData = INTERVAL_PHASES[interval.phase] || INTERVAL_PHASES.steady;

  return `
    <div class="interval-row card" data-index="${index}" style="border-left: 5px solid var(${phaseData.colorVar}); padding: 1rem;">
      <div class="interval-row-header" style="display: flex; justify-content: space-between; margin-bottom: 1rem;">
        <span class="interval-number" style="font-weight: bold; color: var(--text-tertiary);">#${index + 1}</span>
        <div style="display: flex; gap: 0.5rem;">
            <button class="btn-icon btn-move-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} style="background: none; color: var(--text-muted);">${icon('caretUp', 'icon')}</button>
            <button class="btn-icon btn-move-down" data-index="${index}" style="background: none; color: var(--text-muted);">${icon('caretDown', 'icon')}</button>
            <button class="btn-icon btn-delete" data-index="${index}" style="background: none; color: var(--danger);">${icon('trash', 'icon')}</button>
        </div>
      </div>

      <div class="interval-row-content" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <!-- Phase Selection -->
        <div class="form-group">
          <label style="display: block; font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 0.25rem;">Phase</label>
          <select class="input-phase" data-index="${index}" style="width: 100%; background: var(--slate-900); color: white; border: 1px solid var(--slate-700); padding: 0.5rem; border-radius: 4px;">
            ${phaseOptions}
          </select>
        </div>

        <!-- Type Toggle -->
        <div class="form-group">
          <label style="display: block; font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 0.25rem;">Type</label>
          <div class="type-toggle" style="display: flex; background: var(--slate-900); border-radius: 4px; overflow: hidden; border: 1px solid var(--slate-700);">
            <button class="btn-toggle ${isTime ? 'active' : ''}" data-index="${index}" data-type="time" style="flex: 1; padding: 0.5rem; font-size: 0.8rem; background: ${isTime ? 'var(--primary)' : 'transparent'}; color: ${isTime ? 'black' : 'white'};">Time</button>
            <button class="btn-toggle ${!isTime ? 'active' : ''}" data-index="${index}" data-type="distance" style="flex: 1; padding: 0.5rem; font-size: 0.8rem; background: ${!isTime ? 'var(--primary)' : 'transparent'}; color: ${!isTime ? 'black' : 'white'};">Dist</button>
          </div>
        </div>

        <!-- Value Dropdown -->
        <div class="form-group">
          <label style="display: block; font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 0.25rem;">${isTime ? 'Duration' : 'Distance'}</label>
          <select class="input-value" data-index="${index}" data-type="${interval.type}" style="width: 100%; background: var(--slate-900); color: white; border: 1px solid var(--slate-700); padding: 0.5rem; border-radius: 4px;">
            ${isTime 
              ? generateTimeOptions(interval.val)
              : generateDistanceOptions(interval.val)
            }
          </select>
        </div>

        <!-- SPM Dropdown -->
        <div class="form-group">
          <label style="display: block; font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 0.25rem;">Target SPM</label>
          <select class="input-spm" data-index="${index}" style="width: 100%; background: var(--slate-900); color: white; border: 1px solid var(--slate-700); padding: 0.5rem; border-radius: 4px;">
            ${generateSPMOptions(interval.spm)}
          </select>
        </div>
      </div>
       <!-- Zone Selection -->
       <div class="form-group" style="grid-column: span 2; margin-top: 1rem;">
          <label style="display: block; font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 0.25rem;">Target Zone</label>
          <div class="zone-buttons" style="display: flex; gap: 0.5rem;">
            ${[1, 2, 3, 4, 5].map(z => `
              <button class="btn-zone ${interval.zone === z ? 'active' : ''}" data-index="${index}" data-zone="${z}" 
                style="flex: 1; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--slate-700); background: ${interval.zone === z ? 'var(--primary)' : 'transparent'}; color: ${interval.zone === z ? 'black' : 'white'};">
                ${z}
              </button>
            `).join('')}
          </div>
        </div>
        <!-- Target Type Selection -->
        <div class="form-group" style="grid-column: span 2; margin-top: 0.5rem; border-top: 1px solid var(--slate-700); padding-top: 0.5rem;">
          <label style="display: block; font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 0.25rem;">PM5 Target</label>
          <div style="display: flex; gap: 0.5rem;">
            <select class="input-target-type" data-index="${index}" style="flex: 1; background: var(--slate-900); color: white; border: 1px solid var(--slate-700); padding: 0.5rem; border-radius: 4px;">
              <option value="none" ${!interval.targetPace && !interval.targetWatts ? 'selected' : ''}>None</option>
              <option value="pace" ${interval.targetPace ? 'selected' : ''}>Pace /500m</option>
              <option value="watts" ${interval.targetWatts ? 'selected' : ''}>Watts</option>
            </select>
            <input type="number" class="input-target-val" data-index="${index}"
              placeholder="${interval.targetPace ? 'Seconds (e.g. 120)' : 'Watts'}"
              value="${interval.targetPace || interval.targetWatts || ''}"
              style="flex: 1; background: var(--slate-900); color: white; border: 1px solid var(--slate-700); padding: 0.5rem; border-radius: 4px; display: ${!interval.targetPace && !interval.targetWatts ? 'none' : 'block'};">
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
            ${interval.targetPace ? `Target: ${Math.floor(interval.targetPace/60)}:${(interval.targetPace%60).toString().padStart(2,'0')}/500m` : ''}
          </div>
        </div>
    </div>
  `;
}

export function attachEditorHandlers(state, updateState) {
  const workout = state.editingWorkout || {
    id: `workout-${Date.now()}`,
    name: 'New Workout',
    created: Date.now(),
    intervals: []
  };

  // Back button
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('nav:programs'));
    });
  }

  // Save button
  const btnSave = document.getElementById('btn-save');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const nameInput = document.getElementById('workout-name');
      workout.name = nameInput.value || 'Untitled Workout';

      try {
        // Save to IndexedDB
        await saveProgram(workout);
        console.log('[Editor] Saved workout:', workout.id, workout.name);

        // Trigger load and nav
        window.dispatchEvent(new CustomEvent('program:save'));
      } catch (error) {
        console.error('[Editor] Failed to save workout:', error);
        alert('Failed to save workout. Please try again.');
      }
    });
  }

  // Add interval button
  const btnAdd = document.getElementById('btn-add-interval');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      workout.intervals.push({
        type: 'time',
        val: 300, // 5 minutes default
        phase: 'steady',
        spm: 22,
        zone: 2
      });
      updateState({ editingWorkout: workout });
    });
  }

  // Phase selection handlers
  document.querySelectorAll('.input-phase').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const newPhase = e.target.value;
      const phaseData = INTERVAL_PHASES[newPhase];

      workout.intervals[index].phase = newPhase;
      workout.intervals[index].spm = phaseData.defaultSPM;
      workout.intervals[index].zone = phaseData.defaultZone;

      updateState({ editingWorkout: workout });
    });
  });

  // Type toggle handlers
  document.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      const newType = e.target.dataset.type;
      const interval = workout.intervals[index];

      if (interval.type !== newType) {
        interval.type = newType;
        interval.val = newType === 'time' ? 300 : 500;
        updateState({ editingWorkout: workout });
      }
    });
  });

  // Value dropdown handlers
  document.querySelectorAll('.input-value').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const interval = workout.intervals[index];
      interval.val = parseInt(e.target.value);
      updateState({ editingWorkout: workout });
    });
  });

  // SPM dropdown handlers
  document.querySelectorAll('.input-spm').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      workout.intervals[index].spm = parseInt(e.target.value);
      updateState({ editingWorkout: workout });
    });
  });

  // Zone button handlers
  document.querySelectorAll('.btn-zone').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      const zone = parseInt(e.target.dataset.zone);
      workout.intervals[index].zone = zone;
      updateState({ editingWorkout: workout });
    });
  });

  // Target Type Handler
  document.querySelectorAll('.input-target-type').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const type = e.target.value;
      const interval = workout.intervals[index];
      
      delete interval.targetPace;
      delete interval.targetWatts;
      
      if (type === 'pace') interval.targetPace = 120;
      if (type === 'watts') interval.targetWatts = 150;
      
      updateState({ editingWorkout: workout });
    });
  });

  // Target Value Handler
  document.querySelectorAll('.input-target-val').forEach(input => {
    input.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const val = parseInt(e.target.value);
      const interval = workout.intervals[index];
      
      if (interval.targetPace) interval.targetPace = val;
      if (interval.targetWatts) interval.targetWatts = val;
      
      updateState({ editingWorkout: workout });
    });
  });

  // Delete button handlers
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      if (confirm('Delete this interval?')) {
        workout.intervals.splice(index, 1);
        updateState({ editingWorkout: workout });
      }
    });
  });

  // Move up/down logic
  const move = (index, direction) => {
      const target = index + direction;
      if (target >= 0 && target < workout.intervals.length) {
          const temp = workout.intervals[index];
          workout.intervals[index] = workout.intervals[target];
          workout.intervals[target] = temp;
          updateState({ editingWorkout: workout });
      }
  };
  
  document.querySelectorAll('.btn-move-up').forEach(btn => 
    btn.onclick = (e) => move(parseInt(e.currentTarget.dataset.index), -1));
    
  document.querySelectorAll('.btn-move-down').forEach(btn => 
    btn.onclick = (e) => move(parseInt(e.currentTarget.dataset.index), 1));
}