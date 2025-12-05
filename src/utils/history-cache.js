/**
 * History Cache - Fetches and caches processed entries from backend
 * Also handles entity cache operations (getEntity, cacheEntity)
 */

import { getStateValue, setHistoryEntries, setHistoryCacheInitialized } from "../core/state-actions.js";
import { stateStore } from "../core/state-store.js";
import { serverFetch, apiGet } from "./api-fetch.js";
import { getHost, getHeaders } from "./server-utilities.js";

/** Initialize history cache from backend if not already initialized */
export async function initializeHistoryCache() {
  if (getStateValue('history.cacheInitialized') || !getStateValue('server.online')) {
    return getStateValue('history.cacheInitialized') || false;
  }

  try {
    const response = await serverFetch("/history/processed-entries", { method: "GET", headers: getHeaders() });
    if (!response.ok) return false;

    const result = await response.json();
    if (result.status === "success" && result.data?.entries) {
      setHistoryEntries(result.data.entries);
      setHistoryCacheInitialized(true, Object.keys(result.data.entries).length);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Find target identifier by source value (searches aliases in cache) */
export function findTargetBySource(sourceValue) {
  if (!sourceValue) return null;
  const entries = getStateValue('history.entries') || {};
  for (const [identifier, entry] of Object.entries(entries)) {
    if (entry.aliases?.[sourceValue]) return identifier;
  }
  return null;
}

/** Get entity by identifier - checks cache first, falls back to server */
export async function getEntity(identifier) {
  if (!identifier) return null;

  const cached = (getStateValue('history.entries') || {})[identifier];
  if (cached) return cached;

  try {
    const response = await apiGet(`${getHost()}/match-details/${encodeURIComponent(identifier)}`);
    return response?.status !== "error" ? response?.data : null;
  } catch {
    return null;
  }
}

/** Cache entity in history entries */
export function cacheEntity(source, result) {
  const { target, method, confidence, timestamp, entity_profile, web_sources } = result;
  if (!target) return;

  const entries = { ...(getStateValue('history.entries') || {}) };

  // Initialize or clone entry
  entries[target] = entries[target]
    ? { ...entries[target], aliases: { ...entries[target].aliases } }
    : { entity_profile: entity_profile || null, aliases: {}, web_sources: web_sources || [], last_updated: timestamp };

  // Add alias
  entries[target].aliases[source] = { method, confidence, timestamp };

  // Update metadata if newer
  const entry = entries[target];
  if (!entry.last_updated || timestamp > entry.last_updated) {
    entry.last_updated = timestamp;
    if (entity_profile) entry.entity_profile = entity_profile;
    if (web_sources?.length) entry.web_sources = web_sources;
  }

  stateStore.set('history.entries', entries);
}
