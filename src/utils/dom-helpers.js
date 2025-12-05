/**
 * DOM Helper Utilities
 *
 * Consolidated DOM manipulation patterns to reduce code duplication.
 */

/**
 * Safely get an element by ID, logging a warning if not found
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
export function getElement(id) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[DOM] Element not found: #${id}`);
  }
  return el;
}

/**
 * Safely update element text content
 * @param {string} id - Element ID
 * @param {string} text - Text content to set
 * @returns {boolean} - True if element was found and updated
 */
export function updateText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    return true;
  }
  return false;
}

/**
 * Safely update element innerHTML
 * @param {string} id - Element ID
 * @param {string} html - HTML content to set
 * @returns {boolean} - True if element was found and updated
 */
export function updateHTML(id, html) {
  const el = document.getElementById(id);
  if (el) {
    el.innerHTML = html;
    return true;
  }
  return false;
}

/**
 * Toggle visibility using the 'hidden' class
 * @param {string} id - Element ID
 * @param {boolean} visible - Whether element should be visible
 * @returns {boolean} - True if element was found and updated
 */
export function setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.toggle("hidden", !visible);
    return true;
  }
  return false;
}

/**
 * Setup a checkbox that syncs with state and calls a handler on change
 * @param {string} id - Checkbox element ID
 * @param {boolean} initialValue - Initial checked state
 * @param {Function} onChange - Callback when checkbox changes (receives new value)
 * @returns {HTMLInputElement|null} - The checkbox element
 */
export function setupCheckbox(id, initialValue, onChange) {
  const checkbox = document.getElementById(id);
  if (!checkbox) {
    console.warn(`[DOM] Checkbox not found: #${id}`);
    return null;
  }

  checkbox.checked = initialValue;
  checkbox.addEventListener("change", () => {
    onChange(checkbox.checked);
  });

  return checkbox;
}

/**
 * Setup a button with a click handler
 * @param {string} id - Button element ID
 * @param {Function} onClick - Click handler
 * @returns {HTMLButtonElement|null} - The button element
 */
export function setupButton(id, onClick) {
  const button = document.getElementById(id);
  if (!button) {
    console.warn(`[DOM] Button not found: #${id}`);
    return null;
  }

  button.addEventListener("click", onClick);
  return button;
}

/**
 * Copy text to clipboard and optionally update button text for feedback
 * @param {string} text - Text to copy
 * @param {HTMLElement} [button] - Optional button to show feedback
 * @param {string} [successText="Copied!"] - Text to show on success
 * @param {number} [resetMs=1500] - Time before resetting button text
 */
export async function copyToClipboard(text, button, successText = "Copied!", resetMs = 1500) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const originalText = button.textContent;
      button.textContent = successText;
      setTimeout(() => {
        button.textContent = originalText;
      }, resetMs);
    }
    return true;
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
    return false;
  }
}
