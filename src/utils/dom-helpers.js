/** DOM Helper Utilities - Consolidated DOM manipulation patterns */

/** Safely get element by ID */
export function getElement(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[DOM] Element not found: #${id}`);
  return el;
}

/** Safely update element text content */
export function updateText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
  return !!el;
}

/** Safely update element innerHTML */
export function updateHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
  return !!el;
}

/** Toggle visibility using 'hidden' class */
export function setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("hidden", !visible);
  return !!el;
}

/** Setup checkbox with initial value and change handler */
export function setupCheckbox(id, initialValue, onChange) {
  const el = document.getElementById(id);
  if (!el) return console.warn(`[DOM] Checkbox not found: #${id}`), null;
  el.checked = initialValue;
  el.addEventListener("change", () => onChange(el.checked));
  return el;
}

/** Setup button with click handler */
export function setupButton(id, onClick) {
  const el = document.getElementById(id);
  if (!el) return console.warn(`[DOM] Button not found: #${id}`), null;
  el.addEventListener("click", onClick);
  return el;
}

/** Copy text to clipboard with optional button feedback */
export async function copyToClipboard(text, button, successText = "Copied!", resetMs = 1500) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const orig = button.textContent;
      button.textContent = successText;
      setTimeout(() => button.textContent = orig, resetMs);
    }
    return true;
  } catch {
    return false;
  }
}
