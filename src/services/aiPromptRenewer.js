// ./services/aiPromptRenewer.js
import { getHost, getHeaders } from "../utils/serverConfig.js";

export class aiPromptRenewer {
  constructor(showStatus) {
    this.showStatus = showStatus;
    this.isGenerating = false;
    this.abortController = null;
  }

  async renewPrompt(mappings, config, statusId = "prompt-status") {
    if (this.isGenerating) {
      this.abortController?.abort();
      return;
    }

    if (!this._hasMappings(mappings)) {
      this.showStatus("No mappings available. Load mapping table first.", true, statusId);
      return;
    }

    this.isGenerating = true;
    this.abortController = new AbortController();
    this._updateButton(true);

    try {
      this.showStatus("Generating new prompt...", false, statusId);

      const result = await this._callBackend(mappings);
      if (!result?.final_prompt) throw new Error("No prompt generated");

      config.standardization_prompt ??= [];
      config.standardization_prompt.push(result.final_prompt);

      this.showStatus("New prompt generated and saved", false, statusId);
    } catch (error) {
      const cancelled = error.name === "AbortError" || error.message?.includes("499");
      this.showStatus(cancelled ? "Generation cancelled" : `Failed: ${error.message}`, !cancelled, statusId);
    } finally {
      this.isGenerating = false;
      this.abortController = null;
      this._updateButton(false);
    }
  }

  async _callBackend(mappings) {
    const serverHost = getHost();
    const headers = getHeaders();

    await fetch(`${serverHost}/test-connection`, { method: "POST" });

    const response = await fetch(`${serverHost}/analyze-patterns`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        dictionary: this._toStrings(mappings.forward),
        project_name: mappings.metadata?.project_name || "unnamed_project",
        bidirectional: this._hasBoth(mappings),
        mapping_metadata: this._getStats(mappings),
      }),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Backend ${response.status}: ${error}`);
    }

    return response.json();
  }

  _hasMappings(mappings) {
    return Object.keys(mappings.forward || {}).length > 0 || Object.keys(mappings.reverse || {}).length > 0;
  }

  _hasBoth(mappings) {
    return Object.keys(mappings.forward || {}).length > 0 && Object.keys(mappings.reverse || {}).length > 0;
  }

  _toStrings(forward = {}) {
    const result = {};
    for (const [key, val] of Object.entries(forward)) {
      result[key] = typeof val === "string" ? val : val?.target || val?.value || String(val);
    }
    return result;
  }

  _getStats(mappings) {
    const entries = Object.entries(mappings.forward || {});
    if (!entries.length) return { methods: {}, confidence_stats: { min: 1, max: 0, avg: 0 }, total_mappings: 0 };

    const methods = {};
    const confidences = [];

    entries.forEach(([, val]) => {
      const data = typeof val === "string" ? { method: "legacy", confidence: 1.0 } : val;
      methods[data.method] = (methods[data.method] || 0) + 1;
      confidences.push(data.confidence || 1.0);
    });

    return {
      methods,
      confidence_stats: {
        min: Math.min(...confidences),
        max: Math.max(...confidences),
        avg: confidences.reduce((a, b) => a + b) / confidences.length,
      },
      total_mappings: entries.length,
    };
  }

  _updateButton(generating) {
    const btn = document.getElementById("renew-prompt");
    if (btn) {
      btn.textContent = generating ? "Cancel Generation🤖" : "Renew Prompt🤖";
      btn.classList.toggle("generating", generating);
    }
  }

  isRenewing() {
    return this.isGenerating;
  }
  cancel() {
    this.abortController?.abort();
  }
}
