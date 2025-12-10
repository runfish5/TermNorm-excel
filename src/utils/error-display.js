/** Error/Status Display with Loading Indicator */

let loadingIndicator = null;
let dotsInterval = null;

function getLoadingIndicator() {
  if (!loadingIndicator) loadingIndicator = document.getElementById("loading-indicator");
  return loadingIndicator;
}

function showLoadingIndicator(message = "Working", animationType = "processing") {
  const indicator = getLoadingIndicator();
  if (!indicator) return;

  // Clear any existing dots interval
  if (dotsInterval) {
    clearInterval(dotsInterval);
    dotsInterval = null;
  }

  if (animationType === "waiting") {
    // Hourglass for user-waiting scenarios
    indicator.innerHTML = `
      <div class="loading-container">
        <span class="hourglass-emoji">⏳</span>
        <span class="loading-message">${message}</span>
        <span class="loading-dots"></span>
      </div>`;
  } else {
    // Bubbles for system processing (default)
    indicator.innerHTML = `
      <div class="loading-container">
        <div class="bubble-container">
          <div class="bubble-loader left">
            <div class="bubble left"></div>
            <div class="pop-flash left"></div>
            <div class="quarter left"></div>
            <div class="quarter left"></div>
            <div class="quarter left"></div>
            <div class="quarter left"></div>
          </div>
          <div class="bubble-loader right">
            <div class="bubble right"></div>
            <div class="pop-flash right"></div>
            <div class="quarter right"></div>
            <div class="quarter right"></div>
            <div class="quarter right"></div>
            <div class="quarter right"></div>
          </div>
        </div>
        <span class="loading-message">${message}</span>
        <span class="loading-dots"></span>
      </div>`;
  }

  // Start cycling dots animation
  const dotsEl = indicator.querySelector('.loading-dots');
  const dotStates = ['', '.', '..', '...', '..', '.'];
  let dotIndex = 0;
  dotsInterval = setInterval(() => {
    dotIndex = (dotIndex + 1) % dotStates.length;
    if (dotsEl) dotsEl.textContent = dotStates[dotIndex];
  }, 400);

  indicator.classList.add("visible");
}

function hideLoadingIndicator() {
  if (dotsInterval) {
    clearInterval(dotsInterval);
    dotsInterval = null;
  }
  const indicator = getLoadingIndicator();
  if (!indicator) return;
  indicator.classList.remove("visible");
  setTimeout(() => { if (!indicator.classList.contains("visible")) indicator.innerHTML = ""; }, 300);
}

export function showMessage(text, type = "info") {
  if (type === "processing" || text.toLowerCase().includes("processing")) {
    showLoadingIndicator(text, "processing");
    return;
  }

  if (type === "waiting") {
    showLoadingIndicator(text, "waiting");
    return;
  }

  hideLoadingIndicator();

  const el = document.getElementById("main-status-message");
  if (!el) return;
  el.textContent = text;
  el.style.color = type === "error" ? "#F44336" : "";
}
