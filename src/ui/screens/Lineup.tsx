import { useEffect, useMemo, useState } from 'react';
import { buildSlots, assignToSlots } from '../../engine/simulation/formation';
import type { Formation, Player, TacticStyle } from '../../engine/types';
import { useCareerStore } from '../../store/careerStore';
import { resolveSquad } from '../utils';
import { computeLineupStatus } from '../lineupStatus';
import { Button, PitchEditor } from '../components';
import './Lineup.css';

export function Lineup() {
  const career = useCareerStore((s) => s.career);
  const lineup = useCareerStore((s) => s.lineup);
  const tactics = useCareerStore((s) => s.tactics);
  const setLineup = useCareerStore((s) => s.setLineup);
  const setTactics = useCareerStore((s) => s.setTactics);
  const autoSaveEnabled = useCareerStore((s) => s.autoSaveEnabled);
  const saveCurrentCareer = useCareerStore((s) => s.saveCurrentCareer);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const squad = useMemo(
    () => (career ? resolveSquad(career, career.playerClubId).sort((a, b) => b.strength - a.strength) : []),
    [career],
  );
  const playersById = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);

  const [assignments, setAssignments] = useState<Record<string, string | null>>(() => {
    const slots = buildSlots(tactics.formation);
    // Fonte da verdade: mapeamento exato vaga→jogador salvo da última vez. Só
    // cai pra heurística (assignToSlots) se não existir (save antigo/lineup
    // sugerido inicial) ou se a formação salva for outra (vagas não batem) —
    // sem isso, trocar de aba e voltar reconstruía a escalação por
    // aproximação e podia embaralhar quem estava em qual vaga.
    if (lineup?.slotAssignments && lineup.formation === tactics.formation) {
      const validSlotIds = new Set(slots.map((s) => s.id));
      const restored: Record<string, string | null> = {};
      for (const slot of slots) {
        const playerId = lineup.slotAssignments[slot.id];
        // Defesa extra: o careerStore já limpa titular suspenso do lineup assim que a
        // suspensão é decretada (ver removeSuspendedStarters), mas um save antigo
        // carregado só agora pode não ter passado por isso.
        restored[slot.id] =
          playerId && playersById.get(playerId)?.suspendedMatches === 0 ? playerId : null;
      }
      const allSlotsKnown = Object.keys(lineup.slotAssignments).every((id) => validSlotIds.has(id));
      if (allSlotsKnown) return restored;
    }
    const startersNow = (lineup?.starters ?? []).map((id) => playersById.get(id)).filter((p): p is Player => !!p);
    return assignToSlots(slots, startersNow);
  });

  useEffect(() => {
    if (!lineup) return;
    const ids = Object.values(assignments).filter((id): id is string => !!id);
    const assigned = ids.map((id) => playersById.get(id)).filter((p): p is Player => !!p);
    const bestFinisher = [...assigned].sort((a, b) => b.attributes.finishing - a.attributes.finishing)[0];
    setLineup({
      starters: ids,
      formation: tactics.formation,
      captain: ids[0] ?? '',
      penaltyTaker: bestFinisher?.id ?? ids[0] ?? '',
      freeKickTaker: bestFinisher?.id ?? ids[0] ?? '',
      slotAssignments: assignments,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments]);

  if (!career || !lineup) return null;

  const status = computeLineupStatus(assignments, playersById);

  function setFormation(formation: Formation) {
    setTactics({ ...tactics, formation });
  }

  async function handleSaveFormation() {
    await saveCurrentCareer();
    setSavedMessage('Formação salva.');
    setTimeout(() => setSavedMessage(null), 2000);
  }

  return (
    <div className="lineup">
      <div className="lineup__status">
        <span className="numeric">{status.assignedIds.length}/11 escalados</span>
        {!status.hasGoalkeeper && <span className="lineup__status--invalid">sem goleiro</span>}
        <span className={status.isValid ? 'lineup__status--valid' : 'lineup__status--invalid'}>
          {status.isValid ? 'Escalação válida' : 'Escalação incompleta'}
        </span>
        {!autoSaveEnabled && (
          <span className="lineup__save">
            <Button type="button" size="sm" variant="secondary" onClick={handleSaveFormation}>
              Salvar formação
            </Button>
            {savedMessage && <span className="lineup__save-message">{savedMessage}</span>}
          </span>
        )}
      </div>

      <PitchEditor
        idPrefix="lineup"
        formation={tactics.formation}
        style={tactics.style}
        onFormationChange={setFormation}
        onStyleChange={(style: TacticStyle) => setTactics({ ...tactics, style })}
        tacticalIntensity={career.settings.tacticalIntensity}
        squad={squad}
        assignments={assignments}
        onAssignmentsChange={setAssignments}
      />
    </div>
  );
}
