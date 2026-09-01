import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

const SESSION_TTL = '30d';

function getGoogleClientId(): string {
  const id = process.env.VITE_GOOGLE_CLIENT_ID;
  if (!id) throw new Error('VITE_GOOGLE_CLIENT_ID não configurada.');
  return id;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET não configurada.');
  return secret;
}

export interface SessionUser {
  sub: string;
  email: string;
  name: string;
}

export class AuthError extends Error {}

/** Verifica a assinatura/audience do ID token do Google e devolve a identidade do usuário. */
export async function verifyGoogleCredential(idToken: string): Promise<SessionUser> {
  const client = new OAuth2Client(getGoogleClientId());
  const ticket = await client.verifyIdToken({ idToken, audience: getGoogleClientId() });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw new AuthError('Token do Google inválido.');
  return { sub: payload.sub, email: payload.email, name: payload.name ?? payload.email };
}

/** Emite nossa própria sessão assinada — evita reverificar o token do Google (que expira em ~1h) a cada request. */
export function signSession(user: SessionUser): string {
  return jwt.sign(user, getJwtSecret(), { expiresIn: SESSION_TTL });
}

/** Extrai e valida o usuário autenticado a partir do header Authorization: Bearer <token>. */
export function requireUser(req: Request): SessionUser {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new AuthError('Não autenticado.');
  try {
    return jwt.verify(token, getJwtSecret()) as SessionUser;
  } catch {
    throw new AuthError('Sessão inválida ou expirada.');
  }
}
