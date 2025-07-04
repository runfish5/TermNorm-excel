// ./ui-components/CandidateRankingUI.js
import { ActivityFeed } from './ActivityFeedUI.js';

export class ActivityDisplay {
    static container = null;
    static candidateContainer = null;
    static currentView = 'history';

    static init() {
        this.container = document.getElementById('live-activity-section');
        if (!this.container) {
            console.error('ActivityDisplay: Container not found');
            return;
        }
        
        this.createUI();
        this.setupEventListeners();
        
        // Initialize sub-components
        ActivityFeed.init('activity-feed');
        this.initCandidateView();
        
        console.log('ActivityDisplay initialized');
    }

    static createUI() {
        this.container.innerHTML = `
            <div class="activity-header">
                <h4 class="ms-font-l">Live Activity</h4>
                <div class="activity-toggle">
                    <input type="radio" id="activity-history" name="activity-mode" value="history" checked />
                    <label for="activity-history" class="ms-font-s">History</label>
                    <input type="radio" id="activity-ranked" name="activity-mode" value="ranked" />
                    <label for="activity-ranked" class="ms-font-s">Candidate Ranked</label>
                </div>
                <button id="clear-activity" class="ms-Button ms-Button--default ms-font-s">
                    <span class="ms-Button-label">Clear</span>
                </button>
            </div>
            <div id="activity-feed" class="activity-feed"></div>
            <div id="candidate-ranked" class="activity-feed" style="display: none;"></div>
        `;
        
        this.candidateContainer = this.container.querySelector('#candidate-ranked');
    }

    static setupEventListeners() {
        const historyRadio = this.container.querySelector('#activity-history');
        const rankedRadio = this.container.querySelector('#activity-ranked');
        const clearButton = this.container.querySelector('#clear-activity');

        historyRadio?.addEventListener('change', () => this.showView('history'));
        rankedRadio?.addEventListener('change', () => this.showView('ranked'));
        clearButton?.addEventListener('click', () => this.clearCurrentView());
    }

    static showView(view) {
        this.currentView = view;
        const feedDiv = this.container.querySelector('#activity-feed');
        const candidateDiv = this.container.querySelector('#candidate-ranked');
        
        if (view === 'history') {
            feedDiv.style.display = 'block';
            candidateDiv.style.display = 'none';
        } else {
            feedDiv.style.display = 'none';
            candidateDiv.style.display = 'block';
        }
    }

    static clearCurrentView() {
        if (this.currentView === 'history') {
            ActivityFeed.clear();
        } else {
            this.clearCandidates();
        }
    }

    static initCandidateView() {
        if (!this.candidateContainer) return;
        this.candidateContainer.innerHTML = '<div style="color:#666;font-style:italic;padding:10px;text-align:center">Rankings appear here during processing</div>';
    }

    static addCandidate(value, result) {
        if (!this.candidateContainer) return;
        
        // Clear previous content - only show the most recent
        this.candidateContainer.innerHTML = '';
        
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
        this.candidateContainer.appendChild(entry);
    }

    static clearCandidates() {
        if (this.candidateContainer) {
            this.candidateContainer.innerHTML = '<div style="color:#666;font-style:italic;padding:10px;text-align:center">Rankings appear here during processing</div>';
        }
    }

    // Backward compatibility methods
    static add(value, result) {
        this.addCandidate(value, result);
    }

    static clear() {
        this.clearCandidates();
    }
}

// Export both new and old class names for compatibility
export const CandidateRankingUI = ActivityDisplay;