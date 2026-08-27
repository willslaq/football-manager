// Instancia o motor e roteia mensagens tipadas entre a UI e o motor de simulação.
// Único lugar com estado mutável de carreira — o motor em si continua puro.

import {
  advanceRound,
  createBrasileiraoCareer,
  generateSeason,
  generateWorld,
  pickAutoLineup,
  validateCareerState,
} from '../engine';
import type { CareerState, Lineup, Tactics } from '../engine/types';
import type { ClubSummary, EngineRequest, EngineResponse } from './protocol';

let career: CareerState | null = null;

const DEFAULT_TACTICS: Tactics = { formation: '4-4-2', style: 'balanced' };

function buildSuggestedLineup(state: CareerState): Lineup {
  const club = state.world.clubs.find((c) => c.id === state.playerClubId);
  if (!club) throw new Error(`Clube do jogador não encontrado (${state.playerClubId})`);
  const playersById = new Map(state.world.players.map((p) => [p.id, p]));
  const squad = club.squad.map((id) => playersById.get(id)!);
  const starters = pickAutoLineup(squad, DEFAULT_TACTICS.formation);
  const ids = starters.map((p) => p.id);
  return {
    starters: ids,
    formation: DEFAULT_TACTICS.formation,
    captain: ids[0],
    penaltyTaker: ids[ids.length - 1],
    freeKickTaker: ids[ids.length - 1],
  };
}

function respond(response: EngineResponse): void {
  self.postMessage(response);
}

self.onmessage = (event: MessageEvent<EngineRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'listClubs': {
        const world = generateWorld(request.payload.seed);

        // Posição real na tabela atual — dado de verdade, não estimado a partir da reputação.
        const standings = [...generateSeason().competitions[0].standings].sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.won !== a.won) return b.won - a.won;
          const gdDiff = b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst);
          if (gdDiff !== 0) return gdDiff;
          return b.goalsFor - a.goalsFor;
        });
        const positionByClub = new Map(standings.map((entry, index) => [entry.clubId, index + 1]));

        const clubs: ClubSummary[] = world.clubs
          .map((c) => ({
            id: c.id,
            name: c.name,
            shortName: c.shortName,
            reputation: c.reputation,
            colors: c.colors,
            tablePosition: positionByClub.get(c.id) ?? 0,
          }))
          .sort((a, b) => a.tablePosition - b.tablePosition);
        respond({ type: 'clubsList', requestId: request.requestId, payload: { clubs } });
        break;
      }

      case 'startCareer': {
        const state = createBrasileiraoCareer(
          request.payload.seed,
          { id: 'trainer-1', name: request.payload.trainerName },
          request.payload.clubId,
        );
        career = state;
        respond({
          type: 'careerState',
          requestId: request.requestId,
          payload: { state, suggestedLineup: buildSuggestedLineup(state), suggestedTactics: DEFAULT_TACTICS },
        });
        break;
      }

      case 'advanceRound': {
        if (!career) throw new Error('Nenhuma carreira iniciada');
        const previousRound = career.season.currentRound;
        const nextState = advanceRound(career, {
          playerLineup: request.payload.playerLineup,
          playerTactics: request.payload.playerTactics,
        });
        career = nextState;

        const playedRound = nextState.season.competitions[0].fixtures[previousRound - 1];
        const playerFixture = playedRound.find(
          (f) => f.homeTeamId === nextState.playerClubId || f.awayTeamId === nextState.playerClubId,
        );

        respond({
          type: 'roundResult',
          requestId: request.requestId,
          payload: {
            state: nextState,
            playerMatch: playerFixture?.result ?? null,
            suggestedLineup: buildSuggestedLineup(nextState),
          },
        });
        break;
      }

      case 'setCareer': {
        const result = validateCareerState(request.payload.state);
        if (!result.valid) {
          throw new Error(`Estado de carreira inválido: ${result.errors.slice(0, 5).join('; ')}`);
        }
        career = request.payload.state;
        respond({
          type: 'careerState',
          requestId: request.requestId,
          payload: {
            state: career,
            suggestedLineup: buildSuggestedLineup(career),
            suggestedTactics: DEFAULT_TACTICS,
          },
        });
        break;
      }
    }
  } catch (err) {
    respond({
      type: 'error',
      requestId: request.requestId,
      payload: { message: err instanceof Error ? err.message : String(err) },
    });
  }
};
