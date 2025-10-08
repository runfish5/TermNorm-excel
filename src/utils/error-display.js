export function showMessage(text, type = "info") {
  const el = document.getElementById("main-status-message");
  if (!el) return;

  el.textContent = text;
  el.style.color = type === "error" ? "#F44336" : "";
}
