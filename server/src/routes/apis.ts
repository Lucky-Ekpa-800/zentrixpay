import { Router, Request, Response } from 'express';
import { db } from '../db';
import { apiCalls, apis } from '../db/schema';
import { eq, desc, and, gte, sql } from 'drizzle-orm';
import { parsePayerFromXPayment } from '../lib/parseXPayment';

const router = Router();

/**
 * Extract settlement info from the PAYMENT-RESPONSE header.
 * The header is base64-encoded JSON containing { success, transaction, network, payer }.
 */
function settlementFrom(res: Response): {
  success?: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
} {
  const header = res.getHeader('PAYMENT-RESPONSE');
  if (!header) return {};
  const raw = Array.isArray(header) ? header[0] : String(header);
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') {
      return {
        success: typeof parsed.success === 'boolean' ? parsed.success : undefined,
        transaction:
          typeof parsed.transaction === 'string' ? parsed.transaction : undefined,
        network: typeof parsed.network === 'string' ? parsed.network : undefined,
        payer: typeof parsed.payer === 'string' ? parsed.payer : undefined,
      };
    }
  } catch {
    // ignore malformed header
  }
  return {};
}

/**
 * Resolve the payer address for a charged call.
 * Prefer the verified settlement payer from the PAYMENT-RESPONSE header,
 * then fall back to parsing the PAYMENT-SIGNATURE payload.
 */
function resolvePayer(req: Request, res: Response): string {
  const settlement = settlementFrom(res);
  if (settlement.payer && settlement.payer !== 'unknown') {
    return settlement.payer;
  }
  const signature =
    req.get('PAYMENT-SIGNATURE') || req.get('X-PAYMENT') || undefined;
  const parsed = parsePayerFromXPayment(signature);
  return parsed || 'unknown';
}

/**
 * Proxy finish handler: records the completed call.
 * Called after the upstream provider responds.
 */
export async function finishHandler(req: Request, res: Response) {
  const apiId = req.params.id;
  const startedAt: number = (req as any).callStartedAt ?? Date.now();
  const statusCode = res.statusCode;
  const charged = Boolean((req as any).callCharged);
  const latencyMs = Date.now() - startedAt;

  let payerAddress: string | null = null;
  let settlementTx: string | null = null;

  if (charged) {
    payerAddress = resolvePayer(req, res);
    const settlement = settlementFrom(res);
    settlementTx = settlement.transaction ?? null;
  }

  try {
    await db.insert(apiCalls).values({
      apiId,
      statusCode,
      latencyMs,
      charged,
      payerAddress,
      settlementTx,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('Failed to record api call', err);
  }
}

/**
 * GET /apis/:id/stats
 * Returns aggregate stats plus recent calls including settlement_tx.
 */
router.get('/:id/stats', async (req: Request, res: Response) => {
  const apiId = req.params.id;
  const sinceParam = req.query.since as string | undefined;
  const since = sinceParam ? new Date(sinceParam) : undefined;

  try {
    const [api] = await db.select().from(apis).where(eq(apis.id, apiId)).limit(1);
    if (!api) {
      return res.status(404).json({ error: 'API not found' });
    }

    const whereClause = since
      ? and(eq(apiCalls.apiId, apiId), gte(apiCalls.createdAt, since))
      : eq(apiCalls.apiId, apiId);

    const [totals] = await db
      .select({
        totalCalls: sql<number>`count(*)::int`,
        chargedCalls: sql<number>`count(*) filter (where ${apiCalls.charged})::int`,
        uniquePayers: sql<number>`count(distinct ${apiCalls.payerAddress}) filter (where ${apiCalls.payerAddress} is not null and ${apiCalls.payerAddress} <> 'unknown')::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${apiCalls.latencyMs}), 0)::float`,
      })
      .from(apiCalls)
      .where(whereClause);

    const recentCalls = await db
      .select({
        id: apiCalls.id,
        statusCode: apiCalls.statusCode,
        latencyMs: apiCalls.latencyMs,
        charged: apiCalls.charged,
        payerAddress: apiCalls.payerAddress,
        settlementTx: apiCalls.settlementTx,
        createdAt: apiCalls.createdAt,
      })
      .from(apiCalls)
      .where(whereClause)
      .orderBy(desc(apiCalls.createdAt))
      .limit(20);

    return res.json({
      apiId,
      totalCalls: totals?.totalCalls ?? 0,
      chargedCalls: totals?.chargedCalls ?? 0,
      uniquePayers: totals?.uniquePayers ?? 0,
      avgLatencyMs: totals?.avgLatencyMs ?? 0,
      recentCalls,
    });
  } catch (err) {
    console.error('Failed to load stats', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;