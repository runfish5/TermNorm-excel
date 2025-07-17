// ./ui-components/CandidateRankingUI.js
import { ActivityFeed } from './ActivityFeedUI.js';
import { logActivity } from '../shared-services/activity.logger.js';

export class ActivityDisplay {
    static container = null;
    static currentView = 'ranked';
    static candidatesData = []; // Store the candidates data for reordering

    static init() {
        this.container = document.getElementById('live-activity-section');
        if (!this.container) return console.error('ActivityDisplay: Container not found');
        
        this.render();
        this.bindEvents();
        ActivityFeed.init('activity-feed');
        
    }

    static addFirstChoiceListener(container) {
        container.querySelector('#show-first-choice')?.addEventListener('click', () => {
            const first = this.candidatesData[0];
            console.log('\n========= this.candidatesData[0] ========= \n\n', result);
            console.log('\n### </==========================================>');
            console.log(`${JSON.stringify(result, null, 2)}`);
            if (!first) return;
            
            let display = container.querySelector('.first-choice-display');
            if (!display) {
                display = document.createElement('div');
                display.className = 'first-choice-display';
                display.style.cssText = 'background:#f3f2f1;padding:8px;margin:8px 0;border-radius:4px';
                container.querySelector('table').before(display);
            }
            
            display.innerHTML = `<strong>First:</strong> ${first.candidate} | <strong>Relevance:</strong> ${first.relevance_score} | <strong>Spec:</strong> ${first.spec_match_score}`;
        });
    }

    static render() {
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
                .candidate-table tbody tr {
                    cursor: move;
                    transition: background-color 0.2s;
                }
                .candidate-table tbody tr:hover {
                    background-color: #f3f2f1;
                }
                .candidate-table tbody tr.dragging {
                    opacity: 0.5;
                    background-color: #deecf9;
                }
                .candidate-table tbody tr.drag-over {
                    border-top: 2px solid #0078d4;
                }
                .drag-handle {
                    cursor: grab;
                    padding: 4px;
                    color: #605e5c;
                }
                .drag-handle:hover {
                    color: #0078d4;
                }
                .drag-handle:active {
                    cursor: grabbing;
                }
            </style>
        `;
    }

    static bindEvents() {
        this.container.addEventListener('change', e => {
            if (e.target.name === 'activity-mode') this.switchView(e.target.value);
        });   
    }

    static switchView(view) {
        this.currentView = view;
        const isHistory = view === 'history';
        this.container.querySelector('#activity-feed').style.display = isHistory ? 'block' : 'none';
        this.container.querySelector('#candidate-ranked').style.display = isHistory ? 'none' : 'block';
    }

    static addCandidate(value, result) {
        const candidates = result?.fullResults?.ranked_candidates;
        if (!candidates) return;

        // Store the candidates data for reordering
        this.candidatesData = [...candidates];

        this.renderCandidateTable(value);
    }

    static renderCandidateTable(value) {
        const html = `
            <div class="candidate-entry">
                <div class="candidate-header">Input: "${value}"</div>
                <div style="display: flex; align-items: center; margin-bottom: 10px; gap: 10px;">
                    <button id="show-first-choice" class="ms-Button ms-Button--primary ms-font-s">Show First Choice</button>
                    <span style="color: #666; font-size: 14px;">Drag rows to reorder</span>
                </div>
                <table class="candidate-table">
                    <thead><tr><th>🔀</th><th>Rank</th><th>Candidate</th><th>Relevance</th><th>Spec Match</th><th>Match Factors</th></tr></thead>
                    <tbody>
                        ${this.candidatesData.map((c, index) => `
                            <tr draggable="true" data-index="${index}">
                                <td class="drag-handle">⋮⋮</td>
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
        
        const rankedContainer = this.container.querySelector('#candidate-ranked');
        rankedContainer.innerHTML = html;
        
        // Add drag and drop event listeners
        this.addDragListeners(rankedContainer);
        
        // Add first choice button listener
        this.addFirstChoiceListener(rankedContainer);
    }

    static addDragListeners(container) {
        const tbody = container.querySelector('tbody');
        let draggedElement = null;
        let draggedIndex = null;

        tbody.addEventListener('dragstart', (e) => {
            if (e.target.tagName === 'TR') {
                draggedElement = e.target;
                draggedIndex = parseInt(e.target.dataset.index);
                e.target.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', e.target.outerHTML);
            }
        });

        tbody.addEventListener('dragend', (e) => {
            if (e.target.tagName === 'TR') {
                e.target.classList.remove('dragging');
                // Remove drag-over class from all rows
                tbody.querySelectorAll('tr').forEach(row => {
                    row.classList.remove('drag-over');
                });
            }
        });

        tbody.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const targetRow = e.target.closest('tr');
            if (targetRow && targetRow !== draggedElement) {
                // Remove drag-over class from all rows
                tbody.querySelectorAll('tr').forEach(row => {
                    row.classList.remove('drag-over');
                });
                // Add drag-over class to current target
                targetRow.classList.add('drag-over');
            }
        });

        tbody.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetRow = e.target.closest('tr');
            
            if (targetRow && targetRow !== draggedElement) {
                const targetIndex = parseInt(targetRow.dataset.index);
                
                // Reorder the candidates data
                const draggedCandidate = this.candidatesData[draggedIndex];
                this.candidatesData.splice(draggedIndex, 1);
                this.candidatesData.splice(targetIndex, 0, draggedCandidate);
                
                // Re-render the table with updated order
                const currentInput = container.querySelector('.candidate-header').textContent.match(/Input: "([^"]+)"/)?.[1] || '';
                this.renderCandidateTable(currentInput);
            }
            
            // Clean up
            draggedElement = null;
            draggedIndex = null;
        });

        tbody.addEventListener('dragleave', (e) => {
            const targetRow = e.target.closest('tr');
            if (targetRow) {
                targetRow.classList.remove('drag-over');
            }
        });
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