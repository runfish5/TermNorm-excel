#!/usr/bin/env python3
"""
Prompt Evaluation Runner - Compare different prompt versions

Usage:
    python evaluate_prompts.py --stage entity_profiling --versions 1.0.0 1.1.0
    python evaluate_prompts.py --stage candidate_ranking --versions 1.0.0
    python evaluate_prompts.py --stage both --versions latest
    python evaluate_prompts.py --compare  # Compare all versions for both stages
"""
import asyncio
import json
import argparse
from pathlib import Path
from typing import Dict, Any, List
import sys
from datetime import datetime

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

from evaluation.metrics.entity_profiling_metrics import EntityProfilingMetrics
from evaluation.metrics.candidate_ranking_metrics import CandidateRankingMetrics
from prompts.prompt_loader import get_prompt_loader


class PromptEvaluator:
    """Orchestrates evaluation of prompt versions"""

    def __init__(self):
        self.prompt_loader = get_prompt_loader()
        self.results_dir = Path(__file__).parent / "results"
        self.results_dir.mkdir(exist_ok=True)

    def load_test_cases(self, stage: str) -> List[Dict[str, Any]]:
        """Load test cases for a given stage"""
        dataset_file = Path(__file__).parent / "datasets" / f"{stage}_test_cases.jsonl"

        if not dataset_file.exists():
            print(f"⚠️  No test cases found: {dataset_file}")
            return []

        test_cases = []
        with open(dataset_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    test_cases.append(json.loads(line))

        print(f"✓ Loaded {len(test_cases)} test cases for {stage}")
        return test_cases

    async def evaluate_entity_profiling(
        self,
        version: str,
        test_cases: List[Dict[str, Any]],
        schema: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Evaluate entity profiling prompt version

        Note: This is a framework stub - actual evaluation requires running
        the web_generate_entity_profile function with the versioned prompt.
        """
        print(f"\n📊 Evaluating entity profiling prompt v{version}...")

        # Load prompt
        prompt_data = self.prompt_loader.load_prompt('entity_profiling', version)

        results = []
        for i, test_case in enumerate(test_cases, 1):
            query = test_case['query']
            expected = test_case['expected_profile']

            print(f"  [{i}/{len(test_cases)}] Evaluating: {query}")

            # TODO: Run actual entity profiling with versioned prompt
            # For now, we demonstrate the evaluation structure
            # In practice, you would call:
            # profile, _ = await web_generate_entity_profile(query, schema=schema, prompt_version=version)

            # Placeholder: Using expected profile to demonstrate metrics
            profile = expected  # Replace with actual LLM output

            # Calculate metrics
            metrics = EntityProfilingMetrics.evaluate_all(profile, expected, schema)

            results.append({
                'query': query,
                'metrics': metrics,
                'notes': test_case.get('notes', '')
            })

        # Aggregate metrics
        aggregate = self._aggregate_entity_metrics(results)

        return {
            'version': version,
            'prompt_name': prompt_data.get('name', 'Unknown'),
            'test_case_count': len(test_cases),
            'aggregate_metrics': aggregate,
            'detailed_results': results
        }

    def _aggregate_entity_metrics(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Aggregate entity profiling metrics across test cases"""
        if not results:
            return {}

        # Average completeness
        avg_completeness = sum(r['metrics']['completeness'] for r in results) / len(results)

        # Core concept accuracy
        exact_matches = sum(1 for r in results if r['metrics']['core_concept']['exact_match'])
        avg_similarity = sum(r['metrics']['core_concept']['similarity_score'] for r in results) / len(results)

        # Synonym coverage
        avg_synonym_coverage = sum(r['metrics']['synonym_coverage']['coverage_score'] for r in results) / len(results)

        # Spelling variants
        has_variants_count = sum(1 for r in results if r['metrics']['spelling_variants']['has_variants'])

        # Array richness
        avg_array_richness = sum(r['metrics']['array_richness']['average_items_per_array'] for r in results) / len(results)

        return {
            'completeness': {
                'average': round(avg_completeness, 3),
                'percentage': f"{avg_completeness * 100:.1f}%"
            },
            'core_concept_accuracy': {
                'exact_match_rate': round(exact_matches / len(results), 3),
                'average_similarity': round(avg_similarity, 3)
            },
            'synonym_coverage': {
                'average': round(avg_synonym_coverage, 3),
                'percentage': f"{avg_synonym_coverage * 100:.1f}%"
            },
            'spelling_variants': {
                'test_cases_with_variants': has_variants_count,
                'percentage': f"{has_variants_count / len(results) * 100:.1f}%"
            },
            'array_richness': {
                'average_items_per_array': round(avg_array_richness, 2)
            }
        }

    async def evaluate_candidate_ranking(
        self,
        version: str,
        test_cases: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Evaluate candidate ranking prompt version

        Note: This is a framework stub - actual evaluation requires running
        the call_llm_for_ranking function with the versioned prompt.
        """
        print(f"\n📊 Evaluating candidate ranking prompt v{version}...")

        # Load prompt
        prompt_data = self.prompt_loader.load_prompt('candidate_ranking', version)

        results = []
        for i, test_case in enumerate(test_cases, 1):
            query = test_case['query']
            expected_top_3 = test_case['expected_top_3']
            expected_scores = test_case.get('expected_core_scores', {})

            print(f"  [{i}/{len(test_cases)}] Evaluating: {query}")

            # TODO: Run actual candidate ranking with versioned prompt
            # For now, we demonstrate the evaluation structure
            # In practice, you would call:
            # ranked_results, _ = await call_llm_for_ranking(profile_info, entity_profile, candidates, query, prompt_version=version)

            # Placeholder: Create mock ranked results for demonstration
            # Replace with actual LLM output
            ranked_results = [
                {'candidate': c, 'core_concept_score': 4.5, 'spec_score': 4.0}
                for c in expected_top_3
            ]

            # Calculate metrics
            metrics = CandidateRankingMetrics.evaluate_all(
                ranked_results,
                expected_top_3,
                expected_scores
            )

            results.append({
                'query': query,
                'metrics': metrics,
                'ranked_candidates': [r['candidate'] for r in ranked_results],
                'notes': test_case.get('notes', '')
            })

        # Aggregate metrics
        aggregate = self._aggregate_ranking_metrics(results)

        return {
            'version': version,
            'prompt_name': prompt_data.get('name', 'Unknown'),
            'test_case_count': len(test_cases),
            'aggregate_metrics': aggregate,
            'detailed_results': results
        }

    def _aggregate_ranking_metrics(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Aggregate candidate ranking metrics across test cases"""
        if not results:
            return {}

        # Average MRR
        avg_mrr = sum(r['metrics']['mrr'] for r in results) / len(results)

        # Average Precision@K
        avg_p1 = sum(r['metrics']['precision_at_1'] for r in results) / len(results)
        avg_p3 = sum(r['metrics']['precision_at_3'] for r in results) / len(results)
        avg_p5 = sum(r['metrics']['precision_at_5'] for r in results) / len(results)

        # Average Recall@5
        avg_r5 = sum(r['metrics']['recall_at_5'] for r in results) / len(results)

        # Average NDCG@5
        avg_ndcg5 = sum(r['metrics']['ndcg_at_5'] for r in results) / len(results)

        # Average rank correlation
        avg_corr = sum(r['metrics']['rank_correlation'] for r in results) / len(results)

        # Score accuracy (if available)
        score_accuracy_results = [r['metrics'].get('score_accuracy') for r in results if 'score_accuracy' in r['metrics']]
        if score_accuracy_results:
            avg_score_accuracy = sum(sa['accuracy'] for sa in score_accuracy_results) / len(score_accuracy_results)
        else:
            avg_score_accuracy = None

        aggregate = {
            'mrr': round(avg_mrr, 3),
            'precision': {
                'p@1': round(avg_p1, 3),
                'p@3': round(avg_p3, 3),
                'p@5': round(avg_p5, 3)
            },
            'recall_at_5': round(avg_r5, 3),
            'ndcg_at_5': round(avg_ndcg5, 3),
            'rank_correlation': round(avg_corr, 3)
        }

        if avg_score_accuracy is not None:
            aggregate['score_accuracy'] = round(avg_score_accuracy, 3)

        return aggregate

    def compare_versions(
        self,
        stage: str,
        version_results: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Compare multiple version results and identify best performer"""
        if not version_results:
            return {}

        print(f"\n📈 Comparing {len(version_results)} versions for {stage}...")

        if stage == 'entity_profiling':
            # Compare by key metrics
            comparison = []
            for result in version_results:
                agg = result['aggregate_metrics']
                comparison.append({
                    'version': result['version'],
                    'name': result['prompt_name'],
                    'completeness': agg['completeness']['average'],
                    'core_concept_accuracy': agg['core_concept_accuracy']['exact_match_rate'],
                    'synonym_coverage': agg['synonym_coverage']['average'],
                    'array_richness': agg['array_richness']['average_items_per_array']
                })

            # Sort by composite score (weighted average)
            for c in comparison:
                c['composite_score'] = (
                    c['completeness'] * 0.3 +
                    c['core_concept_accuracy'] * 0.4 +
                    c['synonym_coverage'] * 0.2 +
                    min(c['array_richness'] / 10, 1.0) * 0.1  # Normalize richness
                )

            comparison.sort(key=lambda x: x['composite_score'], reverse=True)

        else:  # candidate_ranking
            comparison = []
            for result in version_results:
                agg = result['aggregate_metrics']
                comparison.append({
                    'version': result['version'],
                    'name': result['prompt_name'],
                    'mrr': agg['mrr'],
                    'p@3': agg['precision']['p@3'],
                    'ndcg@5': agg['ndcg_at_5'],
                    'rank_correlation': agg['rank_correlation']
                })

            # Sort by MRR (primary metric)
            comparison.sort(key=lambda x: x['mrr'], reverse=True)

        return {
            'stage': stage,
            'comparison': comparison,
            'best_version': comparison[0]['version'] if comparison else None,
            'recommendation': self._generate_recommendation(comparison) if comparison else None
        }

    def _generate_recommendation(self, comparison: List[Dict[str, Any]]) -> str:
        """Generate human-readable recommendation"""
        if not comparison:
            return "No versions to compare"

        best = comparison[0]
        worst = comparison[-1]

        if len(comparison) == 1:
            return f"Only one version evaluated: v{best['version']}"

        # Calculate improvement
        if 'composite_score' in best:
            improvement = (best['composite_score'] - worst['composite_score']) / worst['composite_score'] * 100
            return f"Best version v{best['version']} shows {improvement:.1f}% improvement over v{worst['version']}"
        else:
            improvement = (best['mrr'] - worst['mrr']) / worst['mrr'] * 100 if worst['mrr'] > 0 else 0
            return f"Best version v{best['version']} shows {improvement:.1f}% MRR improvement over v{worst['version']}"

    def save_report(self, report: Dict[str, Any], stage: str):
        """Save evaluation report to JSON file"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = self.results_dir / f"{stage}_evaluation_{timestamp}.json"

        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

        print(f"\n💾 Report saved: {filename}")
        return filename

    def print_summary(self, report: Dict[str, Any], stage: str):
        """Print human-readable summary of evaluation results"""
        print(f"\n{'='*60}")
        print(f"  {stage.upper().replace('_', ' ')} EVALUATION SUMMARY")
        print(f"{'='*60}")

        if 'aggregate_metrics' in report:
            # Single version report
            agg = report['aggregate_metrics']
            print(f"\nVersion: v{report['version']}")
            print(f"Prompt: {report['prompt_name']}")
            print(f"Test Cases: {report['test_case_count']}")
            print("\nAggregate Metrics:")

            if stage == 'entity_profiling':
                print(f"  Completeness: {agg['completeness']['percentage']}")
                print(f"  Core Concept Accuracy: {agg['core_concept_accuracy']['exact_match_rate']:.1%}")
                print(f"  Synonym Coverage: {agg['synonym_coverage']['percentage']}")
                print(f"  Array Richness: {agg['array_richness']['average_items_per_array']:.1f} items/array")
            else:
                print(f"  MRR: {agg['mrr']:.3f}")
                print(f"  Precision@1: {agg['precision']['p@1']:.3f}")
                print(f"  Precision@3: {agg['precision']['p@3']:.3f}")
                print(f"  NDCG@5: {agg['ndcg_at_5']:.3f}")

        elif 'comparison' in report:
            # Multi-version comparison
            print(f"\n🏆 Best Version: v{report['best_version']}")
            print(f"📊 {report['recommendation']}")
            print("\nRanking:")
            for i, comp in enumerate(report['comparison'], 1):
                print(f"  {i}. v{comp['version']}: {comp['name']}")
                if 'composite_score' in comp:
                    print(f"     Score: {comp['composite_score']:.3f}")
                else:
                    print(f"     MRR: {comp['mrr']:.3f}")

        print(f"\n{'='*60}\n")


async def main():
    parser = argparse.ArgumentParser(description='Evaluate prompt versions')
    parser.add_argument('--stage', choices=['entity_profiling', 'candidate_ranking', 'both'],
                        default='both', help='Which stage to evaluate')
    parser.add_argument('--versions', nargs='+', default=['latest'],
                        help='Prompt versions to evaluate (e.g., 1.0.0 1.1.0)')
    parser.add_argument('--compare', action='store_true',
                        help='Compare all available versions')
    parser.add_argument('--output', type=str, help='Output directory for reports')

    args = parser.parse_args()

    evaluator = PromptEvaluator()

    # Load schema for entity profiling
    schema_path = Path(__file__).parent.parent / "research_and_rank" / "entity_profile_schema.json"
    with open(schema_path, 'r') as f:
        schema = json.load(f)

    stages = ['entity_profiling', 'candidate_ranking'] if args.stage == 'both' else [args.stage]

    for stage in stages:
        # Load test cases
        test_cases = evaluator.load_test_cases(stage)
        if not test_cases:
            continue

        # Determine versions to test
        if args.compare:
            available_versions = evaluator.prompt_loader.list_versions(stage)
            versions = [v['version'] for v in available_versions]
        else:
            versions = args.versions

        # Evaluate each version
        version_results = []
        for version in versions:
            try:
                if stage == 'entity_profiling':
                    result = await evaluator.evaluate_entity_profiling(version, test_cases, schema)
                else:
                    result = await evaluator.evaluate_candidate_ranking(version, test_cases)

                version_results.append(result)
                evaluator.print_summary(result, stage)

            except Exception as e:
                print(f"❌ Error evaluating v{version}: {e}")
                continue

        # Compare versions if multiple
        if len(version_results) > 1:
            comparison = evaluator.compare_versions(stage, version_results)
            evaluator.print_summary(comparison, stage)
            evaluator.save_report(comparison, f"{stage}_comparison")
        elif len(version_results) == 1:
            evaluator.save_report(version_results[0], stage)


if __name__ == '__main__':
    asyncio.run(main())
