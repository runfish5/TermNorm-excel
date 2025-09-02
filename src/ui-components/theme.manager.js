// ui-components/theme.manager.js

export class ThemeManager {
  constructor() {
    this.currentTheme = localStorage.getItem('theme') || 'default';
    this.availableThemes = ['default', 'ocean', 'artdeco'];
    this.selectors = [];
  }

  init() {
    this.applyTheme(this.currentTheme);
    this.setupSelectors();
  }

  setupSelectors() {
    // Find all theme selectors and set up sync
    const selectorIds = ['theme-selector', 'settings-theme-selector'];
    
    selectorIds.forEach(id => {
      const selector = document.getElementById(id);
      if (selector) {
        this.selectors.push(selector);
        selector.value = this.currentTheme;
        selector.addEventListener('change', (e) => {
          this.changeTheme(e.target.value);
        });
      }
    });
  }

  changeTheme(themeName) {
    if (!this.availableThemes.includes(themeName)) {
      console.warn(`Invalid theme: ${themeName}`);
      return;
    }

    this.currentTheme = themeName;
    
    // Persist theme preference
    localStorage.setItem('theme', themeName);
    
    // Sync all selectors
    this.selectors.forEach(selector => {
      selector.value = themeName;
    });

    // Apply theme immediately
    this.applyTheme(themeName);

    // Reload for full theme application (needed for embedded CSS)
    location.reload();
  }

  applyTheme(themeName) {
    // Apply theme class to body
    document.body.className = document.body.className
      .replace(/theme-\w+/g, '')
      .trim();
    
    if (themeName !== 'default') {
      document.body.classList.add(`theme-${themeName}`);
    }

    // Emit theme change event
    this.emit('themeChanged', { theme: themeName });
  }

  getCurrentTheme() {
    return this.currentTheme;
  }

  getAvailableThemes() {
    return [...this.availableThemes];
  }

  // Add a new theme selector to sync
  registerSelector(selector) {
    if (selector && !this.selectors.includes(selector)) {
      this.selectors.push(selector);
      selector.value = this.currentTheme;
      selector.addEventListener('change', (e) => {
        this.changeTheme(e.target.value);
      });
    }
  }

  // Event emitter
  emit(eventName, data) {
    const event = new CustomEvent(`theme:${eventName}`, {
      detail: data,
      bubbles: true
    });
    document.dispatchEvent(event);
  }

  on(eventName, callback) {
    document.addEventListener(`theme:${eventName}`, callback);
  }
}