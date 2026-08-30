"""Python <-> Node bridge to the footmanager TypeScript match/season engine.

The engine (src/engine/**) is pure TypeScript and stays untouched by this package (besides the
one additive change in src/engine/simulation/config.ts — see benchmark/README.md's "Integração
com o motor"). We talk to it through a persistent `vite-node` subprocess
(benchmark/engine/server.ts) over JSONL on stdin/stdout: one JSON object per line in, one JSON
object per line out, strictly request-then-response (the Node side has no async I/O in its
handlers, so ordering is guaranteed FIFO — no need for a request multiplexer).

`vite-node` (not plain `node`/`tsx`) is required because `generation/world.ts` uses Vite's
`import.meta.glob` to load the real Brasileirão 2026 roster JSONs — that syntax only exists
inside Vite's module graph.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Optional


class EngineError(RuntimeError):
    """Raised for anything that goes wrong talking to the Node engine server."""


def find_repo_root(start: Optional[Path] = None) -> Path:
    """Walk upward from `start` (default: this file) looking for the footmanager repo root.

    Recognized by having both `package.json` (name "footmanager") and
    `benchmark/engine/server.ts`. Override with the FOOTMANAGER_REPO_ROOT env var when this
    package is installed/vendored somewhere that breaks the directory-layout assumption.
    """
    env_override = os.environ.get("FOOTMANAGER_REPO_ROOT")
    if env_override:
        return Path(env_override).resolve()

    here = (start or Path(__file__)).resolve()
    for candidate in [here, *here.parents]:
        server = candidate / "benchmark" / "engine" / "server.ts"
        pkg = candidate / "package.json"
        if server.exists() and pkg.exists():
            return candidate
    raise EngineError(
        "não encontrei a raiz do repositório footmanager (procurando por "
        "benchmark/engine/server.ts) — defina FOOTMANAGER_REPO_ROOT"
    )


class EngineAdapter:
    """One persistent vite-node worker process. Not thread-safe — one instance per OS process
    (see benchmark/src/benchmark/simulation.py's multiprocessing pool, which creates one adapter
    per worker via a pool initializer)."""

    def __init__(self, repo_root: Optional[Path] = None):
        self.repo_root = repo_root or find_repo_root()
        self.vite_node = self.repo_root / "node_modules" / ".bin" / "vite-node"
        self.server_script = self.repo_root / "benchmark" / "engine" / "server.ts"
        self._proc: Optional[subprocess.Popen] = None
        self._request_count = 0
        self.engine_version: Optional[str] = None

    # -- lifecycle -------------------------------------------------------------------------

    def start(self) -> "EngineAdapter":
        if self._proc is not None:
            return self
        if not self.vite_node.exists():
            raise EngineError(
                f"vite-node não encontrado em {self.vite_node} — rode `npm install` na raiz do repo"
            )
        self._proc = subprocess.Popen(
            [str(self.vite_node), str(self.server_script)],
            cwd=self.repo_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,  # line-buffered
        )
        pong = self.request("ping")
        if not pong.get("pong"):
            raise EngineError("engine server não respondeu 'pong' ao ping inicial")
        self.engine_version = pong.get("engine_version")
        return self

    def stop(self) -> None:
        if self._proc is None:
            return
        proc = self._proc
        self._proc = None
        try:
            if proc.stdin:
                proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)

    def __enter__(self) -> "EngineAdapter":
        return self.start()

    def __exit__(self, *exc_info: object) -> None:
        self.stop()

    # -- protocol ----------------------------------------------------------------------------

    def request(self, cmd: str, **kwargs: Any) -> dict:
        if self._proc is None:
            self.start()
        proc = self._proc
        assert proc is not None and proc.stdin is not None and proc.stdout is not None

        self._request_count += 1
        run_id = kwargs.pop("run_id", None) or f"req-{self._request_count}"
        payload = {"cmd": cmd, "run_id": run_id, **kwargs}
        line = json.dumps(payload, allow_nan=False)

        try:
            proc.stdin.write(line + "\n")
            proc.stdin.flush()
        except BrokenPipeError as exc:
            raise EngineError(f"pipe do engine server quebrou ao enviar {cmd!r}: {self._drain_stderr()}") from exc

        response_line = proc.stdout.readline()
        if response_line == "":
            exit_code = proc.poll()
            raise EngineError(
                f"engine server fechou stdout (exit={exit_code}) esperando resposta de {cmd!r}.\n"
                f"{self._drain_stderr()}"
            )

        try:
            response = json.loads(response_line)
        except json.JSONDecodeError as exc:
            raise EngineError(f"engine server mandou JSON inválido: {response_line!r}") from exc

        got_run_id = response.get("run_id")
        if got_run_id is not None and got_run_id != run_id:
            raise EngineError(
                f"resposta fora de ordem do engine server: esperava run_id={run_id!r}, veio {got_run_id!r}"
            )
        if not response.get("ok"):
            raise EngineError(f"engine server retornou erro para {cmd!r} (run_id={run_id}): {response.get('error')}")
        return response["data"]

    def _drain_stderr(self) -> str:
        if self._proc is None or self._proc.stderr is None:
            return ""
        try:
            return self._proc.stderr.read()
        except Exception:
            return ""

    # -- convenience wrappers (mirror server.ts's cmd handlers) --------------------------------

    def ping(self) -> dict:
        return self.request("ping")

    def config_schema(self) -> dict:
        return self.request("config_schema")

    def world_ratings(self, world_seed: int = 2026, tactical_intensity: str = "subtle") -> dict:
        return self.request("world_ratings", world_seed=world_seed, tactical_intensity=tactical_intensity)

    def world_players(self, world_seed: int = 2026) -> dict:
        return self.request("world_players", world_seed=world_seed)

    def run_match(self, **kwargs: Any) -> dict:
        """kwargs: run_id?, fixture_id?, world_seed?, seed, home_club_id, away_club_id,
        home_formation?, home_style?, away_formation?, away_style?, tactical_intensity?,
        substitutions?, params?, trace?"""
        return self.request("match", **kwargs)

    def run_season(self, **kwargs: Any) -> dict:
        """kwargs: run_id?, seed, tactical_intensity?, full_season?, params?, trace?"""
        return self.request("season", **kwargs)
