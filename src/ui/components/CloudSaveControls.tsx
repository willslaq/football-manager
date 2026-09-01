import { useEffect, useRef, useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import {
  exchangeGoogleCredential,
  getCloudSession,
  onCloudSessionChange,
  renderGoogleSignInButton,
  signOutOfCloud,
  type CloudSession,
} from '../../persistence/cloudAuth';
import {
  deleteCloudSave,
  listCloudSaves,
  loadCloudSave,
  saveCareerToCloud,
  type CloudSaveSummary,
} from '../../persistence/cloudSync';
import { Button } from './Button';
import { Card } from './Card';
import './CloudSaveControls.css';

/** Botão oficial do Google, montado imperativamente pelo próprio script deles num container. */
function GoogleSignInButton({ onSignedIn }: { onSignedIn: (session: CloudSession) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    renderGoogleSignInButton(containerRef.current, async (credential) => {
      try {
        const session = await exchangeGoogleCredential(credential);
        onSignedIn(session);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [onSignedIn]);

  return (
    <div className="cloud-controls__signin">
      <div ref={containerRef} />
      {error && <p className="cloud-controls__error">{error}</p>}
    </div>
  );
}

export function CloudSaveControls({ defaultSlotName }: { defaultSlotName: string }) {
  const [session, setSession] = useState<CloudSession | null>(() => getCloudSession());
  const [saves, setSaves] = useState<CloudSaveSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const career = useCareerStore((s) => s.career);
  const lineup = useCareerStore((s) => s.lineup);
  const tactics = useCareerStore((s) => s.tactics);
  const loadCareerFromCloud = useCareerStore((s) => s.loadCareerFromCloud);

  useEffect(() => onCloudSessionChange(setSession), []);

  const refreshSaves = useRef(async () => {
    try {
      setSaves(await listCloudSaves());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  });

  useEffect(() => {
    if (session) void refreshSaves.current();
    else setSaves(null);
  }, [session]);

  async function handleSaveToCloud() {
    if (!career) return;
    setBusy(true);
    setError(null);
    try {
      await saveCareerToCloud(defaultSlotName, career, lineup, tactics);
      setMessage('Salvo na nuvem.');
      setTimeout(() => setMessage(null), 2000);
      await refreshSaves.current();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(id: string) {
    setBusy(true);
    setError(null);
    try {
      const record = await loadCloudSave(id);
      loadCareerFromCloud(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteCloudSave(id);
      await refreshSaves.current();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="cloud-controls">
      <span className="eyebrow">Save na nuvem</span>

      {!session ? (
        <GoogleSignInButton onSignedIn={setSession} />
      ) : (
        <>
          <div className="cloud-controls__account">
            <span>{session.user.email}</span>
            <Button variant="ghost" size="sm" onClick={signOutOfCloud}>
              Sair
            </Button>
          </div>

          <Button variant="secondary" disabled={busy || !career} onClick={handleSaveToCloud}>
            Salvar na nuvem
          </Button>
          {message && <span className="cloud-controls__message">{message}</span>}
          {error && <p className="cloud-controls__error">{error}</p>}

          {saves && saves.length > 0 && (
            <ul className="cloud-controls__list">
              {saves.map((save) => (
                <li key={save.id} className="cloud-controls__row">
                  <span className="cloud-controls__row-name">{save.slotName}</span>
                  <span className="cloud-controls__row-date">{new Date(save.updatedAt).toLocaleString('pt-BR')}</span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => handleLoad(save.id)}>
                    Carregar
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => handleDelete(save.id)}>
                    Excluir
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
