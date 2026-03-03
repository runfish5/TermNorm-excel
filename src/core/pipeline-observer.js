// Pipeline Observer - Central pipeline observability (glow + status messages)
import { eventBus } from "./event-bus.js";
import { Events } from "./events.js";
import { $ } from "../utils/dom-helpers.js";

/** Maps match method → which thermo nodes participated */
const METHOD_NODES = {
  cached: ['cache_lookup'],
  fuzzy: ['cache_lookup', 'js_fuzzy'],
};

/**
 * Format a human-readable pipeline status message
 * @param {{ method: string, elapsedMs: number, candidateCount?: number }} payload
 * @returns {string}
 */
function formatPipelineMessage({ method, elapsedMs, candidateCount }) {
  if (method === 'cached') return `Match [exact] in ${Math.round(elapsedMs)}ms`;
  if (method === 'fuzzy') return `Match [fuzzy] in ${Math.round(elapsedMs)}ms`;
  const secs = (elapsedMs / 1000).toFixed(1);
  if (method === 'ProfileRank') {
    const n = candidateCount || 0;
    return `Research completed [ProfileRank] — ${n} candidate${n !== 1 ? 's' : ''} in ${secs}s`;
  }
  return `No match in ${secs}s`;
}

/**
 * Initialize pipeline observer. Call once during app init.
 * Listens for PIPELINE_STARTED/FINISHED and handles thermo glow + SERVICE_MESSAGE.
 */
export function initPipelineObserver() {
  eventBus.on(Events.PIPELINE_STARTED, () => {
    document.querySelectorAll('#research-thermo .thermo__step--glow')
      .forEach(el => el.classList.remove('thermo__step--glow'));
  });

  eventBus.on(Events.PIPELINE_FINISHED, (payload) => {
    const { method } = payload;

    // Glow the nodes that participated
    const container = $('research-thermo');
    if (container) {
      const nodes = METHOD_NODES[method];
      if (nodes) {
        nodes.forEach(key =>
          container.querySelector(`[data-key="${key}"]`)?.classList.add('thermo__step--glow'));
      } else {
        // ProfileRank / no_match: glow all non-disabled nodes
        container.querySelectorAll('.thermo__step:not(.thermo__step--disabled)')
          .forEach(el => el.classList.add('thermo__step--glow'));
      }
    }

    // Emit formatted status message
    eventBus.emit(Events.SERVICE_MESSAGE, { text: formatPipelineMessage(payload) });
  });
}
