// ./ui-components/ActivityFeedUI.js
export const ActivityFeed = {
    container: null,
    tableBody: null,
    maxEntries: 50,
    
    init(containerId = 'activity-feed') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`ActivityFeed: Container '${containerId}' not found`);
            return;
        }
        
        // Create table structure
        this.container.innerHTML = `
            <table class="activity-table">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Source</th>
                        <th>Target</th>
                        <th>Method</th>
                        <th>Confidence</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        `;
        
        this.tableBody = this.container.querySelector('tbody');
        
        // Setup clear button
        const clearBtn = document.getElementById('clear-activity');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clear());
        }
        
        this.showPlaceholder();
        console.log('ActivityFeed initialized');
    },
    
    add(source, target, method, confidence) {
        if (!this.tableBody) {
            console.error('ActivityFeed: Not initialized');
            return;
        }
        
        // Remove placeholder
        const placeholder = this.tableBody.querySelector('.placeholder-row');
        if (placeholder) placeholder.remove();
        
        // Create new row
        const row = document.createElement('tr');
        row.className = `activity-row ${method}`;
        row.innerHTML = `
            <td class="time">${new Date().toLocaleTimeString()}</td>
            <td class="source">${source}</td>
            <td class="target">${target}</td>
            <td class="method">${method.toUpperCase()}</td>
            <td class="confidence">${method !== 'error' ? Math.round(confidence * 100) + '%' : '-'}</td>
        `;
        
        // Add to top
        this.tableBody.insertBefore(row, this.tableBody.firstChild);
        
        // Limit entries
        const rows = this.tableBody.querySelectorAll('.activity-row');
        if (rows.length > this.maxEntries) {
            rows[rows.length - 1].remove();
        }
        
        console.log(`ActivityFeed: Added ${source} → ${target}`);
    },
    
    clear() {
        if (!this.tableBody) return;
        this.tableBody.innerHTML = '';
        this.showPlaceholder();
    },
    
    showPlaceholder() {
        if (!this.tableBody) return;
        if (!this.tableBody.querySelector('.activity-row')) {
            this.tableBody.innerHTML = '<tr class="placeholder-row"><td colspan="5">No activity yet. Start tracking to see live mappings.</td></tr>';
        }
    }
};