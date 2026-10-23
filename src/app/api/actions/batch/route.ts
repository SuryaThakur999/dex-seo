import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { BatchRequestError, decideActionBatch, parseBatchRequest } from '@/lib/action-batch';
import { ActionDecisionError } from '@/lib/action-decision';

async function readBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new BatchRequestError('Missing JSON body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new BatchRequestError('Batch body exceeds 64 KiB');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof BatchRequestError) throw error;
    throw new BatchRequestError('Invalid JSON body');
  } finally {
    reader.releaseLock();
  }
}

export async function POST(req: Request): Promise<Response> {
  const { userId } = auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return Response.json({ error: 'Customer not found' }, { status: 404 });
  try {
    const request = parseBatchRequest(await readBody(req));
    return Response.json(await decideActionBatch({ customerId: customer.id, actorClerkUserId: userId, request }));
  } catch (error) {
    if (error instanceof BatchRequestError || error instanceof ActionDecisionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
