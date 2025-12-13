/**
 * Event Bus - Pub/sub for decoupled communication.
 *
 * Use for UI reacting to state changes and cross-component coordination.
 * Events are emitted from state-actions.js and workflows.js, subscribed in UI components.
 */

class EventBus {
  constructor() { this.listeners = new Map(); }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (!this.listeners.has(event)) return;
    const handlers = this.listeners.get(event);
    const index = handlers.indexOf(handler);
    if (index > -1) handlers.splice(index, 1);
    if (!handlers.length) this.listeners.delete(event);
  }

  emit(event, payload) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(h => { try { h(payload); } catch (e) { console.error(`Error in '${event}':`, e); } });
  }

  async emitAsync(event, payload) {
    if (!this.listeners.has(event)) return;
    for (const h of this.listeners.get(event)) { try { await h(payload); } catch (e) { console.error(`Error in async '${event}':`, e); } }
  }

  clear(event) { event ? this.listeners.delete(event) : this.listeners.clear(); }
  listenerCount(event) { return this.listeners.get(event)?.length || 0; }
  hasListeners(event) { return this.listenerCount(event) > 0; }
}

const eventBus = new EventBus();

// EventBus exported for testing only
export { eventBus, EventBus };
