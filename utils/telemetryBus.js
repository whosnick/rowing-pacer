const _listeners = {};

export function on(event, fn) {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  _listeners[event] = (_listeners[event] ?? []).filter(f => f !== fn);
}

export function emit(event, payload) {
  (_listeners[event] ?? []).forEach(fn => fn(payload));
}

export function clearAll() {
  Object.keys(_listeners).forEach(key => {
    _listeners[key] = [];
  });
}

export const BUS = {
  TICK: 'tick',
  STROKE: 'stroke',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTED: 'reconnected',
  RECONNECT_FAILED: 'reconnect_failed',
  RECONNECT_REQUEST: 'reconnect_request',
  END_OF_WORKOUT: 'end_of_workout',
  SPLIT_INTERVAL: 'split_interval',
  HR_DATA: 'hr_data',
  HR_CONNECTED: 'hr_connected',
  HR_DISCONNECTED: 'hr_disconnected',
  MACHINE_PAUSED: 'machine_paused',
  MACHINE_STOPPED: 'machine_stopped',
  MACHINE_RESUMED: 'machine_resumed',
};
