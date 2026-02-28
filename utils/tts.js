// utils/tts.js - Minimal TTS wrapper

class TTSManager {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.enabled = true;

    // Default settings
    this.settings = {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0
    };

    this.loadSettings();
    this.init();
  }

  loadSettings() {
    const saved = localStorage.getItem('ttsSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.settings = { ...this.settings, ...parsed };
      } catch (e) {
        console.warn('Failed to load TTS settings:', e);
      }
    }
  }

  saveSettings() {
    localStorage.setItem('ttsSettings', JSON.stringify(this.settings));
  }

  init() {
    if (!this.synth) {
      console.warn('Web Speech API not supported');
      this.enabled = false;
      return;
    }

    this.loadVoices();

    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this.loadVoices();
    }
  }

  loadVoices() {
    const voices = this.synth.getVoices();
    this.voice = voices.find(v => v.lang.startsWith('en')) || voices[0];
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled && this.synth) {
      this.synth.cancel();
    }
  }

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.saveSettings();
  }

  getSettings() {
    return { ...this.settings };
  }

  speak(text, overrideSettings = null) {
    if (!this.enabled || !this.synth || !text) {
      return false;
    }

    // Cancel any ongoing speech
    this.synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    if (this.voice) {
      utterance.voice = this.voice;
    }

    const settings = overrideSettings || this.settings;
    utterance.rate = Math.max(0.5, Math.min(2.0, settings.rate || 1.0));
    utterance.pitch = Math.max(0.5, Math.min(2.0, settings.pitch || 1.0));
    utterance.volume = Math.max(0, Math.min(1.0, settings.volume || 1.0));

    this.synth.speak(utterance);
    return true;
  }
}

// Singleton
let ttsInstance = null;

export function getTTS() {
  if (!ttsInstance) {
    ttsInstance = new TTSManager();
  }
  return ttsInstance;
}

export function speak(text) {
  return getTTS().speak(text);
}

export function setTTSEnabled(enabled) {
  getTTS().setEnabled(enabled);
}

export function setTTSSettings(settings) {
  getTTS().setSettings(settings);
}

export function getTTSSettings() {
  return getTTS().getSettings();
}

export function testTTS(settings = null) {
  const testText = "This is a test of the text to speech voice. Row at 20 strokes per minute.";
  return getTTS().speak(testText, settings);
}