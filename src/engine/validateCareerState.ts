import { POSITIONS } from './types/player';
import { SEASON_STATES } from './types/season';
import { TACTICAL_INTENSITIES } from './types/tactics';
import type { CareerState } from './types/career';
import type { Player } from './types/player';
import type { Club } from './types/club';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function validatePlayer(player: Player, errors: string[]): void {
  const label = `player ${player.id}`;

  if (!player.id) errors.push(`${label}: id vazio`);
  if (!player.name) errors.push(`${label}: name vazio`);
  if (!inRange(player.age, 15, 45)) errors.push(`${label}: age fora do intervalo [15, 45]`);
  if (!POSITIONS.includes(player.position)) {
    errors.push(`${label}: position inválida (${player.position})`);
  }
  for (const pos of player.secondaryPositions) {
    if (!POSITIONS.includes(pos)) {
      errors.push(`${label}: secondaryPosition inválida (${pos})`);
    }
  }
  if (!inRange(player.strength, 0, 100)) errors.push(`${label}: strength fora de [0, 100]`);
  if (!inRange(player.condition, 0, 100)) errors.push(`${label}: condition fora de [0, 100]`);
  if (!inRange(player.morale, 0, 100)) errors.push(`${label}: morale fora de [0, 100]`);
  if (!inRange(player.potential, 0, 100)) errors.push(`${label}: potential fora de [0, 100]`);

  for (const [key, value] of Object.entries(player.attributes)) {
    if (!inRange(value, 0, 100)) {
      errors.push(`${label}: attribute ${key} fora de [0, 100]`);
    }
  }
}

function validateClub(club: Club, playerIds: Set<string>, errors: string[]): void {
  const label = `club ${club.id}`;

  if (!club.id) errors.push(`${label}: id vazio`);
  if (!club.name) errors.push(`${label}: name vazio`);
  if (!club.shortName) errors.push(`${label}: shortName vazio`);
  if (!inRange(club.reputation, 0, 100)) errors.push(`${label}: reputation fora de [0, 100]`);
  if (!inRange(club.morale, 0, 100)) errors.push(`${label}: morale fora de [0, 100]`);
  if (club.stadiumCapacity <= 0) errors.push(`${label}: stadiumCapacity deve ser > 0`);
  if (club.squad.length === 0) errors.push(`${label}: squad vazio`);

  for (const playerId of club.squad) {
    if (!playerIds.has(playerId)) {
      errors.push(`${label}: squad referencia player inexistente (${playerId})`);
    }
  }

  const squadSet = new Set(club.squad);
  for (const playerId of club.academySquad ?? []) {
    if (!playerIds.has(playerId)) {
      errors.push(`${label}: academySquad referencia player inexistente (${playerId})`);
    }
    if (squadSet.has(playerId)) {
      errors.push(`${label}: academySquad e squad compartilham o mesmo player (${playerId})`);
    }
  }
}

export function validateCareerState(state: CareerState): ValidationResult {
  const errors: string[] = [];

  if (!Number.isFinite(state.seed)) errors.push('seed deve ser um número finito');
  if (!state.trainer.id) errors.push('trainer.id vazio');
  if (!state.trainer.name) errors.push('trainer.name vazio');

  const { clubs, players } = state.world;

  if (clubs.length === 0) errors.push('world.clubs vazio');

  const clubIds = new Set(clubs.map((c) => c.id));
  if (clubIds.size !== clubs.length) errors.push('world.clubs possui ids duplicados');

  const playerIds = new Set(players.map((p) => p.id));
  if (playerIds.size !== players.length) errors.push('world.players possui ids duplicados');

  for (const player of players) validatePlayer(player, errors);
  for (const club of clubs) validateClub(club, playerIds, errors);

  if (!clubIds.has(state.playerClubId)) {
    errors.push(`playerClubId referencia clube inexistente (${state.playerClubId})`);
  }

  if (!TACTICAL_INTENSITIES.includes(state.settings?.tacticalIntensity)) {
    errors.push(`settings.tacticalIntensity inválido (${state.settings?.tacticalIntensity})`);
  }

  if (!SEASON_STATES.includes(state.season.state)) {
    errors.push(`season.state inválido (${state.season.state})`);
  }

  if (!Number.isInteger(state.season.currentRound) || state.season.currentRound < 1) {
    errors.push(`season.currentRound inválido (${state.season.currentRound})`);
  }

  if (!ISO_DATE_RE.test(state.season.currentDate)) {
    errors.push(`season.currentDate inválido (${state.season.currentDate})`);
  }

  if (state.season.competitions.length === 0) {
    errors.push('season.competitions vazio');
  }

  const competitionIds = new Set<string>();
  for (const competition of state.season.competitions) {
    const compLabel = `competition ${competition.id}`;
    competitionIds.add(competition.id);

    if (competition.teams.length === 0) errors.push(`${compLabel}: teams vazio`);
    const teamSet = new Set(competition.teams);
    if (teamSet.size !== competition.teams.length) {
      errors.push(`${compLabel}: teams possui ids duplicados`);
    }
    for (const teamId of competition.teams) {
      if (!clubIds.has(teamId)) {
        errors.push(`${compLabel}: teams referencia clube inexistente (${teamId})`);
      }
    }

    competition.fixtures.forEach((round, roundIndex) => {
      round.forEach((fixture) => {
        const fixtureLabel = `${compLabel} rodada ${roundIndex} (${fixture.homeTeamId} x ${fixture.awayTeamId})`;
        if (fixture.homeTeamId === fixture.awayTeamId) {
          errors.push(`${fixtureLabel}: mandante e visitante são o mesmo clube`);
        }
        if (!ISO_DATE_RE.test(fixture.date)) {
          errors.push(`${fixtureLabel}: date inválido (${fixture.date})`);
        }
        if (!teamSet.has(fixture.homeTeamId)) {
          errors.push(`${fixtureLabel}: homeTeamId fora de teams`);
        }
        if (!teamSet.has(fixture.awayTeamId)) {
          errors.push(`${fixtureLabel}: awayTeamId fora de teams`);
        }
      });
    });

    for (const entry of competition.standings) {
      if (!teamSet.has(entry.clubId)) {
        errors.push(`${compLabel}: standings referencia clube fora de teams (${entry.clubId})`);
      }
    }
  }

  for (const entry of state.season.calendar) {
    if (!competitionIds.has(entry.competitionId)) {
      errors.push(`calendar referencia competição inexistente (${entry.competitionId})`);
    }
    if (entry.round < 0) {
      errors.push(`calendar possui round negativo (${entry.round})`);
    }
  }

  for (const entry of state.history) {
    if (!clubIds.has(entry.champion)) {
      errors.push(`history referencia campeão inexistente (${entry.champion})`);
    }
    for (const clubId of [...entry.libertadores, ...entry.relegated, ...entry.promoted]) {
      if (!clubIds.has(clubId)) {
        errors.push(`history (${entry.year}) referencia clube inexistente (${clubId})`);
      }
    }
    if (entry.topScorer && !playerIds.has(entry.topScorer.playerId)) {
      errors.push(`history (${entry.year}) referencia artilheiro inexistente (${entry.topScorer.playerId})`);
    }
    if (entry.goldenGlove && !playerIds.has(entry.goldenGlove.playerId)) {
      errors.push(`history (${entry.year}) referencia goleiro (luva de ouro) inexistente (${entry.goldenGlove.playerId})`);
    }
  }

  return { valid: errors.length === 0, errors };
}
