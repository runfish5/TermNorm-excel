/** Session Recovery - Ensure backend session is ready before API calls */

import { getStateValue } from "../core/state-actions.js";
import { reinitializeSession } from "./workflows.js";
import { showMessage } from "../utils/error-display.js";

export async function ensureSessionInitialized() {
  if (getStateValue('session.initialized')) return true;
  showMessage("Initializing backend session...");
  const success = await reinitializeSession();
  if (!success) showMessage("Session initialization failed - check server connection", "error");
  return success;
}

export async function executeWithSessionRecovery(apiCallFn) {
  let result = await apiCallFn();
  if (result) return result;

  showMessage("Recovering backend session...");
  if (await reinitializeSession()) result = await apiCallFn();
  return result;
}
