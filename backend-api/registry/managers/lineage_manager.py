"""
Lineage manager for tracking trial relationships in optimization workflows.

Handles:
- Parent-child relationships
- Branching strategies
- Trial evolution trees
- Ancestor tracking

Used primarily for optimization campaigns where trials branch from each other.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Set
from datetime import datetime

from registry.schemas import Lineage


class LineageManager:
    """
    Manager for trial lineage and relationship tracking.

    Maintains a graph structure of trial relationships for optimization campaigns.
    """

    def __init__(self, registry_root: Path):
        """
        Initialize lineage manager.

        Args:
            registry_root: Root directory for registry data
        """
        self.registry_root = Path(registry_root)
        self.lineage_dir = self.registry_root / "lineage"
        self.lineage_dir.mkdir(parents=True, exist_ok=True)

    def initialize_campaign_lineage(self, campaign_id: str) -> None:
        """
        Initialize lineage tracking for an optimization campaign.

        Args:
            campaign_id: Optimization campaign run_id (parent run)
        """
        lineage_file = self.lineage_dir / f"{campaign_id}_lineage.json"

        lineage_data = {
            "campaign_id": campaign_id,
            "created_at": datetime.now().isoformat(),
            "trials": {},
            "tree": []
        }

        with open(lineage_file, 'w') as f:
            json.dump(lineage_data, f, indent=2)

    def add_trial(
        self,
        campaign_id: str,
        trial_id: str,
        parent_trial_ids: List[str],
        branch_reason: str,
        changes: Dict[str, any],
        metrics: Dict[str, float]
    ) -> None:
        """
        Add a trial to the lineage graph.

        Args:
            campaign_id: Parent campaign ID
            trial_id: New trial run_id
            parent_trial_ids: List of parent trial IDs (can be multiple for merges)
            branch_reason: Reason for creating this trial
            changes: Configuration changes from parent(s)
            metrics: Key metrics for this trial
        """
        lineage_file = self.lineage_dir / f"{campaign_id}_lineage.json"

        if not lineage_file.exists():
            self.initialize_campaign_lineage(campaign_id)

        with open(lineage_file, 'r') as f:
            lineage_data = json.load(f)

        # Create lineage entry
        lineage_entry = Lineage(
            trial_id=trial_id,
            parent_trial_ids=parent_trial_ids,
            children_trial_ids=[],
            branch_reason=branch_reason,
            changes=changes,
            metrics=metrics
        )

        # Add to trials dict
        lineage_data["trials"][trial_id] = lineage_entry.dict()

        # Update parent's children list
        for parent_id in parent_trial_ids:
            if parent_id in lineage_data["trials"]:
                lineage_data["trials"][parent_id]["children_trial_ids"].append(trial_id)

        # Add to tree structure
        lineage_data["tree"].append(lineage_entry.dict())

        # Save
        with open(lineage_file, 'w') as f:
            json.dump(lineage_data, f, indent=2, default=str)

    def get_lineage(self, campaign_id: str) -> Optional[Dict]:
        """
        Get complete lineage for a campaign.

        Args:
            campaign_id: Campaign run_id

        Returns:
            Lineage data dict or None if not found
        """
        lineage_file = self.lineage_dir / f"{campaign_id}_lineage.json"

        if not lineage_file.exists():
            return None

        with open(lineage_file, 'r') as f:
            return json.load(f)

    def get_trial_lineage(self, campaign_id: str, trial_id: str) -> Optional[Lineage]:
        """
        Get lineage info for a specific trial.

        Args:
            campaign_id: Campaign run_id
            trial_id: Trial run_id

        Returns:
            Lineage object or None if not found
        """
        lineage_data = self.get_lineage(campaign_id)

        if not lineage_data or trial_id not in lineage_data["trials"]:
            return None

        return Lineage(**lineage_data["trials"][trial_id])

    def get_ancestors(self, campaign_id: str, trial_id: str) -> List[str]:
        """
        Get all ancestor trial IDs for a trial.

        Args:
            campaign_id: Campaign run_id
            trial_id: Trial run_id

        Returns:
            List of ancestor trial IDs (ordered from root to immediate parent)
        """
        lineage_data = self.get_lineage(campaign_id)

        if not lineage_data:
            return []

        ancestors = []
        visited = set()

        def traverse_ancestors(current_id: str):
            if current_id in visited:
                return
            visited.add(current_id)

            if current_id not in lineage_data["trials"]:
                return

            trial = lineage_data["trials"][current_id]
            for parent_id in trial["parent_trial_ids"]:
                traverse_ancestors(parent_id)
                if parent_id not in ancestors:
                    ancestors.append(parent_id)

        traverse_ancestors(trial_id)
        return ancestors

    def get_descendants(self, campaign_id: str, trial_id: str) -> List[str]:
        """
        Get all descendant trial IDs for a trial.

        Args:
            campaign_id: Campaign run_id
            trial_id: Trial run_id

        Returns:
            List of descendant trial IDs
        """
        lineage_data = self.get_lineage(campaign_id)

        if not lineage_data:
            return []

        descendants = []
        visited = set()

        def traverse_descendants(current_id: str):
            if current_id in visited:
                return
            visited.add(current_id)

            if current_id not in lineage_data["trials"]:
                return

            trial = lineage_data["trials"][current_id]
            for child_id in trial["children_trial_ids"]:
                if child_id not in descendants:
                    descendants.append(child_id)
                traverse_descendants(child_id)

        traverse_descendants(trial_id)
        return descendants

    def get_leaf_trials(self, campaign_id: str) -> List[str]:
        """
        Get all leaf trials (trials with no children).

        These are candidates for next branching in optimization.

        Args:
            campaign_id: Campaign run_id

        Returns:
            List of leaf trial IDs
        """
        lineage_data = self.get_lineage(campaign_id)

        if not lineage_data:
            return []

        leaf_trials = []
        for trial_id, trial_data in lineage_data["trials"].items():
            if not trial_data["children_trial_ids"]:
                leaf_trials.append(trial_id)

        return leaf_trials

    def get_root_trials(self, campaign_id: str) -> List[str]:
        """
        Get root trials (trials with no parents).

        Usually this is the baseline trial.

        Args:
            campaign_id: Campaign run_id

        Returns:
            List of root trial IDs
        """
        lineage_data = self.get_lineage(campaign_id)

        if not lineage_data:
            return []

        root_trials = []
        for trial_id, trial_data in lineage_data["trials"].items():
            if not trial_data["parent_trial_ids"]:
                root_trials.append(trial_id)

        return root_trials

    def get_trial_path(self, campaign_id: str, from_trial_id: str, to_trial_id: str) -> Optional[List[str]]:
        """
        Get path between two trials in the lineage tree.

        Args:
            campaign_id: Campaign run_id
            from_trial_id: Starting trial
            to_trial_id: Target trial

        Returns:
            List of trial IDs forming the path, or None if no path exists
        """
        lineage_data = self.get_lineage(campaign_id)

        if not lineage_data:
            return None

        # BFS to find path
        from collections import deque

        queue = deque([(from_trial_id, [from_trial_id])])
        visited = set([from_trial_id])

        while queue:
            current_id, path = queue.popleft()

            if current_id == to_trial_id:
                return path

            if current_id not in lineage_data["trials"]:
                continue

            trial = lineage_data["trials"][current_id]

            # Check children
            for child_id in trial["children_trial_ids"]:
                if child_id not in visited:
                    visited.add(child_id)
                    queue.append((child_id, path + [child_id]))

            # Check parents (for bidirectional search)
            for parent_id in trial["parent_trial_ids"]:
                if parent_id not in visited:
                    visited.add(parent_id)
                    queue.append((parent_id, path + [parent_id]))

        return None

    def visualize_tree(self, campaign_id: str) -> str:
        """
        Generate ASCII tree visualization of trial lineage.

        Args:
            campaign_id: Campaign run_id

        Returns:
            ASCII tree string
        """
        lineage_data = self.get_lineage(campaign_id)

        if not lineage_data:
            return "No lineage data found"

        # Build tree representation
        lines = [f"Campaign: {campaign_id}", ""]

        root_trials = self.get_root_trials(campaign_id)

        def render_trial(trial_id: str, prefix: str = "", is_last: bool = True):
            trial_data = lineage_data["trials"].get(trial_id)
            if not trial_data:
                return []

            lines = []

            # Current trial
            connector = "└── " if is_last else "├── "
            metrics_str = ", ".join([f"{k}={v:.3f}" for k, v in trial_data["metrics"].items()])
            line = f"{prefix}{connector}{trial_id[:8]}... ({trial_data['branch_reason']}) [{metrics_str}]"
            lines.append(line)

            # Children
            children = trial_data["children_trial_ids"]
            extension = "    " if is_last else "│   "
            for i, child_id in enumerate(children):
                child_is_last = (i == len(children) - 1)
                lines.extend(render_trial(child_id, prefix + extension, child_is_last))

            return lines

        for i, root_id in enumerate(root_trials):
            is_last = (i == len(root_trials) - 1)
            lines.extend(render_trial(root_id, "", is_last))

        return "\n".join(lines)
