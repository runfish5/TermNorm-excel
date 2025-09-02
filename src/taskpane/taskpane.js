// Entry point
import { AppOrchestrator } from "../shared-services/app.orchestrator.js";
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";

// Simple theme system
const theme = localStorage.getItem('theme') || 'default';

// Function to update content margin based on status bar height
function updateContentMargin() {
  const statusBar = document.querySelector('.status-bar');
  if (statusBar) {
    const statusBarHeight = statusBar.offsetHeight;
    document.documentElement.style.setProperty('--status-bar-height', `${statusBarHeight}px`);
  }
}

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    document.getElementById("sideload-msg").textContent = "This add-in requires Microsoft Excel";
    return;
  }

  // Apply theme
  document.body.className = `ms-font-m ms-welcome ms-Fabric theme-${theme}`;

  ActivityFeed.init();

  // Hide loading, show app
  document.getElementById("sideload-msg").style.display = "none";
  document.getElementById("app-body").style.display = "flex";

  // Set up theme selector
  const themeSelector = document.getElementById('theme-selector');
  if (themeSelector) {
    themeSelector.value = theme;
    themeSelector.onchange = (e) => {
      localStorage.setItem('theme', e.target.value);
      location.reload();
    };
  }

  try {
    const app = new AppOrchestrator();
    await app.init();
    window.app = app; // For debugging
    
    // Initial margin update
    updateContentMargin();
    
    // Update margin when status content changes
    const observer = new MutationObserver(updateContentMargin);
    const statusMessage = document.getElementById('main-status-message');
    if (statusMessage) {
      observer.observe(statusMessage, { 
        childList: true, 
        subtree: true, 
        characterData: true 
      });
    }
    
    // Update margin on window resize
    window.addEventListener('resize', updateContentMargin);
    
  } catch (error) {
    console.error("Failed to initialize:", error);
    alert(`Initialization failed: ${error.message}`);
  }
});
