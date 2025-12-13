/** State Store Tests - Core functionality only */
import { StateStore, stateStore } from '../state-store.js';
import { setCellState, getWorkbookCellState, setServerStatus, getStateValue } from '../state-actions.js';
import { eventBus } from '../event-bus.js';
import { Events } from '../events.js';

describe('StateStore', () => {
  let store;
  beforeEach(() => { store = new StateStore(); eventBus.clear(); });

  it('returns frozen state (immutability)', () => {
    expect(() => { store.getState().ui.currentView = 'x'; }).toThrow();
  });

  it('setState updates immutably and notifies subscribers', () => {
    const sub = jest.fn();
    store.subscribe(sub);
    store.setState(s => { s.ui.currentView = 'history'; return s; });
    expect(store.get('ui.currentView')).toBe('history');
    expect(sub).toHaveBeenCalled();
  });

  it('handles subscriber errors gracefully', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    store.subscribe(() => { throw new Error('fail'); });
    store.subscribe(jest.fn());
    store.set('ui.currentView', 'x');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('State Actions', () => {
  beforeEach(() => { stateStore.reset(); eventBus.clear(); });

  it('setCellState tracks cells per workbook', () => {
    setCellState('wb1', '5:3', { value: 'test', status: 'complete' });
    expect(getWorkbookCellState('wb1', '5:3')).toEqual({ value: 'test', status: 'complete' });
  });

  it('setServerStatus emits reconnect event', () => {
    const handler = jest.fn();
    eventBus.on(Events.SERVER_RECONNECTED, handler);
    setServerStatus(false);
    setServerStatus(true, 'http://localhost:8000');
    expect(handler).toHaveBeenCalledWith({ host: 'http://localhost:8000' });
  });
});
