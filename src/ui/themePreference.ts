// Lembra a escolha de tema do usuário (claro/escuro/sistema). "system" segue
// prefers-color-scheme (comportamento padrão do app); claro/escuro força a variante
// via [data-theme] em theme.css, independente da preferência do SO.

export type ThemePreference = 'system' | 'dark' | 'light';

const STORAGE_KEY = 'footmanager:theme';

export function loadThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(value: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // localStorage indisponível (aba privada, etc.) — a escolha só não é lembrada da próxima vez.
  }
}

export function applyThemePreference(value: ThemePreference): void {
  if (value === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = value;
  }
}
