/**
 * State Store - Immutable state container. Single source of truth for app state.
 *
 * Direct reads via get(), mutations via state-actions.js.
 * Only state-actions.js and workflows.js should import this module.
 */

import { eventBus } from './event-bus.js';
import { Events } from './events.js';

const initialState = {
  ui: { currentView: 'config', statusMessage: 'Ready', isError: false },
  server: { online: false, host: null, lastChecked: null, info: {} },
  config: { loaded: false, data: null, raw: null },
  mappings: { sources: {}, combined: null, loaded: false },
  session: { workbooks: {}, initialized: false, termCount: 0, lastInitialized: null, error: null },
  cache: { entities: {}, initialized: false },
  settings: { requireServerOnline: true, useWebSearch: true, useBraveApi: true, loaded: false },
  webSearch: { status: 'idle', error: null },
  history: { cacheInitialized: false, entries: {} },
  tracking: { active: false },
};

class StateStore {
  constructor(initial = initialState) {
    this._state = this._deepClone(initial);
    this._subscribers = new Set();
  }

  getState() { return this._deepFreeze(this._deepClone(this._state)); }

  get(path) {
    let value = this._state;
    for (const key of path.split('.')) {
      if (value == null) return undefined;
      value = value[key];
    }
    return value;
  }

  setState(updater) {
    this._state = updater(this._deepClone(this._state));
    this._notifySubscribers();
    eventBus.emit(Events.STATE_CHANGED, { state: this.getState() });
  }

  set(path, value) {
    this.setState(state => {
      const keys = path.split('.'), lastKey = keys.pop();
      let target = state;
      for (const key of keys) { if (!(key in target)) target[key] = {}; target = target[key]; }
      target[lastKey] = value;
      return state;
    });
  }

  merge(path, updates) {
    this.setState(state => {
      const keys = path.split('.'), lastKey = keys.pop();
      let target = state;
      for (const key of keys) { if (!(key in target)) target[key] = {}; target = target[key]; }
      target[lastKey] = { ...target[lastKey], ...updates };
      return state;
    });
  }

  subscribe(callback) {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  reset(newInitial) {
    this._state = this._deepClone(newInitial || initialState);
    this._notifySubscribers();
    eventBus.emit(Events.STATE_CHANGED, { state: this.getState() });
  }

  _deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Map) return new Map(obj);
    if (obj instanceof Set) return new Set(obj);
    if (Array.isArray(obj)) return obj.map(item => this._deepClone(item));
    const cloned = {};
    for (const key in obj) if (obj.hasOwnProperty(key)) cloned[key] = this._deepClone(obj[key]);
    return cloned;
  }

  _deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object' || obj instanceof Map || obj instanceof Set) return obj;
    Object.freeze(obj);
    for (const key in obj) if (obj.hasOwnProperty(key)) this._deepFreeze(obj[key]);
    return obj;
  }

  _notifySubscribers() {
    const state = this.getState();
    this._subscribers.forEach(cb => { try { cb(state); } catch (e) { console.error('Error in state subscriber:', e); } });
  }
}

const stateStore = new StateStore();

// StateStore/initialState exported for testing only
export { stateStore, StateStore, initialState };
