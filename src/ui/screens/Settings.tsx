import { useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import type { TacticalIntensity } from '../../engine/types';
import { TACTICAL_INTENSITY_COPY } from '../utils';
import { Button, Card } from '../components';
import { saveTacticalIntensityPreference } from '../tacticalIntensityPreference';
import { applyThemePreference, loadThemePreference, saveThemePreference, type ThemePreference } from '../themePreference';
import './Settings.css';

const THEME_COPY: Record<ThemePreference, string> = {
  system: 'Sistema',
  dark: 'Escuro',
  light: 'Claro',
};

function ThemeControl() {
  const [theme, setTheme] = useState<ThemePreference>(loadThemePreference);

  function choose(option: ThemePreference) {
    setTheme(option);
    saveThemePreference(option);
    applyThemePreference(option);
  }

  return (
    <Card className="settings-card">
      <span className="field__label">Tema</span>
      <div className="intensity-toggle">
        {(Object.keys(THEME_COPY) as ThemePreference[]).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={theme === option ? 'primary' : 'secondary'}
            aria-pressed={theme === option}
            onClick={() => choose(option)}
          >
            {THEME_COPY[option]}
          </Button>
        ))}
      </div>
      <p className="settings-card__hint">
        &quot;Sistema&quot; segue o tema claro/escuro configurado no seu dispositivo.
      </p>
    </Card>
  );
}

function TacticalIntensityControl({ current }: { current: TacticalIntensity }) {
  const setTacticalIntensity = useCareerStore((s) => s.setTacticalIntensity);

  return (
    <Card className="settings-card">
      <span className="field__label">Simulação tática</span>
      <div className="intensity-toggle">
        {(Object.keys(TACTICAL_INTENSITY_COPY) as TacticalIntensity[]).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={current === option ? 'primary' : 'secondary'}
            aria-pressed={current === option}
            onClick={() => {
              setTacticalIntensity(option);
              saveTacticalIntensityPreference(option);
            }}
          >
            {TACTICAL_INTENSITY_COPY[option].label}
          </Button>
        ))}
      </div>
      <p className="settings-card__hint">{TACTICAL_INTENSITY_COPY[current].hint}</p>
    </Card>
  );
}

function AutoSaveControl() {
  const autoSaveEnabled = useCareerStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useCareerStore((s) => s.setAutoSaveEnabled);

  return (
    <Card className="settings-card">
      <span className="field__label">Salvamento automático</span>
      <div className="intensity-toggle">
        <Button
          type="button"
          size="sm"
          variant={autoSaveEnabled ? 'primary' : 'secondary'}
          aria-pressed={autoSaveEnabled}
          onClick={() => setAutoSaveEnabled(true)}
        >
          Ativado
        </Button>
        <Button
          type="button"
          size="sm"
          variant={!autoSaveEnabled ? 'primary' : 'secondary'}
          aria-pressed={!autoSaveEnabled}
          onClick={() => setAutoSaveEnabled(false)}
        >
          Desativado
        </Button>
      </div>
      <p className="settings-card__hint">
        {autoSaveEnabled
          ? 'Toda mudança de formação ou escalação é salva automaticamente na carreira atual.'
          : 'Mudanças de formação/escalação não são salvas sozinhas — use "Salvar formação" na tela de Escalação, ou "Salvar" na Início.'}
      </p>
    </Card>
  );
}

export function Settings() {
  const career = useCareerStore((s) => s.career);

  return (
    <div className="settings">
      <ThemeControl />
      {career && <TacticalIntensityControl current={career.settings.tacticalIntensity} />}
      <AutoSaveControl />
    </div>
  );
}
