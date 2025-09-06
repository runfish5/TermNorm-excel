// ui-components/view-manager.js
// Simple view switching functionality

import { state } from "../shared-services/state.manager.js";

// Simple view switching
export function showView(viewName) {
  const views = ["setup-view", "results-view", "history-view", "settings-view"];
  const viewElement = `${viewName}-view`;

  if (!views.includes(viewElement)) return;

  // Hide all views and show selected
  views.forEach((id) => document.getElementById(id)?.classList.toggle("hidden", !id.startsWith(viewName)));

  // Update tab states
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    const isActive = tab.getAttribute("data-view") === viewName;
    tab.classList.toggle("ms-Button--primary", isActive);
  });

  // Update state
  state.set("ui.currentView", viewName);
}