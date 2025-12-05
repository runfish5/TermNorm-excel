/** State Actions - Centralized mutation functions */
import { stateStore } from './state-store.js';
import { eventBus } from './event-bus.js';
import { Events } from './events.js';

export function setView(view) { stateStore.set('ui.currentView', view); }
export function setServerHost(host) { stateStore.set('server.host', host); }
export function setWebSearchStatus(status, error = null) {
  stateStore.merge('webSearch', { status, error });
  import('../utils/status-indicators.js').then(m => m.updateWarnings());
}
export function setHistoryEntries(entries) { stateStore.merge('history', { entries }); }
export function getStateValue(path) { return stateStore.get(path); }
export function getWorkbookCellState(workbookId, cellKey) { return stateStore.get(`session.workbooks.${workbookId}`)?.cells?.[cellKey]; }

export function setServerStatus(online, host = null, info = {}) {
  const wasOnline = stateStore.get('server.online'), currentHost = host || stateStore.get('server.host');
  stateStore.merge('server', { online, host: currentHost, lastChecked: Date.now(), info });
  eventBus.emit(Events.SERVER_STATUS_CHANGED, { online, host: currentHost });
  if (online && !wasOnline) eventBus.emit(Events.SERVER_RECONNECTED, { host: currentHost });
}

export function setConfig(configData, rawData = null) {
  stateStore.merge('config', { loaded: true, data: configData, raw: rawData || configData });
  eventBus.emit(Events.CONFIG_LOADED, { config: configData });
}

export function setHistoryCacheInitialized(initialized, entryCount = 0) {
  stateStore.merge('history', { cacheInitialized: initialized });
  if (initialized) eventBus.emit(Events.HISTORY_CACHE_INITIALIZED, { entries: stateStore.get('history.entries') || {}, count: entryCount });
}

export function setCellState(workbookId, cellKey, cellState) {
  stateStore.setState(state => {
    if (!state.session.workbooks[workbookId]) state.session.workbooks[workbookId] = { cells: {} };
    state.session.workbooks[workbookId].cells[cellKey] = cellState;
    return state;
  });
}

export function clearWorkbookCells(workbookId) {
  stateStore.setState(state => { if (state.session.workbooks[workbookId]) state.session.workbooks[workbookId].cells = {}; return state; });
}

export function deleteWorkbook(workbookId) {
  stateStore.setState(state => { delete state.session.workbooks[workbookId]; return state; });
}

export function findCellState(cellKey) {
  const workbooks = stateStore.get('session.workbooks') || {};
  for (const id of Object.keys(workbooks)) { const s = workbooks[id]?.cells?.[cellKey]; if (s) return s; }
}
