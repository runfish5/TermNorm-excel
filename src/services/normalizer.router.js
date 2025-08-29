// services/normalizer.router.js
import { findBestMatch } from './normalizer.fuzzy.js';
import { state } from '../shared-services/state.manager.js';

export class NormalizerRouter {
    constructor(forward, reverse, config) {
        this.forward = forward;
        this.reverse = reverse;
        this.config = config;
    }

    async process(value) {
        const val = String(value || '').trim();
        if (!val) return null;
        return this.findCached(val) || await this.findTokenMatch(val) || this.findFuzzy(val);
    }

    findCached(val) {
        if (val in this.forward) {
            const mapping = this.forward[val];
            return { 
                target: typeof mapping === 'string' ? mapping : mapping.target, 
                method: 'cached', 
                confidence: 1.0 
            };
        }
        if (val in this.reverse) {
            return { target: val, method: 'cached', confidence: 1.0 };
        }
        return null;
    }

    findFuzzy(val) {
        const fwd = findBestMatch(val, this.forward, 0.7);
        if (fwd) {
            const mapping = fwd.value;
            return { 
                target: typeof mapping === 'string' ? mapping : mapping.target, 
                method: 'fuzzy', 
                confidence: fwd.score 
            };
        }

        const rev = findBestMatch(val, this.reverse, 0.5);
        return rev ? { target: rev.key, method: 'fuzzy', confidence: rev.score } : null;
    }

    async findTokenMatch(val) {
        try {
            state.setStatus('Starting mapping process...');
            
            const res = await fetch("http://127.0.0.1:8000/research-and-match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: val })
            });

            if (!res.ok) return null;
            const data = await res.json();
            
            if (!data.success) {
                console.error(`API Error: ${data.error} (${data.error_type})`);
                state.setStatus(`Research failed: ${data.error}`, true);
                return null;
            }
            
            const rankedCandidates = data.data.full_results?.ranked_candidates;
            if (!rankedCandidates?.length) return null;

            const bestCandidate = rankedCandidates.find(c => c.candidate && c.relevance_score >= 0.005);
            if (!bestCandidate) {
                state.setStatus('No qualifying matches found', true);
                return null;
            }

            state.setStatus(`Found match: ${bestCandidate.candidate}`);
            return {
                target: bestCandidate.candidate,
                method: 'ProfileRank',
                confidence: bestCandidate.relevance_score,
                candidates: rankedCandidates
            };
            
        } catch (error) {
            console.error('Token match error:', error);
            state.setStatus(`Network error during research: ${error.message}`, true);
            return null;
        }
    }

    async callLLM(val) {
        const body = { source_value: val, project_name: "dummy-project", mapping_name: "dummy-mapping" };
        const prompt = this.config?.standardization_prompt;
        if (Array.isArray(prompt) && prompt.length) body.standardization_prompt = prompt.at(-1);

        const res = await fetch("http://127.0.0.1:8000/llm-generate-normalized-term", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
        
        const data = await res.json();
        if (!data.mappedValue) throw new Error("No value returned from LLM");

        this.forward[val] = {
            target: data.mappedValue,
            method: 'llm',
            confidence: data.confidence || 0.8,
            timestamp: new Date().toISOString()
        };

        return { target: data.mappedValue, method: 'llm', confidence: data.confidence || 0.8 };
    }
}