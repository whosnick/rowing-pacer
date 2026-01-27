import * as Utils from './utils.js';
import * as Pacer from './pacer.js';
import * as BLE from './ble.js';

// --- DOM ELEMENTS ---
const el = {
    // Views
    setupView: document.getElementById('setupView'),
    workoutView: document.getElementById('workoutView'),

    // Setup Inputs
    workoutType: document.getElementById('workoutType'),
    workoutSettings: document.getElementById('workoutSettings'),
    startWorkoutBtn: document.getElementById('startWorkoutBtn'),

    // Workout Display
    progressLabelLeft: document.getElementById('progressLabelLeft'),
    progressLabelRight: document.getElementById('progressLabelRight'),
    progressBarMain: document.getElementById('progressBarMain'),
    intervalProgressContainer: document.getElementById('intervalProgressContainer'),
    progressBarInterval: document.getElementById('progressBarInterval'),

    targetSPMVal: document.getElementById('targetSPMVal'),
    stopWorkoutBtn: document.getElementById('stopWorkoutBtn'),

    // Stats
    spm: document.getElementById('spm'),
    spmSource: document.getElementById('spmSource'),
    pace: document.getElementById('pace'),
    strokeCount: document.getElementById('strokeCount'),
    distance: document.getElementById('distance'),
    workoutTime: document.getElementById('workoutTime'),

    // System
    connectBtn: document.getElementById('connectBtn'),
    audioBtn: document.getElementById('audioBtn'),
    logBtn: document.getElementById('logBtn'),
    debugBtn: document.getElementById('debugBtn'),
    debugEl: document.getElementById('debug'),

    // Pacer Anim
    phaseName: document.getElementById('phaseName'),
    rowerDot: document.getElementById('rowerDot'),
    driveTime: document.getElementById('driveTime'),
    recovTime: document.getElementById('recovTime')
};

// --- WORKOUT STATE MANAGEMENT ---

const WorkoutManager = {
    config: null,
    status: 'idle', // idle, active, finished
    startTime: null,
    currentIntervalIndex: 0,

    // Snapshot of BLE data at start of workout/interval
    startSnapshot: { time: 0, dist: 0 },

    init(config) {
        this.config = config;
        this.status = 'idle';
        this.currentIntervalIndex = 0;
        this.intervalSnapshot = null; // Forget previous interval history
        this.updateTargetDisplay();

        // --- RESET UI LOGIC ---
        
        // 1. Force Bars to Zero
        el.progressBarMain.style.width = '0%';
        el.progressBarInterval.style.width = '0%';

        // 2. Reset Text Labels immediately based on Type
        if (this.config.type === 'interval') {
            // INTERVAL WORKOUT
            el.progressLabelLeft.textContent = `Interval 1/${this.config.intervals.length}`;
            
            // Calculate the text for the FIRST interval immediately
            const firstInt = this.config.intervals[0];
            if (firstInt.type === 'time') {
                el.progressLabelRight.textContent = Utils.formatTime(firstInt.val * 60 * 1000);
            } else {
                el.progressLabelRight.textContent = `${firstInt.val}m`;
            }
            
        } else {
            // SINGLE WORKOUT (Time / Distance)
            el.progressLabelLeft.textContent = this.config.type === 'time' ? "Time Goal" : "Distance Goal";
            
            // Calculate full target text immediately
            if (this.config.type === 'time') {
                el.progressLabelRight.textContent = Utils.formatTime(this.config.value * 60 * 1000);
            } else {
                el.progressLabelRight.textContent = `${this.config.value}m`;
            }
        }

        // 3. Reset Stats to Zero (from previous step)
        el.workoutTime.textContent = "00:00";
        el.distance.textContent = "0m";
        el.strokeCount.textContent = "0";
        
        // ----------------------

        Utils.log(`Workout Ready: ${config.type}`);
    },

    start() {
        if (this.status === 'active') return;
        this.status = 'active';
        
        // --- MODIFY THIS SECTION ---
        const lastData = BLE.getLastKnownData();
        this.startSnapshot = { 
            time: lastData.time, 
            dist: lastData.distance,
            strokes: lastData.strokes // Add strokes here
        };
        // ---------------------------

        Pacer.startPacer();
        Utils.log("Workout Started (Active)");
    },

    stop(finished = false) {
        this.status = 'finished';
        Pacer.stopPacer();

        el.stopWorkoutBtn.textContent = finished ? "Workout Complete! (New?)" : "New Workout";
        el.stopWorkoutBtn.classList.add('reset');

        if (finished) {
            Utils.beep();
            setTimeout(() => Utils.beep(), 200);
            setTimeout(() => Utils.beep(), 400);
        }
    },

    reset() {
        this.status = 'idle';
        this.config = null;
        toggleView('setup');
        el.stopWorkoutBtn.textContent = "Stop Workout";
        el.stopWorkoutBtn.classList.remove('reset');
    },

    update(bleData) {
        if (this.status === 'finished') return;

        // Auto-Start Logic
        if (this.status === 'idle' && bleData.workoutActive) {
            this.start();
        }

        // Auto-Stop Logic (Idle timeout handled by BLE, but we reflect it here)
        if (this.status === 'active' && !bleData.workoutActive) {
            // BLE says workout stopped (8s idle)
            this.stop(false);
            return;
        }

        if (this.status !== 'active') return;

        // Calculate Deltas from start of workout/interval
        const elapsedS = (bleData.time - this.startSnapshot.time) / 1000;
        const elapsedM = bleData.distance - this.startSnapshot.dist;
        const elapsedStrokes = bleData.strokes - (this.startSnapshot.strokes || 0);

        // Update UI with Active Workout Stats ---
        el.workoutTime.textContent = Utils.formatTime(elapsedS * 1000);
        el.distance.textContent = Math.floor(Math.max(0, elapsedM)) + 'm';
        el.strokeCount.textContent = Math.max(0, elapsedStrokes);

        // Logic based on Type
        if (this.config.type === 'time') {
            const targetS = this.config.value * 60;
            const remaining = Math.max(0, targetS - elapsedS);

            this.updateProgressUI(elapsedS, targetS, Utils.formatTime(remaining * 1000));
            if (elapsedS >= targetS) this.stop(true);

        } else if (this.config.type === 'distance') {
            const targetM = this.config.value;
            const remaining = Math.max(0, targetM - elapsedM);

            this.updateProgressUI(elapsedM, targetM, remaining + "m");
            if (elapsedM >= targetM) this.stop(true);

        } else if (this.config.type === 'interval') {
            this.handleIntervalLogic(elapsedS, elapsedM);
        }
    },

handleIntervalLogic(totalElapsedS, totalElapsedM) {
    // 1. Initialize Snapshot for this specific interval if needed
    if (!this.intervalSnapshot) {
        this.intervalSnapshot = { ...BLE.getLastKnownData() };
        // Set Pacer Target
        const currentInt = this.config.intervals[this.currentIntervalIndex];
        Pacer.setTargetSPM(currentInt.spm);
        this.updateTargetDisplay();
    }

    // 2. Calculate Segment Elapsed
    const currentBle = BLE.getLastKnownData();
    const segElapsedS = (currentBle.time - this.intervalSnapshot.time) / 1000;
    const segElapsedM = currentBle.distance - this.intervalSnapshot.distance;

    const currentInt = this.config.intervals[this.currentIntervalIndex];
    let isDone = false;
    let progressPct = 0;
    let remainingTxt = "";

    // 3. Anticipation Variables
    let remainingMetric = 0; 
    let anticipationThreshold = 0;

    // 4. Calculate Progress & Remaining
    if (currentInt.type === 'time') {
        const targetS = currentInt.val * 60;
        remainingMetric = targetS - segElapsedS; // Seconds left
        anticipationThreshold = 10; // Start transitioning 10 seconds before end
        
        progressPct = segElapsedS / targetS;
        remainingTxt = Utils.formatTime(Math.max(0, remainingMetric * 1000));
        if (segElapsedS >= targetS) isDone = true;
    } else {
        const targetM = currentInt.val;
        remainingMetric = targetM - segElapsedM; // Meters left
        anticipationThreshold = 35; // Start transitioning 35 meters before end

        progressPct = segElapsedM / targetM;
        remainingTxt = Math.floor(Math.max(0, remainingMetric)) + "m";
        if (segElapsedM >= targetM) isDone = true;
    }

    // 5. Apply Anticipation Logic (Update Pacer Early)
    if (!isDone && remainingMetric <= anticipationThreshold) {
        const nextIdx = this.currentIntervalIndex + 1;
        if (nextIdx < this.config.intervals.length) {
            const nextSPM = this.config.intervals[nextIdx].spm;
            // Update Pacer early. The pacer.js smoothing logic will handle the curve.
            Pacer.setTargetSPM(nextSPM);
            
            // Visual indication
            el.targetSPMVal.style.color = "var(--accent)"; 
            el.targetSPMVal.textContent = `${nextSPM} (Next)`;
        }
    } else if (!isDone) {
        // Ensure we are on current target
        Pacer.setTargetSPM(currentInt.spm);
        el.targetSPMVal.style.color = "inherit";
        el.targetSPMVal.textContent = currentInt.spm;
    }

    // 6. Update UI
    el.progressLabelLeft.textContent = `Interval ${this.currentIntervalIndex + 1}/${this.config.intervals.length}`;
    el.progressLabelRight.textContent = remainingTxt;
    el.progressBarInterval.style.width = `${Math.min(100, progressPct * 100)}%`;
  
    // Calculate Total Progress for the Main Bar
    // Formula: (IntervalsCompleted + CurrentIntervalProgress) / TotalIntervals
    const totalProgress = ((this.currentIntervalIndex + Math.min(1, progressPct)) / this.config.intervals.length) * 100;
    el.progressBarMain.style.width = `${totalProgress}%`;

    // -----------------------------------

    if (isDone) {
        this.currentIntervalIndex++;
        if (this.currentIntervalIndex >= this.config.intervals.length) {
            this.stop(true);
        } else {
            // Next Interval
            Utils.beep();
            this.intervalSnapshot = null; // Triggers reset on next update loop
            el.targetSPMVal.style.color = "inherit"; // Reset text color
            
            // Force visual reset of interval bar immediately for better UX
            el.progressBarInterval.style.width = '0%';
        }
    }
},

    updateTargetDisplay() {
        let target = 20;
        if (this.config.type === 'interval') {
            target = this.config.intervals[this.currentIntervalIndex].spm;
        } else {
            target = this.config.spm;
        }
        el.targetSPMVal.textContent = target;
        Pacer.setTargetSPM(target);
    },

    updateProgressUI(current, max, remainingText) {
        // Only for single Time/Dist workouts. Intervals handle their own.
        if (this.config.type === 'interval') return;

        const pct = Math.min(100, (current / max) * 100);
        el.progressBarMain.style.width = `${pct}%`;
        el.progressLabelLeft.textContent = this.config.type === 'time' ? "Time Goal" : "Distance Goal";
        el.progressLabelRight.textContent = remainingText;
    }
};

// --- UI GENERATION ---

function generateSetupUI() {
    const type = el.workoutType.value;
    const container = el.workoutSettings;
    container.innerHTML = '';

    // Helper: Create Select
    const createSelect = (label, id, opts) => {
        const d = document.createElement('div');
        d.className = 'form-group';
        d.innerHTML = `<label>${label}</label><select id="${id}">${opts.map(o => `<option value="${o.v}">${o.t}</option>`).join('')}</select>`;
        return d;
    };

    // Helper: Generate Options
    const rangeOpts = (min, max, step, suffix = '') => {
        let arr = [];
        for(let i=min; i<=max; i+=step) arr.push({v:i, t: i+suffix});
        return arr;
    };

    // 1. Target SPM (Global for Time/Dist)
    if (type !== 'interval') {
        container.appendChild(createSelect("Target Stroke Rate", "setupSPM", rangeOpts(16, 32, 1, " SPM")));
    }

    // 2. Specifics
    if (type === 'time') {
        // 10 to 60 in 5er steps
        container.appendChild(createSelect("Duration", "setupVal", rangeOpts(10, 60, 5, " min")));
    }
    else if (type === 'distance') {
        // 500 to 10000 in 500er steps
        container.appendChild(createSelect("Distance", "setupVal", rangeOpts(500, 10000, 500, " m")));
    }
    else if (type === 'interval') {
        // Count 2 to 10
        const countHtml = `<div class="form-group"><label>Number of Intervals</label><select id="setupCount">${rangeOpts(2,10,1).map(o=>`<option value="${o.v}">${o.t}</option>`).join('')}</select></div>`;
        container.innerHTML += countHtml;

        // Type
        container.appendChild(createSelect("Interval Type", "setupIntType", [{v:'time', t:'Time (min)'}, {v:'dist', t:'Distance (m)'}]));

        // Value Container
        const valContainer = document.createElement('div');
        valContainer.id = "intValContainer";
        container.appendChild(valContainer);

        // SPM Container
        const rowsContainer = document.createElement('div');
        rowsContainer.id = "intRows";
        container.appendChild(rowsContainer);

        const updateIntervalRows = () => {
            const count = document.getElementById('setupCount').value;
            const intType = document.getElementById('setupIntType').value;

            // Remove the single value selector
            valContainer.innerHTML = '';

            // Create rows with BOTH value and SPM per interval
            let html = '<label style="font-size:12px;color:rgba(255,255,255,0.6);text-transform:uppercase;margin-bottom:8px;display:block;">Configure Each Interval</label>';
            let valOpts = intType === 'time' ? rangeOpts(1, 10, 1, " min") : rangeOpts(100, 2000, 100, " m");
            
            for(let i=1; i<=count; i++) {
                html += `
                <div class="interval-row">
                    <span>Interval ${i}</span>
                    <select class="int-val-select">
                        ${valOpts.map(o => `<option value="${o.v}">${o.t}</option>`).join('')}
                    </select>
                    <select class="int-spm-select">
                        ${rangeOpts(16,32,1).map(o => `<option value="${o.v}" ${o.v===20?'selected':''}>${o.t} SPM</option>`).join('')}
                    </select>
                </div>`;
            }
            rowsContainer.innerHTML = html;
        };

        // Listeners
        document.getElementById('setupCount').addEventListener('change', updateIntervalRows);
        document.getElementById('setupIntType').addEventListener('change', updateIntervalRows);
        updateIntervalRows();
    }
}

function toggleView(viewName) {
    if (viewName === 'setup') {
        el.setupView.classList.remove('hidden');
        el.workoutView.classList.add('hidden');
    } else {
        el.setupView.classList.add('hidden');
        el.workoutView.classList.remove('hidden');
    }
}

// --- INITIALIZATION ---

Pacer.initPacer({
    phaseName: el.phaseName,
    rowerDot: el.rowerDot,
    driveTime: el.driveTime,
    recovTime: el.recovTime
});

// Initial Setup UI
generateSetupUI();

// --- EVENT LISTENERS ---

// Setup Change
el.workoutType.addEventListener('change', generateSetupUI);

// Create Workout
el.startWorkoutBtn.addEventListener('click', () => {
    const type = el.workoutType.value;
    const config = { type: type };

    if (type === 'time' || type === 'distance') {
        config.spm = parseInt(document.getElementById('setupSPM').value);
        config.value = parseInt(document.getElementById('setupVal').value);
        el.intervalProgressContainer.classList.add('hidden');
    } else {
        // Interval Config Construction
        config.intervals = [];
        const intType = document.getElementById('setupIntType').value;
        const valSelects = document.querySelectorAll('.int-val-select');
        const spmSelects = document.querySelectorAll('.int-spm-select');

        valSelects.forEach((valSel, idx) => {
            config.intervals.push({
                type: intType,
                val: parseInt(valSel.value),
                spm: parseInt(spmSelects[idx].value)
            });
        });
        el.intervalProgressContainer.classList.remove('hidden');
    }

    WorkoutManager.init(config);
    toggleView('workout');

    // Check if we should auto-start immediately (if already rowing)
    const lastData = BLE.getLastKnownData();
    if (lastData && lastData.workoutActive) {
        WorkoutManager.start();
    } else {
        Utils.log("Waiting for rowing to start...");
    }
});

// Stop / New Workout
el.stopWorkoutBtn.addEventListener('click', () => {
    if (WorkoutManager.status === 'active') {
        WorkoutManager.stop(false);
    } else {
        WorkoutManager.reset();
    }
});

// BLE Connect
el.connectBtn.addEventListener('click', async () => {
    const success = await BLE.connectBLE();
    if (success) {
        el.connectBtn.disabled = true;
        el.connectBtn.textContent = '✓ Linked';
        el.connectBtn.style.background = 'var(--recovery)';
        el.connectBtn.style.color = '#000';
        Utils.ensureAudio();
    }
});

// System Controls
el.audioBtn.addEventListener('click', () => {
    const enabled = Utils.toggleAudio();
    el.audioBtn.textContent = enabled ? '🔊 Sound' : '🔇 Muted';
    el.audioBtn.classList.toggle('active', enabled);
});
el.logBtn.addEventListener('click', () => Utils.saveRawLog(BLE.getRawLog()));
el.debugBtn.addEventListener('click', () => el.debugEl.style.display = el.debugEl.style.display === 'none' ? 'block' : 'none');

// --- BLE LOOP ---
BLE.setCallback((data) => {
    // 1. Update Raw Stats
    if (data.spm !== null) {
        el.spm.textContent = (Math.round(data.spm * 2) / 2).toFixed(1);
        el.spmSource.textContent = "Filtered Data"; // Simplified, since we removed Average
        el.spmSource.className = `spm-source filtered`;
    } else {
        el.spm.textContent = '--';
        // Check workoutActive. If active, we are calculating. If not, we are Idle.
        el.spmSource.textContent = data.workoutActive ? 'Calculating...' : 'Idle';
        el.spmSource.className = 'spm-source';
    }

    if(data.pace) el.pace.textContent = data.pace;

    // We only want to show "Raw Machine Data" if:
    // 1. We are NOT in an active workout
    // 2. AND we are NOT waiting for a configured workout to start (config is null)
    if (WorkoutManager.status !== 'active' && !WorkoutManager.config) {
        if(data.strokes) el.strokeCount.textContent = data.strokes;
        if(data.distance) el.distance.textContent = data.distance + 'm';
        el.workoutTime.textContent = Utils.formatTime(data.time);
    }
    
    // ---------------------------

    // 2. Update Workout Logic
    WorkoutManager.update(data);
});