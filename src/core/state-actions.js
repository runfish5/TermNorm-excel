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

/**
 * Update the current view in the taskpane
 * @param {string} view - View name ('config' | 'tracking' | 'history' | 'results')
 */
export function setView(view) {
  stateStore.set('ui.currentView', view);
}

/**
 * Set status message displayed in the UI
 * @param {string} message - Message to display
 * @param {boolean} [isError=false] - Whether this is an error message
 */
export function setStatusMessage(message, isError = false) {
  stateStore.merge('ui', {
    statusMessage: message,
    isError,
  });
}

// ============================================================================
// SERVER ACTIONS
// ============================================================================

/**
 * Update server connection status
 * Emits SERVER_STATUS_CHANGED event, and SERVER_RECONNECTED if transitioning offline → online
 * @param {boolean} online - Whether server is online
 * @param {string} [host=null] - Server host URL (uses existing if not provided)
 * @param {Object} [info={}] - Server info (provider, environment, etc.)
 */
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

/**
 * Update server host URL
 * @param {string} host - Server host URL (e.g., 'http://localhost:8000')
 */
export function setServerHost(host) {
  stateStore.set('server.host', host);
}

// ============================================================================
// CONFIG ACTIONS
// ============================================================================

/**
 * Set configuration data
 * Emits CONFIG_LOADED event
 * @param {Object} configData - Parsed configuration object
 * @param {Object} [rawData=null] - Raw configuration data for reloading
 */
export function setConfig(configData, rawData = null) {
  stateStore.merge('config', {
    loaded: true,
    data: configData,
    raw: rawData || configData,
  });

  eventBus.emit(Events.CONFIG_LOADED, { config: configData });
}

/**
 * Clear configuration state
 */
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

/**
 * Update a single mapping source status
 * @param {number} index - Mapping source index
 * @param {string} status - Status ('idle' | 'loading' | 'synced' | 'error')
 * @param {Object} [data=null] - Mapping data (forward/reverse objects)
 * @param {string} [error=null] - Error message if status is 'error'
 */
export function setMappingSource(index, status, data = null, error = null) {
  const sources = stateStore.get('mappings.sources') || {};
  sources[index] = { status, data, error };
  stateStore.set('mappings.sources', sources);
}

/**
 * Set combined mappings (merged from all sources)
 * Emits MAPPINGS_LOADED event
 * @param {Object} combined - Combined mapping object with forward/reverse/metadata
 */
export function setMappingsCombined(combined) {
  stateStore.merge('mappings', {
    combined,
    loaded: true,
  });

  eventBus.emit(Events.MAPPINGS_LOADED, { mappings: combined });
}

/**
 * Clear all mappings
 * Emits MAPPINGS_CLEARED event
 */
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

/**
 * Set backend session initialization status
 * @param {boolean} initialized - Whether session is initialized
 * @param {number} [termCount=0] - Number of terms in session
 */
export function setSessionInitialized(initialized, termCount = 0) {
  stateStore.merge('session', {
    initialized,
    termCount,
    lastInitialized: initialized ? new Date().toISOString() : null,
    error: null,
  });
}

/**
 * Set session error
 * @param {string} error - Error message
 */
export function setSessionError(error) {
  stateStore.merge('session', {
    initialized: false,
    error,
  });
}

/**
 * Initialize workbook session state
 * @param {string} workbookId - Workbook identifier
 */
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

/**
 * Set workbook tracking state
 * Emits TRACKING_STARTED or TRACKING_STOPPED events
 * @param {string} workbookId - Workbook identifier
 * @param {boolean} active - Whether tracking is active
 * @param {Map} [columnMap=null] - Column mapping (col index → target col index)
 * @param {Map} [confidenceColumnMap=null] - Confidence column mapping
 */
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

/**
 * Set or update a cache entity
 * @param {string} identifier - Entity identifier (target value)
 * @param {Object} entityData - Entity data (entity_profile, aliases, web_sources)
 */
export function setCacheEntity(identifier, entityData) {
  const entities = stateStore.get('cache.entities') || {};
  entities[identifier] = entityData;
  stateStore.set('cache.entities', entities);
}

/**
 * Merge updates into existing cache entity
 * @param {string} identifier - Entity identifier
 * @param {Object} updates - Properties to merge
 */
export function mergeCacheEntity(identifier, updates) {
  const entities = stateStore.get('cache.entities') || {};
  entities[identifier] = {
    ...entities[identifier],
    ...updates,
  };
  stateStore.set('cache.entities', entities);
}

/**
 * Set cache initialization status
 * Emits HISTORY_CACHE_INITIALIZED when set to true
 * @param {boolean} initialized - Whether cache is initialized
 */
export function setCacheInitialized(initialized) {
  stateStore.set('cache.initialized', initialized);

  if (initialized) {
    eventBus.emit(Events.HISTORY_CACHE_INITIALIZED);
  }
}

/**
 * Clear all cached entities
 */
export function clearCache() {
  stateStore.merge('cache', {
    entities: {},
    initialized: false,
  });
}

// ============================================================================
// SETTINGS ACTIONS
// ============================================================================

/**
 * Update a single setting
 * Emits SETTING_CHANGED event
 * @param {string} key - Setting key (e.g., 'requireServerOnline', 'useWebSearch')
 * @param {any} value - Setting value
 */
export function setSetting(key, value) {
  const settings = stateStore.get('settings') || {};
  settings[key] = value;
  stateStore.set('settings', settings);

  eventBus.emit(Events.SETTING_CHANGED, { key, value });
}

/**
 * Set all settings at once
 * Emits SETTINGS_LOADED event
 * @param {Object} settingsObject - Settings object
 */
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

/**
 * Set web search status
 * @param {string} status - Status ('idle' | 'searching' | 'success' | 'failed')
 * @param {string} [error=null] - Error message if status is 'failed'
 */
export function setWebSearchStatus(status, error = null) {
  stateStore.merge('webSearch', {
    status,
    error,
  });
}

// ============================================================================
// HISTORY ACTIONS (NEW - CHECKPOINT 11)
// ============================================================================

/**
 * Set history cache entries
 * @param {Object} entries - Entity entries (identifier → {entity_profile, aliases, web_sources})
 */
export function setHistoryEntries(entries) {
  stateStore.merge('history', {
    entries,
  });
}

/**
 * Set history cache initialization status
 * Emits HISTORY_CACHE_INITIALIZED event when set to true
 * @param {boolean} initialized - Whether cache is initialized
 * @param {number} [entryCount=0] - Number of entries loaded
 */
export function setHistoryCacheInitialized(initialized, entryCount = 0) {
  stateStore.merge('history', {
    cacheInitialized: initialized,
  });

  if (initialized) {
    // Emit with entries from state for UI to consume
    const entries = stateStore.get('history.entries') || {};
    eventBus.emit(Events.HISTORY_CACHE_INITIALIZED, {
      entries,
      count: entryCount,
    });
  }
}

// ============================================================================
// HELPER: Get entire state
// ============================================================================

/**
 * Get the entire immutable state
 * @returns {Object} Frozen copy of full state
 */
export function getState() {
  return stateStore.getState();
}

/**
 * Get a nested value from state by path
 * @param {string} path - Dot-separated path (e.g., 'server.online', 'mappings.combined')
 * @returns {any} Value at path, or undefined if not found
 */
export function getStateValue(path) {
  return stateStore.get(path);
}

/**
 * Subscribe to state changes
 * @param {Function} callback - Called with new state on every change
 * @returns {Function} Unsubscribe function
 */
export function subscribeToState(callback) {
  return stateStore.subscribe(callback);
}
