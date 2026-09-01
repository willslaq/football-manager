import { useEffect } from 'react';
import { useCareerStore } from '../../store/careerStore';
import { Backdrop, Badge, Button, Card, FileButton, ProgressBar } from '../components';
import './Start.css';

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function Start({ onNewCareer, onFriendly }: { onNewCareer: () => void; onFriendly: () => void }) {
  const saves = useCareerStore((s) => s.saves);
  const error = useCareerStore((s) => s.error);
  const refreshSaves = useCareerStore((s) => s.refreshSaves);
  const loadSave = useCareerStore((s) => s.loadSave);
  const deleteSave = useCareerStore((s) => s.deleteSave);
  const importCareerFile = useCareerStore((s) => s.importCareerFile);

  useEffect(() => {
    refreshSaves();
  }, [refreshSaves]);

  async function handleFile(file: File) {
    importCareerFile(await file.text());
  }

  return (
    <Backdrop>
      <header className="start__header">
        <span className="eyebrow">Campeonato Brasileiro Série A e Série B · 2026</span>
        <h1 className="start__title">Manager de Futebol</h1>
        <p className="start__lead">
          Assuma o comando de um clube da Série A ou da Série B e viva a temporada real, rodada a rodada — com os
          40 clubes das duas divisões e acesso/rebaixamento de verdade entre elas ano a ano.
        </p>
      </header>

      {saves.length > 0 && (
        <section>
          <p className="start__section-title">Continuar carreira</p>
          <div className="save-list">
            {saves.map((save) => {
              const roundsPlayed = save.currentRound - 1;
              return (
                <Card key={save.id} accentColor={save.clubColor} className="save-card">
                  <div className="save-card__header">
                    <div>
                      <p className="save-card__name">{save.slotName}</p>
                      <p className="save-card__meta">
                        {save.trainerName} · {save.clubName}
                      </p>
                    </div>
                    {save.seasonState === 'finished' && <Badge tone="floodlight">Encerrada</Badge>}
                  </div>

                  <ProgressBar
                    value={roundsPlayed}
                    max={save.totalRounds}
                    label={`${roundsPlayed}/${save.totalRounds} rodadas`}
                  />

                  <div className="save-card__footer">
                    <span className="save-card__date">Salvo em {formatDate(save.updatedAt)}</span>
                    <div className="save-card__actions">
                      <Button variant="ghost" size="sm" onClick={() => deleteSave(save.id)}>
                        Excluir
                      </Button>
                      <Button variant="primary" size="sm" onClick={() => loadSave(save.id)}>
                        Continuar
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section className="action-grid">
        <Card className="action-card">
          <h2 className="action-card__title">Nova carreira</h2>
          <p className="action-card__desc">Escolha um clube da Série A ou da Série B e comece uma carreira do zero.</p>
          <Button variant="primary" onClick={onNewCareer}>
            Criar carreira
          </Button>
        </Card>

        <Card className="action-card">
          <h2 className="action-card__title">Importar carreira</h2>
          <p className="action-card__desc">Tem um arquivo .json de uma carreira exportada? Carregue aqui.</p>
          <FileButton accept="application/json" onFile={handleFile}>
            Escolher arquivo
          </FileButton>
        </Card>

        <Card className="action-card">
          <h2 className="action-card__title">Amistoso</h2>
          <p className="action-card__desc">
            Escolha dois clubes, monte as escalações e simule uma partida avulsa — nada é salvo.
          </p>
          <Button variant="secondary" onClick={onFriendly}>
            Jogar amistoso
          </Button>
        </Card>
      </section>

      {error && <p className="error-banner">{error}</p>}
    </Backdrop>
  );
}
