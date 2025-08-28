// ui-components/CloudConfigPickerUI.js
/* global document */

export class CloudConfigPickerUI {
    constructor(configManager, onConfigLoaded) {
        this.configManager = configManager;
        this.onConfigLoaded = onConfigLoaded;
        this.dialogElement = null;
    }

    /**
     * Show the cloud config picker dialog
     */
    show() {
        this.createDialog();
        this.attachEventListeners();
        this.dialogElement.style.display = 'block';
        document.body.appendChild(this.dialogElement);
    }

    /**
     * Hide the dialog
     */
    hide() {
        if (this.dialogElement) {
            this.dialogElement.style.display = 'none';
            if (this.dialogElement.parentNode) {
                this.dialogElement.parentNode.removeChild(this.dialogElement);
            }
        }
    }

    /**
     * Create the dialog HTML structure
     */
    createDialog() {
        this.dialogElement = document.createElement('div');
        this.dialogElement.className = 'cloud-config-dialog';
        this.dialogElement.innerHTML = `
            <div class="cloud-config-overlay">
                <div class="cloud-config-modal">
                    <div class="cloud-config-header">
                        <h2>🌐 Cloud Configuration Required</h2>
                        <p>Select your configuration file from SharePoint or OneDrive</p>
                    </div>
                    
                    <div class="cloud-config-content">
                        <div class="config-option">
                            <h3>📁 SharePoint/OneDrive Link</h3>
                            <p>Paste a sharing link to your app.config.json file:</p>
                            <input type="url" 
                                   id="config-url-input" 
                                   placeholder="https://company.sharepoint.com/..." 
                                   class="config-input">
                            <button id="load-from-url" class="ms-Button ms-Button--primary config-button">
                                Load from URL
                            </button>
                        </div>
                        
                        <div class="config-divider">
                            <span>OR</span>
                        </div>
                        
                        <div class="config-option">
                            <h3>📄 Upload Config File</h3>
                            <p>Upload your app.config.json file directly:</p>
                            <input type="file" 
                                   id="config-file-input" 
                                   accept=".json" 
                                   class="config-file-input">
                            <label for="config-file-input" class="ms-Button config-button file-button">
                                Choose File
                            </label>
                            <span id="file-name" class="file-name"></span>
                        </div>
                        
                        <div class="config-status" id="config-status"></div>
                    </div>
                    
                    <div class="cloud-config-footer">
                        <button id="config-cancel" class="ms-Button">Cancel</button>
                        <div class="config-help">
                            <a href="https://github.com/runfish5/TermNorm-excel" target="_blank">
                                📖 Need help? View documentation
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Attach event listeners to dialog elements
     */
    attachEventListeners() {
        // URL loading
        const urlInput = this.dialogElement.querySelector('#config-url-input');
        const loadFromUrlBtn = this.dialogElement.querySelector('#load-from-url');
        
        loadFromUrlBtn.addEventListener('click', () => {
            const url = urlInput.value.trim();
            if (url) {
                this.loadConfigFromUrl(url);
            } else {
                this.showStatus('Please enter a valid URL', 'error');
            }
        });

        // File upload
        const fileInput = this.dialogElement.querySelector('#config-file-input');
        const fileName = this.dialogElement.querySelector('#file-name');
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                fileName.textContent = file.name;
                this.loadConfigFromFile(file);
            }
        });

        // Cancel button
        const cancelBtn = this.dialogElement.querySelector('#config-cancel');
        cancelBtn.addEventListener('click', () => {
            this.hide();
        });

        // Close on overlay click
        const overlay = this.dialogElement.querySelector('.cloud-config-overlay');
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide();
            }
        });

        // Enter key on URL input
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                loadFromUrlBtn.click();
            }
        });
    }

    /**
     * Load config from URL
     */
    async loadConfigFromUrl(url) {
        this.showStatus('Loading configuration from URL...', 'loading');
        this.setButtonsDisabled(true);

        try {
            const config = await this.configManager.setupCloudConfig({
                type: 'url',
                url: url
            });

            this.showStatus('Configuration loaded successfully! ✅', 'success');
            
            setTimeout(() => {
                this.hide();
                if (this.onConfigLoaded) {
                    this.onConfigLoaded(config);
                }
            }, 1000);

        } catch (error) {
            this.showStatus(`Failed to load config: ${error.message}`, 'error');
            this.setButtonsDisabled(false);
        }
    }

    /**
     * Load config from uploaded file
     */
    async loadConfigFromFile(file) {
        this.showStatus('Processing uploaded file...', 'loading');
        this.setButtonsDisabled(true);

        try {
            const config = await this.configManager.setupCloudConfig({
                type: 'file',
                file: file
            });

            this.showStatus('Configuration loaded successfully! ✅', 'success');
            
            setTimeout(() => {
                this.hide();
                if (this.onConfigLoaded) {
                    this.onConfigLoaded(config);
                }
            }, 1000);

        } catch (error) {
            this.showStatus(`Failed to process file: ${error.message}`, 'error');
            this.setButtonsDisabled(false);
        }
    }

    /**
     * Show status message
     */
    showStatus(message, type = 'info') {
        const statusElement = this.dialogElement.querySelector('#config-status');
        statusElement.textContent = message;
        statusElement.className = `config-status ${type}`;
    }

    /**
     * Enable/disable buttons during loading
     */
    setButtonsDisabled(disabled) {
        const buttons = this.dialogElement.querySelectorAll('button, input');
        buttons.forEach(btn => {
            btn.disabled = disabled;
        });
    }
}