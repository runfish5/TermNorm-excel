/**
 * Event Constants - Centralized event type definitions
 *
 * All event names in one place for:
 * - Type safety (easy to see all available events)
 * - Prevent typos
 * - Easy refactoring (change in one place)
 */

export const Events = {
  // ============================================================================
  // STATE EVENTS
  // ============================================================================

  /** Fired when any state change occurs */
  STATE_CHANGED: 'state:changed',

  /** Fired when configuration is loaded */
  CONFIG_LOADED: 'config:loaded',

  /** Fired when mappings are loaded */
  MAPPINGS_LOADED: 'mappings:loaded',

  /** Fired when mappings are cleared */
  MAPPINGS_CLEARED: 'mappings:cleared',


  // ============================================================================
  // CELL PROCESSING EVENTS
  // ============================================================================

  /** Fired when cell processing starts */
  CELL_PROCESSING_STARTED: 'cell:processing:started',

  /** Fired when cell processing completes successfully */
  CELL_PROCESSING_COMPLETE: 'cell:processing:complete',

  /** Fired when cell processing encounters an error */
  CELL_PROCESSING_ERROR: 'cell:processing:error',

  /** Fired when a cell is selected (for history navigation) */
  CELL_SELECTED: 'cell:selected',


  // ============================================================================
  // CANDIDATE RANKING EVENTS
  // ============================================================================

  /** Fired when candidates are available for user selection */
  CANDIDATES_AVAILABLE: 'candidates:available',

  /** Fired when user selects a candidate */
  CANDIDATE_SELECTED: 'candidate:selected',

  /** Fired when candidates panel is cleared */
  CANDIDATES_CLEARED: 'candidates:cleared',


  // ============================================================================
  // HISTORY EVENTS
  // ============================================================================

  /** Fired when a new entry is added to history */
  HISTORY_ENTRY_ADDED: 'history:entry:added',

  /** Fired when history cache is initialized from backend */
  HISTORY_CACHE_INITIALIZED: 'history:cache:initialized',

  /** Fired when history is cleared */
  HISTORY_CLEARED: 'history:cleared',


  // ============================================================================
  // SERVER EVENTS
  // ============================================================================

  /** Fired when server status changes (online/offline) */
  SERVER_STATUS_CHANGED: 'server:status:changed',

  /** Fired when server reconnects after being offline */
  SERVER_RECONNECTED: 'server:reconnected',

  /** Fired when server connection fails */
  SERVER_CONNECTION_FAILED: 'server:connection:failed',


  // ============================================================================
  // TRACKING EVENTS
  // ============================================================================

  /** Fired when tracking starts on a worksheet */
  TRACKING_STARTED: 'tracking:started',

  /** Fired when tracking stops on a worksheet */
  TRACKING_STOPPED: 'tracking:stopped',

  /** Fired when active worksheet changes */
  WORKSHEET_CHANGED: 'worksheet:changed',


  // ============================================================================
  // SETTINGS EVENTS
  // ============================================================================

  /** Fired when a setting is changed */
  SETTING_CHANGED: 'setting:changed',

  /** Fired when settings are loaded */
  SETTINGS_LOADED: 'settings:loaded',
};

/**
 * Event payload type definitions (for documentation)
 *
 * @typedef {Object} CellProcessingStartedPayload
 * @property {string} cellKey - Cell key (row:col)
 * @property {string} value - Cell value
 *
 * @typedef {Object} CellProcessingCompletePayload
 * @property {string} cellKey - Cell key
 * @property {string} source - Original value
 * @property {Object} result - Normalization result
 *
 * @typedef {Object} CandidatesAvailablePayload
 * @property {string} source - Original value
 * @property {Array} candidates - Ranked candidates
 * @property {Object} callbacks - Callback functions
 *
 * @typedef {Object} HistoryEntryAddedPayload
 * @property {string} source - Original value
 * @property {string} cellKey - Cell key
 * @property {string} timestamp - ISO timestamp
 * @property {Object} result - Normalization result
 *
 * @typedef {Object} ServerStatusChangedPayload
 * @property {boolean} online - Server online status
 * @property {string} host - Server host URL
 */
