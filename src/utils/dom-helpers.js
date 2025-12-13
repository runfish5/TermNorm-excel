import { setView } from "../core/state-actions.js";

/** Shorthand for document.getElementById */
export const $ = id => document.getElementById(id);

/** Modal helpers - remove/add hidden class */
export const openModal = id => $(id)?.classList.remove("hidden");
export const closeModal = id => $(id)?.classList.add("hidden");

export function setupButton(id, onClick) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", onClick);
  return el;
}

export function showView(viewName) {
  const views = ["setup-view", "results-view", "history-view", "settings-view"];
  if (!views.includes(`${viewName}-view`)) return;
  views.forEach((id) => document.getElementById(id)?.classList.toggle("hidden", !id.startsWith(viewName)));
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("active", tab.getAttribute("data-view") === viewName));
  setView(viewName);
}

/** Confirmation modal - replaces native confirm() */
export function confirmModal(message, confirmText = "Confirm", cancelText = "Cancel") {
  return new Promise(resolve => {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `<div class="modal-content card card-elevated"><p>${message}</p><div class="form-actions"><button class="btn btn-primary">${confirmText}</button><button class="btn btn-secondary">${cancelText}</button></div></div>`;
    document.body.appendChild(modal);
    const [confirmBtn, cancelBtn] = modal.querySelectorAll("button");
    const cleanup = result => { modal.remove(); resolve(result); };
    confirmBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    modal.onclick = e => { if (e.target === modal) cleanup(false); };
  });
}
