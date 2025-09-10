let container = null;
let tableBody = null;
const maxEntries = 50;

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

export function add(source, target, method, confidence) {
  if (!tableBody) {
    const initSuccess = init();
    if (!initSuccess || !tableBody) {
      console.warn("ActivityFeed: Cannot initialize - skipping add");
      return;
    }
  }

  try {
    const placeholder = tableBody?.querySelector(".placeholder-row");
    if (placeholder) placeholder.remove();

    const row = document.createElement("tr");
    row.className = `activity-row ${method}`;
    row.innerHTML = `
              <td class="time">${new Date().toLocaleTimeString()}</td>
              <td class="source">${(source || "-").toString().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
              <td class="target">${(target || "-").toString().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
              <td class="method">${method ? method.toUpperCase() : "-"}</td>
              <td class="confidence">${method !== "error" && confidence ? Math.round(confidence * 100) + "%" : "-"}</td>
          `;

    if (tableBody) {
      tableBody.insertBefore(row, tableBody.firstChild);

      const rows = tableBody.querySelectorAll(".activity-row");
      if (rows.length > maxEntries) {
        rows[rows.length - 1].remove();
      }
    }

    updateHistoryTabCounter();
  } catch (error) {
    console.error("ActivityFeed.add() error:", error);
  }
}

export function clear() {
  if (!tableBody) return;
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
  if (!tableBody) return 0;
  return tableBody.querySelectorAll(".activity-row").length;
}
