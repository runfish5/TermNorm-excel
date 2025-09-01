// Entry point
import { AppOrchestrator } from "../shared-services/app.orchestrator.js";
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";

// TEST_ITERATION mechanism - change this number to switch HTML files
const TEST_ITERATION = 2; // Change to switch to taskpane2.html, taskpane3.html, etc.

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

  // TEST_ITERATION: Load alternative HTML content if > 1
  if (TEST_ITERATION > 1) {
    console.log(`🔄 TEST_ITERATION=${TEST_ITERATION}, loading taskpane${TEST_ITERATION}.html`);
    try {
      // Try both relative and absolute paths
      const possiblePaths = [
        `./taskpane${TEST_ITERATION}.html`,
        `/taskpane${TEST_ITERATION}.html`,
        `taskpane${TEST_ITERATION}.html`
      ];
      
      for (const path of possiblePaths) {
        try {
          console.log(`📡 Trying path: ${path}`);
          const response = await fetch(path);
          if (response.ok) {
            const htmlContent = await response.text();
            console.log(`✅ Successfully loaded from: ${path}`);
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            
            // Apply styles and replace body
            const styleElements = doc.querySelectorAll('style');
            styleElements.forEach(style => {
              document.head.appendChild(style.cloneNode(true));
            });
            
            const newBody = doc.body;
            if (newBody) {
              document.body.innerHTML = newBody.innerHTML;
              document.body.className = newBody.className;
            }
            
            console.log(`🎉 TEST_ITERATION content loaded successfully!`);
            break;
          } else {
            console.log(`❌ ${path} returned status: ${response.status}`);
          }
        } catch (pathError) {
          console.log(`❌ ${path} failed:`, pathError.message);
        }
      }
    } catch (error) {
      console.error(`💥 TEST_ITERATION failed:`, error);
    }
  }

  ActivityFeed.init();

  // Hide loading, show app
  document.getElementById("sideload-msg").style.display = "none";
  document.getElementById("app-body").style.display = "flex";

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
