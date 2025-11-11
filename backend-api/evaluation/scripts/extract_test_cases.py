"""
Extract Test Cases from Activity Logs

Parse logs/activity.jsonl to create ground truth test datasets
for evaluation and prompt optimization.
"""

import json
from pathlib import Path
from typing import List, Dict, Any
from collections import defaultdict
import argparse


def load_activity_log(log_file: Path) -> List[Dict[str, Any]]:
    """
    Load activity log entries from JSONL file

    Args:
        log_file: Path to activity.jsonl

    Returns:
        List of log entry dictionaries
    """
    entries = []

    if not log_file.exists():
        print(f"Log file not found: {log_file}")
        return entries

    with open(log_file, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue

            try:
                entry = json.loads(line)
                entries.append(entry)
            except json.JSONDecodeError as e:
                print(f"Error parsing line {line_num}: {e}")
                continue

    return entries


def extract_test_cases(
    entries: List[Dict[str, Any]],
    min_candidates: int = 3,
    include_user_selections: bool = True
) -> List[Dict[str, Any]]:
    """
    Extract test cases from activity log entries

    Args:
        entries: List of activity log entries
        min_candidates: Minimum number of candidate terms required
        include_user_selections: Only include cases where user made a selection

    Returns:
        List of test case dictionaries
    """
    test_cases = []
    seen_queries = set()

    for entry in entries:
        # Extract relevant fields
        query = entry.get("query", "").strip()
        terms = entry.get("terms", [])
        selected_term = entry.get("selected_term", "")
        user_action = entry.get("user_action", "")

        # Skip if query is empty or too short
        if not query or len(query) < 3:
            continue

        # Skip if not enough candidate terms
        if len(terms) < min_candidates:
            continue

        # Skip if we want only user selections and there isn't one
        if include_user_selections and not selected_term:
            continue

        # Skip duplicate queries (keep first occurrence)
        query_key = query.lower()
        if query_key in seen_queries:
            continue
        seen_queries.add(query_key)

        # Create test case
        test_case = {
            "query": query,
            "terms": terms,
        }

        if selected_term:
            test_case["expected_match"] = selected_term

        # Add metadata if available
        if "timestamp" in entry:
            test_case["source_timestamp"] = entry["timestamp"]

        if "web_search_status" in entry:
            test_case["source_web_search_status"] = entry["web_search_status"]

        test_cases.append(test_case)

    return test_cases


def categorize_test_cases(test_cases: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Categorize test cases by query characteristics

    Args:
        test_cases: List of test cases

    Returns:
        Dictionary mapping category names to test case lists
    """
    categorized = defaultdict(list)

    for test_case in test_cases:
        query = test_case["query"].lower()

        # Simple keyword-based categorization
        # (In production, you might use more sophisticated categorization)
        if any(word in query for word in ["steel", "aluminum", "metal", "alloy", "material"]):
            category = "materials"
        elif any(word in query for word in ["welding", "machining", "process", "cutting", "forming"]):
            category = "processes"
        elif any(word in query for word in ["pipe", "tube", "fitting", "valve", "component"]):
            category = "products"
        elif any(word in query for word in ["iso", "standard", "specification", "astm", "din"]):
            category = "standards"
        else:
            category = "general"

        test_case["category"] = category
        categorized[category].append(test_case)

    return dict(categorized)


def save_test_cases(
    test_cases: List[Dict[str, Any]],
    output_file: Path,
    pretty: bool = True
):
    """
    Save test cases to JSON file

    Args:
        test_cases: List of test cases
        output_file: Output file path
        pretty: Use pretty printing
    """
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w', encoding='utf-8') as f:
        if pretty:
            json.dump(test_cases, f, indent=2, ensure_ascii=False)
        else:
            for test_case in test_cases:
                f.write(json.dumps(test_case, ensure_ascii=False) + '\n')

    print(f"Saved {len(test_cases)} test cases to: {output_file}")


def main():
    """Main extraction script"""
    parser = argparse.ArgumentParser(
        description="Extract test cases from TermNorm activity logs"
    )
    parser.add_argument(
        "--log-file",
        type=str,
        default="../logs/activity.jsonl",
        help="Path to activity.jsonl (default: ../logs/activity.jsonl)"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="../evaluation/configs/test_datasets.json",
        help="Output JSON file path"
    )
    parser.add_argument(
        "--min-candidates",
        type=int,
        default=3,
        help="Minimum number of candidate terms (default: 3)"
    )
    parser.add_argument(
        "--all-queries",
        action="store_true",
        help="Include all queries, not just those with user selections"
    )
    parser.add_argument(
        "--categorize",
        action="store_true",
        help="Save categorized test cases to separate files"
    )
    parser.add_argument(
        "--jsonl",
        action="store_true",
        help="Save as JSONL instead of JSON"
    )

    args = parser.parse_args()

    print("=" * 60)
    print("TermNorm Test Case Extraction")
    print("=" * 60)

    # Resolve paths
    script_dir = Path(__file__).parent
    log_file = (script_dir / args.log_file).resolve()
    output_file = (script_dir / args.output).resolve()

    print(f"\nLog file: {log_file}")
    print(f"Output file: {output_file}")

    # Load activity log
    print("\nLoading activity log...")
    entries = load_activity_log(log_file)
    print(f"Loaded {len(entries)} log entries")

    if not entries:
        print("\nNo entries found. Exiting.")
        return

    # Extract test cases
    print("\nExtracting test cases...")
    test_cases = extract_test_cases(
        entries,
        min_candidates=args.min_candidates,
        include_user_selections=not args.all_queries
    )
    print(f"Extracted {len(test_cases)} test cases")

    if not test_cases:
        print("\nNo test cases extracted. Try using --all-queries flag.")
        return

    # Save test cases
    if args.categorize:
        print("\nCategorizing test cases...")
        categorized = categorize_test_cases(test_cases)

        for category, cases in categorized.items():
            category_file = output_file.parent / f"test_datasets_{category}.json"
            save_test_cases(cases, category_file, pretty=not args.jsonl)
            print(f"  {category}: {len(cases)} cases")

    else:
        save_test_cases(test_cases, output_file, pretty=not args.jsonl)

    print("\n" + "=" * 60)
    print("Extraction Complete!")
    print("\nNext steps:")
    print("  1. Review test cases in:", output_file)
    print("  2. Run experiments: python evaluation/scripts/run_experiment.py")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
