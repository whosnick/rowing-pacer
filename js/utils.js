// Audio Context Singleton
let audioCtx = null;
let audioEnabled = true;
let wakeLock = null;

export const ensureAudio = () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
};

export const toggleAudio = () => {
    audioEnabled = !audioEnabled;
    return audioEnabled;
};

export const beep = async () => {
    if (!audioEnabled) return;
    const ctx = ensureAudio();
    if (ctx.state === 'suspended') await ctx.resume();
    
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    
    // High pitch short beep for Catch
    o.frequency.value = 880; 
    g.gain.setValueAtTime(0.3, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    
    o.connect(g);
    g.connect(ctx.destination);
    o.start(now);
    o.stop(now + 0.2);
};

export const requestWakeLock = async () => {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            log('Wake Lock active');
        }
    } catch (err) {
        console.error(err);
    }
};

export const releaseWakeLock = async () => {
    if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
    }
};

export const buf2hex = (buffer) => { 
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join(' ');
};

export const formatTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
};

export const log = (msg) => {
    const debugEl = document.getElementById('debug');
    if(debugEl) {
        debugEl.textContent += `> ${msg}\n`;
        debugEl.scrollTop = debugEl.scrollHeight;
    }
};

export const saveRawLog = (rawDataLog) => {
    if (rawDataLog.length === 0) {
        alert('No data recorded yet');
        return;
    }
    const content = "ISO_Timestamp,Perf_Timestamp_MS,Raw_Hex_Bytes\n" + 
                    rawDataLog.map(r => `${r.iso},${r.perf.toFixed(2)},"${r.hex}"`).join('\n');
    
    const blob = new Blob([content], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rowing_data_${new Date().toISOString().slice(0,19).replace(/[:]/g,'-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};
