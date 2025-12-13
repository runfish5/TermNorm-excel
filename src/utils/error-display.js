/** Error/Status Display with Loading Indicator */
let loadingIndicator = null, dotsInterval = null;

const clearDots = () => { if (dotsInterval) { clearInterval(dotsInterval); dotsInterval = null; } };

const bubbleSide = (side) => `<div class="bubble-loader ${side}"><div class="bubble ${side}"></div><div class="pop-flash ${side}"></div>${[1,2,3,4].map(n => `<div class="quarter quarter-${n} ${side}"></div>`).join('')}</div>`;

function showLoadingIndicator(message = "Working", type = "processing") {
  const indicator = loadingIndicator || (loadingIndicator = document.getElementById("loading-indicator"));
  if (!indicator) return;
  clearDots();
  const content = type === "waiting" ? '<span class="hourglass-emoji">⏳</span>' : `<div class="bubble-container">${bubbleSide('left')}${bubbleSide('right')}</div>`;
  indicator.innerHTML = `<div class="loading-container">${content}<span class="loading-message">${message}</span><span class="loading-dots"></span></div>`;
  const dotsEl = indicator.querySelector('.loading-dots'), states = ['', '.', '..', '...', '..', '.'];
  let i = 0;
  dotsInterval = setInterval(() => { if (dotsEl) dotsEl.textContent = states[i = (i + 1) % 6]; }, 400);
  indicator.classList.add("visible");
}

function hideLoadingIndicator() {
  clearDots();
  const indicator = loadingIndicator || (loadingIndicator = document.getElementById("loading-indicator"));
  if (!indicator) return;
  indicator.classList.remove("visible");
  setTimeout(() => { if (!indicator.classList.contains("visible")) indicator.innerHTML = ""; }, 300);
}

export function showMessage(text, type = "info") {
  if (type === "processing" || type === "waiting" || text.toLowerCase().includes("processing")) {
    showLoadingIndicator(text, type === "waiting" ? "waiting" : "processing");
    return;
  }
  hideLoadingIndicator();
  const el = document.getElementById("main-status-message");
  if (el) { el.textContent = text; el.style.color = type === "error" ? "#F44336" : ""; }
}
