/**
 * Session Recovery - Proactive and reactive session management
 *
 * This module handles session recovery logic for the backend session.
 * It provides utilities to ensure the session is initialized before making
 * API calls and can recover from session loss (e.g., after server restart).
 */

import { getStateValue } from "../core/state-actions.js";
import { reinitializeSession } from "./state-machine.manager.js";
import { showMessage } from "../utils/error-display.js";
import { LOG_PREFIX, ERROR_MESSAGES } from "../config/session.config.js";

/**
 * Ensure backend session is initialized (proactive check)
 *
 * Checks if the session is initialized and attempts to reinitialize if not.
 * This is a proactive measure to prevent "No session found" errors.
 *
 * @returns {Promise<boolean>} True if session is initialized, false otherwise
 *
 * @example
 * const ready = await ensureSessionInitialized();
 * if (!ready) {
 *   console.error("Cannot proceed - session initialization failed");
 *   return null;
 * }
 */
export async function ensureSessionInitialized() {
  if (getStateValue('session.initialized')) {
    return true; // Already initialized
  }

  showMessage("Initializing backend session...");

  const success = await reinitializeSession();

  if (!success) {
    showMessage(ERROR_MESSAGES.SESSION_RECOVERY_FAILED, "error");
    return false;
  }

  return true;
}

/**
 * Execute an API call with automatic session recovery
 *
 * Wraps an API call function with session recovery logic. If the call fails,
 * it attempts to reinitialize the session and retry once.
 *
 * @param {Function} apiCallFn - Async function that makes the API call
 * @returns {Promise<any>} Result from the API call, or null if failed
 *
 * @example
 * const data = await executeWithSessionRecovery(async () => {
 *   return await apiPost('/research-and-match', { query: 'test' }, getHeaders());
 * });
 */
export async function executeWithSessionRecovery(apiCallFn) {
  // First attempt
  let result = await apiCallFn();

  if (result) {
    return result; // Success
  }

  // First attempt failed - try session recovery
  showMessage("Recovering backend session...");

  const recoverySuccess = await reinitializeSession();

  if (!recoverySuccess) {
    return null; // Recovery failed
  }

  // Retry after successful recovery
  result = await apiCallFn();
  return result;
}
