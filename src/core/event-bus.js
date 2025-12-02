/**
 * Event Bus - Central event dispatcher for decoupled communication
 *
 * Enables services to emit events without knowing about UI components,
 * and UI components to listen for events without importing services directly.
 *
 * This eliminates circular dependencies and service → UI imports.
 */

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * Register an event listener
   * @param {string} event - Event name
   * @param {Function} handler - Callback function
   * @returns {Function} Unsubscribe function
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    this.listeners.get(event).push(handler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Unregister an event listener
   * @param {string} event - Event name
   * @param {Function} handler - Callback function to remove
   */
  off(event, handler) {
    if (!this.listeners.has(event)) return;

    const handlers = this.listeners.get(event);
    const index = handlers.indexOf(handler);

    if (index > -1) {
      handlers.splice(index, 1);
    }

    // Clean up empty listener arrays
    if (handlers.length === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * Emit an event to all registered listeners
   * @param {string} event - Event name
   * @param {*} payload - Data to pass to listeners
   */
  emit(event, payload) {
    if (!this.listeners.has(event)) return;

    const handlers = this.listeners.get(event);

    // Call handlers in registration order
    handlers.forEach(handler => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`Error in event handler for '${event}':`, error);
      }
    });
  }

  /**
   * Emit an event asynchronously
   * @param {string} event - Event name
   * @param {*} payload - Data to pass to listeners
   * @returns {Promise<void>}
   */
  async emitAsync(event, payload) {
    if (!this.listeners.has(event)) return;

    const handlers = this.listeners.get(event);

    // Call handlers sequentially
    for (const handler of handlers) {
      try {
        await handler(payload);
      } catch (error) {
        console.error(`Error in async event handler for '${event}':`, error);
      }
    }
  }

  /**
   * Remove all listeners for an event, or all events if no event specified
   * @param {string} [event] - Optional event name
   */
  clear(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get count of listeners for an event
   * @param {string} event - Event name
   * @returns {number}
   */
  listenerCount(event) {
    return this.listeners.has(event) ? this.listeners.get(event).length : 0;
  }

  /**
   * Check if an event has any listeners
   * @param {string} event - Event name
   * @returns {boolean}
   */
  hasListeners(event) {
    return this.listenerCount(event) > 0;
  }
}

// Singleton instance
const eventBus = new EventBus();

export { eventBus, EventBus };
