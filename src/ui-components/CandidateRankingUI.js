export class CandidateRankingUI {
    static init() {
        this.container = document.getElementById('candidate-ranked');
        this.setupToggle();
        this.clear();
    }

    static setupToggle() {
        const history = document.getElementById('activity-history');
        const ranked = document.getElementById('activity-ranked');
        const feed = document.getElementById('activity-feed');
        const candidates = document.getElementById('candidate-ranked');

        history?.addEventListener('change', () => {
            feed.style.display = 'block';
            candidates.style.display = 'none';
        });

        ranked?.addEventListener('change', () => {
            feed.style.display = 'none';
            candidates.style.display = 'block';
        });
    }

    static add(value, result) {
        if (!this.container) return;

        const entry = document.createElement('div');
        entry.style.cssText = 'border:1px solid #ddd;margin:5px 0;padding:10px;background:#f9f9f9';

        const header = document.createElement('div');
        header.style.cssText = 'font-weight:bold;margin-bottom:8px';
        header.textContent = `Input: "${value}"`;

        const content = document.createElement('div');
        
        if (result?.fullResults?.ranked_candidates) {
            const table = document.createElement('table');
            table.style.cssText = 'border-collapse:collapse;width:100%;font-size:12px';
            
            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th>Rank</th><th>Candidate</th><th>Relevance</th><th>Spec Match</th><th>Match Factors</th></tr>';
            
            const tbody = document.createElement('tbody');
            result.fullResults.ranked_candidates.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${item.rank}</td>
                    <td>${item.candidate}</td>
                    <td>${item.relevance_score}</td>
                    <td>${item.spec_match_score}</td>
                    <td>${item.key_match_factors?.join(', ') || ''}</td>
                `;
                tbody.appendChild(row);
            });
            
            table.append(thead, tbody);
            content.appendChild(table);
        } else {
            content.textContent = 'No ranked candidates';
        }

        entry.append(header, content);
        this.container.insertBefore(entry, this.container.firstChild);

        while (this.container.children.length > 20) {
            this.container.removeChild(this.container.lastChild);
        }
    }

    static clear() {
        if (this.container) {
            this.container.innerHTML = '<div style="color:#666;font-style:italic;padding:10px;text-align:center">Rankings appear here during processing</div>';
        }
    }
}