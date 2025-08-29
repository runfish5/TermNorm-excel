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
        networkMode: false,
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

  setView(view) {
    this.set("ui.currentView", view);
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

  clearMappings() {
    this.update({
      "mappings.forward": {},
      "mappings.reverse": {},
      "mappings.metadata": null,
      "mappings.loaded": false,
    });
  }

  // Enhanced getters for direct UI access
  getConfig() {
    return this.get("config.data");
  }

  getMappings() {
    return this.get("mappings");
  }

  isConfigLoaded() {
    return this.get("config.loaded");
  }

  areMappingsLoaded() {
    return this.get("mappings.loaded");
  }

  // Debug helper
  getFullState() {
    return { ...this.state };
  }

  // shared-services/state.manager.js
  // Add this ONE method to your existing StateManager class:

  // NEW: Merge method with proper reverse mapping handling
  mergeMappings(newForward, newReverse, newMetadata) {
    const current = this.get("mappings");

    // Merge forward mappings (simple)
    const mergedForward = { ...current.forward, ...newForward };

    // Merge reverse mappings (complex - merge alias arrays)
    const mergedReverse = { ...current.reverse };
    for (const [target, data] of Object.entries(newReverse || {})) {
      if (mergedReverse[target]) {
        // Merge aliases, avoiding duplicates
        const existingAliases = new Set(mergedReverse[target].alias || []);
        const newAliases = data.alias || [];
        newAliases.forEach((alias) => existingAliases.add(alias));
        mergedReverse[target] = { alias: Array.from(existingAliases) };
      } else {
        mergedReverse[target] = { ...data };
      }
    }

    this.update({
      "mappings.forward": mergedForward,
      "mappings.reverse": mergedReverse,
      "mappings.metadata": newMetadata,
      "mappings.loaded": true,
    });
  }
}

export const state = new StateManager();
