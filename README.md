# 🚣 Rowing Pacer

A Progressive Web App for heart rate zone training on indoor rowing machines. Connect via Bluetooth to FTMS-compatible rowers (Merach, Concept2, and others) for real-time coaching, interval tracking, and workout history with detailed analytics.

![PWA](https://img.shields.io/badge/PWA-Ready-brightgreen)
![Bluetooth](https://img.shields.io/badge/Bluetooth-FTMS-blue)
![License](https://img.shields.io/badge/License-Apache%202.0-blue)

## ✨ Features

### 🏋️ Workout Management
- **Built-in Templates** — 8 scientifically-designed workouts for cardiovascular health
- **Custom Workouts** — Create time-based or distance-based intervals with target SPM and HR zones
- **Workout Editor** — Intuitive interface for building personalized training sessions

### 📊 Real-Time Display
- **Heart Rate Zones** — Live HR display with Karvonen HRR zone calculation
- **SPM Pacer** — Visual stroke rate guide with target indicators
- **Pace Tracking** — Real-time /500m pace with color-coded feedback
- **Interval Progress** — Visual progress bar showing current interval completion

### 🎯 Smart Coaching
- **Audio Cues** — Spoken guidance for interval transitions and zone deviations
- **Zone Alerts** — Real-time feedback when HR drifts from target zone
- **Pre-Interval Warnings** — Heads-up before intensity changes

### 📈 Analytics
- **Workout History** — Browse past sessions with key metrics
- **Detailed Graphs** — HR, pace, and SPM charts for each workout
- **Interval Breakdown** — Per-interval statistics and comparisons
- **Zone Distribution** — Time spent in each HR zone

### 🔌 Connectivity
- **FTMS Protocol** — Works with any Bluetooth FTMS rowing machine
- **Heart Rate Monitor** — Optional BLE HR chest strap support (recommended!)
- **Auto-Reconnect** — Graceful handling of connection drops

## 📱 Installation

### As a PWA (Recommended)

1. Open the app in Chrome or Edge on your device
2. Tap the browser menu (⋮ or •••)
3. Select "Add to Home Screen" or "Install App"
4. Launch from your home screen for full-screen experience

### Requirements
- **Browser**: Chrome 89+, Edge 89+, or Opera 77+ (Web Bluetooth support)
- **Device**: Android, Windows, macOS, or ChromeOS
- **Note**: iOS Safari does not support Web Bluetooth

## 🚀 Quick Start

### 1. Configure Your Profile
```
Settings → Enter Age and Resting HR
```
The app calculates your HR zones using the Karvonen formula:
```
Target HR = RestHR + % × (HRmax - RestHR)
```

### 2. Connect Your Rower
```
Home → Connect Rower → Select your device
```
Ensure your rower is powered on and in Bluetooth pairing mode.

### 3. Select a Workout
```
Programs → Choose a workout → Start Rowing
```
The workout auto-starts when you begin rowing.

### 4. Follow the Guidance
- **SPM Ring** — Match your stroke rate to the target
- **HR Zone Display** — Keep your heart rate in the target zone
- **Pace Value** — Monitor your /500m split time

## 🏃 Built-in Workouts

| Workout | Duration | Focus | Description |
|---------|----------|-------|-------------|
| **Just Row** | Open | Free row | Row without structure |
| **The Commute** | 20 min | Zone 2 | Short aerobic base session |
| **Parasympathetic Reset** | 25 min | Zone 2-3 | Stress relief after work |
| **Blood Pressure Club** | 30 min | Zone 2 | Core cardiovascular session |
| **Gentle Climb** | ~30 min | Distance | 200/400/600/400/200m pyramid |
| **The Threshold** | 35 min | Zone 2-3 | Threshold adaptation |
| **The Desk Antidote** | 40 min | Zone 2-3 | Weekly long session |
| **Six Shooter** | 20 min | HIIT | 6×1min sprints with rest |

## 🔧 Technical Details

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        App Shell                             │
├─────────────────────────────────────────────────────────────┤
│  Views: Home │ Workout │ Programs │ History │ Summary       │
├─────────────────────────────────────────────────────────────┤
│  State Machine (WorkoutFSM)                                 │
│  IDLE → ACTIVE ⇄ PAUSED → FINISHED                         │
├─────────────────────────────────────────────────────────────┤
│  Services: FTMS │ HR Monitor │ Coaching │ TTS              │
├─────────────────────────────────────────────────────────────┤
│  Storage: IndexedDB (Programs, Workouts, BLE Data)         │
└─────────────────────────────────────────────────────────────┘
```

### Activity Detection

The app uses a **"Snappy Start"** algorithm for reliable auto-pause:

1. **Stroke Detection** — New stroke → `isActive = true` + 6-second immunity
2. **Immunity Block** — 6 seconds of guaranteed active state (covers low SPM)
3. **Coasting Detection** — After immunity, `isActive = distanceIncreased`
4. **Dead Stop** — Distance unchanged → instant pause

### Data Storage

| Store | Contents |
|-------|----------|
| `programs` | Workout templates (built-in + custom) |
| `workouts` | Completed workout metadata |
| `bleData` | Per-stroke telemetry (time, dist, pace, SPM, HR) |

### Bluetooth Protocol

Uses standard FTMS (Fitness Machine Service) UUIDs:

| Characteristic | UUID | Purpose |
|---------------|------|---------|
| Rower Data | `0x2AD1` | Real-time metrics |
| Control Point | `0x2AD9` | Start/Stop/Pause commands |
| Machine Status | `0x2ADA` | Machine state changes |

## 🛠️ Development

### Prerequisites
- Node.js 18+ (for serving locally)
- HTTPS required for Web Bluetooth

### Local Development

```bash
# Clone the repository
git clone https://github.com/whosnick/rowing-pacer.git
cd rowing-pacer

# Serve with HTTPS (required for Bluetooth)
python serve_https.py

# Or use any HTTPS server
npx serve --ssl-cert cert.pem --ssl-key key.pem
```

### Project Structure

```
rowing-pacer/
├── index.html           # App shell
├── app.js               # Main controller & FSM
├── style.css            # All styles
├── manifest.json        # PWA manifest
├── sw.js                # Service worker
├── components/          # UI components
│   ├── WorkoutView.js   # Active workout display
│   ├── WorkoutDetailView.js  # Post-workout graphs
│   ├── HomeView.js      # Dashboard
│   ├── ProgramListView.js    # Workout browser
│   ├── EditorView.js    # Workout creator
│   └── ...
├── bluetooth/           # BLE services
│   ├── ftmsService.js   # Rower connection
│   └── hrService.js     # HR monitor connection
└── utils/               # Helpers
    ├── constants.js     # Zones, templates, config
    ├── storage.js       # IndexedDB wrapper
    ├── CoachingEngine.js # Audio guidance
    └── ...
```

## 📋 Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome Desktop | ✅ Full | Windows, macOS, ChromeOS |
| Chrome Android | ✅ Full | Recommended |
| Edge Desktop | ✅ Full | Windows, macOS |
| Opera Desktop | ✅ Full | Requires flag for some features |
| Safari Desktop | ❌ No | No Web Bluetooth |
| Safari iOS | ❌ No | No Web Bluetooth |
| Firefox | ❌ No | No Web Bluetooth |

## 🔒 Privacy

- **No Account Required** — All data stored locally
- **No Cloud Sync** — Your workout data never leaves your device
- **No Analytics** — No tracking or telemetry
- **No Ads** — Clean, distraction-free experience

## 📄 License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Built on the [FTMS Bluetooth specification](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/)
- Heart rate zone methodology based on Karvonen formula
- Workout designs informed by cardiovascular exercise research

---

**Made with ❤️ for rowers who want smarter training.**
