// ./ui-components/CandidateRankingUI.js
import { ActivityFeed } from './ActivityFeedUI.js';

export class ActivityDisplay {
    static container = null;
    static currentView = 'history';
    static candidatesData = []; // Store the candidates data for reordering

    static init() {
        this.container = document.getElementById('live-activity-section');
        if (!this.container) return console.error('ActivityDisplay: Container not found');
        
        this.render();
        this.bindEvents();
        ActivityFeed.init('activity-feed');
        
    }

    static addFirstChoiceListener(container) {
        const button = container.querySelector('#show-first-choice');
        if (button) {
            button.addEventListener('click', () => {
                try {
                    console.log('First choice button clicked');
                    console.log('candidatesData:', this.candidatesData);
                    
                    if (this.candidatesData.length > 0) {
                        const firstChoice = this.candidatesData[0];
                        console.log('First choice data:', firstChoice);
                        
                        // Use console.log instead of alert for debugging
                        const message = `First Choice: ${firstChoice.candidate}\nRelevance: ${firstChoice.relevance_score}\nSpec Match: ${firstChoice.spec_match_score}\nMatch Factors: ${firstChoice.key_match_factors?.join(', ') || 'None'}`;
                        console.log('Message to display:', message);
                        
                        // Try to display in a div instead of alert
                        this.displayFirstChoice(firstChoice);
                    } else {
                        console.log('No candidates data available');
                        this.displayMessage('No candidates available');
                    }
                } catch (error) {
                    console.error('Error in first choice listener:', error);
                    this.displayMessage('Error displaying first choice');
                }
            });
        }
    }

    static displayFirstChoice(firstChoice) {
        const message = `
            <div style="background: #f3f2f1; padding: 10px; margin: 10px 0; border-radius: 4px;">
                <strong>First Choice:</strong> ${firstChoice.candidate}<br>
                <strong>Relevance:</strong> ${firstChoice.relevance_score}<br>
                <strong>Spec Match:</strong> ${firstChoice.spec_match_score}<br>
                <strong>Match Factors:</strong> ${firstChoice.key_match_factors?.join(', ') || 'None'}
            </div>
        `;
        this.displayMessage(message);
    }

    static displayMessage(message) {
        const existingMsg = this.container.querySelector('.first-choice-display');
        if (existingMsg) {
            existingMsg.remove();
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'first-choice-display';
        messageDiv.innerHTML = message;
        
        const rankedContainer = this.container.querySelector('#candidate-ranked');
        if (rankedContainer) {
            rankedContainer.insertBefore(messageDiv, rankedContainer.firstChild);
        }
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

        // Store the candidates data for reordering
        this.candidatesData = [...candidates];

        this.renderCandidateTable(value);
    }

    static renderCandidateTable(value) {
        const html = `
            <div class="candidate-entry">
                <div class="candidate-header">Input: "${value}" (Drag rows to reorder)</div>
                <button id="show-first-choice" class="ms-Button ms-Button--primary ms-font-s" style="margin-bottom: 10px;">Show First Choice</button>
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