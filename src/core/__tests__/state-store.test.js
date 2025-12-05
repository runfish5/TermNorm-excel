/**
 * State Store Tests
 *
 * Tests for immutable state container and actions
 */

import { StateStore, stateStore, initialState } from '../state-store.js';
import {
  setView,
  setServerStatus,
  setConfig,
  setCellState,
  getWorkbookCellState,
  clearWorkbookCells,
  deleteWorkbook,
  findCellState,
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
  });

  describe('Workbook Cell State Actions', () => {
    it('setCellState() should add cell state to workbook', () => {
      const cellState = {
        value: 'test input',
        status: 'complete',
        row: 5,
        col: 3,
      };

      setCellState('workbook1', '5:3', cellState);

      const retrieved = getWorkbookCellState('workbook1', '5:3');
      expect(retrieved).toEqual(cellState);
    });

    it('setCellState() should create workbook entry if not exists', () => {
      setCellState('newWorkbook', '1:1', { value: 'test' });

      const workbooks = getStateValue('session.workbooks');
      expect(workbooks).toHaveProperty('newWorkbook');
      expect(workbooks.newWorkbook).toHaveProperty('cells');
    });

    it('getWorkbookCellState() should return undefined for non-existent cell', () => {
      const result = getWorkbookCellState('nonexistent', '1:1');
      expect(result).toBeUndefined();
    });

    it('clearWorkbookCells() should remove all cells from workbook', () => {
      setCellState('workbook1', '1:1', { value: 'a' });
      setCellState('workbook1', '2:2', { value: 'b' });

      clearWorkbookCells('workbook1');

      expect(getWorkbookCellState('workbook1', '1:1')).toBeUndefined();
      expect(getWorkbookCellState('workbook1', '2:2')).toBeUndefined();
    });

    it('deleteWorkbook() should remove entire workbook state', () => {
      setCellState('workbook1', '1:1', { value: 'test' });

      deleteWorkbook('workbook1');

      const workbooks = getStateValue('session.workbooks');
      expect(workbooks.workbook1).toBeUndefined();
    });

    it('findCellState() should find cell across all workbooks', () => {
      setCellState('workbook1', '1:1', { value: 'a' });
      setCellState('workbook2', '2:2', { value: 'b' });

      const found = findCellState('2:2');
      expect(found).toEqual({ value: 'b' });
    });

    it('findCellState() should return undefined for non-existent cell', () => {
      const result = findCellState('999:999');
      expect(result).toBeUndefined();
    });
  });

  describe('Helper Functions', () => {
    it('getStateValue() should get nested value', () => {
      expect(getStateValue('ui.currentView')).toBe('config');
    });

    it('getStateValue() should return undefined for non-existent path', () => {
      expect(getStateValue('nonexistent.path')).toBeUndefined();
    });
  });
});
