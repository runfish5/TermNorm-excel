/** Error/Status Display - Unified in main-status-message */
let statusEl = null, dotsInterval = null;

const clearDots = () => { if (dotsInterval) { clearInterval(dotsInterval); dotsInterval = null; } };
const bubbleSide = (side) => `<div class="bubble-loader ${side}"><div class="bubble ${side}"></div><div class="pop-flash ${side}"></div>${[1,2,3,4].map(n => `<div class="quarter quarter-${n} ${side}"></div>`).join('')}</div>`;

export function showMessage(text, type = "info") {
  const el = statusEl || (statusEl = document.getElementById("main-status-message"));
  if (!el) return;
  clearDots();

  if (type === "processing" || type === "waiting" || text.toLowerCase().includes("processing")) {
    const content = type === "waiting" ? '<span class="hourglass-emoji">⏳</span>' : `<div class="bubble-container">${bubbleSide('left')}${bubbleSide('right')}</div>`;
    el.innerHTML = `<div class="loading-container">${content}<span class="loading-message">${text}</span><span class="loading-dots"></span></div>`;
    el.style.color = "";
    const dotsEl = el.querySelector('.loading-dots'), states = ['', '.', '..', '...', '..', '.'];
    let i = 0;
    dotsInterval = setInterval(() => { if (dotsEl) dotsEl.textContent = states[i = (i + 1) % 6]; }, 400);
  } else {
    el.textContent = text;
    el.style.color = type === "error" ? "#F44336" : "";
  }
}
