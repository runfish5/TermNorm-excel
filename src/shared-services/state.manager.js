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
    const sources = this.get("mappings.sources") || {};
    sources[index] = { mappings, result, config };
    this.update({ "mappings.sources": sources });
  }

  // Combine all stored mapping sources
  combineMappingSources() {
    const sources = this.get("mappings.sources") || {};
    if (Object.keys(sources).length === 0) return;

    const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };

    Object.entries(sources).forEach(([index, { mappings, result, config }]) => {
      Object.assign(combined.forward, mappings.forward);
      Object.assign(combined.reverse, mappings.reverse);
      combined.metadata.sources.push({
        index: parseInt(index) + 1,
        config,
        mappings,
        metadata: result.metadata,
      });
    });

    this.setMappings(combined.forward, combined.reverse, combined.metadata);
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
