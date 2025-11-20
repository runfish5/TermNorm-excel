let container = null;
let tableBody = null;
const maxEntries = 50;
// Activity data model - queryable storage
const activities = [];

export function init(containerId = "activity-feed") {
  container = document.getElementById(containerId);
  if (!container) {
    console.warn(`ActivityFeed: Container '${containerId}' not found - will try lazy init`);
    return false;
  }

  container.innerHTML = `
            <table class="activity-table">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Source</th>
                        <th>Target</th>
                        <th>Method</th>
                        <th>Confidence</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        `;

  tableBody = container?.querySelector("tbody");

  const clearBtn = document.getElementById("clear-activity");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => clear());
  }

  showPlaceholder();
  return true;
}

export function add(source, result) {
  if (!tableBody) {
    const initSuccess = init();
    if (!initSuccess || !tableBody) {
      console.warn("ActivityFeed: Cannot initialize - skipping add");
      return;
    }
  }

  try {
    // Store activity in data model
    activities.unshift({ source, result });

    // Keep only last maxEntries
    if (activities.length > maxEntries) {
      activities.pop();
    }

    // Re-render from data
    renderActivities();
    updateHistoryTabCounter();
  } catch (error) {
    console.error("ActivityFeed.add() error:", error);
  }
}

function renderActivities() {
  if (!tableBody) return;

  const placeholder = tableBody?.querySelector(".placeholder-row");
  if (placeholder) placeholder.remove();

  // Clear and rebuild
  tableBody.innerHTML = '';

  activities.forEach(({ source, result }) => {
    const { target, method, confidence, web_search_status, timestamp } = result;

    // Build method display text with web search status indicator
    let methodText = method ? method.toUpperCase() : "-";
    if (web_search_status === "failed" && method === "ProfileRank") {
      methodText = `⚠️ ${methodText} (web scrape ∅)`;
    }

    // Use provided timestamp or generate new one
    const displayTime = timestamp
      ? new Date(timestamp).toLocaleTimeString()
      : new Date().toLocaleTimeString();

    const row = document.createElement("tr");
    row.className = `activity-row ${method}`;
    row.innerHTML = `
      <td class="time">${displayTime}</td>
      <td class="source">${source || "-"}</td>
      <td class="target">${target || "-"}</td>
      <td class="method">${methodText}</td>
      <td class="confidence">${method !== "error" && confidence ? Math.round(confidence * 100) + "%" : "-"}</td>
    `;

    tableBody.appendChild(row);
  });
}

export function clear() {
  if (!tableBody) return;
  activities.length = 0; // Clear data array
  tableBody.innerHTML = "";
  showPlaceholder();
  updateHistoryTabCounter();
}

function showPlaceholder() {
  if (!tableBody) return;
  if (!tableBody.querySelector(".activity-row")) {
    tableBody.innerHTML =
      '<tr class="placeholder-row"><td colspan="5">No activity yet. Start tracking to see live mappings.</td></tr>';
  }
}

export function updateHistoryTabCounter() {
  const historyTab = document.getElementById("history-tab");
  if (historyTab && tableBody) {
    const activityRows = tableBody.querySelectorAll(".activity-row");
    const count = activityRows.length;
    const tabIcon = historyTab.querySelector(".tab-icon");
    if (tabIcon) {
      tabIcon.textContent = `${count}📜`;
    }
  }
}

export function getCount() {
  return activities.length;
}

// Export data accessor functions
export function getActivities() {
  return activities;
}

export function getActivityByIndex(index) {
  return activities[index];
}

export function findActivitiesBySource(source) {
  return activities.filter(a => a.source === source);
}

export function findActivitiesByTarget(target) {
  return activities.filter(a => a.result.target === target);
}
