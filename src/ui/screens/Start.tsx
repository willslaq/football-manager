import { useEffect, useMemo, useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import type { SavedCareerSummary } from '../../persistence/db';
import {
  getCloudSession,
  onCloudSessionChange,
  signOutOfCloud,
  type CloudSession,
} from '../../persistence/cloudAuth';
import { deleteCloudSave, listCloudSaves, loadCloudSave, type CloudSaveSummary } from '../../persistence/cloudSync';
import { Backdrop, Badge, Button, Card, FileButton, GoogleSignInButton, ProgressBar } from '../components';
import './Start.css';

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

type UnifiedSave =
  | ({ source: 'local' } & SavedCareerSummary)
  | ({ source: 'cloud' } & CloudSaveSummary);

function AccountControl({
  session,
  onSignedIn,
}: {
  session: CloudSession | null;
  onSignedIn: (session: CloudSession) => void;
}) {
  if (!session) {
    return (
      <div className="account-control">
        <span className="account-control__hint">Entre para carregar sua carreira de qualquer aparelho</span>
        <GoogleSignInButton onSignedIn={onSignedIn} />
      </div>
    );
  }
  return (
    <div className="account-control account-control--signed-in">
      <div className="account-chip">
        <span className="account-chip__avatar">{session.user.name.charAt(0).toUpperCase()}</span>
        <span className="account-chip__name" title={session.user.email}>
          {session.user.name}
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={signOutOfCloud}>
        Sair
      </Button>
    </div>
  );
}

export function Start({ onNewCareer, onFriendly }: { onNewCareer: () => void; onFriendly: () => void }) {
  const saves = useCareerStore((s) => s.saves);
  const error = useCareerStore((s) => s.error);
  const loading = useCareerStore((s) => s.loading);
  const refreshSaves = useCareerStore((s) => s.refreshSaves);
  const loadSave = useCareerStore((s) => s.loadSave);
  const deleteSave = useCareerStore((s) => s.deleteSave);
  const importCareerFile = useCareerStore((s) => s.importCareerFile);
  const loadCareerFromCloud = useCareerStore((s) => s.loadCareerFromCloud);

  const [session, setSession] = useState<CloudSession | null>(() => getCloudSession());
  const [cloudSaves, setCloudSaves] = useState<CloudSaveSummary[]>([]);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudListBusy, setCloudListBusy] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  useEffect(() => {
    refreshSaves();
  }, [refreshSaves]);

  useEffect(() => onCloudSessionChange(setSession), []);

  useEffect(() => {
    if (!loading) setPendingKey(null);
  }, [loading]);

  useEffect(() => {
    if (!session) {
      setCloudSaves([]);
      return;
    }
    let cancelled = false;
    setCloudListBusy(true);
    setCloudError(null);
    listCloudSaves()
      .then((list) => {
        if (!cancelled) setCloudSaves(list);
      })
      .catch((err) => {
        if (!cancelled) setCloudError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setCloudListBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const unified = useMemo<UnifiedSave[]>(() => {
    const local: UnifiedSave[] = saves.map((s) => ({ source: 'local', ...s }));
    const cloud: UnifiedSave[] = cloudSaves.map((s) => ({ source: 'cloud', ...s }));
    return [...local, ...cloud].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [saves, cloudSaves]);

  async function handleFile(file: File) {
    importCareerFile(await file.text());
  }

  async function handleContinueLocal(id: number) {
    setPendingKey(`local:${id}`);
    await loadSave(id);
  }

  async function handleContinueCloud(id: string) {
    setPendingKey(`cloud:${id}`);
    setCloudError(null);
    try {
      const record = await loadCloudSave(id);
      loadCareerFromCloud(record);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : String(err));
      setPendingKey(null);
    }
  }

  async function handleDeleteLocal(id: number) {
    setDeletingKey(`local:${id}`);
    await deleteSave(id);
    setDeletingKey(null);
  }

  async function handleDeleteCloud(id: string) {
    setDeletingKey(`cloud:${id}`);
    setCloudError(null);
    try {
      await deleteCloudSave(id);
      setCloudSaves((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <Backdrop>
      <header className="start__header">
        <div className="start__intro">
          <span className="eyebrow">Campeonato Brasileiro Série A e Série B · 2026</span>
          <h1 className="start__title">Manager de Futebol</h1>
          <p className="start__lead">
            Assuma o comando de um clube da Série A ou da Série B e viva a temporada real, rodada a rodada — com os
            40 clubes das duas divisões e acesso/rebaixamento de verdade entre elas ano a ano.
          </p>
        </div>
        <AccountControl session={session} onSignedIn={setSession} />
      </header>

      {unified.length > 0 && (
        <section>
          <p className="start__section-title">Continuar carreira</p>
          {cloudListBusy && <p className="start__hint">Sincronizando com a nuvem…</p>}
          <div className="save-list">
            {unified.map((save) => {
              const key = `${save.source}:${save.id}`;
              const roundsPlayed = Math.max(0, save.currentRound - 1);
              const isPending = pendingKey === key;
              const isDeleting = deletingKey === key;
              const busy = loading || isDeleting;
              return (
                <Card key={key} accentColor={save.clubColor} className="save-card">
                  <div className="save-card__header">
                    <div>
                      <p className="save-card__name">{save.slotName}</p>
                      <p className="save-card__meta">
                        {save.trainerName} · {save.clubName}
                      </p>
                    </div>
                    <div className="save-card__tags">
                      {save.source === 'cloud' && <Badge tone="pitch">Nuvem</Badge>}
                      {save.seasonState === 'finished' && <Badge tone="floodlight">Encerrada</Badge>}
                    </div>
                  </div>

                  <ProgressBar
                    value={roundsPlayed}
                    max={save.totalRounds}
                    label={`${roundsPlayed}/${save.totalRounds} rodadas`}
                  />

                  <div className="save-card__footer">
                    <span className="save-card__date">Salvo em {formatDate(save.updatedAt)}</span>
                    <div className="save-card__actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          save.source === 'local' ? handleDeleteLocal(save.id) : handleDeleteCloud(save.id)
                        }
                      >
                        {isDeleting ? 'Excluindo…' : 'Excluir'}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          save.source === 'local' ? handleContinueLocal(save.id) : handleContinueCloud(save.id)
                        }
                      >
                        {isPending && loading ? 'Carregando…' : 'Continuar'}
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

      {(error || cloudError) && <p className="error-banner">{error ?? cloudError}</p>}
    </Backdrop>
  );
}
