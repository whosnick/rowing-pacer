import { beep, requestWakeLock, releaseWakeLock, ensureAudio, beepRecovery } from './utils.js';

const strokeData = {
    16: { drive: 1.18, recovery: 2.57 },
    17: { drive: 1.15, recovery: 2.38 },
    18: { drive: 1.12, recovery: 2.21 },
    19: { drive: 1.10, recovery: 2.06 },
    20: { drive: 1.05, recovery: 1.95 },
    21: { drive: 1.03, recovery: 1.83 },
    22: { drive: 1.01, recovery: 1.72 },
    23: { drive: 0.99, recovery: 1.62 },
    24: { drive: 0.98, recovery: 1.52 },
    25: { drive: 0.96, recovery: 1.44 },
    26: { drive: 0.94, recovery: 1.37 },
    27: { drive: 0.93, recovery: 1.29 },
    28: { drive: 0.92, recovery: 1.22 },
    29: { drive: 0.91, recovery: 1.16 },
    30: { drive: 0.90, recovery: 1.10 },
    31: { drive: 0.89, recovery: 1.05 },
    32: { drive: 0.88, recovery: 1.00 }
};

let pacerRunning = false;
let pacerAnimationFrame = null;

// Animation State
let lastFrameTime = 0;
let cycleProgress = 0; // 0.0 to 1.0 (0=Catch, 1=Finish)
let currentRenderSPM = 20; // The actual float SPM being rendered (e.g. 20.4)
let targetSPM = 20; // The goal SPM

let currentPhase = 'drive';

// DOM Elements cache
let dom = {};

export const initPacer = (elements) => {
    dom = elements;
};

export const setTargetSPM = (spm) => {
    targetSPM = spm;
    // We do NOT update the text immediately here anymore, 
    // we let the animation loop update it as it smoothly transitions.
};

export const startPacer = () => {
    if (pacerRunning) return; 
    pacerRunning = true;
    
    lastFrameTime = performance.now();
    currentRenderSPM = targetSPM; // Start exactly on target
    cycleProgress = 0;
    currentPhase = 'drive';

    requestWakeLock();
    ensureAudio();
    beep(); // Initial Beep
    animatePacer();
};

export const stopPacer = () => {
    pacerRunning = false;
    releaseWakeLock();
    if(pacerAnimationFrame) cancelAnimationFrame(pacerAnimationFrame);
    resetPacerUI();
};

function resetPacerUI() {
    dom.phaseName.textContent = "READY";
    dom.phaseName.className = "phase-name drive";
    dom.rowerDot.className = "rower-dot drive";
    dom.rowerDot.style.left = "10px";
}

function getInterpolatedStrokeData(spm) {
    // Clamp SPM to data range
    const safeSPM = Math.max(16, Math.min(32, spm));
    const lower = Math.floor(safeSPM);
    const upper = Math.ceil(safeSPM);
    
    if (lower === upper) return strokeData[lower];

    // Linear Interpolate between integer steps for smoothness
    const ratio = safeSPM - lower;
    const d1 = strokeData[lower];
    const d2 = strokeData[upper];

    return {
        drive: d1.drive + (d2.drive - d1.drive) * ratio,
        recovery: d1.recovery + (d2.recovery - d1.recovery) * ratio
    };
}

function animatePacer(timestamp) {
    if (!pacerRunning) return;
    if (!timestamp) timestamp = performance.now();

    const dt = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    // --- FIX: TIME-BASED SMOOTHING ---
    
    // We normalize the speed to a standard 60 FPS (approx 16.67ms per frame).
    // If running at 120 FPS, dt will be ~8.33ms, so timeRatio will be 0.5.
    // If running at 30 FPS, dt will be ~33.3ms, so timeRatio will be 2.0.
    const timeRatio = dt / 16.67;

    const diff = targetSPM - currentRenderSPM;
    
    if (Math.abs(diff) > 0.01) {
        // Multiply the base factor (0.02) by the timeRatio
        // This guarantees the visual speed is consistent on all devices.
        currentRenderSPM += diff * (0.008 * timeRatio); 
    } else {
        currentRenderSPM = targetSPM;
    }

    // ---------------------------------

    // Update Text UI with the smoothed value
    if(dom.driveTime) {
        const liveData = getInterpolatedStrokeData(currentRenderSPM);
        dom.driveTime.textContent = liveData.drive.toFixed(2) + 's';
        dom.recovTime.textContent = liveData.recovery.toFixed(2) + 's';
    }

    // 2. Calculate Cycle Duration
    const data = getInterpolatedStrokeData(currentRenderSPM);
    const totalCycleMs = (data.drive + data.recovery) * 1000;
    const driveRatio = (data.drive * 1000) / totalCycleMs;

    // 3. Advance Progress based on Delta Time
    cycleProgress += dt / totalCycleMs;

    // Loop logic
    if (cycleProgress >= 1.0) {
        cycleProgress -= 1.0;
        currentPhase = 'drive'; 
        dom.phaseName.textContent = "DRIVE";
        dom.phaseName.className = "phase-name drive";
        dom.rowerDot.className = "rower-dot drive";
        beep(); 
    }

    // 4. Determine Position based on Phase
    if (cycleProgress < driveRatio) {
        // DRIVE PHASE
        if (currentPhase !== 'drive') {
            currentPhase = 'drive';
            dom.phaseName.textContent = "DRIVE";
            dom.phaseName.className = "phase-name drive";
            dom.rowerDot.className = "rower-dot drive";
        }
        const driveProgress = cycleProgress / driveRatio;
        dom.rowerDot.style.left = `calc(10px + (${driveProgress} * (100% - 50px)))`;

    } else {
        // RECOVERY PHASE
        if (currentPhase !== 'recovery') {
            currentPhase = 'recovery';
            dom.phaseName.textContent = "RECOVERY";
            dom.phaseName.className = "phase-name recovery";
            dom.rowerDot.className = "rower-dot recovery";
            beepRecovery(); 
        }
        const recoveryProgress = (cycleProgress - driveRatio) / (1 - driveRatio);
        dom.rowerDot.style.left = `calc((100% - 40px) - (${recoveryProgress} * (100% - 50px)))`;
    }

    pacerAnimationFrame = requestAnimationFrame(animatePacer);
}