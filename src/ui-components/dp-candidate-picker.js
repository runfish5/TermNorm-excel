// dp-candidate-picker.js - Self-contained candidate selection picker for Direct Prompt
import { showMessage } from "../utils/ui-feedback.js";
import { $ } from "../utils/dom-helpers.js";

const TITLE_TRUNCATE_LENGTH = 40;

let pendingSelections = [];
let currentPendingIndex = 0;
let _onSelect = null; // callback: (pendingItem, selectedCandidate) => void
let _onResolved = null; // callback: () => void

const PICKER_HTML = `<div id="dp-candidates-panel" class="dp-candidates-panel hidden">
  <div class="dp-candidates-header">
    <span id="dp-candidates-title">Select a match:</span>
    <button id="dp-candidates-skip" class="btn-sm btn-secondary">Skip</button>
  </div>
  <div id="dp-candidates-list" class="dp-candidates-list"></div>
</div>`;

/**
 * Initialize the picker — inject HTML into container element.
 * @param {HTMLElement} containerEl - Parent element to append picker into
 */
export function initPicker(containerEl) {
  if (!containerEl) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = PICKER_HTML;
  containerEl.appendChild(wrapper.firstElementChild);
}

/**
 * Start a selection session with pending items.
 * @param {Array<{source: string, candidates: Array, index: number, rowIndex: number}>} items
 * @param {{onSelect: Function, onResolved: Function}} callbacks
 */
export function startSelection(items, { onSelect, onResolved }) {
  pendingSelections = items;
  currentPendingIndex = 0;
  _onSelect = onSelect;
  _onResolved = onResolved;

  if (items.length > 0) {
    _showPicker(items[0]);
  }
}

/** Hide the candidate picker panel. */
export function hide() {
  $("dp-candidates-panel")?.classList.add('hidden');
  pendingSelections = [];
  currentPendingIndex = 0;
}

function _showPicker(pendingItem) {
  const panel = $("dp-candidates-panel");
  const list = $("dp-candidates-list");
  const title = $("dp-candidates-title");
  if (!panel || !list || !title) return;

  title.textContent = `Select match for: "${pendingItem.source.slice(0, TITLE_TRUNCATE_LENGTH)}${pendingItem.source.length > TITLE_TRUNCATE_LENGTH ? '...' : ''}"`;

  list.innerHTML = pendingItem.candidates.map((c, i) =>
    `<button class="dp-candidate-btn" data-index="${i}" data-candidate="${encodeURIComponent(c.candidate)}">
      <span class="dp-candidate-name">${c.candidate}</span>
      <span class="dp-candidate-score">${Math.round(c.score * 100)}%</span>
    </button>`
  ).join('');

  list.querySelectorAll('.dp-candidate-btn').forEach(btn => {
    btn.addEventListener('click', () => _handleSelection(decodeURIComponent(btn.dataset.candidate)));
  });

  $("dp-candidates-skip")?.removeEventListener('click', _handleSkip);
  $("dp-candidates-skip")?.addEventListener('click', _handleSkip);

  panel.classList.remove('hidden');
}

function _handleSelection(selectedCandidate) {
  const pending = pendingSelections[currentPendingIndex];
  if (!pending) return;

  if (_onSelect) _onSelect(pending, selectedCandidate);
  _advance();
}

function _handleSkip() {
  _advance();
}

function _advance() {
  currentPendingIndex++;

  if (currentPendingIndex < pendingSelections.length) {
    _showPicker(pendingSelections[currentPendingIndex]);
    showMessage(`Selection ${currentPendingIndex + 1} of ${pendingSelections.length}`);
  } else {
    hide();
    showMessage("Direct prompt complete: all selections resolved");
    if (_onResolved) _onResolved();
  }
}
