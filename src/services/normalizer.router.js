// services/normalizer.router.js
import { findBestMatch } from "./normalizer.fuzzy.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { state } from "../shared-services/state.manager.js";

export class NormalizerRouter {
  constructor(forward, reverse, config) {
    this.forward = forward;
    this.reverse = reverse;
    this.config = config;
  }

  async process(value) {
    const val = String(value || "").trim();
    if (!val) return null;

    // Try cached first
    const cached = this.getCached(val);
    if (cached) return cached;

    // Try research API
    const researched = await this.findTokenMatch(val);
    if (researched) return researched;

    // Fallback to fuzzy
    return this.findFuzzy(val);
  }

  getCached(val) {
    if (val in this.forward) {
      const mapping = this.forward[val];
      return {
        target: typeof mapping === "string" ? mapping : mapping.target,
        method: "cached",
        confidence: 1.0,
      };
    }
    return val in this.reverse ? { target: val, method: "cached", confidence: 1.0 } : null;
  }

  findFuzzy(val) {
    const fwd = findBestMatch(val, this.forward, 0.7);
    if (fwd) {
      return {
        target: typeof fwd.value === "string" ? fwd.value : fwd.value.target,
        method: "fuzzy",
        confidence: fwd.score,
      };
    }

    const rev = findBestMatch(val, this.reverse, 0.5);
    return rev ? { target: rev.key, method: "fuzzy", confidence: rev.score } : null;
  }

  async findTokenMatch(val) {
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

      // Simplify data access by extracting the nested data object
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
}
