/** Sessão da nuvem: token que nossas próprias funções emitem depois de validar o login do Google. */
export interface CloudUser {
  sub: string;
  email: string;
  name: string;
}

export interface CloudSession {
  token: string;
  user: CloudUser;
}

const STORAGE_KEY = 'footmanager.cloudSession';
const listeners = new Set<(session: CloudSession | null) => void>();

export function getCloudSession(): CloudSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CloudSession;
  } catch {
    return null;
  }
}

function setCloudSession(session: CloudSession | null): void {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((listener) => listener(session));
}

export function onCloudSessionChange(listener: (session: CloudSession | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function signOutOfCloud(): void {
  setCloudSession(null);
}

/** Troca o ID token do Google (via Identity Services) pela nossa sessão assinada. */
export async function exchangeGoogleCredential(credential: string): Promise<CloudSession> {
  const res = await fetch('/api/auth-google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Falha ao autenticar com o Google.');
  const session: CloudSession = { token: data.token, user: data.user };
  setCloudSession(session);
  return session;
}

let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Não foi possível carregar o script do Google.'));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/** Renderiza o botão oficial "Entrar com o Google" dentro de `container`. */
export async function renderGoogleSignInButton(
  container: HTMLElement,
  onCredential: (credential: string) => void,
): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID não configurada no build.');

  await loadGoogleScript();
  window.google!.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
  });
  window.google!.accounts.id.renderButton(container, { theme: 'outline', size: 'large', text: 'signin_with' });
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}
