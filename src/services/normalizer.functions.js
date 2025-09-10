// services/normalizer.functions.js - Pure functions for term normalization
import { findBestMatch } from "./normalizer.fuzzy.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { setStatus } from "../shared-services/state.manager.js";

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

export async function findTokenMatch(value) {
  const val = String(value || "").trim();
  if (!val) return null;

  try {
    setStatus("Starting mapping process...");

    const headers = getHeaders();
    const apiEndpoint = `${getHost()}/research-and-match`;
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ query: val }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        setStatus("❌ API key invalid - check your key", true);
        return null;
      }

      if (response.status === 503) {
        try {
          const errorData = await response.json();
          if (errorData.detail && errorData.detail.includes("Server restart detected")) {
            setStatus(
              "⚠️ Server restart detected - mapping indexes lost. Please reload your configuration files to restore mapping data.",
              true
            );
            return null;
          }
        } catch (e) {
          // If we can't parse the response, fall through to generic 503 error
        }
      }

      setStatus(`❌ API Error: ${response.status} ${response.statusText} (API)`, true);
      return null;
    }

    const data = await response.json();
    if (!data.success || !data.data.ranked_candidates?.length) {
      if (!data.success) {
        setStatus(`Research failed: ${data.error}`, true);
      }
      return null;
    }

    const responseData = data.data;
    const best = responseData.ranked_candidates[0];
    if (!best) {
      setStatus("ranked_candidates has wrong schema or empty", true);
      return null;
    }

    setStatus(`Found match:\n- ${best.candidate} \n- Total time: ${responseData.total_time} s`);
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

    setStatus(errorMessage, true);
    return null;
  }
}

export async function processTermNormalization(value, forward, reverse) {
  const val = (typeof value === 'string' ? value : String(value || "")).trim();
  if (!val) return null;

  // Try cached first
  const cached = getCachedMatch(val, forward, reverse);
  if (cached) return cached;

  // Try research API
  const researched = await findTokenMatch(val);
  if (researched) return researched;

  // Fallback to fuzzy
  return findFuzzyMatch(val, forward, reverse);
}
