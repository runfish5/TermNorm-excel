// ui-components/navigation.manager.js
import { state } from "../shared-services/state.manager.js";

export class NavigationManager {
  constructor() {
    this.currentView = "setup";
    this.views = ["setup-view", "results-view", "history-view", "settings-view"];
  }

  init() {
    this.setupEventListeners();
    this.showView(this.currentView);
  }

  setupEventListeners() {
    // Handle navigation tab clicks
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('.nav-tab');
      if (tab) {
        e.preventDefault();
        const viewName = tab.getAttribute('data-view');
        this.showView(viewName);
      }
    });
  }

  showView(viewName) {
    // Validate view name
    const viewElement = `${viewName}-view`;
    if (!this.views.includes(viewElement)) {
      console.warn(`Invalid view: ${viewName}`);
      return;
    }

    this.currentView = viewName;

    // Hide all views and show the selected one
    this.views.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.classList.toggle("hidden", !id.startsWith(viewName));
      }
    });

    // Update tab active states
    document.querySelectorAll('.nav-tab').forEach(tab => {
      const isActive = tab.getAttribute('data-view') === viewName;
      tab.classList.toggle('ms-Button--primary', isActive);
    });

    // Update global state
    state.setView(viewName);

    // Emit navigation event for other components
    this.emit('viewChanged', { view: viewName, previousView: this.currentView });
  }

  getCurrentView() {
    return this.currentView;
  }

  // Simple event emitter
  emit(eventName, data) {
    const event = new CustomEvent(`navigation:${eventName}`, { 
      detail: data,
      bubbles: true 
    });
    document.dispatchEvent(event);
  }

  // Listen for navigation events
  on(eventName, callback) {
    document.addEventListener(`navigation:${eventName}`, callback);
  }
}