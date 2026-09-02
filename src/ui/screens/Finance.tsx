import { useCareerStore } from '../../store/careerStore';
import { ticketPriceRange } from '../../engine/simulation/finance';
import type { FinanceTransaction } from '../../engine/types';
import { brlFromEur, findClub, findPlayerCompetition, formatEurBRL, isSeriesB } from '../utils';
import { Badge, Button, Card } from '../components';
import './Finance.css';

/**
 * Passo do stepper, em EUR — o motor guarda `ticketPrice` em EUR (ver `Club.ticketPrice`), então
 * ajustar em EUR (não em R$ convertido de volta) evita deriva de arredondamento entre cliques
 * (R$ e EUR não são múltiplos exatos um do outro pela cotação fixa de `EUR_TO_BRL_RATE`).
 */
const TICKET_PRICE_STEP_EUR = 1;

const TRANSACTION_LABEL: Record<FinanceTransaction['type'], string> = {
  matchday: 'Bilheteria',
  prize: 'Premiação',
};

function formatEntryDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function TicketPriceControl({ ticketPriceEur, isSeriesA }: { ticketPriceEur: number; isSeriesA: boolean }) {
  const setTicketPrice = useCareerStore((s) => s.setTicketPrice);
  const range = ticketPriceRange(isSeriesA);
  const priceBRL = brlFromEur(ticketPriceEur);
  const minBRL = brlFromEur(range.min);
  const maxBRL = brlFromEur(range.max);

  function adjust(deltaEur: number) {
    setTicketPrice(Math.min(range.max, Math.max(range.min, ticketPriceEur + deltaEur)));
  }

  return (
    <Card className="finance-card">
      <span className="finance-card__title">Preço do ingresso</span>
      <div className="finance-ticket">
        <Button size="sm" onClick={() => adjust(-TICKET_PRICE_STEP_EUR)} disabled={ticketPriceEur <= range.min} aria-label="Diminuir preço">
          −
        </Button>
        <span className="finance-ticket__value numeric">
          R$ {priceBRL.toLocaleString('pt-BR')}
        </span>
        <Button size="sm" onClick={() => adjust(TICKET_PRICE_STEP_EUR)} disabled={ticketPriceEur >= range.max} aria-label="Aumentar preço">
          +
        </Button>
      </div>
      <p className="finance-card__hint">
        Faixa permitida: R$ {minBRL.toLocaleString('pt-BR')} – R$ {maxBRL.toLocaleString('pt-BR')}. Ingresso mais caro rende mais
        por torcedor, mas esvazia um pouco o estádio; mais barato enche mais, mas rende menos por cabeça.
      </p>
    </Card>
  );
}

export function Finance() {
  const career = useCareerStore((s) => s.career);
  if (!career) return null;

  const club = findClub(career, career.playerClubId);
  if (!club) return null;

  const isSeriesA = !isSeriesB(findPlayerCompetition(career));
  const entries = [...career.financeLog].reverse();

  return (
    <div className="finance">
      <div className="finance__header">
        <span className="eyebrow">Finanças do {club.name}</span>
        <span className="finance__balance numeric">{formatEurBRL(club.budget)}</span>
      </div>

      <div className="finance__layout">
        <Card className="finance-card finance-card--ledger">
          <span className="finance-card__title">Extrato</span>
          {entries.length === 0 ? (
            <p className="finance__empty">Nenhum lançamento ainda — a bilheteria do próximo jogo em casa aparece aqui.</p>
          ) : (
            <div className="finance__ledger scroll-styled">
              {entries.map((entry, index) => (
                <div key={`${entry.date}-${index}`} className="finance__row">
                  <span className="finance__row-date numeric">{formatEntryDate(entry.date)}</span>
                  <div className="finance__row-main">
                    <span className="finance__row-desc">{entry.description}</span>
                    <Badge tone={entry.type === 'prize' ? 'floodlight' : 'neutral'}>{TRANSACTION_LABEL[entry.type]}</Badge>
                  </div>
                  <span className="finance__row-amount numeric">+{formatEurBRL(entry.amountEur)}</span>
                  <span className="finance__row-balance numeric">{formatEurBRL(entry.balanceAfterEur)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <TicketPriceControl ticketPriceEur={club.ticketPrice} isSeriesA={isSeriesA} />
      </div>
    </div>
  );
}
