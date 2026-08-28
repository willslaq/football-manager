import type { ReactNode } from 'react';
import './AppShell.css';

export type HubScreen = 'home' | 'squad' | 'lineup' | 'table' | 'settings';

const TABS: { id: HubScreen; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'squad', label: 'Elenco' },
  { id: 'lineup', label: 'Escalação' },
  { id: 'table', label: 'Tabela' },
  { id: 'settings', label: 'Configurações' },
];

interface AppShellProps {
  active: HubScreen;
  onNavigate: (screen: HubScreen) => void;
  clubName: string;
  clubCrest?: string;
  roundLabel: string;
  children: ReactNode;
}

/**
 * Casca da interface principal da carreira: tabs de navegação em cima +
 * identidade do clube no canto superior direito, inspirada na estrutura do
 * modo carreira de jogos de futebol (mantendo nossa identidade "Matchday").
 */
export function AppShell({ active, onNavigate, clubName, clubCrest, roundLabel, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__topbar">
        <span className="app-shell__brand">
          Manager<span>FC</span>
        </span>

        <nav className="app-shell__tabs" aria-label="Navegação da carreira">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`app-shell__tab${active === tab.id ? ' app-shell__tab--active' : ''}`}
              aria-current={active === tab.id ? 'page' : undefined}
              onClick={() => onNavigate(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="app-shell__club">
          <div className="app-shell__club-info">
            <span className="app-shell__club-name">{clubName}</span>
            <span className="app-shell__club-round numeric">{roundLabel}</span>
          </div>
          {clubCrest && <img className="app-shell__crest" src={clubCrest} alt="" width={36} height={36} />}
        </div>
      </header>

      <main className="app-shell__content">
        <div className="app-shell__container">{children}</div>
      </main>
    </div>
  );
}
