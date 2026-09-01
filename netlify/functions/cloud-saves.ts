import { ObjectId } from 'mongodb';
import { getDb } from './lib/mongo';
import { requireUser, AuthError } from './lib/auth';

interface CloudSaveDoc {
  _id: ObjectId;
  userSub: string;
  slotName: string;
  state: unknown;
  lineup: unknown;
  tactics: unknown;
  createdAt: number;
  updatedAt: number;
}

/**
 * CRUD de saves na nuvem, tudo escopado ao usuário autenticado (userSub = Google sub).
 * GET (sem id)  -> lista de resumos leves (sem o CareerState completo)
 * GET ?id=      -> save completo (state/lineup/tactics)
 * POST          -> cria (sem id) ou atualiza (com id) um save
 * DELETE ?id=   -> remove um save
 */
export default async (req: Request): Promise<Response> => {
  let user;
  try {
    user = requireUser(req);
  } catch (err) {
    const status = err instanceof AuthError ? 401 : 500;
    return Response.json({ error: err instanceof Error ? err.message : 'Não autenticado.' }, { status });
  }

  const url = new URL(req.url);
  const rawId = url.searchParams.get('id');

  try {
    const db = await getDb();
    const saves = db.collection<CloudSaveDoc>('saves');

    if (req.method === 'GET') {
      if (rawId) {
        const doc = await saves.findOne({ _id: new ObjectId(rawId), userSub: user.sub });
        if (!doc) return Response.json({ error: 'Save não encontrado.' }, { status: 404 });
        return Response.json({
          id: doc._id.toString(),
          slotName: doc.slotName,
          state: doc.state,
          lineup: doc.lineup,
          tactics: doc.tactics,
          updatedAt: doc.updatedAt,
        });
      }
      const list = await saves
        .find({ userSub: user.sub }, { projection: { state: 0, lineup: 0, tactics: 0 } })
        .sort({ updatedAt: -1 })
        .toArray();
      return Response.json(
        list.map((doc) => ({
          id: doc._id.toString(),
          slotName: doc.slotName,
          updatedAt: doc.updatedAt,
          createdAt: doc.createdAt,
        })),
      );
    }

    if (req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as {
        id?: unknown;
        slotName?: unknown;
        state?: unknown;
        lineup?: unknown;
        tactics?: unknown;
      } | null;
      const slotName = typeof body?.slotName === 'string' ? body.slotName.trim() : '';
      if (!slotName || body == null || body.state == null) {
        return Response.json({ error: 'slotName e state são obrigatórios.' }, { status: 400 });
      }
      const now = Date.now();
      const existingId = typeof body.id === 'string' ? body.id : undefined;

      if (existingId) {
        const result = await saves.findOneAndUpdate(
          { _id: new ObjectId(existingId), userSub: user.sub },
          {
            $set: {
              slotName,
              state: body.state,
              lineup: body.lineup ?? null,
              tactics: body.tactics ?? null,
              updatedAt: now,
            },
          },
          { returnDocument: 'after' },
        );
        if (!result) return Response.json({ error: 'Save não encontrado.' }, { status: 404 });
        return Response.json({ id: result._id.toString() });
      }

      const insertResult = await saves.insertOne({
        _id: new ObjectId(),
        userSub: user.sub,
        slotName,
        state: body.state,
        lineup: body.lineup ?? null,
        tactics: body.tactics ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return Response.json({ id: insertResult.insertedId.toString() });
    }

    if (req.method === 'DELETE') {
      if (!rawId) return Response.json({ error: 'id é obrigatório.' }, { status: 400 });
      await saves.deleteOne({ _id: new ObjectId(rawId), userSub: user.sub });
      return new Response(null, { status: 204 });
    }

    return new Response('Method Not Allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Erro inesperado.' }, { status: 500 });
  }
};
