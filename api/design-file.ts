import { get, head } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { validate, type Parameters } from '../src/cad/parameters.js';
import {
  accessDecision,
  authorizeStoredFile,
  designFilePath,
  sameParameters,
} from '../src/paywall/access.js';
import { sql } from './db.js';
import { hashGrant } from './grant.js';

type FileClaim = {
  grant?: string;
  designId?: string;
  kind?: string;
  parameters?: unknown;
};

type DesignFileRow = {
  id: string;
  design_id: string;
  profile: string;
  teeth: number;
  parameters: Record<string, unknown>;
  adjustment_deadline: string;
  grant_expires_at: string | null;
  step_blob_path: string | null;
  stl_blob_path: string | null;
  step_file_parameters: unknown;
  stl_file_parameters: unknown;
};

type FileAccess =
  | { ok: true; path: string; kind: 'step' | 'stl'; designId: string; parameters: Parameters; row: DesignFileRow }
  | { ok: false; status: number; reason: 'design' | 'expired' };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

async function revisionsFor(id: string) {
  const db = sql();
  const rows = (await db('SELECT parameters FROM revisions WHERE entitlement_id = $1', [id])) as {
    parameters: Record<string, unknown>;
  }[];
  return rows.map((row) => row.parameters);
}

async function requireFile(claim: FileClaim): Promise<FileAccess> {
  if (!claim.grant || !claim.designId || (claim.kind !== 'step' && claim.kind !== 'stl'))
    return { ok: false, status: 403, reason: 'design' };
  let parameters: Parameters;
  let path: string;
  try {
    parameters = validate(claim.parameters);
    path = designFilePath(claim.designId, claim.kind);
  } catch {
    return { ok: false, status: 400, reason: 'design' };
  }
  const db = sql();
  const rows = (await db(
    `SELECT e.id, e.design_id, e.profile, e.teeth, e.parameters, e.adjustment_deadline, e.grant_expires_at,
            d.step_blob_path, d.stl_blob_path, d.step_file_parameters, d.stl_file_parameters
     FROM entitlements e
     JOIN designs d ON d.id = e.design_id
     WHERE e.grant_hash = $1`,
    [hashGrant(claim.grant)],
  )) as DesignFileRow[];
  const row = rows[0];
  if (!row) return { ok: false, status: 403, reason: 'design' };
  if (!row.grant_expires_at || new Date(row.grant_expires_at).getTime() < Date.now())
    return { ok: false, status: 403, reason: 'expired' };
  const decision = accessDecision({
    grantDesignId: row.design_id,
    requestedDesignId: claim.designId,
    profile: row.profile,
    teeth: Number(row.teeth),
    parameters: row.parameters,
    revisions: await revisionsFor(row.id),
    adjustmentDeadline: new Date(row.adjustment_deadline).getTime(),
    current: parameters as unknown as Record<string, unknown>,
    now: Date.now(),
  });
  if (
    authorizeStoredFile({
      grantDesignId: row.design_id,
      requestedDesignId: claim.designId,
      decisionAllowed: decision.allowed,
    }) !== 'allow'
  )
    return { ok: false, status: 403, reason: 'design' };
  return { ok: true, path, kind: claim.kind, designId: row.design_id, parameters, row };
}

function denied(access: Extract<FileAccess, { ok: false }>) {
  const error = access.reason === 'expired' ? 'This download link expired.' : 'This design is locked.';
  return Response.json({ error, reason: access.reason }, { status: access.status });
}

async function download(claim: FileClaim) {
  const access = await requireFile(claim);
  if (!access.ok) return denied(access);
  const storedPath = access.kind === 'step' ? access.row.step_blob_path : access.row.stl_blob_path;
  const storedParams = asRecord(
    access.kind === 'step' ? access.row.step_file_parameters : access.row.stl_file_parameters,
  );
  if (
    storedPath !== access.path ||
    !storedParams ||
    !sameParameters(storedParams, access.parameters as unknown as Record<string, unknown>)
  )
    return Response.json({ missing: true }, { status: 404 });
  const file = await get(storedPath, { access: 'private', useCache: false });
  if (!file || file.statusCode !== 200 || !file.stream)
    return Response.json({ missing: true }, { status: 404 });
  return new Response(file.stream, {
    headers: {
      'content-type': access.kind === 'step' ? 'application/step' : 'model/stl',
      'content-disposition': `attachment; filename="${access.kind === 'step' ? 'pulley.step' : 'pulley.stl'}"`,
      'cache-control': 'private, no-store',
    },
  });
}

async function commit(claim: FileClaim) {
  const access = await requireFile(claim);
  if (!access.ok) return denied(access);
  try {
    await head(access.path);
  } catch {
    return Response.json({ missing: true }, { status: 404 });
  }
  const pathColumn = access.kind === 'step' ? 'step_blob_path' : 'stl_blob_path';
  const parameterColumn = access.kind === 'step' ? 'step_file_parameters' : 'stl_file_parameters';
  await sql()(
    `UPDATE designs SET ${pathColumn} = $1, ${parameterColumn} = $2::jsonb WHERE id = $3`,
    [access.path, JSON.stringify(access.parameters), access.designId],
  );
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL)
    return Response.json({ error: 'Payments are not configured.' }, { status: 503 });
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID)
    return Response.json({ error: 'File storage is not configured.' }, { status: 503 });
  let body: { type?: string; action?: string } & FileClaim;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (body.type === 'blob.generate-client-token' || body.type === 'blob.upload-completed') {
    try {
      const result = await handleUpload({
        request,
        body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const claim = JSON.parse(clientPayload || '{}') as FileClaim;
          const access = await requireFile(claim);
          if (!access.ok || pathname !== access.path) throw Error('locked');
          return {
            addRandomSuffix: false,
            allowOverwrite: true,
            maximumSizeInBytes: 32 * 1024 * 1024,
            validUntil: Date.now() + 2 * 60 * 1000,
            allowedContentTypes: [
              'application/step',
              'model/step',
              'model/stl',
              'application/sla',
              'application/octet-stream',
            ],
          };
        },
      });
      return Response.json(result);
    } catch {
      return Response.json({ error: 'This design is locked.' }, { status: 403 });
    }
  }
  if (body.action === 'download') return download(body);
  if (body.action === 'commit') return commit(body);
  return Response.json({ error: 'Invalid request.' }, { status: 400 });
}
