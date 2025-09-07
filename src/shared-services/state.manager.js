export class StateManager {
  constructor() {
    this.ui = {
      currentView: "config",
      statusMessage: "Ready to load configuration...",
      isError: false,
    };
    this.server = {
      online: false,
      host: null,
      apiKey: "",
    };
    this.config = {
      loaded: false,
      data: null,
      raw: null,
    };
    this.mappings = {
      forward: {},
      reverse: {},
      metadata: null,
      loaded: false,
      sources: {},
    };
    this.subscribers = [];
    this._combiningInProgress = false;
  }

  get(path) {
    const keys = path.split(".");
    let result = this;
    for (const key of keys) {
      result = result?.[key];
      if (result === undefined) return undefined;
    }
    return result;
  }

  set(path, value) {
    const keys = path.split(".");
    const lastKey = keys.pop();
    let target = this;
    for (const key of keys) {
      target = target[key];
    }
    target[lastKey] = value;
    this._notify();
  }

  update(updates) {
    Object.entries(updates).forEach(([path, value]) => this.set(path, value));
  }

  subscribe(path, callback) {
    this.subscribers.push({ path, callback });
    return this.subscribers.length - 1;
  }

  unsubscribe(id) {
    this.subscribers.splice(id, 1);
  }

  _notify() {
    this.subscribers.forEach(({ path, callback }) => {
      callback(this.get(path));
    });
  }

  setStatus(message, isError = false) {
    this.ui.statusMessage = message;
    this.ui.isError = isError;
    this._notify();
  }

  setConfig(config) {
    this.config.data = config;
    this.config.loaded = true;
    this._notify();
  }

  setMappings(forward, reverse, metadata) {
    this.mappings.forward = forward;
    this.mappings.reverse = reverse;
    this.mappings.metadata = metadata;
    this.mappings.loaded = true;
    this._notify();
  }

  addMappingSource(index, mappings, result, config) {
    this.mappings.sources[index] = { mappings, result, config };
    this.combineMappingSources();
  }

  combineMappingSources() {
    if (this._combiningInProgress) {
      return;
    }

    this._combiningInProgress = true;

    const sources = this.mappings.sources;
    if (Object.keys(sources).length === 0) {
      this._combiningInProgress = false;
      return;
    }

    const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };

    Object.entries(sources).forEach(([index, { mappings, result, config }]) => {
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

    this.setMappings(combined.forward, combined.reverse, combined.metadata);
    this._combiningInProgress = false;
  }

  clearMappings() {
    this.mappings.forward = {};
    this.mappings.reverse = {};
    this.mappings.metadata = null;
    this.mappings.loaded = false;
    this._notify();
  }

  getFullState() {
    return {
      ui: { ...this.ui },
      server: { ...this.server },
      config: { ...this.config },
      mappings: { ...this.mappings },
    };
  }
}

export const state = new StateManager();
