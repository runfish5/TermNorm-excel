/** Event Log - Manages chronological processing events */
import { EVENT_LOG } from "../config/normalization.config.js";

const sessionEvents = [];

export function addEvent(event) {
  if (!event.source || !event.timestamp) throw new Error("Event requires source and timestamp");
  sessionEvents.unshift(event);
  if (sessionEvents.length > EVENT_LOG.MAX_ENTRIES) sessionEvents.pop();
  return event;
}

export function clearEvents() { sessionEvents.length = 0; }
export function getMaxEntries() { return EVENT_LOG.MAX_ENTRIES; }
