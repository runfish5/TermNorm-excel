// ./ui-components/CandidateRankingUI.js
import { ActivityFeed } from './ActivityFeedUI.js';

export class ActivityDisplay {
    static container = null;
    static currentView = 'history';

    static init() {
        this.container = document.getElementById('live-activity-section');
        if (!this.container) return console.error('ActivityDisplay: Container not found');
        
        this.render();
        this.bindEvents();
        ActivityFeed.init('activity-feed');
        
    }

    static render() {
        this.container.innerHTML = `
            <div class="activity-header">
                <h4 class="ms-font-l">Live Activity</h4>
                <div class="activity-toggle">
                    <input type="radio" id="activity-history" name="activity-mode" value="history" checked />
                    <label for="activity-history" class="ms-font-s">History</label>
                    <input type="radio" id="activity-ranked" name="activity-mode" value="ranked" />
                    <label for="activity-ranked" class="ms-font-s">Candidate Ranked</label>
                </div>
                <button id="clear-activity" class="ms-Button ms-Button--default ms-font-s">Clear</button>
            </div>
            <div id="activity-feed" class="activity-feed"></div>
            <div id="candidate-ranked" class="activity-feed" style="display:none">
                <div class="placeholder-text">Rankings appear here during processing</div>
            </div>
        `;
    }

    static bindEvents() {
        this.container.addEventListener('change', e => {
            if (e.target.name === 'activity-mode') this.switchView(e.target.value);
        });
        
        this.container.addEventListener('click', e => {
            if (e.target.closest('#clear-activity')) this.clearActive();
        });
    }

    static switchView(view) {
        this.currentView = view;
        const isHistory = view === 'history';
        this.container.querySelector('#activity-feed').style.display = isHistory ? 'block' : 'none';
        this.container.querySelector('#candidate-ranked').style.display = isHistory ? 'none' : 'block';
    }

    static clearActive() {
        this.currentView === 'history' ? ActivityFeed.clear() : this.clearCandidates();
    }

    static addCandidate(value, result) {
        const candidates = result?.fullResults?.ranked_candidates;
        if (!candidates) return;

        const html = `
            <div class="candidate-entry">
                <div class="candidate-header">Input: "${value}"</div>
                <table class="candidate-table">
                    <thead><tr><th>Rank</th><th>Candidate</th><th>Relevance</th><th>Spec Match</th><th>Match Factors</th></tr></thead>
                    <tbody>
                        ${candidates.map(c => `
                            <tr>
                                <td>${c.rank}</td>
                                <td>${c.candidate}</td>
                                <td>${c.relevance_score}</td>
                                <td>${c.spec_match_score}</td>
                                <td>${c.key_match_factors?.join(', ') || ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        this.container.querySelector('#candidate-ranked').innerHTML = html;
    }

    static clearCandidates() {
        this.container.querySelector('#candidate-ranked').innerHTML = 
            '<div class="placeholder-text">Rankings appear here during processing</div>';
    }

    static add = this.addCandidate;
    static clear = this.clearCandidates;
}

export const CandidateRankingUI = ActivityDisplay;