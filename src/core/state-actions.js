/**
 * State Actions - Centralized mutation functions
 *
 * CHECKPOINT 11.3: Removed unused exports (Phase 2 cleanup).
 * Only actively used actions remain.
 *
 * All mutations go through these centralized actions for:
 * - Consistent mutation patterns
 * - Easier debugging (log actions)
 * - Event emission for reactive UI
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
// HISTORY ACTIONS
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
// HELPER: Get nested state value
// ============================================================================

/**
 * Get a nested value from state by path
 * @param {string} path - Dot-separated path (e.g., 'server.online', 'mappings.combined')
 * @returns {any} Value at path, or undefined if not found
 */
export function getStateValue(path) {
  return stateStore.get(path);
}
