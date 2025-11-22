/**
 * Managed activity store
 * Handles both session and cached entries with consistent interface
 * Prevents direct mutation of internal state
 */

const sessionActivities = [];
const maxEntries = 50;

/**
 * Add activity to store
 * Validates required fields and manages size limits
 *
 * @param {Object} activity - Activity object
 * @param {string} activity.source - Original input value
 * @param {string} activity.cellKey - Cell key (row:col format)
 * @param {string} activity.timestamp - ISO timestamp
 * @returns {Object} The added activity
 * @throws {Error} If required fields are missing
 */
export function addActivity(activity) {
  // Validate required fields
  if (!activity.source || !activity.timestamp) {
    throw new Error("Activity requires source and timestamp");
  }

  sessionActivities.unshift(activity);

  // Maintain size limit
  while (sessionActivities.length > maxEntries) {
    sessionActivities.pop();
  }

  return activity;
}

/**
 * Get all activities
 * Returns a copy to prevent external mutation
 *
 * @returns {Array} Copy of activities array
 */
export function getActivities() {
  return [...sessionActivities];
}

/**
 * Clear all activities
 */
export function clearActivities() {
  sessionActivities.length = 0;
}

/**
 * Get activity count
 *
 * @returns {number} Number of stored activities
 */
export function getCount() {
  return sessionActivities.length;
}

/**
 * Get maximum entries limit
 *
 * @returns {number} Max entries
 */
export function getMaxEntries() {
  return maxEntries;
}
