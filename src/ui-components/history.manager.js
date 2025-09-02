// ui-components/history.manager.js
import { state } from "../shared-services/state.manager.js";

export class HistoryManager {
  constructor() {
    this.activityFeed = null;
    this.currentFilter = 'all';
    this.filterTypes = ['all', 'success', 'error', 'processing'];
  }

  init() {
    this.activityFeed = document.getElementById("activity-feed");
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Set up history filter
    const historyFilter = document.getElementById('history-filter');
    if (historyFilter) {
      historyFilter.addEventListener('change', (e) => {
        this.filterHistory(e.target.value);
      });
    }

    // Set up clear history button
    document.addEventListener('click', (e) => {
      if (e.target.id === 'clear-history-btn') {
        e.preventDefault();
        this.clearHistory();
      }
    });
  }

  clearHistory() {
    if (!this.activityFeed) return;

    this.activityFeed.innerHTML = '<div class="placeholder-text">Activity history cleared</div>';
    state.setStatus("History cleared");
    
    // Emit clear event
    this.emit('historyCleared');
  }

  filterHistory(filterType) {
    if (!this.activityFeed || !this.filterTypes.includes(filterType)) return;

    this.currentFilter = filterType;

    const filterMap = {
      'all': () => true,
      'success': (type) => type === 'success',
      'error': (type) => type === 'error',
      'processing': (type) => type === 'processing'
    };

    const filterFn = filterMap[filterType];
    
    this.activityFeed.querySelectorAll('.activity-entry').forEach(entry => {
      const entryType = entry.getAttribute('data-type') || 'info';
      const shouldShow = filterFn(entryType);
      entry.style.display = shouldShow ? 'block' : 'none';
    });

    // Emit filter event
    this.emit('historyFiltered', { filter: filterType });
  }

  addHistoryEntry(entry) {
    if (!this.activityFeed) return;

    // Remove placeholder text if it exists
    const placeholder = this.activityFeed.querySelector('.placeholder-text');
    if (placeholder) {
      placeholder.remove();
    }

    // Create new entry element
    const entryElement = this.createEntryElement(entry);
    
    // Add to feed (newest first)
    this.activityFeed.prepend(entryElement);
    
    // Apply current filter
    this.filterHistory(this.currentFilter);

    // Emit entry added event
    this.emit('entryAdded', { entry });
  }

  createEntryElement(entry) {
    const element = document.createElement('div');
    element.className = 'activity-entry';
    element.setAttribute('data-type', entry.type || 'info');
    element.setAttribute('data-timestamp', entry.timestamp || Date.now());

    // Format entry based on type
    const iconMap = {
      success: '✅',
      error: '❌',
      processing: '⏳',
      info: 'ℹ️'
    };

    const icon = iconMap[entry.type] || iconMap.info;
    const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
    
    element.innerHTML = `
      <div class="entry-header">
        <span class="entry-icon">${icon}</span>
        <span class="entry-time">${timestamp}</span>
        <span class="entry-type">${entry.type || 'info'}</span>
      </div>
      <div class="entry-content">
        <div class="entry-message">${entry.message || ''}</div>
        ${entry.details ? `<div class="entry-details">${entry.details}</div>` : ''}
      </div>
    `;

    return element;
  }

  getHistoryEntries(filterType = null) {
    if (!this.activityFeed) return [];

    const entries = Array.from(this.activityFeed.querySelectorAll('.activity-entry'));
    
    if (filterType && this.filterTypes.includes(filterType)) {
      return entries.filter(entry => {
        const entryType = entry.getAttribute('data-type');
        return filterType === 'all' || entryType === filterType;
      });
    }

    return entries;
  }

  getHistoryCount() {
    return this.getHistoryEntries().length;
  }

  exportHistory(format = 'json') {
    const entries = this.getHistoryEntries().map(element => ({
      type: element.getAttribute('data-type'),
      timestamp: element.getAttribute('data-timestamp'),
      message: element.querySelector('.entry-message')?.textContent || '',
      details: element.querySelector('.entry-details')?.textContent || ''
    }));

    switch (format) {
      case 'json':
        return JSON.stringify(entries, null, 2);
      case 'csv':
        const headers = ['timestamp', 'type', 'message', 'details'];
        const csvRows = [headers.join(',')];
        entries.forEach(entry => {
          const row = headers.map(header => `"${entry[header] || ''}"`);
          csvRows.push(row.join(','));
        });
        return csvRows.join('\n');
      default:
        return entries;
    }
  }

  // Event emitter
  emit(eventName, data = {}) {
    const event = new CustomEvent(`history:${eventName}`, {
      detail: data,
      bubbles: true
    });
    document.dispatchEvent(event);
  }

  on(eventName, callback) {
    document.addEventListener(`history:${eventName}`, callback);
  }
}