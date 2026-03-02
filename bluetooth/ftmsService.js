// bluetooth/ftmsService.js

import { 
  FTMS_SERVICE_UUID, 
  ROWER_DATA_CHAR_UUID,
  FTMS_CONTROL_POINT_UUID,
  FTMS_STATUS_UUID 
} from '../utils/constants.js';
import { emit, BUS, on } from '../utils/telemetryBus.js';

const TRAINING_STATUS_UUID = '00002ad3-0000-1000-8000-00805f9b34fb';

let device = null;
let server = null;

let rowerChar = null;
let controlChar = null;
let statusChar = null;
let trainingStatusChar = null;

let hasControl = false;
let lastStrokeCount = 0;
let lastProcessedDistance = -1;
let activeImmunityUntil = 0;

let commandQueue = [];
let isSendingCommand = false;

let externalHR = null;

on(BUS.HR_DATA, (data) => {
  if (data.heartrate) {
    externalHR = data.heartrate;
    console.log('[FTMS] External HR received:', externalHR);
  }
});

on(BUS.HR_DISCONNECTED, () => {
  externalHR = null;
  console.log('[FTMS] External HR cleared');
});

const dataPayload = {
  spm: 0,
  strokeCount: 0,
  distanceMeters: 0,
  currentPaceSec: 0,
  avgPowerWatts: 0,
  totalCals: 0,
  elapsedTimeSec: 0,
  heartrate: null,
  isActive: false,
};

function parseRowerData(buffer) {
  const dv = new DataView(buffer);
  let o = 0;
  const flags = dv.getUint16(o, true); o += 2;

  const moreData = !!(flags & 0x0001);
  const avgStrokePresent = !!(flags & 0x0002);
  const totalDistPresent = !!(flags & 0x0004);
  const instPacePresent = !!(flags & 0x0008);
  const avgPacePresent = !!(flags & 0x0010);
  const instPowerPresent = !!(flags & 0x0020);
  const avgPowerPresent = !!(flags & 0x0040);
  const expEnergyPresent = !!(flags & 0x0100);
  const hrPresent = !!(flags & 0x0200);
  const elapsedTimePresent = !!(flags & 0x0800);

  const out = { moreData };

  if (!moreData && o + 3 <= dv.byteLength) {
    out.spm = dv.getUint8(o) * 0.5;
    o += 1;
    out.strokeCount = dv.getUint16(o, true);
    o += 2;
  }

  if (avgStrokePresent && o + 1 <= dv.byteLength) { o += 1; }

  if (totalDistPresent && o + 3 <= dv.byteLength) {
    out.distanceMeters = (dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16));
    o += 3;
  }

  if (instPacePresent && o + 2 <= dv.byteLength) {
    out.currentPaceSec = dv.getUint16(o, true);
    o += 2;
  }

  if (avgPacePresent) { o += 2; }
  if (instPowerPresent) { o += 2; }

  if (avgPowerPresent && o + 2 <= dv.byteLength) {
    out.avgPowerWatts = dv.getInt16(o, true);
    o += 2;
  }

  if (hrPresent && o + 1 <= dv.byteLength) {
    const hr = dv.getUint8(o); o += 1;
    out.heartrate = hr > 0 && hr < 255 ? hr : null;
  }

  if (expEnergyPresent && o + 5 <= dv.byteLength) {
    out.totalCals = dv.getUint16(o, true);
    o += 5;
  }

  if (elapsedTimePresent && o + 2 <= dv.byteLength) {
    out.elapsedTimeSec = dv.getUint16(o, true);
  }

  return out;
}

function handleRowerData(event) {
  const value = event.target.value;
  if (!value) return;

  const parsed = parseRowerData(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  const now = Date.now();

  // FIX: Initialize the baseline on the first packet after a reset
  if (lastProcessedDistance === -1) {
    lastProcessedDistance = parsed.distanceMeters;
  }

  const strokeIncreased = (parsed.strokeCount > lastStrokeCount);
  const distanceIncreased = (parsed.distanceMeters > lastProcessedDistance);

  if (strokeIncreased) {
    dataPayload.isActive = true;
    activeImmunityUntil = now + 6000;
    lastStrokeCount = parsed.strokeCount;
  } else {
    if (now < activeImmunityUntil) {
      dataPayload.isActive = true;
    } else {
      dataPayload.isActive = distanceIncreased;
    }
  }

  lastProcessedDistance = parsed.distanceMeters;

  Object.assign(dataPayload, parsed);

  emit(BUS.TICK, { ...dataPayload });

  if (strokeIncreased) {
    const hrValue = externalHR || dataPayload.heartrate;
    emit(BUS.STROKE, {
      t: Math.round((dataPayload.elapsedTimeSec || 0) * 10),
      d: Math.round((dataPayload.distanceMeters || 0) * 10),
      p: Math.round((dataPayload.currentPaceSec || 0) * 10),
      spm: dataPayload.spm || 0,
      hr: hrValue,
    });
    if (hrValue) {
      console.log('[FTMS] Stroke emitted with HR:', hrValue);
    }
  }
}

// --- MACHINE STATUS HANDLERS ---

function handleMachineStatus(event) {
  const dv = new DataView(event.target.value.buffer);
  if (dv.byteLength < 1) return;

  const op = dv.getUint8(0);
  
  // 0x04: "Started or Resumed by User"
  if (op === 0x04) {
    console.log('[FTMS] Status: Machine Resumed (0x04)');
    emit(BUS.MACHINE_RESUMED);
  }
  // 0x02: "Stopped or Paused by User"
  else if (op === 0x02 && dv.byteLength >= 2) {
    const param = dv.getUint8(1);
    if (param === 0x01) {
      console.log('[FTMS] Status: Machine Stopped (0x02 0x01)');
      emit(BUS.MACHINE_STOPPED);
    } else if (param === 0x02) {
      console.log('[FTMS] Status: Machine Paused (0x02 0x02)');
      emit(BUS.MACHINE_PAUSED);
    }
  }
}

function handleTrainingStatus(event) {
  // 0x01 0x0D (Manual Mode) typically implies a Start/Resume event on Merach
  console.log('[FTMS] Training Status Update (0x2AD3)');
  emit(BUS.MACHINE_RESUMED); 
}

function handleControlResponse(event) {
  const dv = new DataView(event.target.value.buffer);
  // Check for Response OpCode (0x80) -> Request OpCode (0x00) -> Success (0x01)
  if (dv.byteLength >= 3 && dv.getUint8(0) === 0x80) {
    if (dv.getUint8(1) === 0x00 && dv.getUint8(2) === 0x01) {
      hasControl = true;
      console.log('[FTMS] Control Acquired Successfully');
    }
  }
}

// --- EXPORTED FUNCTIONS ---

export async function connectRower() {
  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [FTMS_SERVICE_UUID] }],
  });

  device.addEventListener('gattserverdisconnected', () => emit(BUS.DISCONNECTED));

  server = await device.gatt.connect();
  const service = await server.getPrimaryService(FTMS_SERVICE_UUID);
  
  // 1. Rower Data
  rowerChar = await service.getCharacteristic(ROWER_DATA_CHAR_UUID);
  await rowerChar.startNotifications();
  rowerChar.addEventListener('characteristicvaluechanged', handleRowerData);
  
  // 2. Control Point
  try {
    controlChar = await service.getCharacteristic(FTMS_CONTROL_POINT_UUID);
    await controlChar.startNotifications();
    controlChar.addEventListener('characteristicvaluechanged', handleControlResponse);
    await controlChar.writeValue(new Uint8Array([0x00]).buffer); 
  } catch(e) { console.warn('[FTMS] Control Point unavailable'); }

  // 3. Machine Status
  try {
    statusChar = await service.getCharacteristic(FTMS_STATUS_UUID);
    await statusChar.startNotifications();
    statusChar.addEventListener('characteristicvaluechanged', handleMachineStatus);
  } catch(e) { console.warn('[FTMS] Status unavailable'); }

  // 4. Training Status
  try {
    trainingStatusChar = await service.getCharacteristic(TRAINING_STATUS_UUID);
    await trainingStatusChar.startNotifications();
    trainingStatusChar.addEventListener('characteristicvaluechanged', handleTrainingStatus);
  } catch(e) { console.warn('[FTMS] Training Status unavailable'); }

  emit(BUS.CONNECTED);
}

export function disconnectRower() {
  const chars = [rowerChar, controlChar, statusChar, trainingStatusChar];
  chars.forEach(c => {
    if (c) {
      try { c.stopNotifications(); } catch(e) {}
    }
  });

  if (server?.connected) server.disconnect();
  
  rowerChar = null;
  controlChar = null;
  statusChar = null;
  trainingStatusChar = null;
  server = null;
  device = null;
  hasControl = false;
  commandQueue = [];
  isSendingCommand = false;
  emit(BUS.DISCONNECTED);
}

export function resetRowerSession() {
  lastStrokeCount = 0;
  lastProcessedDistance = -1;
  activeImmunityUntil = 0;
  Object.assign(dataPayload, {
    spm: 0, strokeCount: 0, distanceMeters: 0, currentPaceSec: 0, avgPowerWatts: 0,
    totalCals: 0, elapsedTimeSec: 0, heartrate: null, isActive: false,
  });
}

export async function reconnect() {
  if (!device) throw new Error('No paired rower to reconnect');
  if (server?.connected) return;
  server = await device.gatt.connect();
  emit(BUS.RECONNECTED);
}

export async function sendMachineCommand(cmd) {
  if (!controlChar || !hasControl) return;

  let payload;
  if (cmd === 'START') payload = new Uint8Array([0x07]);
  else if (cmd === 'PAUSE') payload = new Uint8Array([0x08, 0x02]);
  else if (cmd === 'STOP') payload = new Uint8Array([0x08, 0x01]);
  if (!payload) return;

  commandQueue.push({ cmd, payload, retries: 0 });
  processCommandQueue();
}

async function processCommandQueue() {
  if (isSendingCommand || commandQueue.length === 0) return;

  isSendingCommand = true;
  const { cmd, payload, retries } = commandQueue[0];

  try {
    await controlChar.writeValue(payload.buffer);
    console.log(`[FTMS] Sent Command: ${cmd}`);
    commandQueue.shift();
  } catch (error) {
    if (error.message?.includes('GATT operation already in progress') && retries < 3) {
      commandQueue[0].retries++;
      console.log(`[FTMS] Retrying ${cmd} (attempt ${retries + 1})...`);
    } else {
      console.warn(`[FTMS] Failed to send ${cmd}:`, error);
      commandQueue.shift();
    }
  } finally {
    isSendingCommand = false;
    if (commandQueue.length > 0) {
      setTimeout(processCommandQueue, 100);
    }
  }
}