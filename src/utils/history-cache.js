/** History Cache - Fetches and caches processed entries from backend */
import { getStateValue, setHistoryEntries, setHistoryCacheInitialized } from "../core/state-actions.js";
import { stateStore } from "../core/state-store.js";
import { serverFetch, apiGet, getHeaders, buildUrl } from "./api-fetch.js";
import { ENDPOINTS } from "../config/config.js";

export async function initializeHistoryCache() {
  if (getStateValue('history.cacheInitialized') || !getStateValue('server.online')) return getStateValue('history.cacheInitialized') || false;
  try {
    const response = await serverFetch(ENDPOINTS.HISTORY, { method: "GET", headers: getHeaders() });
    if (!response.ok) return false;
    const result = await response.json();
    if (result.status === "success" && result.data?.entries) {
      setHistoryEntries(result.data.entries);
      setHistoryCacheInitialized(true, Object.keys(result.data.entries).length);
      return true;
    }
  } catch {}
  return false;
}

export function findTargetBySource(sourceValue) {
  if (!sourceValue) return null;
  const entries = getStateValue('history.entries') || {};
  for (const [id, e] of Object.entries(entries)) if (e.aliases?.[sourceValue]) return id;
  return null;
}

export async function getEntity(identifier) {
  if (!identifier) return null;
  const cached = (getStateValue('history.entries') || {})[identifier];
  if (cached) return cached;
  try { const r = await apiGet(`${buildUrl(ENDPOINTS.MATCHES)}/${encodeURIComponent(identifier)}`); return r?.status !== "error" ? r?.data : null; }
  catch { return null; }
}

export function cacheEntity(source, { target, method, confidence, timestamp, web_sources, web_search_status }) {
  // Note: entity_profile is intentionally NOT cached here because it describes the SOURCE (user query),
  // not the TARGET (matched identifier). Storing it with the target would show wrong profile in details view.
  if (!target) return;
  const entries = { ...(getStateValue('history.entries') || {}) };
  entries[target] = entries[target] ? { ...entries[target], aliases: { ...entries[target].aliases } }
    : { entity_profile: null, aliases: {}, web_sources: web_sources || [], last_updated: timestamp };
  entries[target].aliases[source] = { method, confidence, timestamp, web_search_status: web_search_status || "idle" };
  if (!entries[target].last_updated || timestamp > entries[target].last_updated) {
    entries[target].last_updated = timestamp;
    if (web_sources?.length) entries[target].web_sources = web_sources;
  }
  stateStore.set('history.entries', entries);
}
