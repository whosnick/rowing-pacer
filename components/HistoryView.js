// HistoryView.js - Workout history display

import { formatTime, formatDistance } from '../utils/formatters.js';
import { deleteWorkout } from '../utils/storage.js';
import { icon } from '../utils/icons.js';
import { HR_ZONES } from '../utils/constants.js';

export default function renderHistory(state) {
  const container = document.createElement('div');
  container.className = 'view-container';
  container.style.padding = '1.5rem';
  container.style.paddingBottom = '5rem';

  const hasHistory = state.history && state.history.length > 0;

  container.innerHTML = `
    <div style="margin-bottom: 2rem;">
      <h1 style="font-size: 2rem; font-weight: 700; color: white; margin-bottom: 0.5rem;">
        Workout History
      </h1>
      <p style="color: var(--text-muted); font-size: 0.875rem;">
        ${hasHistory ? `${state.history.length} workout${state.history.length === 1 ? '' : 's'} completed` : 'No workouts yet'}
      </p>
    </div>

    ${hasHistory ? `
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        ${state.history.map(workout => `
          <div class="card" style="padding: 1rem; position: relative;" data-workout-id="${workout.id}">
            <!-- Delete Button -->
            <button class="delete-workout-btn" data-workout-id="${workout.id}" title="Delete workout" style="
              position: absolute;
              top: 0.5rem;
              right: 0.5rem;
              background: none;
              border: none;
              color: var(--text-muted);
              cursor: pointer;
              padding: 0.5rem;
              border-radius: 0.375rem;
              transition: all 0.2s ease;
              z-index: 1;
            ">
              ${icon('trash', 'icon')}
            </button>

            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; padding-right: 2rem;">
              <div>
                <h3 style="font-size: 1rem; font-weight: 600; color: white; margin-bottom: 0.25rem;">
                  ${workout.name}
                </h3>
                <p style="font-size: 0.75rem; color: var(--text-muted);">
                  ${formatDate(workout.date)}
                </p>
              </div>
              ${workout.avgHR ? `
                <div style="
                  padding: 0.25rem 0.75rem;
                  background: rgba(59, 130, 246, 0.2);
                  border-radius: 9999px;
                  font-size: 0.75rem;
                  font-weight: 600;
                  color: #3b82f6;
                ">
                  ♥ ${Math.round(workout.avgHR)} bpm
                </div>
              ` : ''}
            </div>

            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 0.75rem;">
              <div>
                <div style="font-size: 0.625rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.25rem;">
                  Distance
                </div>
                <div style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary);">
                  ${formatDistance(workout.distance)}
                </div>
              </div>
              <div>
                <div style="font-size: 0.625rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.25rem;">
                  Time
                </div>
                <div style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary);">
                  ${formatTime(workout.duration)}
                </div>
              </div>
              <div>
                <div style="font-size: 0.625rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.25rem;">
                  Avg SPM
                </div>
                <div style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary);">
                  ${Math.round(workout.avgSPM || 0)}
                </div>
              </div>
              <div>
                <div style="font-size: 0.625rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.25rem;">
                  Calories
                </div>
                <div style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary);">
                  ${Math.floor(workout.calories || 0)}
                </div>
              </div>
            </div>

            ${workout.zoneDistribution ? `
              <div style="margin-bottom: 0.75rem;">
                <div style="font-size: 0.625rem; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.375rem;">
                  HR Zones
                </div>
                <div style="display: flex; height: 0.375rem; border-radius: 0.25rem; overflow: hidden;">
                  ${workout.zoneDistribution.map(zd => {
                    const zone = HR_ZONES.find(z => z.zone === zd.zone);
                    return zd.percentage > 0 ? `
                      <div style="flex: ${zd.percentage}; background: var(${zone.colorVar});" title="Zone ${zd.zone}: ${zd.percentage}%"></div>
                    ` : '';
                  }).join('')}
                </div>
              </div>
            ` : ''}
            
            <button class="view-details-btn" data-workout-id="${workout.id}" style="
              width: 100%;
              padding: 0.625rem;
              background: var(--slate-700);
              color: var(--text-secondary);
              border: none;
              border-radius: 0.5rem;
              font-size: 0.875rem;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 0.5rem;
              transition: all 0.2s ease;
            ">
              ${icon('chartLineUp', 'icon')}
              View Details
            </button>
          </div>
        `).join('')}
      </div>
    ` : `
      <div style="
        text-align: center;
        padding: 3rem 1rem;
        background: var(--slate-800);
        border-radius: 1rem;
        border: 1px dashed var(--slate-700);
      ">
        ${icon('clockCounterClockwise', 'icon-xl')}
        <p style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 1.5rem;">
          Complete your first workout to see it here
        </p>
        <button id="startFirstWorkout" class="btn-primary" style="
          padding: 0.75rem 1.5rem;
          border-radius: 0.5rem;
          font-weight: 600;
        ">
          Start Workout
        </button>
      </div>
    `}
  `;

  // Event listeners
  setTimeout(() => {
    const startBtn = container.querySelector('#startFirstWorkout');
    if (startBtn) {
      startBtn.onclick = () => {
        window.dispatchEvent(new CustomEvent('nav:home'));
      };
    }
    
    // View Details buttons
    const detailBtns = container.querySelectorAll('.view-details-btn');
    detailBtns.forEach(btn => {
      btn.onclick = () => {
        const workoutId = btn.dataset.workoutId; 
        window.dispatchEvent(new CustomEvent('workout:showDetail', { 
          detail: { workoutId } 
        }));
      };
    });

    // Delete workout buttons
    const deleteBtns = container.querySelectorAll('.delete-workout-btn');
    deleteBtns.forEach(btn => {
      btn.onclick = async () => {
        const workoutId = btn.dataset.workoutId; 
        const workoutCard = btn.closest('.card');
        const workoutName = workoutCard?.querySelector('h3')?.textContent || 'this workout';
        
        if (confirm(`Delete "${workoutName}"? This cannot be undone.`)) {
          try {
            await deleteWorkout(workoutId);
            console.log('[History] Deleted workout:', workoutId);
            
            // Remove from state
            state.history = state.history.filter(w => w.id !== workoutId);
            
            // Animate removal
            workoutCard.style.transition = 'all 0.3s ease';
            workoutCard.style.opacity = '0';
            workoutCard.style.transform = 'translateX(-100%)';
            
            setTimeout(() => {
              workoutCard.remove();
              
              // If no more workouts, show empty state
              if (state.history.length === 0) {
                window.dispatchEvent(new CustomEvent('nav:history'));
              }
            }, 300);
          } catch (error) {
            console.error('[History] Failed to delete workout:', error);
            alert('Failed to delete workout. Please try again.');
          }
        }
      };
    });
  }, 0);

  return container;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
