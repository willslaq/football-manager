import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TacticalIntensity } from '../../engine/types';
import { useCareerStore } from '../../store/careerStore';
import { Backdrop, Badge, Button, Card, CardButton, ProgressBar, TextField } from '../components';
import { CLUB_CRESTS } from '../clubCrests';
import { loadTacticalIntensityPreference, saveTacticalIntensityPreference } from '../tacticalIntensityPreference';
import { TACTICAL_INTENSITY_COPY } from '../utils';
import { useTabIndicator } from '../hooks/useTabIndicator';
import './NewCareer.css';

export function NewCareer({ onBack }: { onBack: () => void }) {
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000_000));
  const [trainerName, setTrainerName] = useState('');
  const [tacticalIntensity, setTacticalIntensity] = useState<TacticalIntensity>(loadTacticalIntensityPreference);
  const [division, setDivision] = useState<'A' | 'B'>('A');
  const { trackRef: divisionTrackRef, registerItem: registerDivision, indicator: divisionIndicator } =
    useTabIndicator<'A' | 'B'>(division);
  const [clubFilter, setClubFilter] = useState('');
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const clubs = useCareerStore((s) => s.clubs);
  const loading = useCareerStore((s) => s.loading);
  const error = useCareerStore((s) => s.error);
  const listClubs = useCareerStore((s) => s.listClubs);
  const startCareer = useCareerStore((s) => s.startCareer);

  useEffect(() => {
    listClubs(seed);
  }, [seed, listClubs]);

  const selectedClub = useMemo(() => clubs.find((c) => c.id === selectedClubId), [clubs, selectedClubId]);

  // Trocar de divisão enquanto o clube escolhido é da outra continua válido (a escolha não
  // desaparece, só sai da grade visível) — só se troca automaticamente quando ainda não há
  // nenhuma escolha, pra abrir a tela já na divisão do clube selecionado por último.
  useEffect(() => {
    if (selectedClub) setDivision(selectedClub.division);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClubId]);

  const query = clubFilter.trim().toLowerCase();
  const divisionClubs = clubs.filter(
    (c) =>
      c.division === division &&
      (!query || c.name.toLowerCase().includes(query) || c.shortName.toLowerCase().includes(query)),
  );

  const canStart = !!selectedClub && trainerName.trim().length > 0;

  function handleStart() {
    if (!selectedClub) return;
    startCareer(seed, trainerName.trim(), selectedClub.id, tacticalIntensity);
  }

  return (
    <Backdrop>
      <Button variant="ghost" size="sm" className="new-career__back" onClick={onBack}>
        ← Início
      </Button>

      <header className="new-career__header">
        <span className="eyebrow">Nova carreira</span>
        <h1 className="new-career__title">Escolha seu clube</h1>
        <p className="new-career__meta">Campeonato Brasileiro · carreira nº {seed}</p>
      </header>

      <div className="new-career__layout">
        <div className="new-career__main">
          <div className="new-career__browser-header">
            <p className="new-career__section-title">
              <span>{divisionClubs.length} clubes da Série {division}</span>
            </p>
            <div className="new-career__browser-controls">
              <TextField
                type="text"
                className="new-career__search"
                placeholder="Buscar clube…"
                value={clubFilter}
                onChange={(e) => setClubFilter(e.target.value)}
                aria-label="Buscar clube"
              />
              <div className="new-career__division-track" role="radiogroup" aria-label="Divisão" ref={divisionTrackRef}>
                <div className="new-career__division-track-items">
                  {(['A', 'B'] as const).map((d) => (
                    <button
                      key={d}
                      ref={registerDivision(d)}
                      type="button"
                      role="radio"
                      aria-checked={division === d}
                      className="new-career__division-btn"
                      onClick={() => setDivision(d)}
                    >
                      Série {d}
                    </button>
                  ))}
                </div>

                <div
                  className="fm-indicator-layer new-career__division-indicator-layer"
                  aria-hidden="true"
                  data-ready={divisionIndicator ? 'true' : 'false'}
                  style={
                    divisionIndicator
                      ? ({
                          '--fm-indicator-left': `${divisionIndicator.left}px`,
                          '--fm-indicator-right': `${divisionIndicator.right}px`,
                        } as CSSProperties)
                      : undefined
                  }
                >
                  {(['A', 'B'] as const).map((d) => (
                    <span key={d} className="new-career__division-btn">
                      Série {d}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {loading && divisionClubs.length === 0 && <p className="new-career__hint">Carregando clubes…</p>}
          {!loading && divisionClubs.length === 0 && (
            <p className="new-career__hint">Nenhum clube encontrado para &quot;{clubFilter}&quot;.</p>
          )}

          <div className="club-grid">
            {divisionClubs.map((club) => (
              <CardButton
                key={club.id}
                accentColor={club.colors.primary}
                disabled={loading}
                aria-pressed={club.id === selectedClubId}
                onClick={() => setSelectedClubId(club.id)}
                className={`club-card${club.id === selectedClubId ? ' club-card--selected' : ''}`}
              >
                <div className="club-card__top">
                  {CLUB_CRESTS[club.id] && (
                    <img className="club-card__crest" src={CLUB_CRESTS[club.id]} alt="" width={40} height={40} />
                  )}
                  <div className="club-card__identity">
                    <p className="club-card__name" title={club.name}>
                      {club.name}
                    </p>
                    <span className="club-card__code">{club.shortName}</span>
                  </div>
                  <Badge>{club.tablePosition}º</Badge>
                </div>
                <ProgressBar value={club.reputation} max={100} label={`${club.reputation}`} />
              </CardButton>
            ))}
          </div>
        </div>

        <Card className="new-career__sidebar">
          <div className="new-career__setup">
            <TextField
              label="Nome do treinador"
              value={trainerName}
              onChange={(e) => setTrainerName(e.target.value)}
              placeholder="Seu nome"
            />

            <div className="new-career__field">
              <span className="field__label">Simulação tática</span>
              <div className="intensity-toggle">
                {(Object.keys(TACTICAL_INTENSITY_COPY) as TacticalIntensity[]).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={tacticalIntensity === option ? 'primary' : 'secondary'}
                    aria-pressed={tacticalIntensity === option}
                    onClick={() => {
                      setTacticalIntensity(option);
                      saveTacticalIntensityPreference(option);
                    }}
                  >
                    {TACTICAL_INTENSITY_COPY[option].label}
                  </Button>
                ))}
              </div>
              <p className="new-career__hint">{TACTICAL_INTENSITY_COPY[tacticalIntensity].hint}</p>
            </div>
          </div>

          <div className="new-career__selection">
            <span className="field__label">Clube selecionado</span>
            {selectedClub ? (
              <div className="new-career__selected-club">
                {CLUB_CRESTS[selectedClub.id] && (
                  <img
                    className="new-career__selected-crest"
                    src={CLUB_CRESTS[selectedClub.id]}
                    alt=""
                    width={64}
                    height={64}
                  />
                )}
                <div className="new-career__selected-info">
                  <p className="new-career__selected-name">{selectedClub.name}</p>
                  <p className="new-career__selected-meta">
                    Série {selectedClub.division} · {selectedClub.tablePosition}º colocado
                  </p>
                  <ProgressBar value={selectedClub.reputation} max={100} label={`Reputação · ${selectedClub.reputation}`} />
                </div>
              </div>
            ) : (
              <p className="new-career__selection-empty">Escolha um clube na lista ao lado pra continuar.</p>
            )}
          </div>

          <Button variant="primary" block disabled={!canStart || loading} onClick={handleStart}>
            {loading ? 'Preparando carreira…' : 'Iniciar carreira'}
          </Button>
          {!canStart && !loading && (
            <p className="new-career__cta-hint">
              {!selectedClub ? 'Escolha um clube para continuar.' : 'Preencha seu nome para continuar.'}
            </p>
          )}

          {error && <p className="error-banner">{error}</p>}
        </Card>
      </div>
    </Backdrop>
  );
}
