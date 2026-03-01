(function () {
  const oldUI = document.getElementById('ftms-sim-ui-container');
  if (oldUI) oldUI.remove();

  const FTMS = {
    SERVICE:          '00001826-0000-1000-8000-00805f9b34fb',
    ROWER_DATA:       '00002ad1-0000-1000-8000-00805f9b34fb',
    CONTROL_POINT:    '00002ad9-0000-1000-8000-00805f9b34fb',
    MACHINE_STATUS:   '00002ada-0000-1000-8000-00805f9b34fb',
    TRAINING_STATUS:  '00002ad3-0000-1000-8000-00805f9b34fb',
  };

  const RS = { INACTIVE: 0, ACTIVE: 1 };

  const sim = {
    watts:            150,
    spm:              22,
    spmTarget:        22,
    distance:         0,
    elapsedTime:      0,
    cals:             0,
    strokeState:      2,
    strokePhaseTimer: 0,
    strokeCount:      0,
    hr:               72,
    hrConnected:      true,
    rowingState:      RS.INACTIVE,
    lastUpdate:       Date.now(),
    machineStatus:    'idle',
    controlPointChar: null,
    statusChar:       null,
    trainingStatusChar: null,
    rowerDataChar:    null,
  };

  const strokeListeners = [];
  function onStroke(cb) { strokeListeners.push(cb); }
  function fireStroke() { strokeListeners.forEach(cb => cb()); }

  const e2 = (v) => [v & 0xFF, (v >> 8) & 0xFF];
  const e3 = (v) => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF];

  setInterval(() => {
    const now = Date.now();
    const dt  = (now - sim.lastUpdate) / 1000;
    sim.lastUpdate = now;

    if (sim.rowingState === RS.ACTIVE) {
      const wattTarget = 2.8 * Math.pow(sim.spmTarget / 22 * 3.5, 3);
      sim.watts = wattTarget
        + Math.sin(now / 900)  * 10
        + Math.sin(now / 1900) * 5;
      sim.watts = Math.max(80, Math.min(300, sim.watts));

      const speedMS = Math.pow(sim.watts / 2.8, 1 / 3);
      sim.distance    += speedMS * dt;
      sim.elapsedTime += dt;
      sim.cals        += ((sim.watts * 4 * 0.86 + 300) / 3600) * dt;
      sim.spm         += (sim.spmTarget - sim.spm) * Math.min(1, dt / 4);

      sim.strokePhaseTimer += dt;
      const period   = 60 / sim.spm;
      const driveDur = period * 0.38;
      const recDur   = period - driveDur;

      switch (sim.strokeState) {
        case 2:
          if (sim.strokePhaseTimer >= driveDur) {
            sim.strokeState = 3;
            sim.strokeCount++;
            sim.strokePhaseTimer = 0;
          }
          break;
        case 3:
          fireStroke();
          sim.strokeState = 4;
          sim.strokePhaseTimer = 0;
          break;
        case 4:
          if (sim.strokePhaseTimer >= recDur) {
            sim.strokeState = 1;
            sim.strokePhaseTimer = 0;
          }
          break;
        case 1:
          sim.strokeState = 2;
          sim.strokePhaseTimer = 0;
          break;
      }
    } else {
      sim.watts = Math.max(0, sim.watts - 40 * dt);
    }

    if (sim.hrConnected) {
      const targetHR = sim.rowingState === RS.ACTIVE
        ? 100 + sim.spmTarget * 2.5
        : 72;
      const tau = sim.rowingState === RS.ACTIVE ? 40 : 55;
      sim.hr += (targetHR - sim.hr) * (1 - Math.exp(-dt / tau));
      sim.hr += (Math.random() - 0.5) * 0.6;
      sim.hr  = Math.max(50, Math.min(200, sim.hr));
    }
  }, 50);

  function genRowerData() {
    const speedMS = sim.rowingState === RS.ACTIVE
      ? Math.pow(Math.max(sim.watts, 1) / 2.8, 1 / 3) : 0;
    const paceSec = speedMS > 0 ? Math.round(500 / speedMS) : 0;
    const spmOut  = sim.rowingState === RS.ACTIVE ? Math.round(sim.spm * 2) : 0;
    const hr      = sim.hrConnected ? Math.round(sim.hr) : 255;

    const flags = 0
      | 0x0002  // avgStrokePresent
      | 0x0004  // totalDistPresent
      | 0x0008  // instPacePresent
      | 0x0020  // instPowerPresent (accounts for the 0, 0 padding)
      | 0x0040  // avgPowerPresent
      | 0x0100  // expEnergyPresent
      | 0x0200  // hrPresent
      | 0x0800; // elapsedTimePresent

    return new Uint8Array([
      ...e2(flags),
      spmOut,
      ...e2(sim.strokeCount),
      0,
      ...e3(Math.round(sim.distance)),
      ...e2(paceSec),
      0, 0,  // <-- This aligns with the 0x0020 flag we just added
      ...e2(Math.round(sim.watts)),
      hr,
      ...e2(Math.round(sim.cals)),
      0, 0, 0,
      ...e2(Math.round(sim.elapsedTime)),
    ]);
  }

  function genMachineStatus(op, param = 0) {
    if (param) {
      return new Uint8Array([op, param]);
    }
    return new Uint8Array([op]);
  }

  function genTrainingStatus() {
    return new Uint8Array([0x01, 0x0D]);
  }

  function genControlResponse(requestOp, result) {
    return new Uint8Array([0x80, requestOp, result]);
  }

  function emitStatus(op, param = 0) {
    if (sim.statusChar) {
      sim.statusChar._emit(genMachineStatus(op, param));
    }
  }

  function emitTrainingStatus() {
    if (sim.trainingStatusChar) {
      sim.trainingStatusChar._emit(genTrainingStatus());
    }
  }

  function handleControlPoint(value) {
    const v = new Uint8Array(value.buffer || value);
    if (v.length < 1) return;

    const op = v[0];

    switch (op) {
      case 0x00:
        if (sim.controlPointChar) {
          sim.controlPointChar._emit(genControlResponse(0x00, 0x01));
        }
        console.log('%c[FTMS Sim] Control acquired', 'color:#10b981');
        break;

      case 0x07:
        console.log('%c[FTMS Sim] START command received', 'color:#10b981');
        sim.rowingState = RS.ACTIVE;
        sim.machineStatus = 'active';
        sim.strokeCount++;
        sim.distance += 5;
        emitStatus(0x04);
        emitTrainingStatus();
        if (sim.rowerDataChar) {
          sim.rowerDataChar._emit(genRowerData());
        }
        updateStatusDot();
        break;

      case 0x08:
        if (v.length >= 2) {
          const param = v[1];
          if (param === 0x01) {
            console.log('%c[FTMS Sim] STOP command received', 'color:#ef4444');
            sim.rowingState = RS.INACTIVE;
            sim.machineStatus = 'stopped';
            emitStatus(0x02, 0x01);
            updateStatusDot();
          } else if (param === 0x02) {
            console.log('%c[FTMS Sim] PAUSE command received', 'color:#f59e0b');
            sim.rowingState = RS.INACTIVE;
            sim.machineStatus = 'paused';
            emitStatus(0x02, 0x02);
            updateStatusDot();
          }
        }
        break;

      case 0x01:
        console.log('%c[FTMS Sim] Reset command received', 'color:#64748b');
        sim.distance = 0;
        sim.elapsedTime = 0;
        sim.cals = 0;
        sim.strokeCount = 0;
        sim.strokePhaseTimer = 0;
        sim.strokeState = 2;
        sim.rowingState = RS.INACTIVE;
        sim.machineStatus = 'idle';
        updateStatusDot();
        break;
    }
  }

  class MockCharacteristic {
    constructor(uuid) {
      this.uuid = uuid;
      this.listeners = {};
      this._timers = [];
    }

    _emit(packet) {
      const evt = { target: { value: new DataView(packet.buffer) } };
      (this.listeners['characteristicvaluechanged'] || []).forEach(cb => cb(evt));
    }

    async startNotifications() {
      switch (this.uuid) {
        case FTMS.ROWER_DATA:
          sim.rowerDataChar = this;
          const tick = () => {
            this._emit(genRowerData());
            this._timers.push(setTimeout(tick, 1000));
          };
          tick();

          onStroke(() => {
            if (sim.rowingState === RS.ACTIVE) {
              this._emit(genRowerData());
            }
          });
          break;

        case FTMS.CONTROL_POINT:
          sim.controlPointChar = this;
          break;

        case FTMS.MACHINE_STATUS:
          sim.statusChar = this;
          break;

        case FTMS.TRAINING_STATUS:
          sim.trainingStatusChar = this;
          break;
        // --- NEW: Add support for dedicated HR Belt simulation ---
        case '00002a37-0000-1000-8000-00805f9b34fb': 
          sim.standaloneHrChar = this;
          const hrTick = () => {
            if (sim.hrConnected) {
              // Standard BLE HR format: 
              // Byte 0 = 0x00 (Flags: 8-bit HR format)
              // Byte 1 = HR Value
              this._emit(new Uint8Array([0x00, Math.round(sim.hr)]));
            }
            this._timers.push(setTimeout(hrTick, 1000));
          };
          hrTick();
          break;
      }
      return this;
    }

    stopNotifications() {
      this._timers.forEach(clearTimeout);
      this._timers = [];
      return Promise.resolve();
    }

    writeValue(val) {
      if (this.uuid === FTMS.CONTROL_POINT) {
        handleControlPoint(val);
      }
      return Promise.resolve();
    }

    addEventListener(type, cb) {
      (this.listeners[type] = this.listeners[type] || []).push(cb);
    }

    removeEventListener(type, cb) {
      if (this.listeners[type]) {
        this.listeners[type] = this.listeners[type].filter(l => l !== cb);
      }
    }
  }

  class MockService {
    constructor(uuid) {
      this.uuid = uuid;
    }

    async getCharacteristic(uuid) {
      return new MockCharacteristic(uuid);
    }
  }

  class MockDevice {
    constructor() {
      this.name = 'FTMS Rower Sim';
      this.gatt = {
        connected: true,
        connect: () => Promise.resolve(this.gatt),
        disconnect: () => {
          this.gatt.connected = false;
        },
        getPrimaryService: (uuid) => Promise.resolve(new MockService(uuid)),
      };
      this._disconnectListeners = [];
    }

    addEventListener(type, cb) {
      if (type === 'gattserverdisconnected') {
        this._disconnectListeners.push(cb);
      }
    }
  }

  if (!navigator.bluetooth) navigator.bluetooth = {};
  navigator.bluetooth.requestDevice = (options) => {
    console.log('%c[FTMS Sim] requestDevice called', 'color:#10b981');
    return Promise.resolve(new MockDevice());
  };

  function updateStatusDot() {
    const dot = document.getElementById('ftms-sim-dot');
    const lbl = document.getElementById('ftms-sim-state-lbl');
    if (!dot || !lbl) return;

    const map = {
      'idle':     ['#64748b', 'Idle'],
      'active':   ['#10b981', 'Rowing'],
      'paused':   ['#f59e0b', 'Paused'],
      'stopped':  ['#ef4444', 'Stopped'],
    };
    const [color, label] = map[sim.machineStatus] || ['#64748b', 'Idle'];
    dot.style.background = color;
    lbl.textContent = label;
  }

  function createUI() {
    const ui = document.createElement('div');
    ui.id = 'ftms-sim-ui-container';
    ui.style.cssText = `
      position: fixed; bottom: 80px; right: 16px;
      background: #0f172a; border: 1px solid #1e293b;
      border-radius: 10px; padding: 12px 14px;
      z-index: 9999; color: #e2e8f0;
      font-family: ui-monospace, monospace; font-size: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,.6);
      display: flex; flex-direction: column; gap: 10px;
      min-width: 200px;
    `;

    ui.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center">
        <span style="color:#06b6d4; font-weight:bold; font-size:13px">FTMS Sim</span>
        <span style="display:flex; align-items:center; gap:5px; font-size:11px">
          <span id="ftms-sim-dot" style="
            display:inline-block; width:8px; height:8px;
            border-radius:50%; background:#64748b;
            box-shadow:0 0 6px currentColor; transition:background .4s;
          "></span>
          <span id="ftms-sim-state-lbl" style="color:#94a3b8">Idle</span>
        </span>
      </div>

      <div style="display:flex; gap:6px">
        <button id="ftms-sim-row-btn" style="
          flex:1; padding:6px 0; border:none; border-radius:5px;
          background:#10b981; color:#fff; cursor:pointer; font-size:12px; font-weight:bold;
        ">Row</button>
        <button id="ftms-sim-idle-btn" style="
          flex:1; padding:6px 0; border:none; border-radius:5px;
          background:#334155; color:#94a3b8; cursor:pointer; font-size:12px;
        ">Idle</button>
        <button id="ftms-sim-reset-btn" style="
          flex:1; padding:6px 0; border:none; border-radius:5px;
          background:#7c3aed; color:#fff; cursor:pointer; font-size:12px;
        ">Reset</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:4px">
        <label style="font-size:11px; color:#94a3b8">
          SPM: <span id="ftms-sim-spm-val">${sim.spmTarget}</span>
        </label>
        <input type="range" id="ftms-sim-spm" min="14" max="36" value="${sim.spmTarget}" style="
          width:100%; accent-color:#06b6d4; cursor:pointer;
        ">
      </div>

      <label style="display:flex; align-items:center; gap:7px; cursor:pointer; font-size:11px; color:#94a3b8">
        <input type="checkbox" id="ftms-sim-hr-chk" checked style="accent-color:#06b6d4; cursor:pointer">
        HR sensor
      </label>

      <div style="border-top:1px solid #1e293b; padding-top:8px;
                  display:grid; grid-template-columns:1fr 1fr; gap:3px 12px;
                  font-size:11px; color:#64748b">
        <span>Time</span>     <span id="ftms-sim-time"     style="color:#cbd5e1;text-align:right">0:00</span>
        <span>Dist</span>     <span id="ftms-sim-dist"     style="color:#cbd5e1;text-align:right">0 m</span>
        <span>HR</span>       <span id="ftms-sim-hr"       style="color:#cbd5e1;text-align:right">72 bpm</span>
        <span>Pace</span>     <span id="ftms-sim-pace"     style="color:#cbd5e1;text-align:right">--:--</span>
        <span>Watts</span>    <span id="ftms-sim-watts"    style="color:#cbd5e1;text-align:right">--</span>
        <span>Strokes</span>  <span id="ftms-sim-strokes"  style="color:#cbd5e1;text-align:right">0</span>
      </div>

      <div style="border-top:1px solid #1e293b; padding-top:8px; font-size:10px; color:#475569">
        Simulates FTMS protocol (Merach-compatible)
      </div>
    `;

    document.body.appendChild(ui);

    document.getElementById('ftms-sim-row-btn').onclick = () => {
      sim.rowingState = RS.ACTIVE;
      sim.machineStatus = 'active';
      sim.strokeCount++;
      sim.distance += 5;
      emitStatus(0x04);
      emitTrainingStatus();
      if (sim.rowerDataChar) {
        sim.rowerDataChar._emit(genRowerData());
      }
      updateStatusDot();
    };

    document.getElementById('ftms-sim-idle-btn').onclick = () => {
      sim.rowingState = RS.INACTIVE;
      sim.machineStatus = 'paused';
      emitStatus(0x02, 0x02);
      updateStatusDot();
    };

    document.getElementById('ftms-sim-reset-btn').onclick = () => {
      sim.distance = 0;
      sim.elapsedTime = 0;
      sim.cals = 0;
      sim.strokeCount = 0;
      sim.strokePhaseTimer = 0;
      sim.strokeState = 2;
      sim.rowingState = RS.INACTIVE;
      sim.machineStatus = 'idle';
      updateStatusDot();
    };

    document.getElementById('ftms-sim-spm').oninput = (e) => {
      sim.spmTarget = Number(e.target.value);
      document.getElementById('ftms-sim-spm-val').textContent = sim.spmTarget;
    };

    document.getElementById('ftms-sim-hr-chk').onchange = (e) => {
      sim.hrConnected = e.target.checked;
    };

    setInterval(() => {
      const m = Math.floor(sim.elapsedTime / 60);
      const s = Math.floor(sim.elapsedTime % 60);
      document.getElementById('ftms-sim-time').textContent = `${m}:${String(s).padStart(2,'0')}`;
      document.getElementById('ftms-sim-dist').textContent = `${Math.round(sim.distance)} m`;
      document.getElementById('ftms-sim-hr').textContent = sim.hrConnected ? `${Math.round(sim.hr)} bpm` : '--';
      document.getElementById('ftms-sim-strokes').textContent = sim.strokeCount;

      if (sim.rowingState === RS.ACTIVE && sim.watts > 0) {
        const speedMS = Math.pow(sim.watts / 2.8, 1 / 3);
        const paceSec = Math.round(500 / speedMS);
        const pm = Math.floor(paceSec / 60);
        const ps = paceSec % 60;
        document.getElementById('ftms-sim-pace').textContent = `${pm}:${String(ps).padStart(2,'0')}`;
        document.getElementById('ftms-sim-watts').textContent = `${Math.round(sim.watts)} W`;
      } else {
        document.getElementById('ftms-sim-pace').textContent = '--:--';
        document.getElementById('ftms-sim-watts').textContent = '--';
      }
    }, 500);
  }

  createUI();
  console.log('%c✓ FTMS Simulator v1 ready', 'color:#06b6d4; font-weight:bold');
})();
