export const ActivityFeed = {
  container: null,
  tableBody: null,
  maxEntries: 50,

  init(containerId = "activity-feed") {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`ActivityFeed: Container '${containerId}' not found - will try lazy init`);
      return false;
    }

    this.container.innerHTML = `
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

    this.tableBody = this.container?.querySelector("tbody");

    const clearBtn = document.getElementById("clear-activity");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => this.clear());
    }

    this.showPlaceholder();
    return true;
  },

  add(source, target, method, confidence) {
    if (!this.tableBody) {
      const initSuccess = this.init();
      if (!initSuccess || !this.tableBody) {
        console.warn("ActivityFeed: Cannot initialize - skipping add");
        return;
      }
    }

    try {
      const placeholder = this.tableBody?.querySelector(".placeholder-row");
      if (placeholder) placeholder.remove();

      const row = document.createElement("tr");
      row.className = `activity-row ${method}`;
      row.innerHTML = `
              <td class="time">${new Date().toLocaleTimeString()}</td>
              <td class="source">${source || "-"}</td>
              <td class="target">${target || "-"}</td>
              <td class="method">${method ? method.toUpperCase() : "-"}</td>
              <td class="confidence">${method !== "error" && confidence ? Math.round(confidence * 100) + "%" : "-"}</td>
          `;

      if (this.tableBody) {
        this.tableBody.insertBefore(row, this.tableBody.firstChild);

        const rows = this.tableBody.querySelectorAll(".activity-row");
        if (rows.length > this.maxEntries) {
          rows[rows.length - 1].remove();
        }
      }

    } catch (error) {
      console.error("ActivityFeed.add() error:", error);
    }
  },

  clear() {
    if (!this.tableBody) return;
    this.tableBody.innerHTML = "";
    this.showPlaceholder();
  },

  showPlaceholder() {
    if (!this.tableBody) return;
    if (!this.tableBody.querySelector(".activity-row")) {
      this.tableBody.innerHTML =
        '<tr class="placeholder-row"><td colspan="5">No activity yet. Start tracking to see live mappings.</td></tr>';
    }
  },
};
