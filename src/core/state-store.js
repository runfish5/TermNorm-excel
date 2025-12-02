/**
 * State Store - Immutable state container with change notifications
 *
 * Replaces scattered state mutations in state-machine.manager.js with
 * a centralized, predictable state management pattern.
 *
 * Key improvements:
 * - Single source of truth
 * - Immutable updates (prevents accidental mutations)
 * - Centralized change notifications
 * - Better debugging (can log all state changes)
 */

import { eventBus } from './event-bus.js';
import { Events } from './events.js';

/**
 * Initial state structure
 */
const initialState = {
  // UI state
  ui: {
    currentView: 'config',
    statusMessage: 'Ready',
    isError: false,
  },

  // Server connection state
  server: {
    online: false,
    host: null,
    lastChecked: null,
    info: {}, // Server connection info (provider, environment, etc.)
  },

  // Configuration state
  config: {
    loaded: false,
    data: null,
    raw: null, // Raw config data for reloading
  },

  // Mappings state
  mappings: {
    sources: {}, // index → {status, data, error}
    combined: null, // Combined forward/reverse mappings cache
    loaded: false,
  },

  // Session state - unified across workbooks
  session: {
    workbooks: {}, // workbookId → {tracking, cells, history}
    initialized: false,
    termCount: 0,
    lastInitialized: null,
    error: null,
  },

  // Cache state - single source of truth for entities
  cache: {
    entities: {}, // identifier → {entity_profile, aliases, web_sources}
    initialized: false,
  },

  // Settings state
  settings: {
    requireServerOnline: true, // Default: server required
    useWebSearch: true,
    useBraveApi: true,
    loaded: false,
  },

  // Web search status
  webSearch: {
    status: 'idle', // "idle" | "success" | "failed"
    error: null,
  },
};

/**
 * State Store Class
 */
class StateStore {
  constructor(initial = initialState) {
    this._state = this._deepClone(initial);
    this._subscribers = new Set();
  }

  /**
   * Get current state (returns a deeply frozen copy to prevent mutations)
   * @returns {Object} Current state
   */
  getState() {
    return this._deepFreeze(this._deepClone(this._state));
  }

  /**
   * Get specific state slice
   * @param {string} path - Dot-notation path (e.g., "server.online")
   * @returns {*} State value at path
   */
  get(path) {
    const keys = path.split('.');
    let value = this._state;

    for (const key of keys) {
      if (value == null) return undefined;
      value = value[key];
    }

    return value;
  }

  /**
   * Update state immutably
   * @param {Function} updater - Function that receives current state and returns new state
   */
  setState(updater) {
    const currentState = this._state;
    const newState = updater(this._deepClone(currentState));

    // Update internal state
    this._state = newState;

    // Notify subscribers
    this._notifySubscribers();

    // Emit global state change event
    eventBus.emit(Events.STATE_CHANGED, {
      state: this.getState(),
    });
  }

  /**
   * Update specific state slice
   * @param {string} path - Dot-notation path
   * @param {*} value - New value
   */
  set(path, value) {
    this.setState(state => {
      const keys = path.split('.');
      const lastKey = keys.pop();
      let target = state;

      // Navigate to parent object
      for (const key of keys) {
        if (!(key in target)) {
          target[key] = {};
        }
        target = target[key];
      }

      // Set value
      target[lastKey] = value;

      return state;
    });
  }

  /**
   * Merge object into state slice
   * @param {string} path - Dot-notation path
   * @param {Object} updates - Object to merge
   */
  merge(path, updates) {
    this.setState(state => {
      const keys = path.split('.');
      const lastKey = keys.pop();
      let target = state;

      // Navigate to parent object
      for (const key of keys) {
        if (!(key in target)) {
          target[key] = {};
        }
        target = target[key];
      }

      // Merge updates
      target[lastKey] = {
        ...target[lastKey],
        ...updates,
      };

      return state;
    });
  }

  /**
   * Subscribe to state changes
   * @param {Function} callback - Called when state changes
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this._subscribers.add(callback);

    // Return unsubscribe function
    return () => {
      this._subscribers.delete(callback);
    };
  }

  /**
   * Reset state to initial values
   * @param {Object} [newInitial] - Optional new initial state
   */
  reset(newInitial) {
    this._state = this._deepClone(newInitial || initialState);
    this._notifySubscribers();
    eventBus.emit(Events.STATE_CHANGED, { state: this.getState() });
  }

  /**
   * Deep clone helper (handles nested objects and arrays)
   * @private
   */
  _deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Map) return new Map(obj);
    if (obj instanceof Set) return new Set(obj);
    if (Array.isArray(obj)) return obj.map(item => this._deepClone(item));

    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this._deepClone(obj[key]);
      }
    }
    return cloned;
  }

  /**
   * Deep freeze helper (recursively freezes nested objects)
   * @private
   */
  _deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Map || obj instanceof Set) return obj; // Don't freeze collections

    Object.freeze(obj);

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        this._deepFreeze(obj[key]);
      }
    }

    return obj;
  }

  /**
   * Notify all subscribers of state change
   * @private
   */
  _notifySubscribers() {
    const state = this.getState();
    this._subscribers.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in state subscriber:', error);
      }
    });
  }
}

// Singleton instance
const stateStore = new StateStore();

// Export both class and singleton
export { stateStore, StateStore, initialState };
