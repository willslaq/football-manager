import { deriveSeed } from '../rng';
import type { CareerState } from '../types/career';
import type { Club, ClubId } from '../types/club';
import type { Competition, Fixture, StandingEntry } from '../types/competition';
import type { EngineTraceEntry } from '../types/match';
import type { Player } from '../types/player';
import type { Lineup, Tactics } from '../types/tactics';
import { autoAssign, buildSlots, slotPositionsByPlayer } from './formation';
import { simulateMatch, type MatchTeamInput } from './match';

/** Escalação/tática usada para todo clube que não é o do jogador (SRS M4: "escalação automática"). */
const DEFAULT_AUTO_TACTICS: Tactics = { formation: '4-4-2', style: 'balanced' };

export interface AdvanceRoundInput {
  playerLineup: Lineup;
  playerTactics: Tactics;
  /** Observa cada número bruto que o motor computa, só pra partida do jogador — "modo geek" da UI. */
  onPlayerChance?: (entry: EngineTraceEntry) => void;
}

function resolvePlayers(ids: string[], playersById: Map<string, Player>): Player[] {
  return ids.map((id) => {
    const player = playersById.get(id);
    if (!player) throw new Error(`advanceRound: jogador inexistente (${id})`);
    return player;
  });
}

function buildTeamInput(
  clubId: ClubId,
  isPlayerControlled: boolean,
  input: AdvanceRoundInput,
  clubsById: Map<ClubId, Club>,
  playersById: Map<string, Player>,
): MatchTeamInput {
  if (isPlayerControlled) {
    const lineup = input.playerLineup;
    const slotPositionByPlayerId = lineup.slotAssignments
      ? slotPositionsByPlayer(buildSlots(lineup.formation), lineup.slotAssignments)
      : undefined;
    return {
      clubId,
      players: resolvePlayers(lineup.starters, playersById),
      tactics: input.playerTactics,
      slotPositionByPlayerId,
      penaltyTakerId: lineup.penaltyTaker,
      freeKickTakerId: lineup.freeKickTaker,
    };
  }

  const club = clubsById.get(clubId);
  if (!club) throw new Error(`advanceRound: clube inexistente (${clubId})`);
  const squad = resolvePlayers(club.squad, playersById);
  // Times sem escalação manual (SRS M4) usam a mesma auto-escalação gulosa por
  // vaga da tela de Escalação (não a mais simples pickAutoLineup) — assim o
  // encaixe posicional (bônus de posição principal, penalidade fora de
  // posição) também vale pra CPU, não só pro time do jogador.
  const slots = buildSlots(DEFAULT_AUTO_TACTICS.formation);
  const slotAssignments = autoAssign(slots, squad);
  const starterIds = Object.values(slotAssignments).filter((id): id is string => !!id);
  return {
    clubId,
    players: resolvePlayers(starterIds, playersById),
    tactics: DEFAULT_AUTO_TACTICS,
    slotPositionByPlayerId: slotPositionsByPlayer(slots, slotAssignments),
  };
}

function updateStandingEntry(entry: StandingEntry, goalsFor: number, goalsAgainst: number): StandingEntry {
  const won = goalsFor > goalsAgainst;
  const drawn = goalsFor === goalsAgainst;
  return {
    ...entry,
    played: entry.played + 1,
    won: entry.won + (won ? 1 : 0),
    drawn: entry.drawn + (drawn ? 1 : 0),
    lost: entry.lost + (!won && !drawn ? 1 : 0),
    goalsFor: entry.goalsFor + goalsFor,
    goalsAgainst: entry.goalsAgainst + goalsAgainst,
    points: entry.points + (won ? 3 : drawn ? 1 : 0),
  };
}

function applyResultToStandings(standings: StandingEntry[], fixture: Fixture): StandingEntry[] {
  const result = fixture.result;
  if (!result) return standings;
  return standings.map((entry) => {
    if (entry.clubId === fixture.homeTeamId) return updateStandingEntry(entry, result.homeGoals, result.awayGoals);
    if (entry.clubId === fixture.awayTeamId) return updateStandingEntry(entry, result.awayGoals, result.homeGoals);
    return entry;
  });
}

function updatePlayerStats(
  players: Player[],
  starterIds: Set<string>,
  goalsByPlayer: Map<string, number>,
  savesByGoalkeeper: Map<string, number>,
  yellowCardsByPlayer: Map<string, number>,
  redCardsByPlayer: Map<string, number>,
): Player[] {
  return players.map((player) => {
    if (!starterIds.has(player.id)) return player;
    const goals = goalsByPlayer.get(player.id) ?? 0;
    const saves = savesByGoalkeeper.get(player.id) ?? 0;
    const yellowCards = yellowCardsByPlayer.get(player.id) ?? 0;
    const redCards = redCardsByPlayer.get(player.id) ?? 0;
    return {
      ...player,
      seasonStats: {
        ...player.seasonStats,
        appearances: player.seasonStats.appearances + 1,
        goals: player.seasonStats.goals + goals,
        saves: player.seasonStats.saves + saves,
        yellowCards: player.seasonStats.yellowCards + yellowCards,
        redCards: player.seasonStats.redCards + redCards,
      },
    };
  });
}

/**
 * Avança a rodada atual da temporada: simula todos os confrontos, atualiza a
 * tabela (incremental — não recomputa do zero, pois rodadas importadas de uma
 * situação real não têm placar jogo a jogo) e as estatísticas de temporada
 * dos jogadores que entraram em campo. Função pura: recebe o estado e
 * devolve um novo estado, sem mutar o original.
 */
export function advanceRound(state: CareerState, input: AdvanceRoundInput): CareerState {
  if (state.season.state === 'finished') {
    throw new Error('advanceRound: a temporada já terminou');
  }
  if (input.playerLineup.starters.length !== 11) {
    throw new Error('advanceRound: escalação do jogador precisa ter exatamente 11 titulares');
  }

  const competition = state.season.competitions[0];
  const roundIndex = state.season.currentRound - 1;
  const round = competition.fixtures[roundIndex];
  if (!round) {
    throw new Error(`advanceRound: rodada ${state.season.currentRound} não existe nesta competição`);
  }

  const playersById = new Map(state.world.players.map((p) => [p.id, p]));
  const clubsById = new Map(state.world.clubs.map((c) => [c.id, c]));

  const starterIds = new Set<string>();
  const goalsByPlayer = new Map<string, number>();
  const savesByGoalkeeper = new Map<string, number>();
  const yellowCardsByPlayer = new Map<string, number>();
  const redCardsByPlayer = new Map<string, number>();
  let standings = competition.standings;
  const playedRound: Fixture[] = [];

  for (const fixture of round) {
    const isPlayerHome = fixture.homeTeamId === state.playerClubId;
    const isPlayerAway = fixture.awayTeamId === state.playerClubId;

    const home = buildTeamInput(fixture.homeTeamId, isPlayerHome, input, clubsById, playersById);
    const away = buildTeamInput(fixture.awayTeamId, isPlayerAway, input, clubsById, playersById);

    const seed = deriveSeed(state.seed, `round${state.season.currentRound}:${fixture.homeTeamId}:${fixture.awayTeamId}`);
    const isPlayerFixture = isPlayerHome || isPlayerAway;
    const result = simulateMatch(
      home,
      away,
      seed,
      state.settings.tacticalIntensity,
      isPlayerFixture ? input.onPlayerChance : undefined,
    );

    for (const player of [...home.players, ...away.players]) starterIds.add(player.id);
    for (const event of result.events) {
      if (event.type === 'goal') {
        goalsByPlayer.set(event.playerId, (goalsByPlayer.get(event.playerId) ?? 0) + 1);
      } else if (event.type === 'shot_saved' && event.goalkeeperId) {
        savesByGoalkeeper.set(event.goalkeeperId, (savesByGoalkeeper.get(event.goalkeeperId) ?? 0) + 1);
      } else if (event.type === 'yellow_card') {
        yellowCardsByPlayer.set(event.playerId, (yellowCardsByPlayer.get(event.playerId) ?? 0) + 1);
      } else if (event.type === 'red_card') {
        redCardsByPlayer.set(event.playerId, (redCardsByPlayer.get(event.playerId) ?? 0) + 1);
      }
    }

    const playedFixture: Fixture = { ...fixture, result };
    standings = applyResultToStandings(standings, playedFixture);
    playedRound.push(playedFixture);
  }

  const updatedCompetition: Competition = {
    ...competition,
    standings,
    fixtures: competition.fixtures.map((r, i) => (i === roundIndex ? playedRound : r)),
  };

  const totalRounds = competition.fixtures.length;
  const nextRound = state.season.currentRound + 1;

  return {
    ...state,
    world: {
      ...state.world,
      players: updatePlayerStats(
        state.world.players,
        starterIds,
        goalsByPlayer,
        savesByGoalkeeper,
        yellowCardsByPlayer,
        redCardsByPlayer,
      ),
    },
    season: {
      ...state.season,
      currentRound: nextRound,
      state: nextRound > totalRounds ? 'finished' : 'in_progress',
      competitions: [updatedCompetition],
    },
  };
}
