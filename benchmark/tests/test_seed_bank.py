from __future__ import annotations

from benchmark.seed_bank import search_bank, validation_bank


def test_stream_is_deterministic_across_calls():
    bank = search_bank()
    a = bank.stream("some-fixture", 10)
    b = bank.stream("some-fixture", 10)
    assert a == b


def test_different_keys_give_different_streams():
    bank = search_bank()
    a = bank.stream("fixture-a", 10)
    b = bank.stream("fixture-b", 10)
    assert a != b


def test_search_and_validation_banks_are_disjoint_roots():
    search = search_bank()
    validation = validation_bank()
    assert search.root_seed != validation.root_seed
    a = search.stream("same-key", 50)
    b = validation.stream("same-key", 50)
    assert set(a).isdisjoint(set(b))


def test_seed_for_matches_stream_index():
    bank = search_bank()
    stream = bank.stream("k", 5)
    for i in range(5):
        assert bank.seed_for("k", i) == stream[i]


def test_seeds_fit_uint32_range():
    bank = search_bank()
    for seed in bank.stream("range-check", 200):
        assert 0 <= seed < 2**32
