// Ponte determinística entre o motor TypeScript (src/engine) e a ferramenta de benchmark em
// Python (benchmark/). Processo Node de vida longa: lê um pedido JSON por linha em stdin, escreve
// uma resposta JSON por linha em stdout (JSONL nos dois sentidos) — evita o custo de subir um
// processo Node novo por partida, essencial pros perfis de dezenas/centenas de milhares de jogos.
//
// Roda sob `vite-node` (não `node` puro): `generation/world.ts` usa `import.meta.glob`, uma
// sintaxe exclusiva do Vite/Rollup pra carregar os JSONs de src/data/brasileirao-2026 — sem o
// resolvedor do Vite por trás, esse import quebra. Ver benchmark/README.md.
//
// Contrato (um objeto JSON por linha):
//
//   Pedido:  { "cmd": "ping" | "config_schema" | "world_ratings" | "match" | "season", ... }
//   Resposta: { "ok": true,  "cmd": "...", "run_id"?: "...", "data": {...} }
//           | { "ok": false, "cmd": "...", "run_id"?: "...", "error": "mensagem" }
//
// Ver os tipos de pedido/resposta abaixo (MatchRequest, SeasonRequest, ...) — são a fonte da
// verdade do protocolo; benchmark/src/benchmark/engine_adapter.py espelha esses campos.

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { generateWorld } from '../../src/engine/generation/world';
import { createBrasileiraoCareer } from '../../src/engine/generation/career';
import { generateNextSeason } from '../../src/engine/generation/season';
import { advanceCalendar } from '../../src/engine/simulation/season';
import {
  applyEngineParamOverrides,
  applyFormationShape,
  computeSectorStrengths,
  currentEngineParams,
  defaultEngineParams,
  ENGINE_PARAM_NAMES,
  pickAutoLineup,
  resetEngineParams,
  simulateMatch,
  sortStandings,
  type MatchSubstitution,
  type MatchTeamInput,
} from '../../src/engine/simulation';
import type { Club } from '../../src/engine/types/club';
import type { EngineTraceEntry } from '../../src/engine/types/match';
import type { CareerState, World } from '../../src/engine/types/career';
import type { Formation, Lineup, TacticalIntensity, Tactics, TacticStyle } from '../../src/engine/types/tactics';

// --- Identidade do motor / hash de configuração --------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');

function computeEngineVersion(): string {
  let version = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    version = pkg.version ?? version;
  } catch {
    /* segue com o default */
  }
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim();
  } catch {
    /* fora de um repo git (ex.: pacote extraído) — mantém 'unknown' */
  }
  const dirty = (() => {
    try {
      return execSync('git status --porcelain', { cwd: REPO_ROOT }).toString().trim().length > 0 ? '-dirty' : '';
    } catch {
      return '';
    }
  })();
  return `${version}+${sha}${dirty}`;
}

const ENGINE_VERSION = computeEngineVersion();

function stableStringify(values: Record<string, number>): string {
  const sortedEntries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

function currentConfigHash(): string {
  return createHash('sha256').update(stableStringify(currentEngineParams())).digest('hex').slice(0, 16);
}

/** Reseta e (opcionalmente) reaplica overrides — todo pedido começa dos valores-padrão do código, nunca herda o pedido anterior. */
function applyRequestParams(params?: Record<string, number>): void {
  resetEngineParams();
  if (params) applyEngineParamOverrides(params);
}

// --- Mundo (elenco/clubes reais do Brasileirão 2026) — cacheado por seed ------------------

const DEFAULT_WORLD_SEED = 2026;
const worldCache = new Map<number, World>();

function getWorld(seed: number): World {
  let world = worldCache.get(seed);
  if (!world) {
    world = generateWorld(seed);
    worldCache.set(seed, world);
  }
  return world;
}

function findClub(world: World, clubId: string): Club {
  const club = world.clubs.find((c) => c.id === clubId);
  if (!club) throw new Error(`clube desconhecido: "${clubId}" (world_seed sem esse clube)`);
  return club;
}

function buildMatchTeamInput(world: World, clubId: string, formation?: Formation, style?: TacticStyle): MatchTeamInput {
  const club = findClub(world, clubId);
  const playersById = new Map(world.players.map((p) => [p.id, p]));
  const squad = club.squad.map((id) => playersById.get(id)).filter((p): p is NonNullable<typeof p> => p != null);
  const chosenFormation = formation ?? club.formation ?? '4-4-2';
  const chosenStyle = style ?? club.style ?? 'balanced';
  const starters = pickAutoLineup(squad, chosenFormation);
  return { clubId, players: starters, tactics: { formation: chosenFormation, style: chosenStyle } };
}

// --- cmd: ping --------------------------------------------------------------------------------

function handlePing(): unknown {
  return { pong: true, engine_version: ENGINE_VERSION };
}

// --- cmd: config_schema ------------------------------------------------------------------------

function handleConfigSchema(): unknown {
  return {
    engine_version: ENGINE_VERSION,
    param_names: ENGINE_PARAM_NAMES,
    defaults: defaultEngineParams(),
  };
}

// --- cmd: world_ratings -------------------------------------------------------------------------

interface WorldRatingsRequest {
  cmd: 'world_ratings';
  world_seed?: number;
  tactical_intensity?: TacticalIntensity;
}

function handleWorldRatings(req: WorldRatingsRequest): unknown {
  const worldSeed = req.world_seed ?? DEFAULT_WORLD_SEED;
  const tacticalIntensity = req.tactical_intensity ?? 'subtle';
  const world = getWorld(worldSeed);

  const clubs = world.clubs.map((club) => {
    const team = buildMatchTeamInput(world, club.id);
    // isHome=false: nota "neutra" pra ranquear/estratificar times, sem o viés de mando embutido.
    const strength = applyFormationShape(
      computeSectorStrengths(team.players, false, team.slotPositionByPlayerId),
      team.tactics.formation,
      tacticalIntensity,
    );
    return {
      club_id: club.id,
      name: club.name,
      short_name: club.shortName,
      reputation: club.reputation,
      formation: team.tactics.formation,
      style: team.tactics.style,
      attack: strength.attack,
      defense: strength.defense,
      midfield: strength.midfield,
      overall: (strength.attack + strength.defense + strength.midfield) / 3,
    };
  });

  return { world_seed: worldSeed, tactical_intensity: tacticalIntensity, clubs };
}

// --- cmd: world_players -------------------------------------------------------------------------
// Índice achatado playerId -> posição/clube pro world_seed inteiro — pedido uma vez por corrida
// de benchmark (não por partida), pra atribuir gols/cartões (que só trazem playerId, ver
// MatchEvent) a posição/clube na hora de agregar métricas, sem precisar de trace por partida.

interface WorldPlayersRequest {
  cmd: 'world_players';
  world_seed?: number;
}

function handleWorldPlayers(req: WorldPlayersRequest): unknown {
  const worldSeed = req.world_seed ?? DEFAULT_WORLD_SEED;
  const world = getWorld(worldSeed);
  const clubIdByPlayerId = new Map<string, string>();
  for (const club of world.clubs) {
    for (const playerId of club.squad) clubIdByPlayerId.set(playerId, club.id);
  }
  const players = world.players.map((p) => ({
    id: p.id,
    position: p.position,
    club_id: clubIdByPlayerId.get(p.id) ?? null,
    strength: p.strength,
  }));
  return { world_seed: worldSeed, players };
}

// --- cmd: squad -----------------------------------------------------------------------------
// Devolve titulares + banco de um clube — usado pelo benchmark pra montar cenários de
// substituição roteirizados (precisa do objeto Player inteiro pra alimentar de volta
// `MatchSubstitution.playerIn`, não só o id).

interface SquadRequest {
  cmd: 'squad';
  world_seed?: number;
  club_id: string;
  formation?: Formation;
  style?: TacticStyle;
}

function handleSquad(req: SquadRequest): unknown {
  const worldSeed = req.world_seed ?? DEFAULT_WORLD_SEED;
  const world = getWorld(worldSeed);
  const club = findClub(world, req.club_id);
  const playersById = new Map(world.players.map((p) => [p.id, p]));
  const squad = club.squad.map((id) => playersById.get(id)).filter((p): p is NonNullable<typeof p> => p != null);
  const formation = req.formation ?? club.formation ?? '4-4-2';
  const style = req.style ?? club.style ?? 'balanced';
  const starters = pickAutoLineup(squad, formation);
  const starterIds = new Set(starters.map((p) => p.id));
  const bench = squad.filter((p) => !starterIds.has(p.id));
  return { world_seed: worldSeed, club_id: req.club_id, formation, style, starters, bench };
}

// --- cmd: match -----------------------------------------------------------------------------

interface MatchRequest {
  cmd: 'match';
  run_id: string;
  fixture_id?: string;
  world_seed?: number;
  seed: number;
  home_club_id: string;
  away_club_id: string;
  home_formation?: Formation;
  home_style?: TacticStyle;
  away_formation?: Formation;
  away_style?: TacticStyle;
  tactical_intensity?: TacticalIntensity;
  substitutions?: MatchSubstitution[];
  params?: Record<string, number>;
  /** Se true, também devolve o trace bruto (`onChance`) — minuto a minuto, caro; usar só numa amostra estratificada/falhas. */
  trace?: boolean;
}

function handleMatch(req: MatchRequest): unknown {
  applyRequestParams(req.params);
  const worldSeed = req.world_seed ?? DEFAULT_WORLD_SEED;
  const world = getWorld(worldSeed);
  const tacticalIntensity = req.tactical_intensity ?? 'subtle';

  const home = buildMatchTeamInput(world, req.home_club_id, req.home_formation, req.home_style);
  const away = buildMatchTeamInput(world, req.away_club_id, req.away_formation, req.away_style);

  let setupEntry: Extract<EngineTraceEntry, { kind: 'setup' }> | undefined;
  const traceEntries: EngineTraceEntry[] = [];
  const onChance = (entry: EngineTraceEntry): void => {
    if (entry.kind === 'setup') setupEntry = entry;
    if (req.trace) traceEntries.push(entry);
  };

  const startedAt = performance.now();
  const result = simulateMatch(home, away, req.seed, tacticalIntensity, onChance, req.substitutions ?? []);
  const durationMs = performance.now() - startedAt;

  return {
    run_id: req.run_id,
    fixture_id: req.fixture_id ?? null,
    seed: req.seed,
    world_seed: worldSeed,
    engine_version: ENGINE_VERSION,
    config_hash: currentConfigHash(),
    tactical_intensity: tacticalIntensity,
    home_team: req.home_club_id,
    away_team: req.away_club_id,
    home_formation: home.tactics.formation,
    home_style: home.tactics.style,
    away_formation: away.tactics.formation,
    away_style: away.tactics.style,
    home_rating: setupEntry?.home ?? null,
    away_rating: setupEntry?.away ?? null,
    possession_home_target: setupEntry?.possessionHome ?? null,
    home_goals: result.homeGoals,
    away_goals: result.awayGoals,
    events: result.events,
    stats: result.stats,
    man_of_the_match: result.manOfTheMatch,
    duration_ms: durationMs,
    trace: req.trace ? traceEntries : undefined,
  };
}

// --- cmd: season ------------------------------------------------------------------------------
//
// Reaproveita o motor de temporada real (createBrasileiraoCareer/generateNextSeason +
// advanceCalendar) sem alteração nenhuma: usando um playerClubId sentinela que não bate com
// clube nenhum, o "time do jogador" nunca é encontrado, então advanceCalendar trata a temporada
// INTEIRA como CPU x CPU e simula tudo de uma vez.
//
// `full_season` (default true) escolhe a temporada de base:
//   true  — generateNextSeason: 38 rodadas completas do zero (turno+returno real), tabela
//           zerada — o que o benchmark Monte Carlo de temporada quer (réplicas independentes
//           comparáveis a uma temporada real completa).
//   false — createBrasileiraoCareer: ancora no snapshot real (`standings-current.json`) e só
//           simula da rodada atual em diante — útil pra validar "resto da temporada" contra o
//           que de fato aconteceu a partir de hoje, mas cobre menos rodadas.

const SENTINEL_CLUB_ID = '__benchmark_no_player_club__';
const DUMMY_TACTICS: Tactics = { formation: '4-4-2', style: 'balanced' };
const DUMMY_LINEUP: Lineup = { starters: [], formation: '4-4-2', captain: '', penaltyTaker: '', freeKickTaker: '' };
/** Ano-base pra generateNextSeason (só desloca a data de início; irrelevante pro resultado estatístico). */
const FULL_SEASON_PREVIOUS_YEAR = 2025;

interface SeasonRequest {
  cmd: 'season';
  run_id: string;
  seed: number;
  tactical_intensity?: TacticalIntensity;
  full_season?: boolean;
  params?: Record<string, number>;
  /** Se true, cada partida inclui a lista de eventos completa (caro pra Monte Carlo em massa). */
  trace?: boolean;
}

function buildFullSeasonState(seed: number, tacticalIntensity: TacticalIntensity): CareerState {
  const world = getWorld(seed);
  const teams = world.clubs.map((c) => c.id);
  const season = generateNextSeason(FULL_SEASON_PREVIOUS_YEAR, teams);
  return {
    seed,
    trainer: { id: 'benchmark', name: 'Benchmark' },
    playerClubId: SENTINEL_CLUB_ID,
    world,
    season,
    history: [],
    settings: { tacticalIntensity },
  };
}

function handleSeason(req: SeasonRequest): unknown {
  applyRequestParams(req.params);
  const tacticalIntensity = req.tactical_intensity ?? 'subtle';
  const fullSeason = req.full_season ?? true;

  const state = fullSeason
    ? buildFullSeasonState(req.seed, tacticalIntensity)
    : createBrasileiraoCareer(req.seed, { id: 'benchmark', name: 'Benchmark' }, SENTINEL_CLUB_ID, tacticalIntensity);

  const startedAt = performance.now();
  const { nextState, seasonFinished } = advanceCalendar(state, { playerLineup: DUMMY_LINEUP, playerTactics: DUMMY_TACTICS });
  const durationMs = performance.now() - startedAt;

  if (!seasonFinished) {
    throw new Error('season: advanceCalendar não terminou a temporada — SENTINEL_CLUB_ID colidiu com um clube real?');
  }

  const competition = nextState.season.competitions[0];
  const standings = sortStandings(competition.standings);

  const clubIdByPlayerId = new Map<string, string>();
  for (const club of nextState.world.clubs) {
    for (const playerId of club.squad) clubIdByPlayerId.set(playerId, club.id);
  }

  const matches: unknown[] = [];
  for (const round of competition.fixtures) {
    for (const fixture of round) {
      if (!fixture.result) continue;
      const yellowCards = fixture.result.events.filter((e) => e.type === 'yellow_card');
      const redCards = fixture.result.events.filter((e) => e.type === 'red_card');
      matches.push({
        round: fixture.round,
        date: fixture.date,
        home_team: fixture.homeTeamId,
        away_team: fixture.awayTeamId,
        home_goals: fixture.result.homeGoals,
        away_goals: fixture.result.awayGoals,
        stats: fixture.result.stats,
        yellow_cards_home: yellowCards.filter((e) => e.teamId === fixture.homeTeamId).length,
        yellow_cards_away: yellowCards.filter((e) => e.teamId === fixture.awayTeamId).length,
        red_cards_home: redCards.filter((e) => e.teamId === fixture.homeTeamId).length,
        red_cards_away: redCards.filter((e) => e.teamId === fixture.awayTeamId).length,
        events: req.trace ? fixture.result.events : undefined,
      });
    }
  }

  const players = nextState.world.players.map((p) => ({
    id: p.id,
    position: p.position,
    club_id: clubIdByPlayerId.get(p.id) ?? null,
    strength: p.strength,
    season_stats: p.seasonStats,
  }));

  return {
    run_id: req.run_id,
    seed: req.seed,
    world_seed: req.seed,
    engine_version: ENGINE_VERSION,
    config_hash: currentConfigHash(),
    tactical_intensity: tacticalIntensity,
    full_season: fullSeason,
    standings,
    matches,
    players,
    duration_ms: durationMs,
  };
}

// --- dispatch + loop stdin/stdout --------------------------------------------------------------

interface BaseRequest {
  cmd: string;
  run_id?: string;
}

function handle(req: BaseRequest): unknown {
  switch (req.cmd) {
    case 'ping':
      return handlePing();
    case 'config_schema':
      return handleConfigSchema();
    case 'world_ratings':
      return handleWorldRatings(req as unknown as WorldRatingsRequest);
    case 'squad':
      return handleSquad(req as unknown as SquadRequest);
    case 'world_players':
      return handleWorldPlayers(req as unknown as WorldPlayersRequest);
    case 'match':
      return handleMatch(req as unknown as MatchRequest);
    case 'season':
      return handleSeason(req as unknown as SeasonRequest);
    default:
      throw new Error(`comando desconhecido: "${req.cmd}"`);
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: BaseRequest;
  try {
    req = JSON.parse(trimmed);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: `JSON inválido: ${(err as Error).message}` })}\n`);
    return;
  }

  try {
    const data = handle(req);
    process.stdout.write(`${JSON.stringify({ ok: true, cmd: req.cmd, run_id: req.run_id, data })}\n`);
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, cmd: req.cmd, run_id: req.run_id, error: (err as Error).message })}\n`,
    );
  }
});

rl.on('close', () => process.exit(0));

process.stderr.write(`[benchmark engine server] pronto — engine_version=${ENGINE_VERSION}\n`);
