// Functional state management - direct property access
const appState = {
  ui: {
    currentView: "config",
    statusMessage: "Ready to load configuration...",
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
    raw: null,
  },
  mappings: {
    forward: {},
    reverse: {},
    metadata: null,
    loaded: false,
    sources: {},
  },
};

let subscribers = [];
let combiningInProgress = false;

function notify() {
  subscribers.forEach(({ path, callback }) => {
    const keys = path.split(".");
    let result = appState;
    for (const key of keys) {
      result = result?.[key];
      if (result === undefined) return;
    }
    callback(result);
  });
}

export function subscribe(path, callback) {
  subscribers.push({ path, callback });
}

export function setStatus(message, isError = false) {
  appState.ui.statusMessage = message;
  appState.ui.isError = isError;
  notify();
}

export function setConfig(config) {
  appState.config.data = config;
  appState.config.loaded = true;
  notify();
}

export function setMappings(forward, reverse, metadata) {
  appState.mappings.forward = forward;
  appState.mappings.reverse = reverse;
  appState.mappings.metadata = metadata;
  appState.mappings.loaded = true;
  notify();
}

export function addMappingSource(index, mappings, result, config) {
  appState.mappings.sources[index] = { mappings, result, config };
  combineMappingSources();
}

function combineMappingSources() {
  if (combiningInProgress) return;

  combiningInProgress = true;
  const sources = appState.mappings.sources;
  
  if (Object.keys(sources).length === 0) {
    combiningInProgress = false;
    return;
  }

  const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };

  Object.entries(sources).forEach(([index, { mappings, result, config }]) => {
    if (mappings?.forward) Object.assign(combined.forward, mappings.forward);
    if (mappings?.reverse) Object.assign(combined.reverse, mappings.reverse);

    combined.metadata.sources.push({
      index: parseInt(index) + 1,
      config,
      mappings,
      metadata: result.metadata,
    });
  });

  setMappings(combined.forward, combined.reverse, combined.metadata);
  combiningInProgress = false;
}

export function clearMappings() {
  appState.mappings.forward = {};
  appState.mappings.reverse = {};
  appState.mappings.metadata = null;
  appState.mappings.loaded = false;
  notify();
}

export function getFullState() {
  return {
    ui: { ...appState.ui },
    server: { ...appState.server },
    config: { ...appState.config },
    mappings: { ...appState.mappings },
  };
}

// Direct state access - use state.server.online instead of complex path resolution
export const state = appState;
