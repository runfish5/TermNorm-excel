// ./ui-components/CandidateRankingUI.js
import { ActivityFeed } from './ActivityFeedUI.js';

export class ActivityDisplay {
    static container = null;
    static candidatesData = [];
    static firstChoiceHandler = null;

    static init() {
        this.container = document.getElementById('live-activity-section');
        if (!this.container) return console.error('ActivityDisplay: Container not found');
        
        this.container.innerHTML = `
            <div class="activity-toggle">
                <input type="radio" id="activity-history" name="activity-mode" value="history" />
                <label for="activity-history" class="ms-font-s">History</label>
                <input type="radio" id="activity-ranked" name="activity-mode" value="ranked" checked />
                <label for="activity-ranked" class="ms-font-s">Candidate Ranked</label>
            </div>
            <div id="activity-feed" class="activity-feed" style="display:none"></div>
            <div id="candidate-ranked" class="activity-feed">
                <div class="placeholder-text">Rankings appear here during processing</div>
            </div>
            <style>
                .candidate-table tr { cursor: move; transition: background 0.2s; }
                .candidate-table tr:hover { background: #f3f2f1; }
                .candidate-table tr.dragging { opacity: 0.5; }
                .candidate-table tr.drag-over { border-top: 2px solid #0078d4; }
            </style>
        `;
        
        this.container.addEventListener('change', e => {
            if (e.target.name === 'activity-mode') {
                const isHistory = e.target.value === 'history';
                this.container.querySelector('#activity-feed').style.display = isHistory ? 'block' : 'none';
                this.container.querySelector('#candidate-ranked').style.display = isHistory ? 'none' : 'block';
            }
        });
        
        ActivityFeed.init('activity-feed');
    }

    static setFirstChoiceHandler(handler) {
        this.firstChoiceHandler = handler;
    }

    static addCandidate(value, result) {
        const candidates = result?.fullResults?.ranked_candidates;
        if (!candidates) return;
        
        this.candidatesData = [...candidates];
        
        const rankedContainer = this.container.querySelector('#candidate-ranked');
        rankedContainer.innerHTML = `
            <div class="candidate-entry">
                <div class="candidate-header">Input: "${value}"</div>
                <div style="display: flex; align-items: center; margin-bottom: 10px; gap: 10px;">
                    <button id="apply-first" class="ms-Button ms-Button--primary ms-font-s">Apply First Choice</button>
                    <span style="color: #666; font-size: 14px;">Drag rows to reorder</span>
                </div>
                <table class="candidate-table">
                    <thead><tr><th>Rank</th><th>Candidate</th><th>Relevance</th><th>Match Factors</th></tr></thead>
                    <tbody>
                        ${this.candidatesData.map((c, i) => `
                            <tr draggable="true" data-index="${i}">
                                <td>${c.rank}</td>
                                <td>${c.candidate}</td>
                                <td>${c.relevance_score}</td>
                                <td>${c.key_match_factors?.join(', ') || ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        this.setupDragDrop(rankedContainer);
        this.setupFirstChoice(rankedContainer);
    }

    static setupFirstChoice(container) {
        container.querySelector('#apply-first').onclick = async () => {
            const first = this.candidatesData[0];
            if (!first) return;
            
            const feedback = this.showFeedback(container, 'Processing...', '#f3f2f1');
            
            try {
                if (this.firstChoiceHandler) {
                    await this.firstChoiceHandler(first);
                    feedback.innerHTML = `✅ Applied: ${first.candidate} | Relevance: ${first.relevance_score}`;
                    feedback.style.background = '#d4edda';
                } else {
                    feedback.innerHTML = `First: ${first.candidate} | Relevance: ${first.relevance_score}`;
                }
                setTimeout(() => feedback.remove(), 3000);
            } catch (error) {
                feedback.innerHTML = '❌ Error: Failed to apply first choice';
                feedback.style.background = '#f8d7da';
                setTimeout(() => feedback.remove(), 3000);
            }
        };
    }

    static showFeedback(container, message, bg) {
        let feedback = container.querySelector('.feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.className = 'feedback';
            feedback.style.cssText = `padding:8px;margin:8px 0;border-radius:4px;background:${bg};`;
            container.querySelector('table').before(feedback);
        }
        feedback.innerHTML = message;
        return feedback;
    }

    static setupDragDrop(container) {
        const tbody = container.querySelector('tbody');
        let dragIndex = null;
        
        tbody.ondragstart = (e) => {
            if (e.target.tagName === 'TR') {
                dragIndex = parseInt(e.target.dataset.index);
                e.target.classList.add('dragging');
            }
        };
        
        tbody.ondragend = (e) => {
            if (e.target.tagName === 'TR') {
                e.target.classList.remove('dragging');
                tbody.querySelectorAll('tr').forEach(row => row.classList.remove('drag-over'));
            }
        };
        
        tbody.ondragover = (e) => {
            e.preventDefault();
            const targetRow = e.target.closest('tr');
            if (targetRow && dragIndex !== null) {
                tbody.querySelectorAll('tr').forEach(row => row.classList.remove('drag-over'));
                targetRow.classList.add('drag-over');
            }
        };
        
        tbody.ondrop = (e) => {
            e.preventDefault();
            const targetRow = e.target.closest('tr');
            if (targetRow && dragIndex !== null) {
                const targetIndex = parseInt(targetRow.dataset.index);
                const [draggedItem] = this.candidatesData.splice(dragIndex, 1);
                this.candidatesData.splice(targetIndex, 0, draggedItem);
                
                const input = container.querySelector('.candidate-header').textContent.match(/Input: "([^"]+)"/)?.[1];
                this.addCandidate(input, { fullResults: { ranked_candidates: this.candidatesData } });
            }
            dragIndex = null;
        };
    }

    static clearCandidates() {
        this.candidatesData = [];
        this.container.querySelector('#candidate-ranked').innerHTML = 
            '<div class="placeholder-text">Rankings appear here during processing</div>';
    }

    static add = this.addCandidate;
    static clear = this.clearCandidates;
}

export const CandidateRankingUI = ActivityDisplay;