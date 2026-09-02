import { addDays, toEpochDay } from '../generation/calendar';
import { deriveSeed } from '../rng';
import type { CareerState } from '../types/career';
import type { Club, ClubId } from '../types/club';
import type { CompetitionId, Competition, Fixture, StandingEntry } from '../types/competition';
import type { EngineTraceEntry, MatchResult } from '../types/match';
import type { Player, PlayerId } from '../types/player';
import type { Season } from '../types/season';
import type { Lineup, Tactics } from '../types/tactics';
import {
  ageRecoveryMultiplier,
  CLUB_MORALE_DRAW_DELTA,
  CLUB_MORALE_LOSS_DELTA,
  CLUB_MORALE_WIN_DELTA,
  CONDITION_RECOVERY_PER_DAY,
} from './config';
import { applyMatchdayRevenue } from './finance';
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
 * Suspensão em cumprimento decrementa pros elencos dos dois clubes de UMA partida, no momento em
 * que ela é resolvida — é assim que o jogador volta a ficar disponível pro próximo jogo do seu
 * clube. Escopo por partida (não mais "todo mundo, uma vez por rodada"): com o calendário real,
 * uma rodada pode se espalhar por mais de uma data, então não existe mais um "tick" único por
 * rodada — cada clube serve sua suspensão exatamente quando SEU jogo acontece, não antes.
 */
function decrementSuspensions(players: Player[], clubSquadIds: Set<PlayerId>): Player[] {
  return players.map((player) => {
    if (!clubSquadIds.has(player.id)) return player;
    const servedSuspension = Math.max(0, player.suspendedMatches - 1);
    return servedSuspension === player.suspendedMatches ? player : { ...player, suspendedMatches: servedSuspension };
  });
}

/**
 * Grava em `Player.condition` a energia com que cada participante terminou a partida (ver
 * `MatchResult.finalEnergyByPlayerId`) — é assim que a fadiga em campo persiste pra além do jogo em
 * si. Só toca quem de fato jogou (tem entrada no mapa); quem ficou fora do jogo mantém a condição
 * de antes, sujeita só à recuperação por descanso (ver `recoverCondition`).
 */
function applyFinalEnergy(players: Player[], finalEnergyByPlayerId: Record<PlayerId, number>): Player[] {
  return players.map((player) => {
    const energy = finalEnergyByPlayerId[player.id];
    if (energy === undefined) return player;
    const rounded = Math.round(energy);
    return rounded === player.condition ? player : { ...player, condition: rounded };
  });
}

/**
 * Recupera `Player.condition` de todo mundo pelo tempo de descanso (ver `CONDITION_RECOVERY_PER_DAY`),
 * a cada dia de calendário que passa sem jogo — inspirado no sistema de fitness do EA FC 26 (energia
 * volta ao normal em poucos dias de folga). Aplica pra todo o elenco, não só quem jogou por último:
 * quem ficou fora também "descansa" (ainda que já estivesse em 100, o clamp final absorve isso).
 */
function recoverCondition(players: Player[], days: number): Player[] {
  if (days <= 0) return players;
  return players.map((player) => {
    const rate = CONDITION_RECOVERY_PER_DAY * ageRecoveryMultiplier(player.age);
    const recovered = Math.min(100, Math.round(player.condition + rate * days));
    return recovered === player.condition ? player : { ...player, condition: recovered };
  });
}

interface MatchStatMaps {
  /** Todo mundo que efetivamente entrou em campo nessa partida (titulares + substitutos). */
  participantIds: Set<string>;
  goalsByPlayer: Map<string, number>;
  savesByGoalkeeper: Map<string, number>;
  yellowCardsByPlayer: Map<string, number>;
  redCardsByPlayer: Map<string, number>;
  /** Minutos jogados nessa partida, por jogador — direto de `result.minutesPlayedByPlayerId`. */
  minutesByPlayer: Map<string, number>;
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

  const minutesByPlayer = new Map<string, number>(Object.entries(result.minutesPlayedByPlayerId));

  return { participantIds, goalsByPlayer, savesByGoalkeeper, yellowCardsByPlayer, redCardsByPlayer, minutesByPlayer };
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
  minutesByPlayer: Map<string, number>,
): Player[] {
  return players.map((player) => {
    if (!participantIds.has(player.id)) return player;

    const goals = goalsByPlayer.get(player.id) ?? 0;
    const saves = savesByGoalkeeper.get(player.id) ?? 0;
    const yellowCards = yellowCardsByPlayer.get(player.id) ?? 0;
    const redCards = redCardsByPlayer.get(player.id) ?? 0;
    const minutes = minutesByPlayer.get(player.id) ?? 0;
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
        minutesPlayed: player.seasonStats.minutesPlayed + minutes,
      },
      pendingYellowCards,
      suspendedMatches,
    };
  });
}

/**
 * Rodada "atual" pra exibição — informativa/derivada, nunca mutada direto (ver `Season.currentRound`).
 * A menor rodada com algum fixture ainda pendente (sem `result`) datado hoje ou no futuro
 * (`date &gt;= currentDate`). Ancorada em `date`, não em `.result`: as rodadas 1..(rodada do
 * snapshot real - 1) vêm de `standings-current.json` sem placar jogo a jogo (só o saldo agregado
 * já está nas standings) — comparar por data as exclui corretamente sem confundi-las com "ainda
 * por simular", o que compará-las por ausência de `.result` faria (bug: ficariam "atuais" pra sempre).
 * Usa a competição do `playerClubId` (não sempre `competitions[0]`): o clube do jogador pode estar
 * na Série A ou na Série B, e cada uma tem seu próprio calendário/rodada corrente.
 */
function deriveCurrentRound(season: Season, playerClubId: ClubId): number {
  const competition = season.competitions.find((c) => c.teams.includes(playerClubId)) ?? season.competitions[0];
  for (const round of competition.fixtures) {
    if (round.some((f) => !f.result && f.date >= season.currentDate)) return round[0].round;
  }
  return competition.fixtures.length + 1;
}

/** Localizador de um fixture dentro de `season.competitions` — pra reencontrá-lo depois de mutações imutáveis. */
interface FixtureRef {
  competitionIndex: number;
  roundIndex: number;
  fixture: Fixture;
}

/** Todo fixture ainda sem resultado, de todas as competições, datado `date === targetDate`. */
function fixturesOnDate(competitions: Competition[], targetDate: string): FixtureRef[] {
  const refs: FixtureRef[] = [];
  competitions.forEach((competition, competitionIndex) => {
    competition.fixtures.forEach((round, roundIndex) => {
      for (const fixture of round) {
        if (!fixture.result && fixture.date === targetDate) refs.push({ competitionIndex, roundIndex, fixture });
      }
    });
  });
  return refs;
}

/** A menor data `&gt;= cursor` que tem algum fixture pendente, em qualquer competição — `undefined` se não houver mais nenhuma (temporada esgotada). */
function earliestPendingDate(competitions: Competition[], cursor: string): string | undefined {
  let earliest: string | undefined;
  for (const competition of competitions) {
    for (const round of competition.fixtures) {
      for (const fixture of round) {
        if (fixture.result || fixture.date < cursor) continue;
        if (!earliest || fixture.date < earliest) earliest = fixture.date;
      }
    }
  }
  return earliest;
}

/**
 * Simula e comita de uma vez uma lista de fixtures (nenhum deles do time do jogador — CPU x CPU
 * sempre) que compartilham a mesma data: tabela, moral dos clubes envolvidos, estatísticas de
 * quem jogou, suspensão servida (escopada aos dois elencos de cada partida — ver
 * `decrementSuspensions`) e bilheteria creditada ao mandante (ver `applyMatchdayRevenue`).
 * `onCommitted` recebe cada fixture já resolvido, na ordem processada,
 * pra quem chama decidir se ele é "enquanto isso" (data passada) ou "mesmo dia" (ver
 * `advanceToNextEvent`). Função pura.
 */
function commitFixturesBatch(
  state: CareerState,
  refs: FixtureRef[],
  input: AdvanceRoundInput,
  clubsById: Map<ClubId, Club>,
  playersById: Map<string, Player>,
  onCommitted: (fixture: Fixture) => void,
): CareerState {
  if (refs.length === 0) return state;

  let players = state.world.players;
  let clubs = state.world.clubs;
  let financeLog = state.financeLog;
  const competitions = state.season.competitions.map((c) => ({ ...c, fixtures: c.fixtures.map((r) => [...r]) }));

  for (const { competitionIndex, roundIndex, fixture } of refs) {
    const home = buildTeamInput(fixture.homeTeamId, false, input, clubsById, playersById);
    const away = buildTeamInput(fixture.awayTeamId, false, input, clubsById, playersById);
    const seed = deriveSeed(state.seed, `fixture:${fixture.round}:${fixture.homeTeamId}:${fixture.awayTeamId}`);
    const result = simulateMatch(home, away, seed, state.settings.tacticalIntensity);
    const playedFixture: Fixture = { ...fixture, result };

    // Bilheteria calculada com a tabela ENTRANDO nessa partida (antes do resultado dela ser
    // aplicado abaixo) — reflete a expectativa de público de quem foi assistir, não o resultado.
    const revenue = applyMatchdayRevenue(
      clubs,
      fixture.homeTeamId,
      fixture.awayTeamId,
      competitions[competitionIndex].standings,
      competitions[competitionIndex].teams.length,
      competitionIndex === 0,
      state.playerClubId,
      fixture.date,
      deriveSeed(state.seed, `attendance:${fixture.round}:${fixture.homeTeamId}:${fixture.awayTeamId}`),
    );
    clubs = revenue.clubs;
    if (revenue.transaction) financeLog = [...financeLog, revenue.transaction];

    competitions[competitionIndex].fixtures[roundIndex] = competitions[competitionIndex].fixtures[roundIndex].map((f) =>
      f === fixture ? playedFixture : f,
    );
    competitions[competitionIndex].standings = applyResultToStandings(competitions[competitionIndex].standings, playedFixture);

    const stats = collectMatchStatMaps(home.players, away.players, result);
    const homeClub = clubsById.get(fixture.homeTeamId);
    const awayClub = clubsById.get(fixture.awayTeamId);
    const clubSquadIds = new Set<PlayerId>([...(homeClub?.squad ?? []), ...(awayClub?.squad ?? [])]);
    players = applyFinalEnergy(
      applyParticipantStats(
        decrementSuspensions(players, clubSquadIds),
        stats.participantIds,
        stats.goalsByPlayer,
        stats.savesByGoalkeeper,
        stats.yellowCardsByPlayer,
        stats.redCardsByPlayer,
        stats.minutesByPlayer,
      ),
      result.finalEnergyByPlayerId,
    );
    if (homeClub) {
      const morale = moraleAfterResult(homeClub.morale, result.homeGoals, result.awayGoals);
      clubs = clubs.map((c) => (c.id === homeClub.id ? { ...c, morale } : c));
    }
    if (awayClub) {
      const morale = moraleAfterResult(awayClub.morale, result.awayGoals, result.homeGoals);
      clubs = clubs.map((c) => (c.id === awayClub.id ? { ...c, morale } : c));
    }

    onCommitted(playedFixture);
  }

  return { ...state, world: { ...state.world, players, clubs }, season: { ...state.season, competitions }, financeLog };
}

export interface AdvanceCalendarResult {
  nextState: CareerState;
  /** Fixtures resolvidos em datas antes da parada — recapitulação estática ("enquanto isso"), sem revelação ao vivo. */
  simulatedAlongTheWay: Fixture[];
  /** true quando `currentDate` já é a data do próximo jogo do time do jogador — pronto pra `startMatchDay`. */
  reachedPlayerMatchDay: boolean;
  /** true quando a temporada se esgotou sem mais nenhum jogo do jogador (não sobra mais nada, nem pra `startMatchDay`). */
  seasonFinished: boolean;
}

/**
 * Avança só o CALENDÁRIO, dia a dia, a partir de `state.season.currentDate + 1`: em cada data com
 * algum jogo pendente (de QUALQUER competição — não hardcoded a `competitions[0]`, pra dar certo
 * quando existir uma segunda competição concorrente no futuro) que NÃO seja do time do jogador,
 * comita na hora (`simulatedAlongTheWay`) e continua andando. Para assim que chega numa data em
 * que o time do jogador joga — sem simular nada dessa data (isso é trabalho de `startMatchDay`,
 * chamado como uma ação separada) — ou quando esgota a temporada sem mais nenhum jogo do jogador.
 * Função pura: recebe o estado e devolve um novo estado, sem mutar o original.
 */
export function advanceCalendar(state: CareerState, input: AdvanceRoundInput): AdvanceCalendarResult {
  if (state.season.state === 'finished') {
    throw new Error('advanceCalendar: a temporada já terminou');
  }

  const playersById = new Map(state.world.players.map((p) => [p.id, p]));
  const clubsById = new Map(state.world.clubs.map((c) => [c.id, c]));

  let workingState = state;
  let cursor = addDays(state.season.currentDate, 1);
  const simulatedAlongTheWay: Fixture[] = [];
  let reachedPlayerMatchDay = false;
  let seasonFinished = false;

  for (;;) {
    const date = earliestPendingDate(workingState.season.competitions, cursor);
    if (!date) {
      seasonFinished = true;
      break;
    }

    const daysPassed = toEpochDay(date) - toEpochDay(workingState.season.currentDate);
    workingState = {
      ...workingState,
      world: { ...workingState.world, players: recoverCondition(workingState.world.players, daysPassed) },
    };

    const onDate = fixturesOnDate(workingState.season.competitions, date);
    const playerRef = onDate.find(
      (r) => r.fixture.homeTeamId === state.playerClubId || r.fixture.awayTeamId === state.playerClubId,
    );

    if (playerRef) {
      // Chegou no dia do próximo jogo do jogador — só posiciona o calendário aqui, sem simular
      // nada dessa data ainda (nem esse jogo, nem os outros do mesmo dia).
      workingState = { ...workingState, season: { ...workingState.season, currentDate: date } };
      reachedPlayerMatchDay = true;
      break;
    }

    workingState = commitFixturesBatch(workingState, onDate, input, clubsById, playersById, (f) =>
      simulatedAlongTheWay.push(f),
    );
    workingState = { ...workingState, season: { ...workingState.season, currentDate: date } };
    cursor = addDays(date, 1);
  }

  const finalSeason: Season = { ...workingState.season, state: seasonFinished ? 'finished' : 'in_progress' };
  const nextState: CareerState = {
    ...workingState,
    season: { ...finalSeason, currentRound: deriveCurrentRound(finalSeason, state.playerClubId) },
  };

  return { nextState, simulatedAlongTheWay, reachedPlayerMatchDay, seasonFinished };
}

export interface StartMatchDayResult {
  nextState: CareerState;
  competitionId?: CompetitionId;
  roundIndex?: number;
  /** Ausentes se `state.season.currentDate` não é, na verdade, dia de jogo do time do jogador (chame `advanceCalendar` antes). */
  playerFixture?: Fixture;
  playerMatchResult?: MatchResult;
  homeTeamInput?: MatchTeamInput;
  awayTeamInput?: MatchTeamInput;
  seed?: number;
  /** Fixtures resolvidos na MESMA data de `playerFixture` — alimentam a barra lateral de revelação ao vivo (gol a gol) existente. */
  sameDateFixtures: Fixture[];
  /**
   * Presente só quando esse era o ÚLTIMO jogo do time do jogador na temporada: o resto do
   * calendário (só jogos de CPU) é varrido e comitado na mesma chamada, senão a temporada nunca
   * seria marcada 'finished' sem mais um "Avançar o tempo" sem efeito nenhum pro jogador.
   */
  simulatedAlongTheWay: Fixture[];
  seasonFinished: boolean;
}

/**
 * Simula o jogo do time do jogador na data ATUAL do calendário (`state.season.currentDate`) — só
 * deve ser chamada depois que `advanceCalendar` sinalizar `reachedPlayerMatchDay: true`. Comita
 * na hora qualquer outro jogo da mesma data (`sameDateFixtures`); deixa o jogo do jogador em si
 * sem resultado (a UI transmite ao vivo, com possíveis substituições — `commitPlayerMatchResult`
 * grava o resultado final depois). Função pura.
 */
export function startMatchDay(state: CareerState, input: AdvanceRoundInput): StartMatchDayResult {
  if (state.season.state === 'finished') {
    throw new Error('startMatchDay: a temporada já terminou');
  }
  if (input.playerLineup.starters.length !== 11) {
    throw new Error('startMatchDay: escalação do jogador precisa ter exatamente 11 titulares');
  }

  const playersById = new Map(state.world.players.map((p) => [p.id, p]));
  const clubsById = new Map(state.world.clubs.map((c) => [c.id, c]));

  const date = state.season.currentDate;
  const onDate = fixturesOnDate(state.season.competitions, date);
  const playerRef = onDate.find(
    (r) => r.fixture.homeTeamId === state.playerClubId || r.fixture.awayTeamId === state.playerClubId,
  );
  if (!playerRef) {
    throw new Error('startMatchDay: não há jogo do time do jogador na data atual — chame advanceCalendar primeiro');
  }

  const sameDateFixtures: Fixture[] = [];
  const others = onDate.filter((r) => r !== playerRef);
  let workingState = commitFixturesBatch(state, others, input, clubsById, playersById, (f) => sameDateFixtures.push(f));

  const isPlayerHome = playerRef.fixture.homeTeamId === state.playerClubId;
  const home = buildTeamInput(playerRef.fixture.homeTeamId, isPlayerHome, input, clubsById, playersById);
  const away = buildTeamInput(playerRef.fixture.awayTeamId, !isPlayerHome, input, clubsById, playersById);
  const seed = deriveSeed(state.seed, `fixture:${playerRef.fixture.round}:${playerRef.fixture.homeTeamId}:${playerRef.fixture.awayTeamId}`);
  const result = simulateMatch(home, away, seed, workingState.settings.tacticalIntensity, input.onPlayerChance);

  // A partida do time do jogador "aconteceu" nessa data — a suspensão é servida agora, mesmo o
  // resultado só sendo comitado depois (transmissão ao vivo + possíveis substituições).
  const homeClub = clubsById.get(playerRef.fixture.homeTeamId);
  const awayClub = clubsById.get(playerRef.fixture.awayTeamId);
  const clubSquadIds = new Set<PlayerId>([...(homeClub?.squad ?? []), ...(awayClub?.squad ?? [])]);
  workingState = {
    ...workingState,
    world: { ...workingState.world, players: decrementSuspensions(workingState.world.players, clubSquadIds) },
  };

  const playerFixture = playerRef.fixture;
  const competitionId = workingState.season.competitions[playerRef.competitionIndex].id;
  const roundIndex = playerRef.roundIndex;

  // Se não sobra mais nenhum jogo FUTURO do time do jogador na temporada, varre o resto do
  // calendário (só jogos de CPU) nessa mesma chamada — reaproveita `advanceCalendar`: como o jogo
  // do jogador ainda não foi comitado, mas está datado exatamente em `date` e o cursor dele
  // começa em `date + 1`, ele nunca é revisitado (ver `earliestPendingDate`'s filtro por cursor).
  const hasMoreForPlayer = workingState.season.competitions.some((c) =>
    c.fixtures.some((round) =>
      round.some(
        (f) => !f.result && f.date > date && (f.homeTeamId === state.playerClubId || f.awayTeamId === state.playerClubId),
      ),
    ),
  );

  let simulatedAlongTheWay: Fixture[] = [];
  let seasonFinished = false;
  if (!hasMoreForPlayer) {
    const swept = advanceCalendar(workingState, input);
    workingState = swept.nextState;
    simulatedAlongTheWay = swept.simulatedAlongTheWay;
    seasonFinished = swept.seasonFinished;
  } else {
    workingState = {
      ...workingState,
      season: { ...workingState.season, currentRound: deriveCurrentRound(workingState.season, state.playerClubId) },
    };
  }

  return {
    nextState: workingState,
    competitionId,
    roundIndex,
    playerFixture,
    playerMatchResult: result,
    homeTeamInput: home,
    awayTeamInput: away,
    seed,
    sameDateFixtures,
    simulatedAlongTheWay,
    seasonFinished,
  };
}

/**
 * Comita o resultado FINAL (pós-substituições, se houve) da partida do jogador: tabela, moral
 * dos dois clubes envolvidos, estatísticas de quem participou (titulares + qualquer
 * substituto que entrou — ver `collectMatchStatMaps`) e bilheteria creditada ao mandante (ver
 * `applyMatchdayRevenue` — vale tanto quando o clube do jogador manda quanto quando visita).
 * Chamado depois que a transmissão ao
 * vivo termina (ver engine.worker.ts). Suspensão do time do jogador já foi servida em
 * `advanceToNextEvent` no instante em que a data foi alcançada — não repete aqui. Função pura.
 */
export function commitPlayerMatchResult(
  state: CareerState,
  ctx: { playerFixture: Fixture; competitionId: CompetitionId; roundIndex: number; homeTeamInput: MatchTeamInput; awayTeamInput: MatchTeamInput },
  finalResult: MatchResult,
): CareerState {
  const competitionIndex = state.season.competitions.findIndex((c) => c.id === ctx.competitionId);
  const competition = state.season.competitions[competitionIndex];
  if (!competition) {
    throw new Error(`commitPlayerMatchResult: competição ${ctx.competitionId} não encontrada`);
  }
  const round = competition.fixtures[ctx.roundIndex];
  if (!round) {
    throw new Error(`commitPlayerMatchResult: rodada de índice ${ctx.roundIndex} não existe nesta competição`);
  }

  const playedFixture: Fixture = { ...ctx.playerFixture, result: finalResult };
  const updatedRound = round.map((f) => (f === ctx.playerFixture ? playedFixture : f));

  // Bilheteria com a tabela ENTRANDO nessa partida — mesma regra de commitFixturesBatch, usa
  // `competition.standings` (ainda não tocado pelo resultado desse jogo, ver applyResultToStandings abaixo).
  const revenue = applyMatchdayRevenue(
    state.world.clubs,
    ctx.playerFixture.homeTeamId,
    ctx.playerFixture.awayTeamId,
    competition.standings,
    competition.teams.length,
    competitionIndex === 0,
    state.playerClubId,
    ctx.playerFixture.date,
    deriveSeed(state.seed, `attendance:${ctx.playerFixture.round}:${ctx.playerFixture.homeTeamId}:${ctx.playerFixture.awayTeamId}`),
  );

  const standings = applyResultToStandings(competition.standings, playedFixture);

  const homeClub = state.world.clubs.find((c) => c.id === ctx.playerFixture.homeTeamId);
  const awayClub = state.world.clubs.find((c) => c.id === ctx.playerFixture.awayTeamId);
  const moraleByClub = new Map<ClubId, number>();
  if (homeClub) moraleByClub.set(homeClub.id, moraleAfterResult(homeClub.morale, finalResult.homeGoals, finalResult.awayGoals));
  if (awayClub) moraleByClub.set(awayClub.id, moraleAfterResult(awayClub.morale, finalResult.awayGoals, finalResult.homeGoals));

  const stats = collectMatchStatMaps(ctx.homeTeamInput.players, ctx.awayTeamInput.players, finalResult);

  const nextSeason: Season = {
    ...state.season,
    competitions: state.season.competitions.map((c, i) =>
      i === competitionIndex ? { ...competition, standings, fixtures: competition.fixtures.map((r, ri) => (ri === ctx.roundIndex ? updatedRound : r)) } : c,
    ),
  };

  return {
    ...state,
    world: {
      clubs: revenue.clubs.map((c) => (moraleByClub.has(c.id) ? { ...c, morale: moraleByClub.get(c.id)! } : c)),
      players: applyFinalEnergy(
        applyParticipantStats(
          state.world.players,
          stats.participantIds,
          stats.goalsByPlayer,
          stats.savesByGoalkeeper,
          stats.yellowCardsByPlayer,
          stats.redCardsByPlayer,
          stats.minutesByPlayer,
        ),
        finalResult.finalEnergyByPlayerId,
      ),
    },
    season: { ...nextSeason, currentRound: deriveCurrentRound(nextSeason, state.playerClubId) },
    financeLog: revenue.transaction ? [...state.financeLog, revenue.transaction] : state.financeLog,
  };
}

/**
 * Avança o tempo de uma vez só até a próxima partida do time do jogador, já comitando tudo
 * (tabela, moral, estatísticas) inclusive ela — sem transmissão ao vivo nem chance de
 * substituição. É `advanceCalendar` + `startMatchDay` + `commitPlayerMatchResult` compostos;
 * usado pelos testes e por qualquer fluxo que só queira o resultado final de uma vez (ver
 * engine.worker.ts pro fluxo ao vivo de verdade, que chama os três separadamente, como duas
 * ações distintas da UI — "avançar o tempo" e "iniciar partida").
 */
export function advanceRound(state: CareerState, input: AdvanceRoundInput): CareerState {
  const calendar = advanceCalendar(state, input);
  if (!calendar.reachedPlayerMatchDay) {
    return calendar.nextState;
  }
  const { nextState, playerFixture, playerMatchResult, homeTeamInput, awayTeamInput, competitionId, roundIndex } =
    startMatchDay(calendar.nextState, input);
  if (!playerFixture || !playerMatchResult || !homeTeamInput || !awayTeamInput || competitionId === undefined || roundIndex === undefined) {
    return nextState;
  }
  return commitPlayerMatchResult(nextState, { playerFixture, competitionId, roundIndex, homeTeamInput, awayTeamInput }, playerMatchResult);
}
