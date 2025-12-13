import { getStateValue, setHistoryEntries, setHistoryCacheInitialized } from "../core/state-actions.js";
import { stateStore } from "../core/state-store.js";
import { serverFetch, apiGet, getHeaders, buildUrl } from "./api-fetch.js";
import { ENDPOINTS } from "../config/config.js";

export async function initializeHistoryCache() {
  if (getStateValue('history.cacheInitialized') || !getStateValue('server.online')) return getStateValue('history.cacheInitialized') || false;
  try {
    const r = await serverFetch(ENDPOINTS.HISTORY, { method: "GET", headers: getHeaders() });
    if (!r.ok) return false;
    const { status, data } = await r.json();
    if (status === "success" && data?.entries) { setHistoryEntries(data.entries); setHistoryCacheInitialized(true, Object.keys(data.entries).length); return true; }
  } catch {}
  return false;
}

export function findTargetBySource(src) {
  if (!src) return null;
  for (const [id, e] of Object.entries(getStateValue('history.entries') || {})) if (e.aliases?.[src]) return id;
  return null;
}

export async function getEntity(id) {
  if (!id) return null;
  const cached = (getStateValue('history.entries') || {})[id];
  if (cached) return cached;
  try { const r = await apiGet(`${buildUrl(ENDPOINTS.MATCHES)}/${encodeURIComponent(id)}`); return r?.status !== "error" ? r?.data : null; } catch { return null; }
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
