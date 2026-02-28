// spmPacer.js - SPM Pacer with visual ring and optional audio

class SPMPacer {
  constructor(svgElement, enableAudio = true) {
    this.svg = svgElement;
    this.ring = svgElement.querySelector('#pacerRing');
    this.centerText = svgElement.querySelector('#pacerSPM');
    this.targetText = svgElement.querySelector('#targetSPM');
    this.actualSPM = null;
    
    // Animation state
    this.targetSPM = 20;
    this.currentRenderSPM = 20;
    this.cycleProgress = 0;
    this.lastFrameTime = null;
    this.animationId = null;
    this.isRunning = false;
    
    // Ring geometry
    this.radius = 45;
    this.circumference = 2 * Math.PI * this.radius;
    
    // Audio
    this.enableAudio = enableAudio;
    this.audioContext = null;
    this.lastBeepTime = 0;
    
    // Beep settings
    this.beepSettings = {
      frequency: 800,
      volume: 0.1,
      duration: 0.05
    };
    this.loadBeepSettings();
    
    // EMA smoothing
    this.smoothingStiffness = 0.1;
    
    this.setupAudio();
    this.reset();
  }

  loadBeepSettings() {
    const saved = localStorage.getItem('pacerBeepSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.beepSettings = { ...this.beepSettings, ...parsed };
      } catch (e) {
        console.warn('Failed to load pacer beep settings:', e);
      }
    }
  }
  
  saveBeepSettings() {
    localStorage.setItem('pacerBeepSettings', JSON.stringify(this.beepSettings));
  }
  
  setupAudio() {
    if (this.enableAudio && typeof AudioContext !== 'undefined') {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
  }
  
  setBeepSettings(settings) {
    this.beepSettings = { ...this.beepSettings, ...settings };
    this.saveBeepSettings();
  }
  
  getBeepSettings() {
    return { ...this.beepSettings };
  }

  setTargetSPM(spm) {
    // Clamp to reasonable range
    this.targetSPM = Math.max(16, Math.min(32, spm));
    
    // Update target text
    if (this.targetText) {
      this.targetText.textContent = `Target: ${this.targetSPM}`;
    }
    
    // Visual feedback during transition
    if (this.targetText && Math.abs(this.targetSPM - this.currentRenderSPM) > 1) {
      this.targetText.style.color = '#f59e0b'; // Orange during ramp
      setTimeout(() => {
        if (this.targetText) this.targetText.style.color = '#94a3b8';
      }, 2000);
    }
  }

  setAudioEnabled(enabled) {
    this.enableAudio = enabled;
    if (!enabled) {
      this.audioContext = null;
    } else {
      this.setupAudio();
    }
  }

  playBeep() {
    if (!this.enableAudio || !this.audioContext) return;
    
    const now = this.audioContext.currentTime;
    if (now - this.lastBeepTime < 0.1) return; // Debounce
    
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    
    const freq = Math.max(200, Math.min(2000, this.beepSettings.frequency));
    const vol = Math.max(0, Math.min(1, this.beepSettings.volume));
    const dur = Math.max(0.01, Math.min(0.5, this.beepSettings.duration));
    
    oscillator.frequency.value = freq;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(vol, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + dur);
    
    oscillator.start(now);
    oscillator.stop(now + dur);
    
    this.lastBeepTime = now;
  }
  
  testBeep() {
    if (!this.audioContext) {
      this.setupAudio();
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    this.playBeep();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.animate();
  }

  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  reset() {
    this.cycleProgress = 0;
    this.currentRenderSPM = this.targetSPM;
    this.updateRing();
  }

  animate() {
    if (!this.isRunning) return;

    const now = performance.now();
    const dt = this.lastFrameTime ? now - this.lastFrameTime : 0;
    this.lastFrameTime = now;

    // Smooth SPM transition (frame-rate independent)
    const stiffness = this.smoothingStiffness * (dt / 16.67); // Normalized to 60fps
    this.currentRenderSPM += (this.targetSPM - this.currentRenderSPM) * stiffness;

    // Calculate beat duration
    const beatDuration = 60000 / this.currentRenderSPM; // ms per stroke

    // Advance cycle
    const cycleIncrement = dt / beatDuration;
    this.cycleProgress += cycleIncrement;

    // Handle cycle completion
    if (this.cycleProgress >= 1.0) {
      this.cycleProgress -= 1.0;
      this.playBeep(); // Beep at catch
    }

    this.updateRing();
    this.animationId = requestAnimationFrame(() => this.animate());
  }

  updateRing() {
      // Safety check: ensure ring element exists
      if (!this.ring) return;

      // Update stroke dashoffset for visual progress
      const offset = this.circumference * (1 - this.cycleProgress);
      this.ring.style.strokeDashoffset = offset;

      // Note: Center text is now updated by WorkoutView to keep text+color in sync
  }

  updateActualSPM(spm) {
      // FIX: Store the actual SPM passed from the view
      this.actualSPM = spm;
  }

  destroy() {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}

export default SPMPacer;