export const WS = {
  IDLE: 'IDLE',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  FINISHED: 'FINISHED',
  DISCONNECTED: 'DISCONNECTED',
  CANCELLED: 'CANCELLED',
};

export const WE = {
  START: 'START',
  ROWING: 'ROWING',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  END: 'END',
  USER_STOP: 'USER_STOP',
  BLE_DISCONNECT: 'BLE_DISCONNECT',
  BLE_RECONNECT: 'BLE_RECONNECT',
  RESET: 'RESET',
};

const TRANSITIONS = {
  [WS.IDLE]: {
    [WE.START]: WS.ACTIVE,
    [WE.ROWING]: WS.ACTIVE,
    [WE.END]: WS.IDLE,
    [WE.BLE_DISCONNECT]: WS.DISCONNECTED,
  },
  [WS.ACTIVE]: {
    [WE.PAUSE]: WS.PAUSED,
    [WE.END]: WS.FINISHED,
    [WE.USER_STOP]: WS.FINISHED,
    [WE.BLE_DISCONNECT]: WS.DISCONNECTED,
  },
  [WS.PAUSED]: {
    [WE.RESUME]: WS.ACTIVE,
    [WE.USER_STOP]: WS.FINISHED,
    [WE.BLE_DISCONNECT]: WS.DISCONNECTED,
  },
  [WS.DISCONNECTED]: {
    [WE.BLE_RECONNECT]: null,
  },
  [WS.FINISHED]: {
    [WE.RESET]: WS.IDLE,
  },
  [WS.CANCELLED]: {
    [WE.RESET]: WS.IDLE,
  },
};

export class WorkoutFSM {
  constructor() {
    this._state = WS.IDLE;
    this._prevState = null;
    this._handlers = {};
    this._listeners = [];
  }

  get state() {
    return this._state;
  }

  get prevState() {
    return this._prevState;
  }

  on(state, { onEnter, onExit } = {}) {
    this._handlers[state] = { onEnter, onExit };
    return this;
  }

  onChange(fn) {
    this._listeners.push(fn);
    return this;
  }

  offChange(fn) {
    this._listeners = this._listeners.filter(f => f !== fn);
    return this;
  }

  send(event, payload = {}) {
    const map = TRANSITIONS[this._state];
    if (!map || !(event in map)) {
      console.warn(`[FSM] Invalid transition: ${this._state} + ${event}`);
      return false;
    }

    const next = event === WE.BLE_RECONNECT
      ? (this._prevState ?? WS.IDLE)
      : map[event];

    this._transition(next, event, payload);
    return true;
  }

  _transition(next, event, payload) {
    const from = this._state;

    this._handlers[from]?.onExit?.({ from, to: next, event, payload });

    if (next === WS.DISCONNECTED) {
      this._prevState = from;
    } else if (from === WS.DISCONNECTED) {
      this._prevState = null;
    }

    this._state = next;

    this._handlers[next]?.onEnter?.({ from, to: next, event, payload });

    this._listeners.forEach(fn => fn({ from, to: next, event, payload }));
  }

  reset() {
    this._state = WS.IDLE;
    this._prevState = null;
  }
}
