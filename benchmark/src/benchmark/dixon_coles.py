"""Dixon-Coles baseline, via `penaltyblog.models.DixonColesGoalModel` (verified against the
project's Python 3.12 venv — see benchmark/README.md's Setup). This is a purely statistical
reference fit to REAL match results; it never sees the engine's events and is never a substitute
for it (SRS "usar o Dixon-Coles como referência externa, não como substituto do motor de
eventos") — comparison.py lines the three up side by side: dados reais x Dixon-Coles x motor.

Fit only on matches strictly BEFORE the evaluation window (caller's responsibility — pass in a
pre-filtered DataFrame) to avoid temporal leakage (SRS "evite qualquer informação futura em
relação à temporada avaliada").
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional

import numpy as np
import pandas as pd
import penaltyblog as pb


@dataclass
class DixonColesFit:
    model: Any
    params: dict[str, float]
    teams: list[str]
    n_matches: int


def fit_dixon_coles(
    matches: pd.DataFrame,
    *,
    home_col: str = "home_team",
    away_col: str = "away_team",
    home_goals_col: str = "home_goals",
    away_goals_col: str = "away_goals",
    weights: Optional[np.ndarray] = None,
) -> DixonColesFit:
    if len(matches) == 0:
        raise ValueError("fit_dixon_coles: nenhuma partida pra treinar o baseline")
    # penaltyblog's Cython loss function needs writable buffers — a plain .to_numpy() off a
    # pandas Series can return a read-only view, which fails deep inside scipy.optimize.minimize.
    model = pb.models.DixonColesGoalModel(
        np.array(matches[home_goals_col], dtype=np.int64),
        np.array(matches[away_goals_col], dtype=np.int64),
        np.array(matches[home_col], dtype=object),
        np.array(matches[away_col], dtype=object),
        weights=weights,
    )
    model.fit()
    teams = sorted(set(matches[home_col]) | set(matches[away_col]))
    return DixonColesFit(model=model, params=model.get_params(), teams=teams, n_matches=len(matches))


def team_strengths(fit: DixonColesFit) -> pd.DataFrame:
    rows = [
        {
            "team": team,
            "attack": fit.params.get(f"attack_{team}"),
            "defence": fit.params.get(f"defence_{team}"),
            "home_advantage": fit.params.get("home_advantage"),
            "rho": fit.params.get("rho"),
        }
        for team in fit.teams
    ]
    return pd.DataFrame(rows)


def predict_match(fit: DixonColesFit, home_team: str, away_team: str, *, max_goals: int = 10) -> dict:
    if home_team not in fit.teams or away_team not in fit.teams:
        return {
            "home_team": home_team,
            "away_team": away_team,
            "home_goal_expectation": None,
            "away_goal_expectation": None,
            "home_win": None,
            "draw": None,
            "away_win": None,
            "note": "time fora do conjunto de treino do Dixon-Coles",
        }
    grid = fit.model.predict(home_team, away_team, max_goals=max_goals)
    return {
        "home_team": home_team,
        "away_team": away_team,
        "home_goal_expectation": float(grid.home_goal_expectation),
        "away_goal_expectation": float(grid.away_goal_expectation),
        "home_win": float(grid.home_win),
        "draw": float(grid.draw),
        "away_win": float(grid.away_win),
        "score_matrix": grid.grid.tolist(),
    }


def predict_fixtures(fit: DixonColesFit, fixtures: Iterable[tuple[str, str]], *, max_goals: int = 10) -> pd.DataFrame:
    return pd.DataFrame([predict_match(fit, h, a, max_goals=max_goals) for h, a in fixtures])


def dixon_coles_aggregate_metrics(fit: DixonColesFit, fixtures: Iterable[tuple[str, str]]) -> dict:
    """Same shape as metrics.goal_metrics()'s headline numbers, but from the DC model's predicted
    probabilities rather than simulated matches — what comparison.py lines up against the engine."""
    predictions = predict_fixtures(fit, fixtures)
    predictions = predictions.dropna(subset=["home_win"])
    if len(predictions) == 0:
        return {"n": 0}
    return {
        "n": int(len(predictions)),
        "goals_per_match": float((predictions["home_goal_expectation"] + predictions["away_goal_expectation"]).mean()),
        "goals_per_match_home": float(predictions["home_goal_expectation"].mean()),
        "goals_per_match_away": float(predictions["away_goal_expectation"].mean()),
        "home_win_rate": float(predictions["home_win"].mean()),
        "draw_rate": float(predictions["draw"].mean()),
        "away_win_rate": float(predictions["away_win"].mean()),
    }
