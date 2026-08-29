import type { CSSProperties } from 'react';
import type { ClubId } from '../../engine/types';
import { CLUB_CRESTS } from '../clubCrests';
import './RoundResultsList.css';

export interface RoundResultsListEntry {
  homeTeamId: ClubId;
  awayTeamId: ClubId;
  homeGoals: number;
  awayGoals: number;
  /** false = partida em andamento (placar cresce gol a gol); true = tempo cheio, placar definitivo. */
  finished: boolean;
}

interface RoundResultsListProps {
  entries: RoundResultsListEntry[];
  /** Time do jogador, se houver — destaca a linha correspondente. */
  playerClubId?: ClubId;
  clubName: (id: ClubId) => string;
  emptyMessage?: string;
}

function staggerStyle(index: number): CSSProperties {
  return { '--i': Math.min(index, 8) } as CSSProperties;
}

/**
 * Lista compacta de resultados de uma rodada (crest + nome + placar por confronto),
 * reaproveitada tanto pra rodada sendo revelada aos poucos na transmissão ao vivo
 * (`MatchLive`) quanto pro resumo estático pós-jogo (`MatchResult`) — mesma marcação
 * usada em `MatchHistory`'s "Rodada completa", com classes próprias pra permitir o
 * estado "a jogar" (result null) e a animação de revelação.
 */
export function RoundResultsList({ entries, playerClubId, clubName, emptyMessage }: RoundResultsListProps) {
  if (entries.length === 0) {
    return emptyMessage ? <p className="rrl-empty">{emptyMessage}</p> : null;
  }

  return (
    <div className="rrl-list">
      {entries.map((entry, i) => {
        const isOwn = entry.homeTeamId === playerClubId || entry.awayTeamId === playerClubId;
        return (
          <div
            key={`${entry.homeTeamId}-${entry.awayTeamId}`}
            className={`rrl-row${isOwn ? ' rrl-row--own' : ''}`}
            style={staggerStyle(i)}
          >
            <span className="rrl-team">
              {CLUB_CRESTS[entry.homeTeamId] && <img className="rrl-crest" src={CLUB_CRESTS[entry.homeTeamId]} alt="" />}
              <span className="rrl-name" title={clubName(entry.homeTeamId)}>
                {clubName(entry.homeTeamId)}
              </span>
            </span>

            <span
              key={`${entry.homeGoals}-${entry.awayGoals}-${entry.finished}`}
              className={`rrl-score numeric rrl-score--revealed${entry.finished ? '' : ' rrl-score--pending'}`}
            >
              {entry.homeGoals} — {entry.awayGoals}
            </span>

            <span className="rrl-team rrl-team--away">
              <span className="rrl-name" title={clubName(entry.awayTeamId)}>
                {clubName(entry.awayTeamId)}
              </span>
              {CLUB_CRESTS[entry.awayTeamId] && <img className="rrl-crest" src={CLUB_CRESTS[entry.awayTeamId]} alt="" />}
            </span>
          </div>
        );
      })}
    </div>
  );
}
