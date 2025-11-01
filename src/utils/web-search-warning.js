/**
 * Web Search Warning Indicator
 * Shows persistent warning when web scraping fails
 * Only clears on next successful search
 */

export function updateWebSearchWarning(status, error) {
  const warning = document.getElementById("web-search-warning");
  if (!warning) return;

  if (status === "failed") {
    warning.classList.remove("hidden");
    warning.title = `Web scraping failed: ${error || 'Unknown error'}`;
  } else if (status === "success") {
    warning.classList.add("hidden");
  }
}
