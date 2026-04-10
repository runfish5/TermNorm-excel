"""Token-based matcher for candidate filtering using inverted index lookup."""
import re
from collections import defaultdict

from config.pipeline_config import get_node_config

_TM_CONFIG = get_node_config("token_matching")


class TokenLookupMatcher:
    """Token-based matcher that builds an inverted index for fast candidate lookup."""

    def __init__(self, terms: list[str]):
        self.deduplicated_terms = list(set(terms))
        self.token_term_lookup = self._build_index()

    def _tokenize(self, text):
        return set(re.findall(_TM_CONFIG["tokenization_regex"], str(text).lower()))

    def _build_index(self):
        index = defaultdict(set)
        for i, term in enumerate(self.deduplicated_terms):
            for token in self._tokenize(term):
                index[token].add(i)
        return index

    def match(self, query) -> list[tuple[str, float]]:
        query_tokens = self._tokenize(query)
        if not query_tokens:
            return []

        # Find candidates
        candidates = set()
        for token in query_tokens:
            candidates.update(self.token_term_lookup.get(token, set()))

        # Score candidates
        scores = []
        for i in candidates:
            term_tokens = self._tokenize(self.deduplicated_terms[i])
            shared_token_count = len(query_tokens & term_tokens)
            if shared_token_count > 0:
                score = shared_token_count / len(term_tokens)
                scores.append((self.deduplicated_terms[i], score))

        return sorted(scores, key=lambda x: x[1], reverse=True)
