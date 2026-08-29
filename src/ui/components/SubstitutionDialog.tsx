import { useEffect, useMemo, useRef } from 'react';
import { MAX_SUBSTITUTIONS_PER_TEAM } from '../../engine';
import type { Player, PlayerId } from '../../engine/types';
import { positionFit } from '../positionFit';
import { applyPendingSwaps, type PendingSwap, type PitchRosterEntry } from '../../store/careerStore';
import { Badge } from './Badge';
import { Button } from './Button';
import './SubstitutionDialog.css';

export interface SubstitutionDialogProps {
  open: boolean;
  pitchRoster: PitchRosterEntry[];
  benchIds: PlayerId[];
  pendingSwaps: PendingSwap[];
  selectedPitchSlotId: string | null;
  subCount: number;
  players: Player[];
  onSelectSlot: (slotId: string | null) => void;
  onQueueSwap: (benchPlayerId: PlayerId) => void;
  onRemovePendingSwap: (index: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Diálogo de substituição da partida ao vivo: mostra quem está em campo e no banco do time do
 * jogador, permite selecionar um titular (fica "elevado") e trocar por um reserva — várias
 * trocas podem ser montadas antes de confirmar (ver careerStore's `pendingSwaps`). Pausa a
 * partida enquanto aberto (ver `openSubstitutionDialog`); fechar sem confirmar não retoma sozinho.
 */
export function SubstitutionDialog({
  open,
  pitchRoster,
  benchIds,
  pendingSwaps,
  selectedPitchSlotId,
  subCount,
  players,
  onSelectSlot,
  onQueueSwap,
  onRemovePendingSwap,
  onConfirm,
  onClose,
}: SubstitutionDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const { pitchRoster: effectivePitch, benchIds: effectiveBench } = useMemo(
    () => applyPendingSwaps(pitchRoster, benchIds, pendingSwaps),
    [pitchRoster, benchIds, pendingSwaps],
  );

  if (!open) return null;

  const selectedSlot = effectivePitch.find((entry) => entry.slotId === selectedPitchSlotId) ?? null;
  const atLimit = subCount + pendingSwaps.length >= MAX_SUBSTITUTIONS_PER_TEAM;

  return (
    <div className="sub-dialog-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="sub-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sub-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sub-dialog__header">
          <h2 id="sub-dialog-title">Substituições</h2>
          <span className="sub-dialog__count numeric">
            {subCount + pendingSwaps.length}/{MAX_SUBSTITUTIONS_PER_TEAM}
          </span>
          <button type="button" className="sub-dialog__close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="sub-dialog__groups">
          <section className="sub-dialog__group">
            <span className="eyebrow">Em campo</span>
            <ul className="sub-dialog__list">
              {effectivePitch.map((entry) => {
                const player = playersById.get(entry.playerId);
                const changed = pitchRoster.find((p) => p.slotId === entry.slotId)?.playerId !== entry.playerId;
                return (
                  <li key={entry.slotId}>
                    <button
                      type="button"
                      className={`sub-row${selectedPitchSlotId === entry.slotId ? ' sub-row--selected' : ''}${changed ? ' sub-row--changed' : ''}`}
                      onClick={() => onSelectSlot(selectedPitchSlotId === entry.slotId ? null : entry.slotId)}
                    >
                      <span className="sub-row__pos">{entry.canonicalPosition}</span>
                      <span className="sub-row__name">{player?.name ?? entry.playerId}</span>
                      {changed && <Badge tone="pitch">Entrou</Badge>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="sub-dialog__group">
            <span className="eyebrow">Banco</span>
            <ul className="sub-dialog__list">
              {effectiveBench.length === 0 && <li className="sub-dialog__empty">Nenhum reserva disponível.</li>}
              {effectiveBench.map((playerId) => {
                const player = playersById.get(playerId);
                if (!player) return null;
                const fit = selectedSlot ? positionFit(player, selectedSlot.canonicalPosition) : null;
                const mismatch = fit === 'similar' || fit === 'poor';
                const disabled = !selectedSlot || atLimit;
                return (
                  <li key={playerId}>
                    <button
                      type="button"
                      className={`sub-row${disabled ? ' sub-row--disabled' : ''}`}
                      onClick={() => !disabled && onQueueSwap(playerId)}
                      disabled={disabled}
                      title={
                        mismatch
                          ? `${player.name} joga naturalmente de ${player.position} — fora de posição em ${selectedSlot?.canonicalPosition}`
                          : undefined
                      }
                    >
                      <span className="sub-row__pos">{player.position}</span>
                      <span className="sub-row__name">{player.name}</span>
                      {mismatch && <Badge tone="floodlight">Fora de posição</Badge>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {!selectedSlot && effectiveBench.length > 0 && (
          <p className="sub-dialog__hint">Selecione um titular em campo pra trocar por um reserva.</p>
        )}

        {pendingSwaps.length > 0 && (
          <ul className="sub-dialog__pending">
            {pendingSwaps.map((swap, i) => (
              <li key={i}>
                <span>
                  {playersById.get(swap.playerOutId)?.name ?? swap.playerOutId} sai, {playersById.get(swap.playerInId)?.name ?? swap.playerInId} entra
                </span>
                <button type="button" className="sub-dialog__pending-remove" onClick={() => onRemovePendingSwap(i)} aria-label="Desfazer">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sub-dialog__footer">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={pendingSwaps.length === 0}>
            Confirmar Substituição
          </Button>
        </div>
      </div>
    </div>
  );
}
