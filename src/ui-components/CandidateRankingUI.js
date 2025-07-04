// ./ui-components/CandidateRankingUI.js

export class CandidateRankingUI {
    static init() {
        this.container = document.getElementById('candidate-ranked');
        this.setupToggleHandling();
        this.clear();
    }

    static setupToggleHandling() {
        const historyRadio = document.getElementById('activity-history');
        const rankedRadio = document.getElementById('activity-ranked');
        const activityFeed = document.getElementById('activity-feed');
        const candidateRanked = document.getElementById('candidate-ranked');

        historyRadio?.addEventListener('change', () => {
            if (historyRadio.checked) {
                activityFeed.style.display = 'block';
                candidateRanked.style.display = 'none';
            }
        });

        rankedRadio?.addEventListener('change', () => {
            if (rankedRadio.checked) {
                activityFeed.style.display = 'none';
                candidateRanked.style.display = 'block';
            }
        });
    }

    static add(originalValue, result) {
        if (!this.container) return;

        const entry = document.createElement('div');
        entry.className = 'ranking-entry';
        entry.style.cssText = `
            border: 1px solid #ddd;
            margin: 5px 0;
            padding: 10px;
            background: #f9f9f9;
            border-radius: 4px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            font-weight: bold;
            margin-bottom: 8px;
            color: #333;
        `;
        header.textContent = `Input: "${originalValue}"`;

        const resultsContainer = document.createElement('div');
        resultsContainer.style.cssText = `
            font-family: monospace;
            font-size: 12px;
            background: #fff;
            padding: 8px;
            border: 1px solid #eee;
            border-radius: 2px;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
        `;

        // Display the full result object as formatted JSON
        const displayText = result ? JSON.stringify(result, null, 2) : 'No result data available';
        resultsContainer.textContent = displayText;

        entry.appendChild(header);
        entry.appendChild(resultsContainer);

        // Add to top of container
        this.container.insertBefore(entry, this.container.firstChild);

        // Limit to 20 entries
        while (this.container.children.length > 20) {
            this.container.removeChild(this.container.lastChild);
        }
    }

    static clear() {
        if (this.container) {
            this.container.innerHTML = `
                <div style="color: #666; font-style: italic; padding: 10px; text-align: center;">
                    Candidate rankings will appear here when processing cells with multiple matches.
                </div>
            `;
        }
    }

    static show() {
        if (this.container) {
            this.container.style.display = 'block';
        }
    }

    static hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }
}