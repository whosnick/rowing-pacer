
// components/HomeView.js
import { INTERVAL_PHASES, calculateHRMax, getHRZoneBoundaries } from '../utils/constants.js';
import { getTTSSettings, setTTSSettings, testTTS } from '../utils/tts.js';
import { icon } from '../utils/icons.js';

export default function renderHome(state) {
  const container = document.createElement('div');
  container.className = 'view-container';
  container.style.padding = '1.5rem';
  container.style.paddingBottom = '5rem';

  // Find favorite workout
  const favoriteWorkout = state.programs ? state.programs.find(w => w.isFavorite) : null;

  container.innerHTML = `
    <!-- Header -->
    <div style="margin-bottom: 2rem;">
      <h1 style="font-size: 2rem; font-weight: 700; color: white; margin-bottom: 0.5rem;">
        Ready to Row
      </h1>
      <p style="color: var(--text-muted); font-size: 0.875rem;">
        Select a workout or connect your devices
      </p>
    </div>

    <!-- Connection Status -->
    <div class="card" style="margin-bottom: 1.5rem; padding: 1rem;">
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <!-- Rower Connection -->
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="
              width: 2.5rem;
              height: 2.5rem;
              border-radius: 50%;
              background: ${state.bleConnected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(71, 85, 105, 0.3)'};
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              ${state.bleConnected ? icon('check', 'icon') : icon('broadcast', 'icon')}
            </div>
            <div>
              <div style="font-weight: 600; color: white; font-size: 0.875rem;">Rowing Machine</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">
                ${state.bleConnected ? 'Connected' : 'Not connected'}
              </div>
            </div>
          </div>
          <button id="toggleRower" class="btn-${state.bleConnected ? 'secondary' : 'primary'}" style="
            padding: 0.5rem 1rem;
            font-size: 0.875rem;
            border-radius: 0.5rem;
          ">
            ${state.bleConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>

        <!-- HR Monitor Connection -->
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="
              width: 2.5rem;
              height: 2.5rem;
              border-radius: 50%;
              background: ${state.hrConnected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(71, 85, 105, 0.3)'};
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              ${state.hrConnected ? icon('heart', 'icon') : icon('heart', 'icon')}
            </div>
            <div>
              <div style="font-weight: 600; color: white; font-size: 0.875rem;">Heart Rate Belt</div>
              <div style="font-size: 0.75rem; color: var(--slate-400);">
                ${state.hrConnected
                  ? `${state.hrData?.hr ?? '--'} bpm`
                  : 'Connect chest strap'}
              </div>
            </div>
          </div>
          <button id="toggleHR" class="btn-${state.hrConnected ? 'secondary' : 'primary'}" style="
            padding: 0.5rem 1rem;
            font-size: 0.875rem;
            border-radius: 0.5rem;
          ">
            ${state.hrConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </div>
    </div>

    <!-- Favorite Workout (Only shows if one is starred) -->
    ${favoriteWorkout ? `
      <div style="margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h2 style="font-size: 1.25rem; font-weight: 600; color: white;">
                Favorite Workout
            </h2>
            <div style="color: var(--accent);">${icon('starFill', 'icon')}</div>
        </div>
        ${renderWorkoutCard(favoriteWorkout)}
      </div>
    ` : ''}

    <!-- Quick Actions -->
    <div style="margin-bottom: 1.5rem;">
      <h2 style="font-size: 1.25rem; font-weight: 600; color: white; margin-bottom: 1rem;">
        Quick Actions
      </h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <button id="freeRowBtn" class="card" style="
          padding: 1.5rem 1rem;
          text-align: center;
          cursor: pointer;
          border: 1px solid var(--slate-700);
          transition: all 0.2s;
          color: var(--primary);
        ">
          ${icon('activity')}
          <div style="font-weight: 600; color: white; font-size: 0.875rem;">Free Row</div>
          <div style="font-size: 0.75rem; color: var(--slate-400); margin-top: 0.25rem;">No structure</div>
        </button>

        <button id="settingsBtn" class="card" style="
          padding: 1.5rem 1rem;
          text-align: center;
          cursor: pointer;
          border: 1px solid var(--slate-700);
          transition: all 0.2s;
          color: var(--slate-400);
        ">
          ${icon('gear')}
          <div style="font-weight: 600; color: white; font-size: 0.875rem;">Settings</div>
          <div style="font-size: 0.75rem; color: var(--slate-400); margin-top: 0.25rem;">HRmax, audio</div>
        </button>
      </div>
    </div>
  `;

  // Event listeners
  setTimeout(() => {
    // Connections
    const toggleRower = container.querySelector('#toggleRower');
    if (toggleRower) toggleRower.onclick = () => window.dispatchEvent(new CustomEvent(state.bleConnected ? 'disconnect:rower' : 'connect:rower'));

    const toggleHR = container.querySelector('#toggleHR');
    if (toggleHR) toggleHR.onclick = () => window.dispatchEvent(new CustomEvent(state.hrConnected ? 'disconnect:hr' : 'connect:hr'));

    // Quick Actions
    const freeRowBtn = container.querySelector('#freeRowBtn');
    if (freeRowBtn) {
      freeRowBtn.onclick = () => {
        const freeWorkout = {
          id: 'free-row', name: 'Free Row', description: 'Row at your own pace', duration: 3600, intervals: []
        };
        window.dispatchEvent(new CustomEvent('workout:select', { detail: freeWorkout }));
      };
    }

    const settingsBtn = container.querySelector('#settingsBtn');
    if (settingsBtn) settingsBtn.onclick = () => showSettings(state);

    // Favorite Workout Start
    const favStartBtn = container.querySelector('#startFavorite');
    if (favStartBtn && favoriteWorkout) {
        favStartBtn.onclick = () => {
            window.dispatchEvent(new CustomEvent('workout:select', { detail: favoriteWorkout }));
        };
    }
  }, 0);

  return container;
}

function renderWorkoutCard(workout) {
  return `
    <div class="card" style="padding: 1.5rem; border: 1px solid var(--accent); cursor: pointer;" id="startFavorite">
      <div style="display: flex; align-items: start; justify-content: space-between; margin-bottom: 1rem;">
        <div style="flex: 1;">
          <h3 style="font-size: 1.125rem; font-weight: 600; color: white; margin-bottom: 0.25rem;">
            ${workout.name}
          </h3>
          <p style="font-size: 0.875rem; color: var(--text-muted);">
             Favorites
          </p>
        </div>
      </div>

      <div style="display: flex; gap: 1.5rem; margin-bottom: 1rem;">
        <div>
           <div style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase;">Intervals</div>
           <div style="font-size: 1rem; font-weight: 600; color: var(--text-primary);">${workout.intervals.length}</div>
        </div>
        <div style="flex: 1; display: flex; align-items: center; justify-content: flex-end;">
             <span style="color: var(--primary); font-weight: 600; font-size: 0.875rem;">Tap to Start ${icon('caretRight', 'icon')}</span>
        </div>
      </div>

      <!-- Zone Distribution Bar -->
      <div style="display: flex; gap: 2px; height: 6px; border-radius: 3px; overflow: hidden; opacity: 0.8;">
        ${workout.intervals.map(i => `
          <div style="flex: ${i.type === 'time' ? i.val : 120}; background: var(${INTERVAL_PHASES[i.phase]?.colorVar || '--slate-500'});"></div>
        `).join('')}
      </div>
    </div>
  `;
}

// Enhanced settings function with validation and zone preview
function showSettings(state) {
  const modal = document.createElement('div');
  modal.style.cssText = `position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;`;

  const baseAge = state.userSettings?.age ?? 40;
  const baseHrMax = state.userSettings?.hrMax ?? calculateHRMax(baseAge);
  const baseRestHr = state.userSettings?.restHR ?? 60;

  // Load TTS settings
  const ttsSettings = getTTSSettings();

  // Load Pacer Beep settings
  const savedBeepSettings = localStorage.getItem('pacerBeepSettings');
  const beepSettings = savedBeepSettings ? JSON.parse(savedBeepSettings) : { frequency: 800, volume: 0.1, duration: 0.05 };

  modal.innerHTML = `
    <div style="background: var(--slate-800); border-radius: 1rem; padding: 1.5rem; max-width: 400px; width: 100%; max-height: 90vh; overflow-y: auto;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
        <h2 style="font-size: 1.5rem; font-weight: 700; color: white;">Settings</h2>
        <button id="closeSettings" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.5rem;">${icon('x', 'icon-lg')}</button>
      </div>

      <div style="margin-bottom: 1.5rem;">
        <label style="display: block; font-size: 0.875rem; font-weight: 600; color: white; margin-bottom: 0.5rem;">Age</label>
        <input type="number" id="ageInput" value="${baseAge}" min="0" max="99" style="width: 100%; padding: 0.75rem; background: var(--slate-900); border: 1px solid var(--slate-700); border-radius: 0.5rem; color: white;">
      </div>

      <div style="margin-bottom: 1.5rem;">
        <label style="display: block; font-size: 0.875rem; font-weight: 600; color: white; margin-bottom: 0.5rem;">Resting HR (Required for Zones)</label>
        <input type="number" id="restHRInput" value="${baseRestHr}" min="40" max="220" style="width: 100%; padding: 0.75rem; background: var(--slate-900); border: 1px solid var(--slate-700); border-radius: 0.5rem; color: white;">
      </div>

      <div style="margin-bottom: 1rem;">
        <label style="display: block; font-size: 0.875rem; font-weight: 600; color: white; margin-bottom: 0.5rem;">Max HR</label>
        <div style="display: flex; gap: 0.5rem;">
          <input type="number" id="hrMaxInput" value="${baseHrMax}" min="40" max="220" style="width: 100%; padding: 0.75rem; background: var(--slate-900); border: 1px solid var(--slate-700); border-radius: 0.5rem; color: white;">
          <button id="calcHrMax" class="btn-secondary" style="padding: 0.75rem 0.9rem; font-size: 0.75rem; white-space: nowrap;">Calculate</button>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-muted);">Use age to calculate HR max or adjust manually.</div>
      </div>

      <div id="settingsWarnings" style="margin-bottom: 1rem; font-size: 0.75rem; color: #fca5a5;"></div>

      <div style="margin-bottom: 1.5rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
          <div style="font-size: 0.875rem; font-weight: 600; color: white;">Heart Rate Zones</div>
          <div style="font-size: 0.75rem; color: var(--slate-400);">Karvonen (HRR)</div>
        </div>
        <div id="hrZoneOverview" style="display: grid; gap: 0.5rem;"></div>
      </div>

      <!-- TTS Voice Settings -->
      <div style="border-top: 1px solid var(--slate-700); padding-top: 1rem; margin-bottom: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
          ${icon('speakerHigh', 'icon')}
          <h3 style="font-size: 1rem; font-weight: 600; color: white;">Voice Settings (TTS)</h3>
        </div>

        <div style="margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <label style="font-size: 0.875rem; color: var(--text-secondary);">Speed</label>
            <span id="ttsRateValue" style="font-size: 0.75rem; color: var(--text-muted);">${ttsSettings.rate.toFixed(1)}x</span>
          </div>
          <input type="range" id="ttsRate" min="0.5" max="2.0" step="0.1" value="${ttsSettings.rate}" style="width: 100%; accent-color: var(--primary);">
        </div>

        <div style="margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <label style="font-size: 0.875rem; color: var(--text-secondary);">Pitch</label>
            <span id="ttsPitchValue" style="font-size: 0.75rem; color: var(--text-muted);">${ttsSettings.pitch.toFixed(1)}</span>
          </div>
          <input type="range" id="ttsPitch" min="0.5" max="2.0" step="0.1" value="${ttsSettings.pitch}" style="width: 100%; accent-color: var(--primary);">
        </div>

        <div style="margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <label style="font-size: 0.875rem; color: var(--text-secondary);">Volume</label>
            <span id="ttsVolumeValue" style="font-size: 0.75rem; color: var(--text-muted);">${Math.round(ttsSettings.volume * 100)}%</span>
          </div>
          <input type="range" id="ttsVolume" min="0" max="1.0" step="0.05" value="${ttsSettings.volume}" style="width: 100%; accent-color: var(--primary);">
        </div>

        <button id="testTTSBtn" class="btn-secondary" style="width: 100%; padding: 0.75rem; font-size: 0.875rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
          ${icon('playCircle', 'icon')}
          Test Voice
        </button>
      </div>

      <!-- Pacer Beep Settings -->
      <div style="border-top: 1px solid var(--slate-700); padding-top: 1rem; margin-bottom: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
          ${icon('waveSine', 'icon')}
          <h3 style="font-size: 1rem; font-weight: 600; color: white;">Pacer Beep Sound</h3>
        </div>

        <div style="margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <label style="font-size: 0.875rem; color: var(--text-secondary);">Frequency (Hz)</label>
            <span id="beepFreqValue" style="font-size: 0.75rem; color: var(--text-muted);">${beepSettings.frequency} Hz</span>
          </div>
          <input type="range" id="beepFreq" min="200" max="2000" step="50" value="${beepSettings.frequency}" style="width: 100%; accent-color: var(--primary);">
        </div>

        <div style="margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <label style="font-size: 0.875rem; color: var(--text-secondary);">Volume</label>
            <span id="beepVolumeValue" style="font-size: 0.75rem; color: var(--text-muted);">${Math.round(beepSettings.volume * 100)}%</span>
          </div>
          <input type="range" id="beepVolume" min="0" max="1.0" step="0.05" value="${beepSettings.volume}" style="width: 100%; accent-color: var(--primary);">
        </div>

        <div style="margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <label style="font-size: 0.875rem; color: var(--text-secondary);">Duration</label>
            <span id="beepDurationValue" style="font-size: 0.75rem; color: var(--text-muted);">${Math.round(beepSettings.duration * 1000)}ms</span>
          </div>
          <input type="range" id="beepDuration" min="0.01" max="0.5" step="0.01" value="${beepSettings.duration}" style="width: 100%; accent-color: var(--primary);">
        </div>

        <button id="testBeepBtn" class="btn-secondary" style="width: 100%; padding: 0.75rem; font-size: 0.875rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
          ${icon('playCircle', 'icon')}
          Test Beep
        </button>
      </div>

      <button id="saveSettings" class="btn-primary" style="width: 100%; padding: 0.875rem; font-weight: 600; border-radius: 0.75rem; margin-bottom: 0.75rem;">Save Settings</button>

      <!-- Reset App Section -->
      <div style="border-top: 1px solid var(--slate-700); padding-top: 1rem; margin-top: 1rem;">
        <button id="resetAppBtn" style="
          width: 100%;
          padding: 0.75rem;
          background: transparent;
          color: var(--danger);
          border: 1px solid var(--danger);
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        ">
          ${icon('warningCircle', 'icon')}
          Reset App (Delete All Data)
        </button>
        <div style="font-size: 0.75rem; color: var(--text-muted); text-align: center; margin-top: 0.5rem;">
          This will delete all settings, custom programs, and workout history
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const ageInput = modal.querySelector('#ageInput');
  const restHRInput = modal.querySelector('#restHRInput');
  const hrMaxInput = modal.querySelector('#hrMaxInput');
  const calcHrMaxBtn = modal.querySelector('#calcHrMax');
  const zoneOverview = modal.querySelector('#hrZoneOverview');
  const warnings = modal.querySelector('#settingsWarnings');
  let hrMaxAuto = state.userSettings?.hrMax === null || state.userSettings?.hrMax === undefined;

  const parseInput = (input) => {
    const value = parseInt(input.value, 10);
    return Number.isFinite(value) ? value : null;
  };

  const updateWarnings = () => {
    const ageValue = parseInput(ageInput);
    const restHRValue = parseInput(restHRInput);
    const hrMaxValue = parseInput(hrMaxInput);
    const messages = [];

    if (ageValue === null) {
      messages.push('Age is required.');
    } else if (ageValue < 0 || ageValue > 99) {
      messages.push('Age must be between 0 and 99.');
    }

    if (restHRValue === null) {
      messages.push('Resting HR is required.');
    } else if (restHRValue < 40 || restHRValue > 220) {
      messages.push('Resting HR must be between 40 and 220 bpm.');
    }

    if (hrMaxValue === null) {
      messages.push('Max HR is required.');
    } else if (hrMaxValue < 40 || hrMaxValue > 220) {
      messages.push('Max HR must be between 40 and 220 bpm.');
    }

    if (restHRValue !== null && hrMaxValue !== null && restHRValue >= hrMaxValue) {
      messages.push('Resting HR should be lower than Max HR.');
    }

    warnings.textContent = messages.join(' ');
  };

  const updateZones = () => {
    const restHRValue = parseInput(restHRInput);
    const hrMaxValue = parseInput(hrMaxInput);
    const zones = getHRZoneBoundaries(restHRValue, hrMaxValue);

    zoneOverview.innerHTML = zones.map(zone => `
      <div style="display: flex; align-items: center; justify-content: space-between; background: var(--slate-900); border: 1px solid var(--slate-700); border-radius: 0.5rem; padding: 0.5rem 0.75rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <div style="width: 0.6rem; height: 0.6rem; border-radius: 999px; background: var(${zone.colorVar});"></div>
          <div style="font-size: 0.8rem; color: var(--text-primary); font-weight: 600;">Zone ${zone.zone}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${zone.name}</div>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-secondary);">${zone.min}-${zone.max} bpm</div>
      </div>
    `).join('');
    updateWarnings();
  };

  updateZones();

  modal.querySelector('#closeSettings').onclick = () => modal.remove();

  hrMaxInput.addEventListener('input', () => {
    hrMaxAuto = false;
    updateZones();
  });

  ageInput.addEventListener('input', () => {
    const ageValue = parseInput(ageInput);
    if (ageValue !== null && hrMaxAuto) {
      hrMaxInput.value = calculateHRMax(ageValue);
    }
    updateZones();
  });

  restHRInput.addEventListener('input', () => {
    updateZones();
  });

  calcHrMaxBtn.addEventListener('click', () => {
    const ageValue = parseInput(ageInput);
    if (ageValue !== null) {
      hrMaxInput.value = calculateHRMax(ageValue);
      hrMaxAuto = true;
      updateZones();
    }
  });

  // TTS Settings handlers
  const ttsRateInput = modal.querySelector('#ttsRate');
  const ttsPitchInput = modal.querySelector('#ttsPitch');
  const ttsVolumeInput = modal.querySelector('#ttsVolume');
  const ttsRateValue = modal.querySelector('#ttsRateValue');
  const ttsPitchValue = modal.querySelector('#ttsPitchValue');
  const ttsVolumeValue = modal.querySelector('#ttsVolumeValue');

  ttsRateInput.addEventListener('input', () => {
    ttsRateValue.textContent = parseFloat(ttsRateInput.value).toFixed(1) + 'x';
  });

  ttsPitchInput.addEventListener('input', () => {
    ttsPitchValue.textContent = parseFloat(ttsPitchInput.value).toFixed(1);
  });

  ttsVolumeInput.addEventListener('input', () => {
    ttsVolumeValue.textContent = Math.round(parseFloat(ttsVolumeInput.value) * 100) + '%';
  });

  modal.querySelector('#testTTSBtn').onclick = () => {
    const testSettings = {
      rate: parseFloat(ttsRateInput.value),
      pitch: parseFloat(ttsPitchInput.value),
      volume: parseFloat(ttsVolumeInput.value)
    };
    testTTS(testSettings);
  };

  // Pacer Beep Settings handlers
  const beepFreqInput = modal.querySelector('#beepFreq');
  const beepVolumeInput = modal.querySelector('#beepVolume');
  const beepDurationInput = modal.querySelector('#beepDuration');
  const beepFreqValue = modal.querySelector('#beepFreqValue');
  const beepVolumeValue = modal.querySelector('#beepVolumeValue');
  const beepDurationValue = modal.querySelector('#beepDurationValue');

  beepFreqInput.addEventListener('input', () => {
    beepFreqValue.textContent = beepFreqInput.value + ' Hz';
  });

  beepVolumeInput.addEventListener('input', () => {
    beepVolumeValue.textContent = Math.round(parseFloat(beepVolumeInput.value) * 100) + '%';
  });

  beepDurationInput.addEventListener('input', () => {
    beepDurationValue.textContent = Math.round(parseFloat(beepDurationInput.value) * 1000) + 'ms';
  });

  modal.querySelector('#testBeepBtn').onclick = () => {
    // Create temporary pacer to test beep
    const tempPacer = {
      enableAudio: true,
      audioContext: null,
      beepSettings: {
        frequency: parseInt(beepFreqInput.value),
        volume: parseFloat(beepVolumeInput.value),
        duration: parseFloat(beepDurationInput.value)
      },
      lastBeepTime: 0
    };

    // Setup audio context
    if (typeof AudioContext !== 'undefined') {
      tempPacer.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (tempPacer.audioContext) {
      if (tempPacer.audioContext.state === 'suspended') {
        tempPacer.audioContext.resume();
      }

      const now = tempPacer.audioContext.currentTime;
      const oscillator = tempPacer.audioContext.createOscillator();
      const gainNode = tempPacer.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(tempPacer.audioContext.destination);

      oscillator.frequency.value = tempPacer.beepSettings.frequency;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(tempPacer.beepSettings.volume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + tempPacer.beepSettings.duration);

      oscillator.start(now);
      oscillator.stop(now + tempPacer.beepSettings.duration);
    }
  };

  modal.querySelector('#saveSettings').onclick = () => {
    state.userSettings.age = parseInt(ageInput.value, 10);
    state.userSettings.restHR = parseInt(restHRInput.value, 10);
    state.userSettings.hrMax = parseInt(hrMaxInput.value, 10);

    // Save TTS settings
    setTTSSettings({
      rate: parseFloat(ttsRateInput.value),
      pitch: parseFloat(ttsPitchInput.value),
      volume: parseFloat(ttsVolumeInput.value)
    });

    // Save Pacer Beep settings
    localStorage.setItem('pacerBeepSettings', JSON.stringify({
      frequency: parseInt(beepFreqInput.value),
      volume: parseFloat(beepVolumeInput.value),
      duration: parseFloat(beepDurationInput.value)
    }));

    localStorage.setItem('userSettings', JSON.stringify(state.userSettings));
    modal.remove();
    window.dispatchEvent(new CustomEvent('nav:home'));
  };

  // Reset App button handler
  modal.querySelector('#resetAppBtn').onclick = async () => {
    if (confirm('⚠️ WARNING: This will permanently delete:\n\n• All user settings\n• All custom workout programs\n• All workout history\n• All BLE data\n\nThis action cannot be undone. Are you sure?')) {
      const userInput = prompt('Final confirmation: Type "RESET" to confirm complete data deletion');
      if (userInput === 'RESET') {
        try {
          // Clear IndexedDB
          const { clearAllData } = await import('../utils/storage.js');
          await clearAllData();

          // Clear LocalStorage (except we keep a flag to know migration is done)
          const migrationFlag = localStorage.getItem('indexedDBMigrationComplete');
          localStorage.clear();
          if (migrationFlag) {
            localStorage.setItem('indexedDBMigrationComplete', 'true');
          }

          console.log('[Settings] App reset complete');
          alert('App has been reset. The page will now reload.');
          window.location.reload();
        } catch (error) {
          console.error('[Settings] Failed to reset app:', error);
          alert('Failed to reset app. Please try again.');
        }
      } else if (userInput !== null) {
        alert('Reset cancelled. You did not type "RESET" correctly.');
      }
    }
  };

  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

