// ./ui-components/metadata.display.js

export class MetadataDisplay {
    constructor() {
        this.visible = false;
        this.els = {};
    }

    init() {
        this.els = {
            section: document.getElementById('metadata-section'),
            display: document.getElementById('metadata-display'),
            content: document.getElementById('metadata-content'),
            btn: document.getElementById('show-metadata-btn'),
            label: document.getElementById('show-metadata-btn')?.querySelector('.ms-Button-label')
        };

        if (this.els.btn) this.els.btn.onclick = () => this.toggle();
        this.hide();
    }

    show(metadata) {
        if (!this.els.section || !this.els.display) return;

        this.els.section.style.display = 'block';
        this.els.display.innerHTML = this.render(metadata);
        this.visible = false;
        this.updateBtn();
    }

    hide() {
        if (this.els.section) this.els.section.style.display = 'none';
        this.visible = false;
        this.updateBtn();
    }

    toggle() {
        this.visible = !this.visible;
        this.updateBtn();
        
        if (this.els.content) {
            this.els.content.style.display = this.visible ? 'block' : 'none';
        }
    }

    updateBtn() {
        if (this.els.label) {
            this.els.label.textContent = this.visible ? 'Hide Details' : 'Show Details';
        }
    }

    render(data) {
        if (!data) return '<em>No metadata available.</em>';

        const stats = [
            { label: 'Processed', key: 'totalProcessed' },
            { label: 'Valid', key: 'validMappings' },
            { label: 'Skipped', key: 'skippedItems' },
            { label: 'Duplicates', key: 'duplicatesFound', pairs: 'duplicatePairs' },
            { label: 'Empty Source', key: 'emptySourceCount', pairs: 'emptySourcePairs' },
            { label: 'Empty Target', key: 'emptyTargetCount', pairs: 'emptyTargetPairs' }
        ].filter(s => data[s.key] > 0);

        const statsHtml = stats.map(({ label, key, pairs }) => {
            const count = data[key];
            const pairData = pairs ? data[pairs] : [];
            const pairsHtml = pairData?.length ? 
                `<div class="pairs">${pairData.map(p => 
                    `<div>"${p.source}" → "${p.target}"${p.rowIndex ? ` (row ${p.rowIndex})` : ''}</div>`
                ).join('')}</div>` : '';
            
            return `<div><strong>${label}:</strong> ${count}${pairsHtml}</div>`;
        }).join('');

        const warningsHtml = data.warnings?.length ? 
            `<div class="warnings"><strong>⚠️ Warnings:</strong>
             <ul>${data.warnings.map(w => `<li>${w}</li>`).join('')}</ul></div>` : '';

        // Add JSON dump section
        const jsonDump = `
            <div style="margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-family: monospace; font-size: 12px;">
                <strong>Raw Data:</strong>
                <pre style="margin: 5px 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(data, null, 2)}</pre>
            </div>`;

        return (statsHtml + warningsHtml + jsonDump) || '<em>No data.</em>';
    }
}