import { beep, requestWakeLock, releaseWakeLock, ensureAudio } from './utils.js';

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
let pacerStartTime = 0;
let currentPhase = 'drive';
let targetSPM = 20;

// DOM Elements cache
let dom = {};

export const initPacer = (elements) => {
    dom = elements;
};

export const setTargetSPM = (spm) => {
    targetSPM = spm;
    const data = strokeData[targetSPM];
    if(data && dom.driveTime && dom.recovTime) {
        dom.driveTime.textContent = data.drive.toFixed(2) + 's';
        dom.recovTime.textContent = data.recovery.toFixed(2) + 's';
    }
};

export const startPacer = () => {
    if (pacerRunning) return; // Prevent double start
    pacerRunning = true;
    // dom.btn.textContent ... REMOVE button text logic as button is gone
    pacerStartTime = performance.now();
    currentPhase = 'drive';

    requestWakeLock();
    ensureAudio();
    beep(); 
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

function animatePacer() {
    if (!pacerRunning) return;

    const data = strokeData[targetSPM];
    const driveMs = data.drive * 1000;
    const recovMs = data.recovery * 1000;
    const totalCycleMs = driveMs + recovMs;
    
    const elapsed = (performance.now() - pacerStartTime) % totalCycleMs;
    
    if (elapsed < driveMs) {
        // DRIVE PHASE
        if (currentPhase !== 'drive') {
            currentPhase = 'drive';
            dom.phaseName.textContent = "DRIVE";
            dom.phaseName.className = "phase-name drive";
            dom.rowerDot.className = "rower-dot drive";
            beep(); // Audio Cue at Catch
        }
        
        const progress = elapsed / driveMs; 
        dom.rowerDot.style.left = `calc(10px + (${progress} * (100% - 50px)))`;
        
    } else {
        // RECOVERY PHASE
        if (currentPhase !== 'recovery') {
            currentPhase = 'recovery';
            dom.phaseName.textContent = "RECOVERY";
            dom.phaseName.className = "phase-name recovery";
            dom.rowerDot.className = "rower-dot recovery";
        }
        
        const recovElapsed = elapsed - driveMs;
        const progress = recovElapsed / recovMs; 
        
        // Return stroke (Right to Left)
        dom.rowerDot.style.left = `calc((100% - 40px) - (${progress} * (100% - 50px)))`;
    }

    pacerAnimationFrame = requestAnimationFrame(animatePacer);
}
