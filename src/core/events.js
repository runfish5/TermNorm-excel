/** Event Constants - Centralized event type definitions */

export const Events = {
  // State Events
  STATE_CHANGED: 'state:changed',
  CONFIG_LOADED: 'config:loaded',
  MAPPINGS_LOADED: 'mappings:loaded',
  MAPPINGS_CLEARED: 'mappings:cleared',

  // Cell Processing Events
  CELL_PROCESSING_STARTED: 'cell:processing:started',
  CELL_PROCESSING_COMPLETE: 'cell:processing:complete',
  CELL_PROCESSING_ERROR: 'cell:processing:error',
  CELL_SELECTED: 'cell:selected',

  // Candidate Ranking Events
  CANDIDATES_AVAILABLE: 'candidates:available',
  CANDIDATE_SELECTED: 'candidate:selected',
  CANDIDATES_CLEARED: 'candidates:cleared',

  // History Events
  HISTORY_ENTRY_ADDED: 'history:entry:added',
  HISTORY_CACHE_INITIALIZED: 'history:cache:initialized',
  HISTORY_CLEARED: 'history:cleared',

  // Server Events
  SERVER_STATUS_CHANGED: 'server:status:changed',
  SERVER_RECONNECTED: 'server:reconnected',

  // Tracking Events
  TRACKING_STARTED: 'tracking:started',
  TRACKING_STOPPED: 'tracking:stopped',
  WORKSHEET_CHANGED: 'worksheet:changed',

  // Settings Events
  SETTING_CHANGED: 'setting:changed',
  SETTINGS_LOADED: 'settings:loaded',

  // Normalization Method Events
  NORMALIZATION_METHOD_CACHE: 'normalization:method:cache',
  NORMALIZATION_METHOD_FUZZY: 'normalization:method:fuzzy',
  NORMALIZATION_METHOD_LLM: 'normalization:method:llm',
  NORMALIZATION_NO_MATCH: 'normalization:no:match',

  // Cache Performance Events
  CACHE_HIT: 'cache:hit',
  CACHE_MISS: 'cache:miss',

  // Cell State Events
  CELL_STATE_CHANGED: 'cell:state:changed',
  CELL_RESULT_LOGGED: 'cell:result:logged',

  // Web Search Events
  WEB_SEARCH_STARTED: 'web:search:started',
  WEB_SEARCH_COMPLETED: 'web:search:completed',
  WEB_SEARCH_FAILED: 'web:search:failed',
  WEB_SEARCH_STATUS_CHANGED: 'web:search:status:changed',
};
