"""
Evaluation metrics for entity profiling stage
Measures: completeness, accuracy, synonym coverage, spelling variants
"""
from typing import Dict, Any, List
import re


class EntityProfilingMetrics:
    """Metrics for evaluating entity profile generation quality"""

    @staticmethod
    def schema_field_completeness(profile: Dict[str, Any], schema: Dict[str, Any]) -> float:
        """
        Calculate what percentage of schema fields are populated

        Returns: Float 0.0-1.0 representing completeness
        """
        if 'properties' not in schema:
            return 0.0

        total_fields = len(schema['properties'])
        if total_fields == 0:
            return 0.0

        populated_fields = 0
        for field_name in schema['properties'].keys():
            if field_name in profile:
                value = profile[field_name]
                # Check if value is non-empty
                if value:
                    if isinstance(value, list) and len(value) > 0:
                        populated_fields += 1
                    elif isinstance(value, str) and value.strip():
                        populated_fields += 1
                    elif isinstance(value, dict) and len(value) > 0:
                        populated_fields += 1
                    elif not isinstance(value, (list, str, dict)):
                        populated_fields += 1

        return populated_fields / total_fields

    @staticmethod
    def core_concept_accuracy(profile: Dict[str, Any], expected: Dict[str, Any]) -> Dict[str, Any]:
        """
        Check if core concept matches expected value

        Returns: Dict with exact_match (bool) and similarity_score (0.0-1.0)
        """
        actual = profile.get('core_concept', '').lower().strip()
        expected_concept = expected.get('core_concept', '').lower().strip()

        exact_match = actual == expected_concept

        # Token-based similarity for partial credit
        actual_tokens = set(actual.split())
        expected_tokens = set(expected_concept.split())

        if len(expected_tokens) == 0:
            similarity = 0.0
        else:
            overlap = len(actual_tokens & expected_tokens)
            similarity = overlap / len(expected_tokens)

        return {
            'exact_match': exact_match,
            'similarity_score': similarity,
            'actual': actual,
            'expected': expected_concept
        }

    @staticmethod
    def synonym_coverage(profile: Dict[str, Any], expected: Dict[str, Any]) -> Dict[str, Any]:
        """
        Measure how many expected synonyms are found in profile

        Returns: Dict with coverage score, found count, and missing synonyms
        """
        # Collect all string values from profile (flatten all arrays and strings)
        profile_terms = set()
        for value in profile.values():
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        profile_terms.add(item.lower().strip())
            elif isinstance(value, str):
                profile_terms.add(value.lower().strip())

        # Get expected synonyms
        expected_synonyms = expected.get('synonyms', [])
        expected_synonyms_lower = [s.lower().strip() for s in expected_synonyms]

        if len(expected_synonyms_lower) == 0:
            return {
                'coverage_score': 1.0,
                'found_count': 0,
                'total_expected': 0,
                'missing': []
            }

        # Check which expected synonyms are found
        found_count = sum(1 for syn in expected_synonyms_lower if syn in profile_terms)
        missing = [syn for syn in expected_synonyms if syn.lower().strip() not in profile_terms]

        coverage_score = found_count / len(expected_synonyms_lower)

        return {
            'coverage_score': coverage_score,
            'found_count': found_count,
            'total_expected': len(expected_synonyms_lower),
            'missing': missing
        }

    @staticmethod
    def spelling_variant_presence(profile: Dict[str, Any]) -> Dict[str, Any]:
        """
        Check for presence of US/GB spelling variant pairs

        Returns: Dict with variant_pair_count and example pairs
        """
        # Common US/GB spelling patterns
        variant_patterns = [
            (r'\b(\w+)or\b', r'\b\1our\b'),  # color/colour
            (r'\b(\w+)ize\b', r'\b\1ise\b'),  # analyze/analyse
            (r'\b(\w+)ization\b', r'\b\1isation\b'),  # organization/organisation
            (r'\b(\w+)yze\b', r'\b\1yse\b'),  # analyze/analyse
            (r'\b(\w+)ter\b', r'\b\1tre\b'),  # center/centre
            (r'\b(\w+)er\b', r'\b\1re\b'),    # fiber/fibre
        ]

        # Collect all terms from profile
        all_terms = []
        for value in profile.values():
            if isinstance(value, list):
                all_terms.extend([str(item).lower() for item in value if isinstance(item, str)])
            elif isinstance(value, str):
                all_terms.append(value.lower())

        found_pairs = []
        terms_set = set(all_terms)

        for term in terms_set:
            for us_pattern, gb_pattern in variant_patterns:
                # Check if term matches US pattern and GB variant exists
                if re.search(us_pattern, term):
                    gb_variant = re.sub(us_pattern, gb_pattern.replace(r'\b', '').replace(r'\1', r'\g<1>'), term)
                    if gb_variant in terms_set and gb_variant != term:
                        found_pairs.append((term, gb_variant))

        return {
            'variant_pair_count': len(found_pairs),
            'example_pairs': found_pairs[:5],
            'has_variants': len(found_pairs) > 0
        }

    @staticmethod
    def array_field_richness(profile: Dict[str, Any], schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        Measure richness of array fields (how many items per array)

        Returns: Dict with average items per array and field details
        """
        array_fields = []

        if 'properties' in schema:
            for field_name, field_def in schema['properties'].items():
                if field_def.get('type') == 'array' and field_name in profile:
                    value = profile[field_name]
                    if isinstance(value, list):
                        array_fields.append({
                            'field': field_name,
                            'item_count': len(value)
                        })

        if len(array_fields) == 0:
            return {
                'average_items_per_array': 0.0,
                'total_array_fields': 0,
                'field_details': []
            }

        total_items = sum(f['item_count'] for f in array_fields)
        avg_items = total_items / len(array_fields)

        return {
            'average_items_per_array': avg_items,
            'total_array_fields': len(array_fields),
            'field_details': sorted(array_fields, key=lambda x: x['item_count'], reverse=True)
        }

    @classmethod
    def evaluate_all(cls, profile: Dict[str, Any], expected: Dict[str, Any], schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        Run all entity profiling metrics

        Returns: Comprehensive evaluation report
        """
        return {
            'completeness': cls.schema_field_completeness(profile, schema),
            'core_concept': cls.core_concept_accuracy(profile, expected),
            'synonym_coverage': cls.synonym_coverage(profile, expected),
            'spelling_variants': cls.spelling_variant_presence(profile),
            'array_richness': cls.array_field_richness(profile, schema)
        }
