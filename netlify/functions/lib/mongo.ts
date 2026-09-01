import { MongoClient, type Db } from 'mongodb';

// Cached across warm serverless invocations so we don't reopen a TCP
// connection to Atlas on every request — Netlify reuses the process
// between calls when it can.
let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI não configurada.');
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(process.env.MONGODB_DB || 'footmanager');
}
