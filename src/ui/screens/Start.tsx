import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useCareerStore } from '../../store/careerStore';
import type { SavedCareerSummary } from '../../persistence/db';
import {
  getCloudSession,
  onCloudSessionChange,
  signOutOfCloud,
  type CloudSession,
} from '../../persistence/cloudAuth';
import { deleteCloudSave, listCloudSaves, loadCloudSave, type CloudSaveSummary } from '../../persistence/cloudSync';
import { Backdrop, Badge, Button, Card, GoogleSignInButton, ProgressBar } from '../components';
import { CLUB_CRESTS } from '../clubCrests';
import './Start.css';

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

type UnifiedSave =
  | ({ source: 'local' } & SavedCareerSummary)
  | ({ source: 'cloud' } & CloudSaveSummary);

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 13V3M6 6.5 10 3l4 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 13.5v2a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="action-tile__chevron">
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCloud() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 18h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 9.5 4 4 0 0 0 7 18Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/** Escudo do clube pelo `clubId`; cai numa inicial quando não há `clubId` (save antigo) ou o crest não existe no mapa. */
function ClubCrest({
  clubId,
  clubName,
  accentColor,
  className,
}: {
  clubId?: string;
  clubName: string;
  accentColor: string;
  className?: string;
}) {
  const src = clubId ? CLUB_CRESTS[clubId] : undefined;
  return (
    <div
      className={className ? `club-crest ${className}` : 'club-crest'}
      style={{ '--accent-color': accentColor } as CSSProperties}
    >
      {src ? <img src={src} alt="" className="club-crest__img" /> : <span className="club-crest__fallback">{clubName.charAt(0).toUpperCase()}</span>}
    </div>
  );
}

function ActionTileContent({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <>
      <span className="action-tile__icon">{icon}</span>
      <span className="action-tile__body">
        <span className="action-tile__title">{title}</span>
        <span className="action-tile__desc">{desc}</span>
      </span>
      <IconChevronRight />
    </>
  );
}

function ActionTile({
  icon,
  iconTone,
  title,
  desc,
  onClick,
}: {
  icon: ReactNode;
  iconTone?: 'pitch' | 'floodlight';
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`action-tile${iconTone ? ` action-tile--${iconTone}` : ''}`} onClick={onClick}>
      <ActionTileContent icon={icon} title={title} desc={desc} />
    </button>
  );
}

/** Mesma anatomia visual do ActionTile, mas como `<label>` + input de arquivo nativo escondido (padrão de seletor de arquivo). */
function ActionTileFile({
  icon,
  title,
  desc,
  accept,
  onFile,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  accept?: string;
  onFile: (file: File) => void;
}) {
  return (
    <label className="action-tile action-tile--file">
      <ActionTileContent icon={icon} title={title} desc={desc} />
      <input
        type="file"
        accept={accept}
        className="action-tile__file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

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
  const othersRef = useRef<HTMLDivElement>(null);

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

  const [featured, ...others] = unified;

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

  async function handleContinue(save: UnifiedSave) {
    return save.source === 'local' ? handleContinueLocal(save.id) : handleContinueCloud(save.id);
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

  function handleDelete(save: UnifiedSave) {
    return save.source === 'local' ? handleDeleteLocal(save.id) : handleDeleteCloud(save.id);
  }

  return (
    <Backdrop>
      <header className="start__header">
        <div className="start__intro">
          <span className="eyebrow">Campeonato Brasileiro Série A e Série B · 2026</span>
          <h1 className="start__title">Manager de Futebol</h1>
          {unified.length === 0 && (
            <p className="start__lead">
              Assuma o comando de um clube da Série A ou da Série B e viva a temporada real, rodada a rodada — com os
              40 clubes das duas divisões e acesso/rebaixamento de verdade entre elas ano a ano.
            </p>
          )}
        </div>
        <AccountControl session={session} onSignedIn={setSession} />
      </header>

      {featured && (
        <Card accentColor={featured.clubColor} className="hero-card">
          <div className="hero-card__glow" />
          {featured.source === 'cloud' && (
            <Badge tone="pitch" className="hero-card__sync">
              <IconCloud /> Nuvem
            </Badge>
          )}

          <div className="hero-card__identity">
            <ClubCrest clubId={featured.clubId} clubName={featured.clubName} accentColor={featured.clubColor} className="club-crest--hero" />
            <div className="hero-card__text">
              <span className="eyebrow">Continuar carreira</span>
              <h2 className="hero-card__club">{featured.clubName}</h2>
              <p className="hero-card__meta">Técnico {featured.trainerName}</p>
              <div className="hero-card__badges">
                {featured.division && <Badge tone="pitch">{featured.division}</Badge>}
                {featured.tablePosition && <Badge tone="floodlight">{featured.tablePosition}º colocado</Badge>}
                {featured.seasonState === 'finished' && <Badge tone="floodlight">Encerrada</Badge>}
              </div>
            </div>
          </div>

          <div className="hero-card__stats">
            <div className="hero-card__rounds">
              <span className="numeric hero-card__rounds-value">{Math.max(0, featured.currentRound - 1)}</span>
              <span className="hero-card__rounds-total">/ {featured.totalRounds} rodadas</span>
            </div>
            <ProgressBar value={Math.max(0, featured.currentRound - 1)} max={featured.totalRounds} />
            <span className="hero-card__date">Salvo em {formatDate(featured.updatedAt)}</span>
          </div>

          <div className="hero-card__actions">
            <Button
              variant="primary"
              className="hero-card__cta"
              disabled={loading || deletingKey === `${featured.source}:${featured.id}`}
              onClick={() => handleContinue(featured)}
            >
              {pendingKey === `${featured.source}:${featured.id}` && loading ? 'Carregando…' : 'Continuar carreira'}
            </Button>
            {others.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => othersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>
                Ver outras carreiras ({others.length})
              </Button>
            )}
          </div>
        </Card>
      )}

      {others.length > 0 && (
        <section>
          <p className="start__section-title">Outras carreiras</p>
          {cloudListBusy && <p className="start__hint">Sincronizando com a nuvem…</p>}
          <div className="save-row scroll-styled" ref={othersRef}>
            {others.map((save) => {
              const key = `${save.source}:${save.id}`;
              const roundsPlayed = Math.max(0, save.currentRound - 1);
              const isPending = pendingKey === key;
              const isDeleting = deletingKey === key;
              const busy = loading || isDeleting;
              return (
                <Card key={key} accentColor={save.clubColor} className="save-card">
                  <div className="save-card__header">
                    <ClubCrest clubId={save.clubId} clubName={save.clubName} accentColor={save.clubColor} className="club-crest--sm" />
                    <div className="save-card__names">
                      <p className="save-card__name" title={save.slotName}>
                        {save.slotName}
                      </p>
                      <p className="save-card__meta" title={`${save.trainerName} · ${save.clubName}`}>
                        {save.trainerName} · {save.clubName}
                      </p>
                    </div>
                    <div className="save-card__tags">
                      <Badge tone={save.source === 'cloud' ? 'pitch' : 'neutral'}>{save.source === 'cloud' ? 'Nuvem' : 'Local'}</Badge>
                      {save.seasonState === 'finished' && <Badge tone="floodlight">Encerrada</Badge>}
                    </div>
                  </div>

                  <ProgressBar value={roundsPlayed} max={save.totalRounds} />

                  <div className="save-card__footer">
                    <span className="save-card__date numeric">{formatDate(save.updatedAt)}</span>
                    <div className="save-card__actions">
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => handleDelete(save)}>
                        {isDeleting ? 'Excluindo…' : 'Excluir'}
                      </Button>
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleContinue(save)}>
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

      <section>
        <p className="start__section-title">{unified.length > 0 ? 'Começar algo novo' : 'Comece por aqui'}</p>
        <div className="action-tiles">
          <ActionTile icon={<IconPlus />} iconTone="pitch" title="Nova carreira" desc="Escolha um clube da Série A ou B" onClick={onNewCareer} />
          <ActionTileFile icon={<IconUpload />} title="Importar carreira" desc="Carregue um arquivo .json salvo" accept="application/json" onFile={handleFile} />
          <ActionTile icon={<span className="action-tile__vs">VS</span>} iconTone="floodlight" title="Amistoso" desc="Uma partida avulsa, nada é salvo" onClick={onFriendly} />
        </div>
      </section>

      {(error || cloudError) && <p className="error-banner">{error ?? cloudError}</p>}
    </Backdrop>
  );
}
