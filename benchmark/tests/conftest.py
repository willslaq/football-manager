from __future__ import annotations

from pathlib import Path

import pytest

from benchmark.engine_adapter import EngineAdapter

BENCHMARK_DIR = Path(__file__).resolve().parents[1]
WORLD_SEED = 2026


@pytest.fixture(scope="session")
def adapter():
    """One persistent engine subprocess shared across the whole test session — spawning
    vite-node per test would dominate the suite's runtime."""
    with EngineAdapter(repo_root=BENCHMARK_DIR.parent) as a:
        yield a


@pytest.fixture(scope="session")
def club_ids(adapter) -> list[str]:
    ratings = adapter.world_ratings(world_seed=WORLD_SEED)
    return [c["club_id"] for c in ratings["clubs"]]
