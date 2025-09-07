// services/normalizer.functions.js - Pure functions for term normalization
import { findBestMatch } from "./normalizer.fuzzy.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { state } from "../shared-services/state.manager.js";

export function getCachedMatch(value, forward, reverse) {
  const val = String(value || "").trim();
  if (!val) return null;
  
  if (val in forward) {
    const mapping = forward[val];
    return {
      target: typeof mapping === "string" ? mapping : mapping.target,
      method: "cached",
      confidence: 1.0,
    };
  }
  return val in reverse ? { target: val, method: "cached", confidence: 1.0 } : null;
}

export function findFuzzyMatch(value, forward, reverse) {
  const val = String(value || "").trim();
  if (!val) return null;

  const fwd = findBestMatch(val, forward, 0.7);
  if (fwd) {
    return {
      target: typeof fwd.value === "string" ? fwd.value : fwd.value.target,
      method: "fuzzy",
      confidence: fwd.score,
    };
  }

  const rev = findBestMatch(val, reverse, 0.5);
  return rev ? { target: rev.key, method: "fuzzy", confidence: rev.score } : null;
}

export async function findTokenMatch(value, config) {
  const val = String(value || "").trim();
  if (!val) return null;

  try {
    state.setStatus("Starting mapping process...");

    const headers = getHeaders();
    const apiEndpoint = `${getHost()}/research-and-match`;
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ query: val }),
    });

    if (!response.ok) {
      const isAuthError = response.status === 401;
      const message = isAuthError
        ? "❌ API key invalid - check your key"
        : `❌ API Error: ${response.status} ${response.statusText} (API)`;
      const logMessage = `[API] ${
        isAuthError ? "API Key Error: 401 Unauthorized" : `API Error: ${response.status} ${response.statusText}`
      } - Endpoint: ${apiEndpoint}`;

      state.setStatus(message, true);
      console.error(logMessage);
      return null;
    }

    const data = await response.json();
    if (!data.success || !data.data.ranked_candidates?.length) {
      if (!data.success) {
        console.error(`API Error: ${data.error} (${data.error_type})`);
        state.setStatus(`Research failed: ${data.error}`, true);
      }
      return null;
    }

    const responseData = data.data;
    const best = responseData.ranked_candidates[0];
    if (!best) {
      state.setStatus("ranked_candidates has wrong schema or empty", true);
      return null;
    }

    state.setStatus(`Found match:\n- ${best.candidate} \n- Total time: ${responseData.total_time} s`);
    return {
      target: best.candidate,
      method: "ProfileRank",
      confidence: best.relevance_score,
      candidates: responseData.ranked_candidates,
      total_time: responseData.total_time,
      llm_provider: responseData.llm_provider,
    };
  } catch (error) {
    console.error("Token match error:", error);
    let errorMessage = "❌ Connection failed: " + error.message;
    if (error.name === "AbortError") {
      errorMessage = "Backend server timeout - ensure server is running on port 8000";
    } else if (error.message.includes("fetch") || error.message.includes("Failed to fetch")) {
      errorMessage = "Backend server not accessible - ensure server is running on port 8000";
    }

    state.setStatus(errorMessage, true);
    return null;
  }
}

export async function processTermNormalization(value, forward, reverse, config) {
  const val = String(value || "").trim();
  if (!val) return null;

  // Try cached first
  const cached = getCachedMatch(val, forward, reverse);
  if (cached) return cached;

  // Try research API
  const researched = await findTokenMatch(val, config);
  if (researched) return researched;

  // Fallback to fuzzy
  return findFuzzyMatch(val, forward, reverse);
}