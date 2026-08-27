import { useEffect, useState } from 'react';
import type { TacticalIntensity } from '../../engine/types';
import { useCareerStore } from '../../store/careerStore';
import { Backdrop, Badge, Button, Card, CardButton, ProgressBar, TextField } from '../components';
import { CLUB_CRESTS } from '../clubCrests';
import { TACTICAL_INTENSITY_COPY } from '../utils';
import './NewCareer.css';

export function NewCareer({ onBack }: { onBack: () => void }) {
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000_000));
  const [trainerName, setTrainerName] = useState('');
  const [tacticalIntensity, setTacticalIntensity] = useState<TacticalIntensity>('subtle');
  const clubs = useCareerStore((s) => s.clubs);
  const loading = useCareerStore((s) => s.loading);
  const error = useCareerStore((s) => s.error);
  const listClubs = useCareerStore((s) => s.listClubs);
  const startCareer = useCareerStore((s) => s.startCareer);

  useEffect(() => {
    listClubs(seed);
  }, [seed, listClubs]);

  const canPick = trainerName.trim().length > 0;

  return (
    <Backdrop>
      <Button variant="ghost" size="sm" className="new-career__back" onClick={onBack}>
        ← Início
      </Button>

      <header className="new-career__header">
        <span className="eyebrow">Nova carreira</span>
        <h1 className="new-career__title">Escolha seu clube</h1>
        <p className="new-career__meta">Campeonato Brasileiro Série A 2026 · carreira nº {seed}</p>
      </header>

      <Card className="new-career__form-card">
        <TextField
          label="Nome do treinador"
          value={trainerName}
          onChange={(e) => setTrainerName(e.target.value)}
          placeholder="Seu nome"
        />
      </Card>

      <Card className="new-career__form-card">
        <span className="field__label">Simulação tática</span>
        <div className="intensity-toggle">
          {(Object.keys(TACTICAL_INTENSITY_COPY) as TacticalIntensity[]).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={tacticalIntensity === option ? 'primary' : 'secondary'}
              aria-pressed={tacticalIntensity === option}
              onClick={() => setTacticalIntensity(option)}
            >
              {TACTICAL_INTENSITY_COPY[option].label}
            </Button>
          ))}
        </div>
        <p className="new-career__hint">{TACTICAL_INTENSITY_COPY[tacticalIntensity].hint}</p>
      </Card>

      <section>
        <p className="new-career__section-title">
          <span>20 clubes da Série A</span>
          {!canPick && <span className="new-career__hint">Preencha seu nome para escolher</span>}
        </p>

        {loading && clubs.length === 0 && <p className="new-career__hint">Carregando clubes…</p>}

        <div className="club-grid">
          {clubs.map((club) => (
            <CardButton
              key={club.id}
              accentColor={club.colors.primary}
              disabled={!canPick || loading}
              onClick={() => startCareer(seed, trainerName.trim(), club.id, tacticalIntensity)}
              className="club-card"
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
      </section>

      {error && <p className="error-banner">{error}</p>}
    </Backdrop>
  );
}
