// Entry point
import { AppOrchestrator } from '../shared-services/app.orchestrator.js';
import { ActivityFeed } from '../ui-components/ActivityFeedUI.js';

/* global document, Office */

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    document.getElementById("sideload-msg").textContent = "This add-in requires Microsoft Excel";
    return;
  }
  
  // Detect if running in Excel Online/Web
  const isExcelOnline = info.platform === Office.PlatformType.OfficeOnline;
  if (isExcelOnline) {
    document.getElementById("cloud-indicator").classList.remove("hidden");
    document.getElementById("onedrive-url-section").classList.remove("hidden");
  }
  
  ActivityFeed.init();

  // Hide loading, show app
  document.getElementById("sideload-msg").style.display = "none";
  document.getElementById("app-body").style.display = "flex";
  
  try {
    const app = new AppOrchestrator();
    await app.init();
    window.app = app; // For debugging
  } catch (error) {
    console.error('Failed to initialize:', error);
    alert(`Initialization failed: ${error.message}`);
  }
});