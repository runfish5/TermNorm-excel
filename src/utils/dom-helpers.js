export const $ = id => document.getElementById(id);
export const openModal = id => $(id)?.classList.remove("hidden");
export const closeModal = id => $(id)?.classList.add("hidden");
export const setupButton = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); return el; };

export function showView(viewName) {
  const views = ["home-view", "results-view", "history-view"];
  if (!views.includes(`${viewName}-view`)) return;
  views.forEach(id => $(id)?.classList.toggle("hidden", !id.startsWith(viewName)));
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.toggle("active", t.dataset.view === viewName));
}

export const confirmModal = (msg, ok = "Confirm", cancel = "Cancel") => new Promise(resolve => {
  const m = Object.assign(document.createElement("div"), { className: "modal-overlay", innerHTML: `<div class="modal-content card card-elevated"><p>${msg}</p><div class="form-actions"><button class="btn btn-primary">${ok}</button><button class="btn btn-secondary">${cancel}</button></div></div>` });
  document.body.appendChild(m);
  const done = r => { m.remove(); resolve(r); };
  m.querySelectorAll("button")[0].onclick = () => done(true);
  m.querySelectorAll("button")[1].onclick = () => done(false);
  m.onclick = e => e.target === m && done(false);
});

export function setupColumnResize(table) {
  const ths = table.querySelectorAll("th");
  ths.forEach(th => {
    const handle = th.querySelector(".resize-handle");
    if (!handle) return;
    let startX, startWidth;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startX = e.pageX;
      startWidth = th.offsetWidth;
      const onMouseMove = (e) => {
        const newWidth = Math.max(40, startWidth + e.pageX - startX);
        th.style.width = newWidth + "px";
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  });
}
