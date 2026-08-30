"""Deterministic seed generation for the benchmark, split into two disjoint banks:

- **search**: used during development/calibration (Optuna trials, sensitivity analysis, smoke/
  nightly profiles). Free to look at, free to overfit to.
- **validation**: a *disjoint* root seed, used only to re-evaluate calibration finalists and for
  the `release` profile. Never touched during search — that's what keeps it meaningful as a
  held-out check (SRS "candidatos são reavaliados com validation seeds").

Seeds are derived purely from (root_seed, key, index) via `numpy.random.SeedSequence` — nothing
is persisted to reproduce a given match's seed; the same (bank, key, index) always yields the
same uint32 seed, which is what the engine's `mulberry32(seed)` consumes. `materialize()` exists
only to write an auditable snapshot of resolved seeds for a run, not because storage is required
for reproducibility.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal

import numpy as np

BankKind = Literal["search", "validation"]

# Arbitrary, fixed, disjoint 64-bit constants — never change these, or every prior run's seeds
# become unreproducible. Two independent-looking constants (not derived from one another) so a
# bug that mixes them up is more likely to be caught by a sanity check than silently pass.
SEARCH_ROOT_SEED = 0xB5A115EED0DDBA11
VALIDATION_ROOT_SEED = 0xFA11DA7A5AFE1D01


def _key_to_int(key: str) -> int:
    """Stable string -> int, independent of PYTHONHASHSEED (unlike builtin hash())."""
    digest = hashlib.sha256(key.encode("utf-8")).digest()[:8]
    return int.from_bytes(digest, "big")


@dataclass(frozen=True)
class SeedBank:
    kind: BankKind
    root_seed: int

    @classmethod
    def create(cls, kind: BankKind) -> "SeedBank":
        root = SEARCH_ROOT_SEED if kind == "search" else VALIDATION_ROOT_SEED
        return cls(kind=kind, root_seed=root)

    def stream(self, key: str, n: int) -> list[int]:
        """`n` independent uint32 seeds for `key` (e.g. a fixture_id, or "season"). Deterministic:
        calling this again with the same (kind, root_seed, key, n) always returns the same list."""
        if n <= 0:
            return []
        child = np.random.SeedSequence([self.root_seed, _key_to_int(key)])
        return [int(x) for x in child.generate_state(n, dtype=np.uint32)]

    def seed_for(self, key: str, index: int) -> int:
        """The seed at position `index` (0-based) of `key`'s stream. O(index) — prefer `stream()`
        when you need several seeds for the same key."""
        return self.stream(key, index + 1)[index]


def search_bank() -> SeedBank:
    return SeedBank.create("search")


def validation_bank() -> SeedBank:
    return SeedBank.create("validation")


def materialize(bank: SeedBank, keys: list[str], n_per_key: int) -> dict[str, list[int]]:
    """Resolve concrete seeds for a set of keys — for writing an auditable snapshot, not required
    for reproducibility (see module docstring)."""
    return {key: bank.stream(key, n_per_key) for key in keys}
