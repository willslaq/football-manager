import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useCareerStore } from '../../store/careerStore';
import { fromEpochDay } from '../../engine/generation/calendar';
import { buildMonthGrid } from '../calendarGrid';
import { findClub, findPlayerCompetition, outcomeFor, OUTCOME_LABEL, OUTCOME_VAR } from '../utils';
import { CLUB_CRESTS } from '../clubCrests';
import { Button, Card } from '../components';
import type { Fixture, MatchResult } from '../../engine/types';
import './Calendar.css';

interface CalendarProps {
  /** Abre o resultado de uma partida já disputada (mesmo destino do Histórico — ver App.tsx). */
  onSelect: (result: MatchResult) => void;
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_LABELS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

/**
 * Mês (visão mensal) com o jogo do time do jogador marcado no dia certo — só os jogos do PRÓPRIO
 * clube (não a rodada inteira), já com o calendário real gerado em `assignFixtureDates` (sábado ou
 * domingo). Clicar num dia já disputado abre o mesmo resultado do Histórico (ver App.tsx).
 */
export function Calendar({ onSelect }: CalendarProps) {
  const career = useCareerStore((s) => s.career);

  const fixturesByDate = useMemo(() => {
    const map = new Map<string, Fixture>();
    if (!career) return map;
    for (const competition of career.season.competitions) {
      for (const round of competition.fixtures) {
        for (const fixture of round) {
          if (fixture.homeTeamId === career.playerClubId || fixture.awayTeamId === career.playerClubId) {
            map.set(fixture.date, fixture);
          }
        }
      }
    }
    return map;
  }, [career]);

  const todayIso = career?.season.currentDate ?? fromEpochDay(0);
  const [todayYear, todayMonthNum] = todayIso.split('-').map(Number);
  // Estado inicial só — navegar o mês não deve "voltar" sozinho quando o calendário do jogo avança
  // (ver botão "Hoje" pra isso de propósito).
  const [viewed, setViewed] = useState<{ year: number; month: number }>({ year: todayYear, month: todayMonthNum - 1 });

  const grid = useMemo(() => buildMonthGrid(viewed.year, viewed.month), [viewed]);

  if (!career) return null;

  const competition = findPlayerCompetition(career);
  const monthLabel = `${MONTH_LABELS[viewed.month]} ${viewed.year}`;

  function goToMonth(deltaMonths: number) {
    setViewed((v) => {
      const total = v.year * 12 + v.month + deltaMonths;
      return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
    });
  }

  function goToToday() {
    const [y, m] = todayIso.split('-').map(Number);
    setViewed({ year: y, month: m - 1 });
  }

  return (
    <div className="cal">
      <div className="cal__header">
        <div>
          <span className="eyebrow">{competition?.name ?? 'Calendário'}</span>
          <h1 className="cal__title">{monthLabel}</h1>
        </div>
        <div className="cal__nav">
          <Button variant="secondary" size="sm" onClick={() => goToMonth(-1)} aria-label="Mês anterior">
            ‹
          </Button>
          <Button variant="secondary" size="sm" onClick={goToToday}>
            Hoje
          </Button>
          <Button variant="secondary" size="sm" onClick={() => goToMonth(1)} aria-label="Próximo mês">
            ›
          </Button>
        </div>
      </div>

      <div className="cal__legend">
        {(['win', 'draw', 'loss'] as const).map((outcome) => (
          <span key={outcome} className="cal__legend-item">
            <span className="cal__legend-dot" style={{ background: OUTCOME_VAR[outcome] }} />
            {OUTCOME_LABEL[outcome]}
          </span>
        ))}
        <span className="cal__legend-item">
          <span className="cal__legend-dot cal__legend-dot--scheduled" />A jogar
        </span>
      </div>

      <Card className="cal__card">
        <div className="cal__weekdays">
          {WEEKDAY_LABELS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="cal__grid">
          {grid.map((cell) => {
            const fixture = fixturesByDate.get(cell.iso);
            const isToday = cell.iso === todayIso;
            const isHome = fixture?.homeTeamId === career.playerClubId;
            const opponentId = fixture ? (isHome ? fixture.awayTeamId : fixture.homeTeamId) : null;
            const opponent = opponentId ? findClub(career, opponentId) : undefined;
            const outcome = fixture ? outcomeFor(fixture, career.playerClubId) : null;
            const resultColor = outcome ? OUTCOME_VAR[outcome] : undefined;
            // Rodadas anteriores ao snapshot inicial (ver deriveCurrentRound em season.ts) não têm
            // `.result` por design — só saldo agregado nas standings, nunca placar jogo a jogo. Sem
            // isso, um fixture nessa faixa (data no passado) pareceria "a jogar" quando na verdade
            // já aconteceu, só que sem dado registrado.
            const isPastWithoutData = !!fixture && !fixture.result && cell.iso < todayIso;

            const cellClasses = [
              'cal-day',
              !cell.inMonth && 'cal-day--outside',
              isToday && 'cal-day--today',
              fixture && !fixture.result && (isPastWithoutData ? 'cal-day--no-data' : 'cal-day--scheduled'),
            ]
              .filter(Boolean)
              .join(' ');

            const content = (
              <>
                <span className="cal-day__num numeric">{cell.day}</span>
                {isToday && <span className="cal-day__badge">Hoje</span>}
                {fixture && opponent && (
                  <span className="cal-day__match">
                    {CLUB_CRESTS[opponent.id] && (
                      <img className="cal-day__crest" src={CLUB_CRESTS[opponent.id]} alt="" width={18} height={18} />
                    )}
                    <span className="cal-day__opponent" title={opponent.name}>
                      {isHome ? '' : '@ '}
                      {opponent.shortName}
                    </span>
                    {fixture.result ? (
                      <span className="cal-day__score numeric">
                        {isHome ? fixture.result.homeGoals : fixture.result.awayGoals}–
                        {isHome ? fixture.result.awayGoals : fixture.result.homeGoals}
                      </span>
                    ) : isPastWithoutData ? (
                      <span className="cal-day__status">sem dados</span>
                    ) : (
                      <span className="cal-day__status">{isHome ? 'em casa' : 'fora'}</span>
                    )}
                  </span>
                )}
              </>
            );

            const style = resultColor ? ({ '--result-color': resultColor } as CSSProperties) : undefined;

            return fixture?.result ? (
              <button key={cell.iso} type="button" className={cellClasses} style={style} onClick={() => onSelect(fixture.result!)}>
                {content}
              </button>
            ) : (
              <div key={cell.iso} className={cellClasses} style={style}>
                {content}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
