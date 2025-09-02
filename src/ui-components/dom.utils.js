// ui-components/dom.utils.js

export class DOMUtils {
  constructor() {
    this.elementCache = new Map();
  }

  // Cached element retrieval
  getElement(id) {
    if (!this.elementCache.has(id)) {
      const element = document.getElementById(id);
      if (element) {
        this.elementCache.set(id, element);
      }
    }
    return this.elementCache.get(id) || null;
  }

  // Clear cache for specific element or all elements
  clearCache(id = null) {
    if (id) {
      this.elementCache.delete(id);
    } else {
      this.elementCache.clear();
    }
  }

  // Update element text content
  updateElementText(id, text) {
    const element = this.getElement(id);
    if (element) {
      element.textContent = text;
      return true;
    }
    return false;
  }

  // Toggle element visibility
  toggleElementVisibility(id, force = undefined) {
    const element = this.getElement(id);
    if (element) {
      return element.classList.toggle("hidden", force);
    }
    return false;
  }

  // Show/hide element
  showElement(id) {
    return this.toggleElementVisibility(id, false);
  }

  hideElement(id) {
    return this.toggleElementVisibility(id, true);
  }

  // Add/remove CSS classes
  addClass(id, className) {
    const element = this.getElement(id);
    if (element) {
      element.classList.add(className);
      return true;
    }
    return false;
  }

  removeClass(id, className) {
    const element = this.getElement(id);
    if (element) {
      element.classList.remove(className);
      return true;
    }
    return false;
  }

  toggleClass(id, className, force = undefined) {
    const element = this.getElement(id);
    if (element) {
      return element.classList.toggle(className, force);
    }
    return false;
  }

  // Set element attributes
  setAttribute(id, attribute, value) {
    const element = this.getElement(id);
    if (element) {
      element.setAttribute(attribute, value);
      return true;
    }
    return false;
  }

  // Get element attribute
  getAttribute(id, attribute) {
    const element = this.getElement(id);
    return element ? element.getAttribute(attribute) : null;
  }

  // Set element styles
  setStyle(id, property, value) {
    const element = this.getElement(id);
    if (element) {
      element.style[property] = value;
      return true;
    }
    return false;
  }

  // Set multiple styles at once
  setStyles(id, styles) {
    const element = this.getElement(id);
    if (element && typeof styles === 'object') {
      Object.entries(styles).forEach(([property, value]) => {
        element.style[property] = value;
      });
      return true;
    }
    return false;
  }

  // Create element with options
  createElement(tag, options = {}) {
    const element = document.createElement(tag);
    
    if (options.id) element.id = options.id;
    if (options.className) element.className = options.className;
    if (options.textContent) element.textContent = options.textContent;
    if (options.innerHTML) element.innerHTML = options.innerHTML;
    
    if (options.attributes) {
      Object.entries(options.attributes).forEach(([attr, value]) => {
        element.setAttribute(attr, value);
      });
    }
    
    if (options.styles) {
      Object.entries(options.styles).forEach(([prop, value]) => {
        element.style[prop] = value;
      });
    }

    return element;
  }

  // Query selectors with caching
  queryAll(selector, useCache = false) {
    if (useCache && this.elementCache.has(selector)) {
      return this.elementCache.get(selector);
    }

    const elements = document.querySelectorAll(selector);
    
    if (useCache) {
      this.elementCache.set(selector, elements);
    }

    return elements;
  }

  // Event delegation helper
  delegate(selector, eventType, handler) {
    document.addEventListener(eventType, (e) => {
      const target = e.target.closest(selector);
      if (target) {
        handler.call(target, e);
      }
    });
  }

  // Wait for element to exist
  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Timeout fallback
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }
}

// Export a singleton instance
export const domUtils = new DOMUtils();