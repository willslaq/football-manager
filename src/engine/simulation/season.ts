import { deriveSeed } from '../rng';
import type { CareerState } from '../types/career';
import type { Club, ClubId } from '../types/club';
import type { Competition, Fixture, StandingEntry } from '../types/competition';
import type { EngineTraceEntry, MatchResult } from '../types/match';
import type { Player } from '../types/player';
import type { Lineup, Tactics } from '../types/tactics';
import { CLUB_MORALE_DRAW_DELTA, CLUB_MORALE_LOSS_DELTA, CLUB_MORALE_WIN_DELTA } from './config';
import { autoAssign, buildSlots, slotPositionsByPlayer } from './formation';
import { simulateMatch, type MatchTeamInput } from './match';

/**
 * Escalação/tática usada pra clube CPU sem formação/estilo pesquisados (ver `Club.formation`/`style`)
 * — também exportada pra UI mostrar a mesma tática "padrão" que o motor realmente usaria contra esse
 * adversário (ver Home.tsx), não um valor inventado à parte.
 */
export const DEFAULT_AUTO_TACTICS: Tactics = { formation: '4-4-2', style: 'balanced' };

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
  // Jogador suspenso (cartão acumulado ou expulsão — ver updatePlayerStats) não entra
  // na auto-escalação da CPU, mesma regra aplicada à escalação manual do jogador
  // (ver Lineup.tsx).
  const squad = resolvePlayers(club.squad, playersById).filter((p) => p.suspendedMatches === 0);
  // Times sem escalação manual (SRS M4) usam a mesma auto-escalação gulosa por
  // vaga da tela de Escalação (não a mais simples pickAutoLineup) — assim o
  // encaixe posicional (bônus de posição principal, penalidade fora de
  // posição) também vale pra CPU, não só pro time do jogador. Clube com
  // formação/estilo real pesquisado (ver Club.formation/style) usa o próprio;
  // sem isso, cai no DEFAULT_AUTO_TACTICS genérico.
  const tactics: Tactics = {
    formation: club.formation ?? DEFAULT_AUTO_TACTICS.formation,
    style: club.style ?? DEFAULT_AUTO_TACTICS.style,
  };
  const slots = buildSlots(tactics.formation);
  const slotAssignments = autoAssign(slots, squad);
  const starterIds = Object.values(slotAssignments).filter((id): id is string => !!id);
  return {
    clubId,
    players: resolvePlayers(starterIds, playersById),
    tactics,
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Ajuste de moral do clube pelo resultado da partida (ver `Club.morale` — só exibição). */
function moraleAfterResult(morale: number, goalsFor: number, goalsAgainst: number): number {
  const delta =
    goalsFor > goalsAgainst ? CLUB_MORALE_WIN_DELTA : goalsFor < goalsAgainst ? CLUB_MORALE_LOSS_DELTA : CLUB_MORALE_DRAW_DELTA;
  return clamp(morale + delta, 0, 100);
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

/**
 * Regra CBF/Brasileirão: 3 cartões amarelos acumulados suspendem 1 jogo; cartão
 * vermelho (direto ou 2º amarelo) também suspende 1 jogo. A suspensão só zera o
 * contador de amarelos quando é de fato cumprida (ver decremento abaixo) — sem
 * "limpeza" no meio da temporada.
 *
 * Os amarelos que geram uma expulsão (2º amarelo na partida, ou um vermelho direto
 * na mesma partida em que o jogador já tinha levado amarelo — caso raro) NÃO contam
 * pro acúmulo: "esses cartões não contam pro total, já que o jogador já vai cumprir
 * a suspensão pela expulsão". `MatchEvent` não distingue vermelho direto de 2º
 * amarelo (ambos viram só `red_card` — a distinção só existe efêmera dentro de
 * match.ts), então tratamos os dois casos igual: qualquer jogador com vermelho na
 * partida tem TODOS os amarelos daquela partida ignorados pro acúmulo.
 */
export function applyCardSuspension(
  player: Pick<Player, 'pendingYellowCards' | 'suspendedMatches'>,
  yellowCards: number,
  redCards: number,
): Pick<Player, 'pendingYellowCards' | 'suspendedMatches'> {
  let pendingYellowCards = player.pendingYellowCards;
  let newSuspensions = redCards;

  if (yellowCards > 0 && redCards === 0) {
    pendingYellowCards += yellowCards;
    while (pendingYellowCards >= 3) {
      pendingYellowCards -= 3;
      newSuspensions += 1;
    }
  }

  return { pendingYellowCards, suspendedMatches: player.suspendedMatches + newSuspensions };
}

/**
 * Suspensão em cumprimento decrementa pra todo mundo do elenco, tenha jogado essa rodada ou
 * não — é assim que o jogador volta a ficar disponível na rodada seguinte. Roda uma única vez
 * por rodada (ver `simulateRound`), separado de `applyParticipantStats` porque a partida do
 * jogador só tem seu resultado final conhecido depois da transmissão ao vivo (e possíveis
 * substituições) terminar — mas a liberação de suspensão de TODO o elenco não pode esperar isso.
 */
function decrementSuspensions(players: Player[]): Player[] {
  return players.map((player) => {
    const servedSuspension = Math.max(0, player.suspendedMatches - 1);
    return servedSuspension === player.suspendedMatches ? player : { ...player, suspendedMatches: servedSuspension };
  });
}

interface MatchStatMaps {
  /** Todo mundo que efetivamente entrou em campo nessa partida (titulares + substitutos). */
  participantIds: Set<string>;
  goalsByPlayer: Map<string, number>;
  savesByGoalkeeper: Map<string, number>;
  yellowCardsByPlayer: Map<string, number>;
  redCardsByPlayer: Map<string, number>;
}

/** Extrai os mapas de estatística de uma partida já resolvida — titulares dos dois lados + qualquer substituto que entrou (evento 'substitution'). */
function collectMatchStatMaps(homeStarters: Player[], awayStarters: Player[], result: MatchResult): MatchStatMaps {
  const participantIds = new Set<string>();
  for (const player of [...homeStarters, ...awayStarters]) participantIds.add(player.id);

  const goalsByPlayer = new Map<string, number>();
  const savesByGoalkeeper = new Map<string, number>();
  const yellowCardsByPlayer = new Map<string, number>();
  const redCardsByPlayer = new Map<string, number>();

  for (const event of result.events) {
    if (event.type === 'goal') {
      goalsByPlayer.set(event.playerId, (goalsByPlayer.get(event.playerId) ?? 0) + 1);
    } else if (event.type === 'shot_saved' && event.goalkeeperId) {
      savesByGoalkeeper.set(event.goalkeeperId, (savesByGoalkeeper.get(event.goalkeeperId) ?? 0) + 1);
    } else if (event.type === 'yellow_card') {
      yellowCardsByPlayer.set(event.playerId, (yellowCardsByPlayer.get(event.playerId) ?? 0) + 1);
    } else if (event.type === 'red_card') {
      redCardsByPlayer.set(event.playerId, (redCardsByPlayer.get(event.playerId) ?? 0) + 1);
    } else if (event.type === 'substitution' && event.playerInId) {
      participantIds.add(event.playerInId);
    }
  }

  return { participantIds, goalsByPlayer, savesByGoalkeeper, yellowCardsByPlayer, redCardsByPlayer };
}

/**
 * Aplica estatísticas/cartões de uma (ou mais) partida(s) já resolvida(s) só a quem jogou
 * (`participantIds`) — quem não jogou fica intocado. Assume que `decrementSuspensions` já
 * rodou sobre `players` antes: pode ser chamada mais de uma vez por rodada com conjuntos de
 * `participantIds` disjuntos (partidas de CPU, depois a do jogador) sem decrementar suspensão em dobro.
 */
function applyParticipantStats(
  players: Player[],
  participantIds: Set<string>,
  goalsByPlayer: Map<string, number>,
  savesByGoalkeeper: Map<string, number>,
  yellowCardsByPlayer: Map<string, number>,
  redCardsByPlayer: Map<string, number>,
): Player[] {
  return players.map((player) => {
    if (!participantIds.has(player.id)) return player;

    const goals = goalsByPlayer.get(player.id) ?? 0;
    const saves = savesByGoalkeeper.get(player.id) ?? 0;
    const yellowCards = yellowCardsByPlayer.get(player.id) ?? 0;
    const redCards = redCardsByPlayer.get(player.id) ?? 0;
    const { pendingYellowCards, suspendedMatches } = applyCardSuspension(player, yellowCards, redCards);

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
      pendingYellowCards,
      suspendedMatches,
    };
  });
}

export interface SimulateRoundResult {
  nextState: CareerState;
  /** Índice da rodada simulada em `competition.fixtures` — precisa ser guardado por quem chama pra achar o fixture de novo em `commitPlayerMatchResult` (currentRound já avançou nesse meio-tempo). */
  roundIndex: number;
  /** Ausentes quando a rodada não tem confronto do time do jogador (defensivo — não deveria acontecer no calendário atual). */
  playerFixture?: Fixture;
  playerMatchResult?: MatchResult;
  homeTeamInput?: MatchTeamInput;
  awayTeamInput?: MatchTeamInput;
  seed?: number;
}

/**
 * Simula todos os confrontos da rodada atual e já comita tabela/estatísticas/moral de TODOS
 * eles, exceto o do time do jogador: esse é entregue ao vivo pra UI (com possíveis
 * substituições no meio, ver match.ts's `MatchSubstitution`), então seu resultado ainda pode
 * mudar — só é definitivo quando `commitPlayerMatchResult` for chamado com o resultado final.
 * Função pura: recebe o estado e devolve um novo estado, sem mutar o original.
 */
export function simulateRound(state: CareerState, input: AdvanceRoundInput): SimulateRoundResult {
  if (state.season.state === 'finished') {
    throw new Error('simulateRound: a temporada já terminou');
  }
  if (input.playerLineup.starters.length !== 11) {
    throw new Error('simulateRound: escalação do jogador precisa ter exatamente 11 titulares');
  }

  const competition = state.season.competitions[0];
  const roundIndex = state.season.currentRound - 1;
  const round = competition.fixtures[roundIndex];
  if (!round) {
    throw new Error(`simulateRound: rodada ${state.season.currentRound} não existe nesta competição`);
  }

  const playersById = new Map(state.world.players.map((p) => [p.id, p]));
  const clubsById = new Map(state.world.clubs.map((c) => [c.id, c]));

  const cpuParticipantIds = new Set<string>();
  const cpuGoalsByPlayer = new Map<string, number>();
  const cpuSavesByGoalkeeper = new Map<string, number>();
  const cpuYellowCardsByPlayer = new Map<string, number>();
  const cpuRedCardsByPlayer = new Map<string, number>();
  let standings = competition.standings;
  const playedRound: Fixture[] = [];
  const moraleByClub = new Map<ClubId, number>();

  let playerFixture: Fixture | undefined;
  let playerMatchResult: MatchResult | undefined;
  let playerHomeTeamInput: MatchTeamInput | undefined;
  let playerAwayTeamInput: MatchTeamInput | undefined;
  let playerSeed: number | undefined;

  for (const fixture of round) {
    const isPlayerHome = fixture.homeTeamId === state.playerClubId;
    const isPlayerAway = fixture.awayTeamId === state.playerClubId;
    const isPlayerFixture = isPlayerHome || isPlayerAway;

    const home = buildTeamInput(fixture.homeTeamId, isPlayerHome, input, clubsById, playersById);
    const away = buildTeamInput(fixture.awayTeamId, isPlayerAway, input, clubsById, playersById);

    const seed = deriveSeed(state.seed, `round${state.season.currentRound}:${fixture.homeTeamId}:${fixture.awayTeamId}`);
    const result = simulateMatch(
      home,
      away,
      seed,
      state.settings.tacticalIntensity,
      isPlayerFixture ? input.onPlayerChance : undefined,
    );

    if (isPlayerFixture) {
      // Ainda sem resultado definitivo — a UI transmite ao vivo (e pode pedir substituições,
      // que reroda `simulateMatch`); o fixture entra "como está" na rodada, e `commitPlayerMatchResult`
      // troca por `{ ...fixture, result }` quando o resultado final estiver pronto.
      playerFixture = fixture;
      playerMatchResult = result;
      playerHomeTeamInput = home;
      playerAwayTeamInput = away;
      playerSeed = seed;
      playedRound.push(fixture);
      continue;
    }

    const stats = collectMatchStatMaps(home.players, away.players, result);
    for (const id of stats.participantIds) cpuParticipantIds.add(id);
    for (const [id, n] of stats.goalsByPlayer) cpuGoalsByPlayer.set(id, (cpuGoalsByPlayer.get(id) ?? 0) + n);
    for (const [id, n] of stats.savesByGoalkeeper) cpuSavesByGoalkeeper.set(id, (cpuSavesByGoalkeeper.get(id) ?? 0) + n);
    for (const [id, n] of stats.yellowCardsByPlayer) cpuYellowCardsByPlayer.set(id, (cpuYellowCardsByPlayer.get(id) ?? 0) + n);
    for (const [id, n] of stats.redCardsByPlayer) cpuRedCardsByPlayer.set(id, (cpuRedCardsByPlayer.get(id) ?? 0) + n);

    const playedFixture: Fixture = { ...fixture, result };
    standings = applyResultToStandings(standings, playedFixture);
    playedRound.push(playedFixture);

    const homeClub = clubsById.get(fixture.homeTeamId);
    const awayClub = clubsById.get(fixture.awayTeamId);
    if (homeClub) moraleByClub.set(homeClub.id, moraleAfterResult(homeClub.morale, result.homeGoals, result.awayGoals));
    if (awayClub) moraleByClub.set(awayClub.id, moraleAfterResult(awayClub.morale, result.awayGoals, result.homeGoals));
  }

  const updatedCompetition: Competition = {
    ...competition,
    standings,
    fixtures: competition.fixtures.map((r, i) => (i === roundIndex ? playedRound : r)),
  };

  const totalRounds = competition.fixtures.length;
  const nextRound = state.season.currentRound + 1;

  const nextState: CareerState = {
    ...state,
    world: {
      clubs: state.world.clubs.map((c) => (moraleByClub.has(c.id) ? { ...c, morale: moraleByClub.get(c.id)! } : c)),
      players: applyParticipantStats(
        decrementSuspensions(state.world.players),
        cpuParticipantIds,
        cpuGoalsByPlayer,
        cpuSavesByGoalkeeper,
        cpuYellowCardsByPlayer,
        cpuRedCardsByPlayer,
      ),
    },
    season: {
      ...state.season,
      currentRound: nextRound,
      state: nextRound > totalRounds ? 'finished' : 'in_progress',
      competitions: [updatedCompetition],
    },
  };

  return {
    nextState,
    roundIndex,
    playerFixture,
    playerMatchResult,
    homeTeamInput: playerHomeTeamInput,
    awayTeamInput: playerAwayTeamInput,
    seed: playerSeed,
  };
}

/**
 * Comita o resultado FINAL (pós-substituições, se houve) da partida do jogador: tabela, moral
 * dos dois clubes envolvidos e estatísticas de quem participou (titulares + qualquer
 * substituto que entrou — ver `collectMatchStatMaps`). Chamado depois que a transmissão ao
 * vivo termina (ver engine.worker.ts). Função pura.
 */
export function commitPlayerMatchResult(
  state: CareerState,
  ctx: { playerFixture: Fixture; roundIndex: number; homeTeamInput: MatchTeamInput; awayTeamInput: MatchTeamInput },
  finalResult: MatchResult,
): CareerState {
  const competition = state.season.competitions[0];
  const round = competition.fixtures[ctx.roundIndex];
  if (!round) {
    throw new Error(`commitPlayerMatchResult: rodada de índice ${ctx.roundIndex} não existe nesta competição`);
  }

  const playedFixture: Fixture = { ...ctx.playerFixture, result: finalResult };
  const updatedRound = round.map((f) => (f === ctx.playerFixture ? playedFixture : f));
  const standings = applyResultToStandings(competition.standings, playedFixture);

  const homeClub = state.world.clubs.find((c) => c.id === ctx.playerFixture.homeTeamId);
  const awayClub = state.world.clubs.find((c) => c.id === ctx.playerFixture.awayTeamId);
  const moraleByClub = new Map<ClubId, number>();
  if (homeClub) moraleByClub.set(homeClub.id, moraleAfterResult(homeClub.morale, finalResult.homeGoals, finalResult.awayGoals));
  if (awayClub) moraleByClub.set(awayClub.id, moraleAfterResult(awayClub.morale, finalResult.awayGoals, finalResult.homeGoals));

  const stats = collectMatchStatMaps(ctx.homeTeamInput.players, ctx.awayTeamInput.players, finalResult);

  return {
    ...state,
    world: {
      clubs: state.world.clubs.map((c) => (moraleByClub.has(c.id) ? { ...c, morale: moraleByClub.get(c.id)! } : c)),
      players: applyParticipantStats(
        state.world.players,
        stats.participantIds,
        stats.goalsByPlayer,
        stats.savesByGoalkeeper,
        stats.yellowCardsByPlayer,
        stats.redCardsByPlayer,
      ),
    },
    season: {
      ...state.season,
      competitions: [
        {
          ...competition,
          standings,
          fixtures: competition.fixtures.map((r, i) => (i === ctx.roundIndex ? updatedRound : r)),
        },
      ],
    },
  };
}

/**
 * Avança a rodada atual da temporada de uma vez só: simula todos os confrontos e já comita
 * tudo (tabela, moral, estatísticas), incluindo a partida do jogador — sem transmissão ao vivo
 * nem chance de substituição. É `simulateRound` + `commitPlayerMatchResult` compostos; usado
 * pelos testes e por qualquer fluxo que só queira o resultado final da rodada de uma vez
 * (ver engine.worker.ts pro fluxo ao vivo, que chama os dois separadamente).
 */
export function advanceRound(state: CareerState, input: AdvanceRoundInput): CareerState {
  const { nextState, playerFixture, playerMatchResult, homeTeamInput, awayTeamInput, roundIndex } = simulateRound(
    state,
    input,
  );
  if (!playerFixture || !playerMatchResult || !homeTeamInput || !awayTeamInput) {
    return nextState;
  }
  return commitPlayerMatchResult(nextState, { playerFixture, roundIndex, homeTeamInput, awayTeamInput }, playerMatchResult);
}
