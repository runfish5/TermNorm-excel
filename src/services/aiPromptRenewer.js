import { getHost, getHeaders } from "../utils/serverConfig.js";

let isGenerating = false;
let abortController = null;

export async function renewPrompt(mappings, config, showStatus) {
  if (isGenerating) {
    abortController?.abort();
    return;
  }

  if (!hasMappings(mappings)) {
    showStatus("No mappings available. Load mapping table first.", true);
    return;
  }

  isGenerating = true;
  abortController = new AbortController();
  updateButton(true);

  try {
    showStatus("Generating new prompt...", false);

    const result = await callBackend(mappings);
    if (!result?.final_prompt) throw new Error("No prompt generated");

    config.standardization_prompt ??= [];
    config.standardization_prompt.push(result.final_prompt);

    showStatus("New prompt generated and saved", false);
  } catch (error) {
    const cancelled = error.name === "AbortError" || error.message?.includes("499");
    showStatus(cancelled ? "Generation cancelled" : `Failed: ${error.message}`, !cancelled);
  } finally {
    isGenerating = false;
    abortController = null;
    updateButton(false);
  }
}

async function callBackend(mappings) {
  const serverHost = getHost();
  const headers = getHeaders();

  await fetch(`${serverHost}/test-connection`, { method: "POST" });

  const response = await fetch(`${serverHost}/analyze-patterns`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      dictionary: toStrings(mappings.forward),
      project_name: mappings.metadata?.project_name || "unnamed_project",
      bidirectional: hasBoth(mappings),
      mapping_metadata: getStats(mappings),
    }),
    signal: abortController.signal,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Backend ${response.status}: ${error}`);
  }

  return response.json();
}

function hasMappings(mappings) {
  return Object.keys(mappings.forward || {}).length > 0 || Object.keys(mappings.reverse || {}).length > 0;
}

function hasBoth(mappings) {
  return Object.keys(mappings.forward || {}).length > 0 && Object.keys(mappings.reverse || {}).length > 0;
}

function toStrings(forward = {}) {
  const result = {};
  for (const [key, val] of Object.entries(forward)) {
    result[key] = typeof val === "string" ? val : val?.target || val?.value || String(val);
  }
  return result;
}

function getStats(mappings) {
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

function updateButton(generating) {
  const btn = document.getElementById("renew-prompt");
  if (btn) {
    btn.textContent = generating ? "Cancel Generation🤖" : "Renew Prompt🤖";
    btn.classList.toggle("generating", generating);
  }
}

export function isRenewing() {
  return isGenerating;
}

export function cancel() {
  abortController?.abort();
}
