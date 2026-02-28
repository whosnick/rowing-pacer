// bluetooth/ftmsService.js

import { 
  FTMS_SERVICE_UUID, 
  ROWER_DATA_CHAR_UUID,
  FTMS_CONTROL_POINT_UUID,
  FTMS_STATUS_UUID 
} from '../utils/constants.js';
import { emit, BUS } from '../utils/telemetryBus.js';

let device = null;
let server = null;
let rowerChar = null;
let controlChar = null;
let statusChar = null;
let hasControl = false;
let lastStrokeCount = 0;

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

// --- NEW: Handle Responses from the Machine ---
function handleControlResponse(event) {
  const dv = new DataView(event.target.value.buffer);
  if (dv.byteLength >= 3 && dv.getUint8(0) === 0x80) { // 0x80 = Response Code
    const reqOp = dv.getUint8(1);
    const result = dv.getUint8(2);
    
    // If the machine says Success (0x01) to Request Control (0x00)
    if (reqOp === 0x00 && result === 0x01) {
      hasControl = true;
      console.log('[FTMS] Machine Control Acquired Successfully');
    }
  }
}

// --- NEW: Handle Status Events pushed by the Machine ---
function handleMachineStatus(event) {
  const dv = new DataView(event.target.value.buffer);
  if (dv.byteLength >= 1) {
    const op = dv.getUint8(0);
    if (op === 0x02 && dv.byteLength >= 2) { 
      // Op 0x02: Stopped or Paused by User
      const param = dv.getUint8(1);
      if (param === 0x01) emit(BUS.MACHINE_STOPPED);
      if (param === 0x02) emit(BUS.MACHINE_PAUSED);
    } else if (op === 0x04) {
      // Op 0x04: Started or Resumed by User
      emit(BUS.MACHINE_RESUMED);
    }
  }
}

function handleRowerData(event) {
  const value = event.target.value;
  if (!value) return;

  const parsed = parseRowerData(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));

  Object.assign(dataPayload, parsed);
  dataPayload.isActive = (dataPayload.spm || 0) > 0 || (dataPayload.currentPaceSec || 0) > 0;

  emit(BUS.TICK, { ...dataPayload });

  if (typeof parsed.strokeCount === 'number' && parsed.strokeCount > lastStrokeCount) {
    lastStrokeCount = parsed.strokeCount;
    emit(BUS.STROKE, {
      t: Math.round((dataPayload.elapsedTimeSec || 0) * 10),
      d: Math.round((dataPayload.distanceMeters || 0) * 10),
      p: Math.round((dataPayload.currentPaceSec || 0) * 10),
      spm: dataPayload.spm || 0,
      hr: dataPayload.heartrate,
    });
  }
}

export async function connectRower() {
  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [FTMS_SERVICE_UUID] }],
  });

  device.addEventListener('gattserverdisconnected', () => emit(BUS.DISCONNECTED));

  server = await device.gatt.connect();
  const service = await server.getPrimaryService(FTMS_SERVICE_UUID);
  
  // 1. Setup Rower Data
  rowerChar = await service.getCharacteristic(ROWER_DATA_CHAR_UUID);
  await rowerChar.startNotifications();
  rowerChar.addEventListener('characteristicvaluechanged', handleRowerData);
  
  // 2. Setup Control Point (Optional, won't fail if machine doesn't support it)
  try {
    controlChar = await service.getCharacteristic(FTMS_CONTROL_POINT_UUID);
    await controlChar.startNotifications(); // Technically indications, Web BLE uses the same method
    controlChar.addEventListener('characteristicvaluechanged', handleControlResponse);
    
    // Instantly Request Control of the Machine!
    await controlChar.writeValue(new Uint8Array([0x00]).buffer);
  } catch(e) { console.warn('[FTMS] Control Point unavailable'); }

  // 3. Setup Machine Status (Optional)
  try {
    statusChar = await service.getCharacteristic(FTMS_STATUS_UUID);
    await statusChar.startNotifications();
    statusChar.addEventListener('characteristicvaluechanged', handleMachineStatus);
  } catch(e) { console.warn('[FTMS] Status unavailable'); }

  emit(BUS.CONNECTED);
}

export function disconnectRower() {
  if (rowerChar) {
    rowerChar.removeEventListener('characteristicvaluechanged', handleRowerData);
    rowerChar.stopNotifications().catch(() => {});
  }
  if (controlChar) {
    controlChar.removeEventListener('characteristicvaluechanged', handleControlResponse);
    controlChar.stopNotifications().catch(() => {});
  }
  if (statusChar) {
    statusChar.removeEventListener('characteristicvaluechanged', handleMachineStatus);
    statusChar.stopNotifications().catch(() => {});
  }
  if (server?.connected) server.disconnect();
  
  rowerChar = null;
  controlChar = null;
  statusChar = null;
  server = null;
  device = null;
  hasControl = false;
  emit(BUS.DISCONNECTED);
}

// --- NEW: Command Sender ---
export async function sendMachineCommand(cmd) {
  if (!controlChar || !hasControl) return;
  try {
    let payload;
    if (cmd === 'START') payload = new Uint8Array([0x07]);
    else if (cmd === 'PAUSE') payload = new Uint8Array([0x08, 0x02]);
    else if (cmd === 'STOP') payload = new Uint8Array([0x08, 0x01]);

    if (payload) {
      await controlChar.writeValue(payload.buffer);
      console.log(`[FTMS] Sent Remote Command: ${cmd}`);
    }
  } catch (error) {
    console.warn(`[FTMS] Failed to send command ${cmd}:`, error);
  }
}

export function resetRowerSession() {
  lastStrokeCount = 0;
  Object.assign(dataPayload, {
    spm: 0, strokeCount: 0, distanceMeters: 0, currentPaceSec: 0, avgPowerWatts: 0,
    totalCals: 0, elapsedTimeSec: 0, heartrate: null, isActive: false,
  });
}

export async function reconnect() {
  if (!device) throw new Error('No paired rower to reconnect');
  if (server?.connected) return;
  server = await device.gatt.connect();
  const service = await server.getPrimaryService(FTMS_SERVICE_UUID);
  rowerChar = await service.getCharacteristic(ROWER_DATA_CHAR_UUID);
  await rowerChar.startNotifications();
  rowerChar.addEventListener('characteristicvaluechanged', handleRowerData);
  emit(BUS.RECONNECTED);
}
