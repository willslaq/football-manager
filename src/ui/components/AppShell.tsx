import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import './AppShell.css';

export type HubScreen = 'home' | 'squad' | 'lineup' | 'table' | 'settings';

const TABS: { id: HubScreen; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'squad', label: 'Elenco' },
  { id: 'lineup', label: 'Escalação' },
  { id: 'table', label: 'Tabela' },
  { id: 'settings', label: 'Configurações' },
];

function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 7.5 8 2l6 5.5M4 6.6v6.9h3V10h2v3.5h3V6.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconSquad() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5 2 2 4.2l1.4 2.4L5 5.6V14h6V5.6l1.6 1L14 4.2 11 2c-.6.9-1.7 1.5-3 1.5S5.6 2.9 5 2z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconLineup() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="3" r="1.3" fill="currentColor" />
      <circle cx="3.4" cy="8.2" r="1.3" fill="currentColor" />
      <circle cx="12.6" cy="8.2" r="1.3" fill="currentColor" />
      <circle cx="8" cy="13" r="1.3" fill="currentColor" />
    </svg>
  );
}

function IconTable() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M2 7.2h12M6.4 3v10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4h6M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10.5" cy="4" r="1.4" fill="currentColor" />
      <circle cx="5.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="10.5" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

const TAB_ICONS: Record<HubScreen, () => ReactNode> = {
  home: IconHome,
  squad: IconSquad,
  lineup: IconLineup,
  table: IconTable,
  settings: IconSettings,
};

function IconMenuToggle() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleMobileNavigate = (screen: HubScreen) => {
    onNavigate(screen);
    setMobileMenuOpen(false);
  };

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

      <div
        className={`app-shell__mobile-backdrop${mobileMenuOpen ? ' app-shell__mobile-backdrop--visible' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      <nav className={`app-shell__mobile-menu${mobileMenuOpen ? ' app-shell__mobile-menu--open' : ''}`} aria-label="Navegação da carreira (mobile)">
        {TABS.map((tab, index) => {
          const Icon = TAB_ICONS[tab.id];
          return (
            <div
              key={tab.id}
              className="app-shell__mobile-option-wrap"
              style={{ '--i': index + 1, transitionDelay: mobileMenuOpen ? `${index * 40}ms` : '0ms' } as CSSProperties}
            >
              <span className="app-shell__mobile-option-label">{tab.label}</span>
              <button
                type="button"
                className={`app-shell__mobile-option${active === tab.id ? ' app-shell__mobile-option--active' : ''}`}
                aria-current={active === tab.id ? 'page' : undefined}
                tabIndex={mobileMenuOpen ? 0 : -1}
                onClick={() => handleMobileNavigate(tab.id)}
              >
                <Icon />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className={`app-shell__mobile-fab${mobileMenuOpen ? ' app-shell__mobile-fab--open' : ''}`}
          aria-label={mobileMenuOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <IconMenuToggle />
        </button>
      </nav>
    </div>
  );
}
