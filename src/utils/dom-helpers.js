/** DOM Helper Utilities */

import { setView } from "../core/state-actions.js";

export function getElement(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[DOM] Element not found: #${id}`);
  return el;
}

export function updateText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
  return !!el;
}

export function updateHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
  return !!el;
}

export function setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("hidden", !visible);
  return !!el;
}

export function setupCheckbox(id, initialValue, onChange) {
  const el = document.getElementById(id);
  if (!el) return console.warn(`[DOM] Checkbox not found: #${id}`), null;
  el.checked = initialValue;
  el.addEventListener("change", () => onChange(el.checked));
  return el;
}

export function setupButton(id, onClick) {
  const el = document.getElementById(id);
  if (!el) return console.warn(`[DOM] Button not found: #${id}`), null;
  el.addEventListener("click", onClick);
  return el;
}

export async function copyToClipboard(text, button, successText = "Copied!", resetMs = 1500) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) { const orig = button.textContent; button.textContent = successText; setTimeout(() => button.textContent = orig, resetMs); }
    return true;
  } catch { return false; }
}

/** Show view and update navigation tabs */
export function showView(viewName) {
  const views = ["setup-view", "results-view", "history-view", "settings-view"];
  if (!views.includes(`${viewName}-view`)) return;

  views.forEach((id) => document.getElementById(id)?.classList.toggle("hidden", !id.startsWith(viewName)));
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("ms-Button--primary", tab.getAttribute("data-view") === viewName));
  setView(viewName);
}
