import { setView } from "../core/state-actions.js";

/** Shorthand for document.getElementById */
export const $ = id => document.getElementById(id);

export function setupButton(id, onClick) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", onClick);
  return el;
}

export function showView(viewName) {
  const views = ["setup-view", "results-view", "history-view", "settings-view"];
  if (!views.includes(`${viewName}-view`)) return;
  views.forEach((id) => document.getElementById(id)?.classList.toggle("hidden", !id.startsWith(viewName)));
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("ms-Button--primary", tab.getAttribute("data-view") === viewName));
  setView(viewName);
}
