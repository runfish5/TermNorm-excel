// shared-services/state.manager.js

/**
 * Simple centralized state management
 * Enhanced for direct UI access to config and mappings
 */
export class StateManager {
  constructor() {
    this.state = {
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
      },
      mappings: {
        forward: {},
        reverse: {},
        metadata: null,
        loaded: false,
      },
    };
    this.subscribers = new Map();
    this.nextId = 1;
  }

  get(path) {
    return path.split(".").reduce((obj, key) => obj?.[key], this.state);
  }

  set(path, value) {
    const keys = path.split(".");
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => (obj[key] = obj[key] || {}), this.state);
    target[lastKey] = value;
    this._notify(path);
  }

  update(updates) {
    Object.entries(updates).forEach(([path, value]) => this.set(path, value));
  }

  subscribe(path, callback) {
    const id = this.nextId++;
    this.subscribers.set(id, { path, callback });
    return id;
  }

  unsubscribe(id) {
    this.subscribers.delete(id);
  }

  _notify(changedPath) {
    this.subscribers.forEach(({ path, callback }) => {
      if (changedPath.startsWith(path)) {
        callback(this.get(path));
      }
    });
  }

  // Convenience methods
  setStatus(message, isError = false) {
    this.update({
      "ui.statusMessage": message,
      "ui.isError": isError,
    });
  }

  setConfig(config) {
    this.update({
      "config.data": config,
      "config.loaded": true,
    });
  }

  setMappings(forward, reverse, metadata) {
    this.update({
      "mappings.forward": forward,
      "mappings.reverse": reverse,
      "mappings.metadata": metadata,
      "mappings.loaded": true,
    });
  }

  // Store individual mapping for combination
  addMappingSource(index, mappings, result, config) {
    console.log(`🔵 STATE_ADD_SOURCE: Adding mapping source ${index} -`, {
      hasForward: !!mappings?.forward,
      hasReverse: !!mappings?.reverse,
      forwardCount: mappings?.forward ? Object.keys(mappings.forward).length : 0,
      reverseCount: mappings?.reverse ? Object.keys(mappings.reverse).length : 0,
      hasResult: !!result,
      hasConfig: !!config,
    });

    const sources = this.get("mappings.sources") || {};
    sources[index] = { mappings, result, config };
    this.update({ "mappings.sources": sources });

    const updatedSources = this.get("mappings.sources") || {};
    console.log("🟢 STATE_ADD_SOURCE: Source stored -", {
      totalSources: Object.keys(updatedSources).length,
      sourceIndexes: Object.keys(updatedSources),
    });

    // Auto-combine mappings when sources are added
    this.combineMappingSources();
  }

  // Combine all stored mapping sources
  combineMappingSources() {
    // Guard against recursion
    if (this._combiningInProgress) {
      console.log("🟡 STATE_COMBINE: Already combining, skipping to prevent recursion");
      return;
    }

    this._combiningInProgress = true;
    console.log("🔵 STATE_COMBINE: Starting mapping source combination");

    const sources = this.get("mappings.sources") || {};
    console.log("🔵 STATE_COMBINE: Raw sources -", {
      sourcesCount: Object.keys(sources).length,
      sourceIndexes: Object.keys(sources),
      sources: sources,
    });

    if (Object.keys(sources).length === 0) {
      console.log("🔴 STATE_COMBINE: FAILED - No mapping sources to combine");
      this._combiningInProgress = false;
      return;
    }

    const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };

    Object.entries(sources).forEach(([index, { mappings, result, config }]) => {
      console.log(`🔵 STATE_COMBINE: Processing source ${index} -`, {
        hasForward: !!mappings?.forward,
        hasReverse: !!mappings?.reverse,
        forwardCount: mappings?.forward ? Object.keys(mappings.forward).length : 0,
        reverseCount: mappings?.reverse ? Object.keys(mappings.reverse).length : 0,
        hasResult: !!result,
        hasConfig: !!config,
      });

      if (mappings?.forward) {
        Object.assign(combined.forward, mappings.forward);
      }
      if (mappings?.reverse) {
        Object.assign(combined.reverse, mappings.reverse);
      }

      combined.metadata.sources.push({
        index: parseInt(index) + 1,
        config,
        mappings,
        metadata: result.metadata,
      });
    });

    console.log("🔵 STATE_COMBINE: Final combined result -", {
      forwardCount: Object.keys(combined.forward).length,
      reverseCount: Object.keys(combined.reverse).length,
      sourcesCount: combined.metadata.sources.length,
    });

    this.setMappings(combined.forward, combined.reverse, combined.metadata);
    console.log("🟢 STATE_COMBINE: SUCCESS - Mappings combined and set");
    this._combiningInProgress = false;
  }

  clearMappings() {
    this.update({
      "mappings.forward": {},
      "mappings.reverse": {},
      "mappings.metadata": null,
      "mappings.loaded": false,
    });
  }

  // Debug helper
  getFullState() {
    return { ...this.state };
  }
}

export const state = new StateManager();
