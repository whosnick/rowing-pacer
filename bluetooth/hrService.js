import { emit, BUS } from '../utils/telemetryBus.js';

const HR_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
const HR_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

let device = null;
let server = null;
let hrChar = null;

function parseHeartRate(buffer) {
  const dv = new DataView(buffer);
  const flags = dv.getUint8(0);

  const is16Bit = !!(flags & 0x01);

  let hr;
  if (is16Bit) {
    hr = dv.getUint16(1, true);
  } else {
    hr = dv.getUint8(1);
  }

  return hr > 0 && hr < 255 ? hr : null;
}

function handleHRData(event) {
  const value = event.target.value;
  if (!value) return;

  const hr = parseHeartRate(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));

  if (hr !== null) {
    emit(BUS.HR_DATA, { heartrate: hr });
  }
}

export async function connectHRMonitor() {
  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [HR_SERVICE_UUID] }],
  });

  device.addEventListener('gattserverdisconnected', () => {
    emit(BUS.HR_DISCONNECTED);
    server = null;
    hrChar = null;
  });

  server = await device.gatt.connect();
  const service = await server.getPrimaryService(HR_SERVICE_UUID);
  hrChar = await service.getCharacteristic(HR_MEASUREMENT_UUID);
  await hrChar.startNotifications();
  hrChar.addEventListener('characteristicvaluechanged', handleHRData);
  emit(BUS.HR_CONNECTED);
}

export function disconnectHRMonitor() {
  if (hrChar) {
    hrChar.removeEventListener('characteristicvaluechanged', handleHRData);
    hrChar.stopNotifications().catch(() => {});
  }
  if (server?.connected) server.disconnect();
  hrChar = null;
  server = null;
  device = null;
}

export function isHRMonitorConnected() {
  return server?.connected ?? false;
}
