import { verifyGoogleCredential, signSession } from './lib/auth';

/** Troca um ID token do Google (obtido no front via Google Identity Services) pela nossa sessão. */
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const body = (await req.json().catch(() => null)) as { credential?: unknown } | null;
    const credential = body?.credential;
    if (typeof credential !== 'string') {
      return Response.json({ error: 'credential ausente.' }, { status: 400 });
    }
    const user = await verifyGoogleCredential(credential);
    const token = signSession(user);
    return Response.json({ token, user });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Erro ao autenticar.' }, { status: 401 });
  }
};
