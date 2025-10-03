/**
 * State Machine Manager - Backend-First Architecture
 *
 * Core Principles:
 * 1. Backend is single source of truth
 * 2. All operations: Update Backend → Verify → Update Frontend
 * 3. No optimistic updates - always verify before committing
 * 4. Automatic rollback on any failure
 * 5. Periodic reconciliation with backend state
 */

import { getHost, getHeaders } from "../utils/server-utilities.js";

// State Machine States
const States = {
  IDLE: "idle",
  LOADING: "loading",
  VERIFYING: "verifying",
  SYNCED: "synced",
  ERROR: "error",
  RECONCILING: "reconciling",
};

// Mapping Source State
class MappingSourceState {
  constructor(index) {
    this.index = index;
    this.status = States.IDLE;
    this.data = null;
    this.error = null;
    this.backendSynced = false;
    this.lastSyncTime = null;
  }

  canTransitionTo(newState) {
    const valid = {
      [States.IDLE]: [States.LOADING, States.ERROR],
      [States.LOADING]: [States.VERIFYING, States.ERROR],
      [States.VERIFYING]: [States.SYNCED, States.ERROR],
      [States.SYNCED]: [States.LOADING, States.RECONCILING, States.ERROR],
      [States.ERROR]: [States.IDLE, States.LOADING],
      [States.RECONCILING]: [States.SYNCED, States.ERROR],
    };
    return valid[this.status]?.includes(newState) || false;
  }

  transition(newState, data = {}) {
    if (!this.canTransitionTo(newState)) {
      throw new Error(`Invalid transition: ${this.status} → ${newState}`);
    }
    this.status = newState;
    Object.assign(this, data);
  }
}

// Global State
const appState = {
  ui: {
    currentView: "config",
    statusMessage: "Ready",
    isError: false,
  },
  server: {
    online: false,
    host: null,
    apiKey: "",
  },
  config: {
    loaded: false,
    data: null,
  },
  mappings: {
    sources: {},           // index → MappingSourceState
    combined: null,        // Combined forward/reverse mappings
    loaded: false,
    totalBackendTerms: 0,  // Current expected backend term count
  },
};

let statusCallback = null;
let stateChangeCallbacks = [];

// Operation queue for sequential processing
let operationQueue = Promise.resolve();

export function onStatusChange(callback) {
  statusCallback = callback;
}

export function onStateChange(callback) {
  stateChangeCallbacks.push(callback);
}

function notifyStatus() {
  statusCallback?.(appState.ui);
}

function notifyStateChange() {
  stateChangeCallbacks.forEach((cb) => cb(appState));
}

export function setStatus(message, isError = false) {
  appState.ui.statusMessage = message;
  appState.ui.isError = isError;
  notifyStatus();
}

export function setConfig(config) {
  appState.config.data = config;
  appState.config.loaded = true;
  notifyStateChange();
}

/**
 * Transaction Pattern - All or Nothing
 */
async function executeTransaction(operation) {
  // Queue operations sequentially
  return new Promise((resolve, reject) => {
    operationQueue = operationQueue
      .then(async () => {
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      })
      .catch(reject);
  });
}

/**
 * Verify Backend State
 */
async function verifyBackendState() {
  try {
    const projectId = appState.config.data?.workbook || "default";
    const params = new URLSearchParams({ project_id: projectId });
    const response = await fetch(`${getHost()}/session-state?${params}`, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Backend verification failed: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Backend verification failed:", error);
    throw error;
  }
}

/**
 * Load Mapping Source with Transaction Pattern
 *
 * Steps:
 * 1. Transition to LOADING
 * 2. Update backend (/update-matcher)
 * 3. Verify backend state
 * 4. Transition to SYNCED with data
 * 5. Combine all sources
 *
 * On any failure: Rollback to previous state
 */
export async function loadMappingSource(index, loadFunction, params) {
  return executeTransaction(async () => {
    // Initialize source state if needed
    if (!appState.mappings.sources[index]) {
      appState.mappings.sources[index] = new MappingSourceState(index);
    }

    const source = appState.mappings.sources[index];
    const previousState = { ...source };

    try {
      // 1. Transition to LOADING
      source.transition(States.LOADING);
      setStatus("Loading mapping table...");
      notifyStateChange();

      // 2. Execute load operation (Excel + Backend)
      const result = await loadFunction(params);

      // 3. Verify backend accepted it
      source.transition(States.VERIFYING);
      setStatus("Verifying with backend...");
      notifyStateChange();

      const backendState = await verifyBackendState();

      if (!backendState.matcher_initialized || backendState.unique_terms === 0) {
        throw new Error("Backend verification failed: Matcher not initialized");
      }

      // 4. Transition to SYNCED
      source.transition(States.SYNCED, {
        data: result,
        backendSynced: true,
        lastSyncTime: Date.now(),
        error: null,
      });

      // 5. Store current backend total
      appState.mappings.totalBackendTerms = backendState.unique_terms;

      // 6. Combine all synced sources
      combineMappingSources();

      setStatus(`✅ Mapping ${index + 1} loaded and verified (${backendState.unique_terms} terms)`);
      notifyStateChange();

      return result;
    } catch (error) {
      // Rollback on failure
      source.transition(States.ERROR, {
        error: error.message,
        backendSynced: false,
      });

      setStatus(`❌ Failed to load mapping ${index + 1}: ${error.message}`, true);
      notifyStateChange();

      throw error;
    }
  });
}

/**
 * Combine all SYNCED mapping sources
 */
function combineMappingSources() {
  const syncedSources = Object.values(appState.mappings.sources).filter(
    (s) => s.status === States.SYNCED && s.data
  );

  if (syncedSources.length === 0) {
    appState.mappings.combined = null;
    appState.mappings.loaded = false;
    return;
  }

  const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };

  syncedSources.forEach((source) => {
    const data = source.data;
    if (data.forward) Object.assign(combined.forward, data.forward);
    if (data.reverse) Object.assign(combined.reverse, data.reverse);

    combined.metadata.sources.push({
      index: source.index + 1,
      backendSynced: source.backendSynced,
      lastSyncTime: source.lastSyncTime,
    });
  });

  appState.mappings.combined = combined;
  appState.mappings.loaded = true;
}

/**
 * Reconcile Frontend with Backend State
 * Call this periodically or after errors
 */
export async function reconcileWithBackend() {
  try {
    const backendState = await verifyBackendState();
    const expected = appState.mappings.totalBackendTerms;

    // Compare actual vs expected
    if (backendState.unique_terms !== expected && expected > 0) {
      console.warn(
        `State mismatch: Expected ${expected} terms, backend has ${backendState.unique_terms}`
      );

      // Mark all sources as needing verification
      Object.values(appState.mappings.sources).forEach((source) => {
        if (source.status === States.SYNCED) {
          source.backendSynced = false;
        }
      });

      setStatus("⚠️ State mismatch detected - please reload mapping tables", true);
      notifyStateChange();
    }
  } catch (error) {
    console.error("Reconciliation failed:", error);
  }
}

/**
 * Clear all mapping sources
 */
export function clearMappings() {
  appState.mappings.sources = {};
  appState.mappings.combined = null;
  appState.mappings.loaded = false;
  notifyStateChange();
}

/**
 * Get current state (read-only)
 */
export function getState() {
  return {
    ui: { ...appState.ui },
    server: { ...appState.server },
    config: { ...appState.config },
    mappings: {
      sources: { ...appState.mappings.sources },
      combined: appState.mappings.combined,
      loaded: appState.mappings.loaded,
    },
  };
}

// Direct state access for backward compatibility
export const state = appState;

// Start periodic reconciliation (every 30 seconds)
setInterval(() => {
  if (appState.server.online && appState.mappings.loaded) {
    reconcileWithBackend();
  }
}, 30000);
