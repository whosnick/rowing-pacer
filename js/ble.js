import { buf2hex, log } from './utils.js';

const FTMS_SERVICE = 0x1826;
const ROWING_DATA_CHAR = 0x2AD1;
const UINT16_MAX = 0x10000;
const IDLE_RESET_MS = 3500;
const ROWING_ACTIVITY_THRESHOLD_MS = 8000;
const STOP_TIMEOUT_MS = 8000;
const DEVICE_SPM_VALID_RANGE = { min: 12, max: 48 };
const MAX_HISTORY_SIZE = 5;

let device, server, char;
let onDataCallback = null;

// State
const rawDataLog = [];
const deviceSPMHistory = [];
const strokeTimestamps = [];

let initialStrokeCount = null;
let lastStrokeCount = null;
let currentSPM = null;
let deviceAvgSR = null;
let deviceInstantSPM = null;
let spmSource = "none";

let workoutActive = false;
let workoutStart = null;
let accumWorkoutMs = 0;
let stopTimer;

// --- EXPORTED FUNCTIONS ---

export const getRawLog = () => rawDataLog;

export const setCallback = (cb) => {
    onDataCallback = cb;
};

export const connectBLE = async () => {
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [FTMS_SERVICE] }]
        });
        server = await device.gatt.connect();
        const svc = await server.getPrimaryService(FTMS_SERVICE);
        char = await svc.getCharacteristic(ROWING_DATA_CHAR);
        await char.startNotifications();
        char.addEventListener('characteristicvaluechanged', handleRowerData);
        log('Connected to ' + device.name);
        return true;
    } catch (e) {
        log('Connect Error: ' + e.message);
        return false;
    }
};

// --- INTERNAL LOGIC ---

function addToDeviceSPMHistory(spm) {
    if (spm >= DEVICE_SPM_VALID_RANGE.min && spm <= DEVICE_SPM_VALID_RANGE.max) {
        deviceSPMHistory.push(spm);
        if (deviceSPMHistory.length > MAX_HISTORY_SIZE) deviceSPMHistory.shift();
    }
}

function getFilteredDeviceSPM() {
    if (deviceSPMHistory.length === 0) return null;
    const sorted = [...deviceSPMHistory].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function calculateStableSPM() {
    const now = performance.now();
    const isActiveRowing = strokeTimestamps.length > 0 && 
                          (now - strokeTimestamps[strokeTimestamps.length - 1]) < ROWING_ACTIVITY_THRESHOLD_MS;
    
    if (!isActiveRowing) {
        spmSource = "none";
        return null;
    }
    
    // 1. Median Filtered Device Data
    const filteredDeviceSPM = getFilteredDeviceSPM();
    if (filteredDeviceSPM !== null) {
        spmSource = "filtered";
        // EMA Smoothing (0.6 / 0.4)
        if (currentSPM === null || currentSPM === 0) return filteredDeviceSPM;
        return (0.6 * filteredDeviceSPM) + (0.4 * currentSPM);
    }
    
    // 2. Device Average Fallback
    if (deviceAvgSR !== null && deviceAvgSR > 0) {
        spmSource = "average";
        return deviceAvgSR;
    }
    
    return currentSPM || null;
}

function onStrokeDetected(sc, timestamp) {
    if (initialStrokeCount === null) initialStrokeCount = sc;
    
    // Idle Reset check
    if (strokeTimestamps.length > 0) {
        const lastTime = strokeTimestamps[strokeTimestamps.length - 1];
        if (timestamp - lastTime > IDLE_RESET_MS) {
            log(`Idle detected. Resetting history.`);
            strokeTimestamps.length = 0;
            deviceSPMHistory.length = 0;
        }
    }
    
    strokeTimestamps.push(timestamp);
    if (strokeTimestamps.length > 20) strokeTimestamps.shift();
    
    if (!workoutActive) {
        workoutActive = true;
        workoutStart = performance.now();
    }
    
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
        if (workoutActive) {
            workoutActive = false;
            accumWorkoutMs += performance.now() - workoutStart;
            workoutStart = null;
            strokeTimestamps.length = 0;
            deviceSPMHistory.length = 0;
            updateUI(); // Force update to show Idle
        }
    }, STOP_TIMEOUT_MS);
}

function handleRowerData(ev) {
    const data = ev.target.value;
    const timestamp = performance.now();
    if (!data || data.byteLength < 2) return;

    // Log Raw
    rawDataLog.push({
        iso: new Date().toISOString(),
        perf: timestamp,
        hex: buf2hex(data.buffer)
    });

    const flags = data.getUint16(0, true);
    let offset = 2;
    
    // Flags
    if ((flags & 0x0001) !== 0) return; // More Data flag present? Skip.
    const SR_AND_CNT = (flags & 0x0002) !== 0;
    const AVG_SR = (flags & 0x0004) !== 0;
    const DIST = (flags & 0x0008) !== 0;
    const INST_PACE = (flags & 0x0010) !== 0;

    // 1. Instant SPM
    if (SR_AND_CNT && data.byteLength >= offset + 1) {
        const rawStrokeRate = data.getUint8(offset);
        deviceInstantSPM = rawStrokeRate / 2; // Merach 0.5 resolution
        if (workoutActive || rawStrokeRate > 0) addToDeviceSPMHistory(deviceInstantSPM);
        offset += 1;
    }

    // 2. Stroke Count
    let displayStrokes = 0;
    if (SR_AND_CNT && data.byteLength >= offset + 2) {
        const sc = data.getUint16(offset, true);
        offset += 2;
        
        if (lastStrokeCount === null) {
            lastStrokeCount = sc;
        } else if (sc !== lastStrokeCount) {
            const diff = (sc - lastStrokeCount + UINT16_MAX) % UINT16_MAX;
            if (diff > 0 && diff < 10) onStrokeDetected(sc, timestamp);
            lastStrokeCount = sc;
        }
        
        if (initialStrokeCount !== null) {
            displayStrokes = (sc - initialStrokeCount + UINT16_MAX) % UINT16_MAX;
        }
    }

    // 3. Average SPM
    if (AVG_SR && data.byteLength >= offset + 1) {
        deviceAvgSR = data.getUint8(offset) / 2;
        offset += 1;
    }

    // 4. Distance
    let displayDist = 0;
    if (DIST && data.byteLength >= offset + 3) {
        displayDist = data.getUint8(offset) | (data.getUint8(offset+1)<<8) | (data.getUint8(offset+2)<<16);
        offset += 3;
    }

    // 5. Pace
    let displayPace = "--:--";
    if (INST_PACE && data.byteLength >= offset + 2) {
        const sp = data.getUint16(offset, true);
        offset += 2;
        if (sp > 0 && sp < 600) {
            const m = Math.floor(sp / 60);
            const s = String(sp % 60).padStart(2, '0');
            displayPace = `${m}:${s}`;
        }
    }

    updateUI(displayStrokes, displayDist, displayPace);
}

function updateUI(strokes, dist, pace) {
    // Calculate SPM using the logic
    const stableSPM = calculateStableSPM();
    
    // Update State
    if (stableSPM !== null && stableSPM > 0) {
        currentSPM = stableSPM;
    } else {
        currentSPM = null;
    }

    // Calculate elapsed time
    const elapsed = accumWorkoutMs + (workoutActive && workoutStart ? performance.now() - workoutStart : 0);

    // Send data back to App
    if (onDataCallback) {
        onDataCallback({
            spm: currentSPM,
            spmSource: spmSource,
            strokes: strokes || 0,
            distance: dist || 0,
            pace: pace || "--:--",
            time: elapsed,
            workoutActive: workoutActive
        });
    }
}
