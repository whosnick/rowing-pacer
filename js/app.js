import * as Utils from './utils.js';
import * as Pacer from './pacer.js';
import * as BLE from './ble.js';

// --- ELEMENTS ---
const el = {
    connectBtn: document.getElementById('connectBtn'),
    spm: document.getElementById('spm'),
    spmSource: document.getElementById('spmSource'),
    pace: document.getElementById('pace'),
    strokeCount: document.getElementById('strokeCount'),
    distance: document.getElementById('distance'),
    workoutTime: document.getElementById('workoutTime'),
    
    // Controls
    audioBtn: document.getElementById('audioBtn'),
    logBtn: document.getElementById('logBtn'),
    debugBtn: document.getElementById('debugBtn'),
    debugEl: document.getElementById('debug'),
    
    // Pacer
    spmSlider: document.getElementById('spmSlider'),
    targetSPMVal: document.getElementById('targetSPMVal'),
    pacerBtn: document.getElementById('pacerBtn'),
    
    // Pacer Animation Elements
    phaseName: document.getElementById('phaseName'),
    rowerDot: document.getElementById('rowerDot'),
    driveTime: document.getElementById('driveTime'),
    recovTime: document.getElementById('recovTime'),
    btn: document.getElementById('pacerBtn')
};

// --- INITIALIZATION ---

// Initialize Pacer Module with DOM elements it needs
Pacer.initPacer({
    phaseName: el.phaseName,
    rowerDot: el.rowerDot,
    driveTime: el.driveTime,
    recovTime: el.recovTime,
    btn: el.pacerBtn
});

// Update initial pacer stats
Pacer.setTargetSPM(20);

// --- EVENT LISTENERS ---

// 1. Bluetooth Connect
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

// 2. Pacer Controls
el.spmSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    el.targetSPMVal.textContent = val;
    Pacer.setTargetSPM(val);
});

el.pacerBtn.addEventListener('click', () => {
    Pacer.togglePacer();
});

// 3. System Controls
el.audioBtn.addEventListener('click', () => {
    const enabled = Utils.toggleAudio();
    el.audioBtn.textContent = enabled ? '🔊 Sound' : '🔇 Muted';
    el.audioBtn.classList.toggle('active', enabled);
});

el.logBtn.addEventListener('click', () => {
    Utils.saveRawLog(BLE.getRawLog());
});

el.debugBtn.addEventListener('click', () => {
    el.debugEl.style.display = el.debugEl.style.display === 'none' ? 'block' : 'none';
});

// --- DATA UPDATE LOOP ---

// Subscribe to BLE updates
BLE.setCallback((data) => {
    // SPM
    if (data.spm !== null) {
        el.spm.textContent = (Math.round(data.spm * 2) / 2).toFixed(1);
        
        let txt = "";
        let cls = "";
        switch(data.spmSource) {
            case "filtered": txt = "Filtered Device Data"; cls = "filtered"; break;
            case "average": txt = "Device Average"; cls = "average"; break;
            default: txt = "Estimating...";
        }
        el.spmSource.textContent = txt;
        el.spmSource.className = `spm-source ${cls}`;
    } else {
        el.spm.textContent = '--';
        el.spmSource.textContent = data.workoutActive ? 'Waiting...' : 'Idle';
        el.spmSource.className = 'spm-source';
    }

    // Other Stats
    if(data.strokes) el.strokeCount.textContent = data.strokes;
    if(data.distance) el.distance.textContent = data.distance + 'm';
    if(data.pace) el.pace.textContent = data.pace;
    el.workoutTime.textContent = Utils.formatTime(data.time);
});

// Fallback timer for workout time display (makes the clock tick even if BLE doesn't send data for 1s)
setInterval(() => {
    // Only used to tick the seconds visually, the real source of truth is BLE
}, 100);
