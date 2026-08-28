// Lembra se o autosave (salvar a cada mudança de formação/escalação) está ativo — é uma
// preferência do usuário, fora do escopo de um save específico. Ativo por padrão.

const STORAGE_KEY = 'footmanager:autoSave';

export function loadAutoSavePreference(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function saveAutoSavePreference(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // localStorage indisponível (aba privada, etc.) — a escolha só não é lembrada da próxima vez.
  }
}
