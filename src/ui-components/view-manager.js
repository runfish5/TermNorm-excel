import { state } from "../shared-services/state.manager.js";
export function showView(viewName) {
  const views = ["setup-view", "results-view", "history-view", "settings-view"];
  const viewElement = `${viewName}-view`;

  if (!views.includes(viewElement)) return;

  views.forEach((id) => document.getElementById(id)?.classList.toggle("hidden", !id.startsWith(viewName)));

  document.querySelectorAll(".nav-tab").forEach((tab) => {
    const isActive = tab.getAttribute("data-view") === viewName;
    tab.classList.toggle("ms-Button--primary", isActive);
  });
  state.ui.currentView = viewName;
}