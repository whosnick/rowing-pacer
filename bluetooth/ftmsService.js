import { FTMS_SERVICE_UUID, ROWER_DATA_CHAR_UUID } from '../utils/constants.js';
import { emit, BUS } from '../utils/telemetryBus.js';

let device = null;
let server = null;
let rowerChar = null;
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
  const instPacePresent = !!(flags & 0x0010);
  const avgPacePresent = !!(flags & 0x0020);
  const instPowerPresent = !!(flags & 0x0040);
  const avgPowerPresent = !!(flags & 0x0080);
  const hrPresent = !!(flags & 0x0100);
  const strokeCountPresent = !!(flags & 0x0200);
  const expEnergyPresent = !!(flags & 0x0400);
  const elapsedTimePresent = !!(flags & 0x0800);

  const out = { moreData };

  if (avgStrokePresent) { o += 2; }

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

  if (strokeCountPresent && o + 2 <= dv.byteLength) {
    out.strokeCount = dv.getUint16(o, true);
    o += 2;
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

  const parsed = parseRowerData(value.buffer);
  if (parsed.moreData) return;

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
  rowerChar = await service.getCharacteristic(ROWER_DATA_CHAR_UUID);
  await rowerChar.startNotifications();
  rowerChar.addEventListener('characteristicvaluechanged', handleRowerData);
  emit(BUS.CONNECTED);
}

export function disconnectRower() {
  if (rowerChar) {
    rowerChar.removeEventListener('characteristicvaluechanged', handleRowerData);
    rowerChar.stopNotifications().catch(() => {});
  }
  if (server?.connected) server.disconnect();
  rowerChar = null;
  server = null;
  device = null;
  emit(BUS.DISCONNECTED);
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
