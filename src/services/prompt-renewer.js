import { getHost, getHeaders } from "../utils/api-fetch.js";
import { serverFetch } from "../utils/api-fetch.js";

let isGenerating = false, abortController = null;

export async function renewPrompt(mappings, config, showStatus) {
  if (isGenerating) { abortController?.abort(); return; }

  const fwdKeys = Object.keys(mappings?.forward || {}), revKeys = Object.keys(mappings?.reverse || {});
  if (!fwdKeys.length && !revKeys.length) return showStatus("No mappings available. Load mapping table first.", true);

  isGenerating = true;
  abortController = new AbortController();
  updateButton(true);

  try {
    showStatus("Generating new prompt...", false);

    const forward = Object.fromEntries(Object.entries(mappings?.forward || {}).map(([k, v]) => [k, typeof v === "string" ? v : v?.target || v?.value || String(v)]));
    const entries = Object.entries(mappings?.forward || {});
    const methods = {}, confidences = [];
    entries.forEach(([, v]) => { const d = typeof v === "string" ? { method: "legacy", confidence: 1 } : v; methods[d.method] = (methods[d.method] || 0) + 1; confidences.push(d.confidence || 1); });

    const response = await serverFetch(`${getHost()}/analyze-patterns`, {
      method: "POST", headers: getHeaders(), signal: abortController.signal,
      body: JSON.stringify({
        dictionary: forward, project_name: mappings?.metadata?.project_name || "unnamed_project",
        bidirectional: fwdKeys.length > 0 && revKeys.length > 0,
        mapping_metadata: { methods, confidence_stats: confidences.length ? { min: Math.min(...confidences), max: Math.max(...confidences), avg: confidences.reduce((a, b) => a + b) / confidences.length } : { min: 1, max: 0, avg: 0 }, total_mappings: entries.length },
      }),
    });

    if (!response.ok) throw new Error(`Backend ${response.status}: ${await response.text()}`);
    const result = await response.json();
    if (!result?.final_prompt) throw new Error("No prompt generated");

    config.standardization_prompt ??= [];
    config.standardization_prompt.push(result.final_prompt);
    showStatus("New prompt generated and saved", false);
  } catch (error) {
    const cancelled = error.name === "AbortError" || error.message?.includes("499");
    showStatus(cancelled ? "Generation cancelled" : `Failed: ${error.message}`, !cancelled);
  } finally { isGenerating = false; abortController = null; updateButton(false); }
}

function updateButton(generating) {
  const btn = document.getElementById("renew-prompt");
  if (btn) { btn.textContent = generating ? "Cancel Generation🤖" : "Renew Prompt🤖"; btn.classList.toggle("generating", generating); }
}
