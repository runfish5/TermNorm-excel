/**
 * State Store Tests
 *
 * Tests for immutable state container and actions
 */

import { StateStore, stateStore, initialState } from '../state-store.js';
import {
  setView,
  setStatusMessage,
  setServerStatus,
  setConfig,
  clearConfig,
  setMappingsCombined,
  clearMappings,
  setSessionInitialized,
  setCacheEntity,
  setSetting,
  getState,
  getStateValue,
} from '../state-actions.js';
import { eventBus } from '../event-bus.js';
import { Events } from '../events.js';

describe('StateStore', () => {
  let store;

  beforeEach(() => {
    store = new StateStore();
    eventBus.clear(); // Clear event bus between tests
  });

  describe('getState()', () => {
    it('should return frozen copy of state', () => {
      const state = store.getState();

      expect(() => {
        state.ui.currentView = 'modified';
      }).toThrow();
    });

    it('should return deep clone (nested objects also frozen)', () => {
      const state = store.getState();

      expect(() => {
        state.server.online = true;
      }).toThrow();
    });
  });

  describe('get()', () => {
    it('should get nested values by path', () => {
      expect(store.get('ui.currentView')).toBe('config');
      expect(store.get('server.online')).toBe(false);
      expect(store.get('settings.requireServerOnline')).toBe(true);
    });

    it('should return undefined for non-existent paths', () => {
      expect(store.get('nonexistent.path')).toBeUndefined();
    });
  });

  describe('setState()', () => {
    it('should update state immutably', () => {
      const originalState = store.getState();

      store.setState(state => {
        state.ui.currentView = 'history';
        return state;
      });

      expect(store.get('ui.currentView')).toBe('history');
      expect(originalState.ui.currentView).toBe('config'); // Original unchanged
    });

    it('should notify subscribers', () => {
      const subscriber = jest.fn();
      store.subscribe(subscriber);

      store.setState(state => {
        state.ui.currentView = 'history';
        return state;
      });

      expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
        ui: expect.objectContaining({ currentView: 'history' })
      }));
    });

    it('should emit STATE_CHANGED event', () => {
      const handler = jest.fn();
      eventBus.on(Events.STATE_CHANGED, handler);

      store.setState(state => {
        state.ui.currentView = 'history';
        return state;
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        state: expect.any(Object)
      }));
    });
  });

  describe('set()', () => {
    it('should set nested values by path', () => {
      store.set('ui.currentView', 'history');
      expect(store.get('ui.currentView')).toBe('history');

      store.set('server.online', true);
      expect(store.get('server.online')).toBe(true);
    });

    it('should create missing intermediate objects', () => {
      store.set('new.nested.path', 'value');
      expect(store.get('new.nested.path')).toBe('value');
    });
  });

  describe('merge()', () => {
    it('should merge object into state slice', () => {
      store.merge('server', {
        online: true,
        host: 'http://localhost:8000',
      });

      expect(store.get('server.online')).toBe(true);
      expect(store.get('server.host')).toBe('http://localhost:8000');
      expect(store.get('server.lastChecked')).toBeNull(); // Other props unchanged
    });
  });

  describe('subscribe()', () => {
    it('should call subscriber on state change', () => {
      const subscriber = jest.fn();
      store.subscribe(subscriber);

      store.set('ui.currentView', 'history');

      expect(subscriber).toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const subscriber = jest.fn();
      const unsubscribe = store.subscribe(subscriber);

      unsubscribe();
      store.set('ui.currentView', 'history');

      expect(subscriber).not.toHaveBeenCalled();
    });

    it('should handle errors in subscribers gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const badSubscriber = jest.fn(() => {
        throw new Error('Subscriber error');
      });
      const goodSubscriber = jest.fn();

      store.subscribe(badSubscriber);
      store.subscribe(goodSubscriber);

      store.set('ui.currentView', 'history');

      expect(badSubscriber).toHaveBeenCalled();
      expect(goodSubscriber).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('reset()', () => {
    it('should reset to initial state', () => {
      store.set('ui.currentView', 'history');
      store.set('server.online', true);

      store.reset();

      expect(store.get('ui.currentView')).toBe('config');
      expect(store.get('server.online')).toBe(false);
    });

    it('should notify subscribers on reset', () => {
      const subscriber = jest.fn();
      store.subscribe(subscriber);

      store.reset();

      expect(subscriber).toHaveBeenCalled();
    });
  });
});

describe('State Actions', () => {
  beforeEach(() => {
    stateStore.reset();
    eventBus.clear();
  });

  describe('UI Actions', () => {
    it('setView() should update current view', () => {
      setView('history');
      expect(getStateValue('ui.currentView')).toBe('history');
    });

    it('setStatusMessage() should update message and error flag', () => {
      setStatusMessage('Error occurred', true);
      expect(getStateValue('ui.statusMessage')).toBe('Error occurred');
      expect(getStateValue('ui.isError')).toBe(true);
    });
  });

  describe('Server Actions', () => {
    it('setServerStatus() should update server state', () => {
      setServerStatus(true, 'http://localhost:8000', { provider: 'groq' });

      expect(getStateValue('server.online')).toBe(true);
      expect(getStateValue('server.host')).toBe('http://localhost:8000');
      expect(getStateValue('server.info.provider')).toBe('groq');
    });

    it('setServerStatus() should emit SERVER_STATUS_CHANGED event', () => {
      const handler = jest.fn();
      eventBus.on(Events.SERVER_STATUS_CHANGED, handler);

      setServerStatus(true, 'http://localhost:8000');

      expect(handler).toHaveBeenCalledWith({
        online: true,
        host: 'http://localhost:8000',
      });
    });

    it('setServerStatus() should emit SERVER_RECONNECTED on reconnect', () => {
      const handler = jest.fn();
      eventBus.on(Events.SERVER_RECONNECTED, handler);

      // First set to offline
      setServerStatus(false);
      // Then reconnect
      setServerStatus(true, 'http://localhost:8000');

      expect(handler).toHaveBeenCalledWith({ host: 'http://localhost:8000' });
    });
  });

  describe('Config Actions', () => {
    it('setConfig() should update config state', () => {
      const config = { test: 'data' };
      setConfig(config);

      expect(getStateValue('config.loaded')).toBe(true);
      expect(getStateValue('config.data')).toEqual(config);
    });

    it('setConfig() should emit CONFIG_LOADED event', () => {
      const handler = jest.fn();
      eventBus.on(Events.CONFIG_LOADED, handler);

      const config = { test: 'data' };
      setConfig(config);

      expect(handler).toHaveBeenCalledWith({ config });
    });

    it('clearConfig() should reset config state', () => {
      setConfig({ test: 'data' });
      clearConfig();

      expect(getStateValue('config.loaded')).toBe(false);
      expect(getStateValue('config.data')).toBeNull();
    });
  });

  describe('Mappings Actions', () => {
    it('setMappingsCombined() should update mappings', () => {
      const mappings = { forward: {}, reverse: {} };
      setMappingsCombined(mappings);

      expect(getStateValue('mappings.loaded')).toBe(true);
      expect(getStateValue('mappings.combined')).toEqual(mappings);
    });

    it('setMappingsCombined() should emit MAPPINGS_LOADED event', () => {
      const handler = jest.fn();
      eventBus.on(Events.MAPPINGS_LOADED, handler);

      const mappings = { forward: {}, reverse: {} };
      setMappingsCombined(mappings);

      expect(handler).toHaveBeenCalledWith({ mappings });
    });

    it('clearMappings() should emit MAPPINGS_CLEARED event', () => {
      const handler = jest.fn();
      eventBus.on(Events.MAPPINGS_CLEARED, handler);

      clearMappings();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Session Actions', () => {
    it('setSessionInitialized() should update session state', () => {
      setSessionInitialized(true, 100);

      expect(getStateValue('session.initialized')).toBe(true);
      expect(getStateValue('session.termCount')).toBe(100);
      expect(getStateValue('session.lastInitialized')).toBeTruthy();
    });
  });

  describe('Cache Actions', () => {
    it('setCacheEntity() should add entity to cache', () => {
      const entity = {
        entity_profile: { name: 'Test' },
        aliases: {},
        web_sources: [],
      };

      setCacheEntity('test-id', entity);

      const cached = getStateValue('cache.entities.test-id');
      expect(cached).toEqual(entity);
    });
  });

  describe('Settings Actions', () => {
    it('setSetting() should update individual setting', () => {
      setSetting('requireServerOnline', false);

      expect(getStateValue('settings.requireServerOnline')).toBe(false);
    });

    it('setSetting() should emit SETTING_CHANGED event', () => {
      const handler = jest.fn();
      eventBus.on(Events.SETTING_CHANGED, handler);

      setSetting('requireServerOnline', false);

      expect(handler).toHaveBeenCalledWith({
        key: 'requireServerOnline',
        value: false,
      });
    });
  });

  describe('Helper Functions', () => {
    it('getState() should return full state', () => {
      const state = getState();
      expect(state).toHaveProperty('ui');
      expect(state).toHaveProperty('server');
      expect(state).toHaveProperty('config');
    });

    it('getStateValue() should get nested value', () => {
      expect(getStateValue('ui.currentView')).toBe('config');
    });
  });
});
