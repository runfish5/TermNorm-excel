// services/normalizer.router.js
import { findBestMatch } from "./normalizer.fuzzy.js";
import { state } from "../shared-services/state.manager.js";

export class NormalizerRouter {
  constructor(forward, reverse, config) {
    this.forward = forward;
    this.reverse = reverse;
    this.config = config;
    this.recentQueries = new Map(); // Track recent API queries
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
      // Deduplication: check if same query made recently
      const now = Date.now();
      if (this.recentQueries.has(val)) {
        const lastQuery = this.recentQueries.get(val);
        if (now - lastQuery.timestamp < 2000) {
          console.log(`[DEDUPE] Using recent result for: ${val}`);
          return lastQuery.result; // Return cached result
        }
      }

      state.setStatus("Starting mapping process...");

      const serverHost = state.get("server.host") || "http://127.0.0.1:8000";
      const apiKey = state.get("server.apiKey");

      const headers = { "Content-Type": "application/json" };
      if (apiKey) {
        headers["X-API-Key"] = apiKey;
      }

      const response = await fetch(`${serverHost}/research-and-match`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ query: val }),
      });

      if (!response.ok) return null;

      if (response.status === 401) {
        state.setStatus("API key required or invalid", true);
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

      const best = data.data.ranked_candidates[0];
      if (!best) {
        state.setStatus("ranked_candidates has wrong schema or empty", true);
        return null;
      }

      state.setStatus(`Found match:\n- ${best.candidate} \n- Total time: ${data.data.total_time} s`);
      const result = {
        target: best.candidate,
        method: "ProfileRank",
        confidence: best.relevance_score,
        candidates: data.data.ranked_candidates,
        total_time: data.data.total_time,
      };
      
      // Cache the result for deduplication
      this.recentQueries.set(val, { timestamp: now, result });
      return result;
    } catch (error) {
      console.error("Token match error:", error);
      state.setStatus(`Network error during research: ${error.message}`, true);
      return null;
    }
  }
}
