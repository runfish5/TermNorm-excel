/**
 * Event Log Service
 * Manages chronological log of processing events
 * Prevents direct mutation of internal state
 */

const sessionEvents = [];
const maxEntries = 50;

/**
 * Add event to log
 * Validates required fields and manages size limits
 *
 * @param {Object} event - Event object
 * @param {string} event.source - Original input value
 * @param {string} event.cellKey - Cell key (row:col format)
 * @param {string} event.timestamp - ISO timestamp
 * @returns {Object} The added event
 * @throws {Error} If required fields are missing
 */
export function addEvent(event) {
  // Validate required fields
  if (!event.source || !event.timestamp) {
    throw new Error("Event requires source and timestamp");
  }

  sessionEvents.unshift(event);

  // Maintain size limit
  while (sessionEvents.length > maxEntries) {
    sessionEvents.pop();
  }

  return event;
}

/**
 * Clear all events
 */
export function clearEvents() {
  sessionEvents.length = 0;
}

/**
 * Get event count
 *
 * @returns {number} Number of stored events
 */
export function getCount() {
  return sessionEvents.length;
}

/**
 * Get maximum entries limit
 *
 * @returns {number} Max entries
 */
export function getMaxEntries() {
  return maxEntries;
}
