/**
 * State Actions - Predefined mutation functions for common operations
 *
 * Instead of direct state mutations scattered across 13 files,
 * all mutations go through these centralized actions.
 *
 * Benefits:
 * - Consistent mutation patterns
 * - Easier debugging (log actions)
 * - Type safety (can add TypeScript later)
 * - Single source of truth for state changes
 */

import { stateStore } from './state-store.js';
import { eventBus } from './event-bus.js';
import { Events } from './events.js';

// ============================================================================
// UI ACTIONS
// ============================================================================

export function setView(view) {
  stateStore.set('ui.currentView', view);
}

export function setStatusMessage(message, isError = false) {
  stateStore.merge('ui', {
    statusMessage: message,
    isError,
  });
}

// ============================================================================
// SERVER ACTIONS
// ============================================================================

export function setServerStatus(online, host = null, info = {}) {
  const wasOnline = stateStore.get('server.online');

  stateStore.merge('server', {
    online,
    host: host || stateStore.get('server.host'),
    lastChecked: Date.now(),
    info,
  });

  const currentHost = host || stateStore.get('server.host');

  eventBus.emit(Events.SERVER_STATUS_CHANGED, {
    online,
    host: currentHost,
  });

  // Emit reconnect event if going from offline → online
  if (online && !wasOnline) {
    eventBus.emit(Events.SERVER_RECONNECTED, { host: currentHost });
  }
}

export function setServerHost(host) {
  stateStore.set('server.host', host);
}

// ============================================================================
// CONFIG ACTIONS
// ============================================================================

export function setConfig(configData, rawData = null) {
  stateStore.merge('config', {
    loaded: true,
    data: configData,
    raw: rawData || configData,
  });

  eventBus.emit(Events.CONFIG_LOADED, { config: configData });
}

export function clearConfig() {
  stateStore.merge('config', {
    loaded: false,
    data: null,
    raw: null,
  });
}

// ============================================================================
// MAPPINGS ACTIONS
// ============================================================================

export function setMappingSource(index, status, data = null, error = null) {
  const sources = stateStore.get('mappings.sources') || {};
  sources[index] = { status, data, error };
  stateStore.set('mappings.sources', sources);
}

export function setMappingsCombined(combined) {
  stateStore.merge('mappings', {
    combined,
    loaded: true,
  });

  eventBus.emit(Events.MAPPINGS_LOADED, { mappings: combined });
}

export function clearMappings() {
  stateStore.merge('mappings', {
    sources: {},
    combined: null,
    loaded: false,
  });

  eventBus.emit(Events.MAPPINGS_CLEARED);
}

// ============================================================================
// SESSION ACTIONS
// ============================================================================

export function setSessionInitialized(initialized, termCount = 0) {
  stateStore.merge('session', {
    initialized,
    termCount,
    lastInitialized: initialized ? new Date().toISOString() : null,
    error: null,
  });
}

export function setSessionError(error) {
  stateStore.merge('session', {
    initialized: false,
    error,
  });
}

export function initWorkbookSession(workbookId) {
  const workbooks = stateStore.get('session.workbooks') || {};

  if (!workbooks[workbookId]) {
    workbooks[workbookId] = {
      tracking: {
        active: false,
        columnMap: null,
        confidenceColumnMap: null,
      },
      cells: new Map(),
      history: [],
    };

    stateStore.set('session.workbooks', workbooks);
  }
}

export function setWorkbookTracking(workbookId, active, columnMap = null, confidenceColumnMap = null) {
  const workbooks = stateStore.get('session.workbooks') || {};

  if (!workbooks[workbookId]) {
    initWorkbookSession(workbookId);
  }

  workbooks[workbookId].tracking = {
    active,
    columnMap,
    confidenceColumnMap,
  };

  stateStore.set('session.workbooks', workbooks);

  if (active) {
    eventBus.emit(Events.TRACKING_STARTED, { workbookId });
  } else {
    eventBus.emit(Events.TRACKING_STOPPED, { workbookId });
  }
}

// ============================================================================
// CACHE ACTIONS
// ============================================================================

export function setCacheEntity(identifier, entityData) {
  const entities = stateStore.get('cache.entities') || {};
  entities[identifier] = entityData;
  stateStore.set('cache.entities', entities);
}

export function mergeCacheEntity(identifier, updates) {
  const entities = stateStore.get('cache.entities') || {};
  entities[identifier] = {
    ...entities[identifier],
    ...updates,
  };
  stateStore.set('cache.entities', entities);
}

export function setCacheInitialized(initialized) {
  stateStore.set('cache.initialized', initialized);

  if (initialized) {
    eventBus.emit(Events.HISTORY_CACHE_INITIALIZED);
  }
}

export function clearCache() {
  stateStore.merge('cache', {
    entities: {},
    initialized: false,
  });
}

// ============================================================================
// SETTINGS ACTIONS
// ============================================================================

export function setSetting(key, value) {
  const settings = stateStore.get('settings') || {};
  settings[key] = value;
  stateStore.set('settings', settings);

  eventBus.emit(Events.SETTING_CHANGED, { key, value });
}

export function setSettings(settingsObject) {
  stateStore.merge('settings', {
    ...settingsObject,
    loaded: true,
  });

  eventBus.emit(Events.SETTINGS_LOADED, { settings: settingsObject });
}

// ============================================================================
// WEB SEARCH ACTIONS
// ============================================================================

export function setWebSearchStatus(status, error = null) {
  stateStore.merge('webSearch', {
    status,
    error,
  });
}

// ============================================================================
// HELPER: Get entire state
// ============================================================================

export function getState() {
  return stateStore.getState();
}

export function getStateValue(path) {
  return stateStore.get(path);
}

export function subscribeToState(callback) {
  return stateStore.subscribe(callback);
}
