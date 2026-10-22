import { get, head } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { validate, type Parameters } from '../src/cad/parameters.js';
import { authorizeStoredFile, designFilePath, sameParameters } from '../src/paywall/access.js';
import { sql } from './db.js';
import {
  accountAccess,
  designRecord,
  ownedDesign,
  uploadTokenMatches,
  type StoredDesignRow,
} from './purchase.js';
import { currentAccount } from './session.js';

type FileClaim = {
  grant?: string;
  designId?: string;
  kind?: string;
  parameters?: unknown;
};

type FileAccess =
  | {
      ok: true;
      path: string;
      kind: 'step' | 'stl';
      designId: string;
      parameters: Parameters;
      row: StoredDesignRow;
    }
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

async function requireFile(request: Request, claim: FileClaim): Promise<FileAccess> {
  if (claim.kind !== 'step' && claim.kind !== 'stl') return { ok: false, status: 403, reason: 'design' };
  const identity = await currentAccount(request);
  let row: StoredDesignRow | null = null;
  if (claim.designId) {
    try {
      designFilePath(claim.designId, claim.kind);
    } catch {
      return { ok: false, status: 400, reason: 'design' };
    }
    row = await designRecord(claim.designId);
    if (row && identity && !row.google_sub) {
      const owned = await ownedDesign(identity.sub, row.id);
      if (owned) row = { ...row, google_sub: identity.sub };
    }
  } else if (identity) {
    let parameters: Parameters;
    try {
      parameters = validate(claim.parameters);
    } catch {
      return { ok: false, status: 400, reason: 'design' };
    }
    const db = sql();
    const rows = (await db(
      `SELECT id, google_sub, profile, teeth, parameters, upload_grant_hash,
              step_blob_path, stl_blob_path, step_file_parameters, stl_file_parameters
       FROM designs
       WHERE google_sub = $1 AND parameters = $2::jsonb
       ORDER BY created_at DESC
       LIMIT 1`,
      [identity.sub, JSON.stringify(parameters)],
    )) as StoredDesignRow[];
    row = rows[0] ?? null;
  }
  if (!row?.google_sub) return { ok: false, status: 404, reason: 'design' };
  const sessionOwns = identity?.sub === row.google_sub;
  const tokenOwns = uploadTokenMatches(row, claim.grant);
  if (!sessionOwns && !tokenOwns) return { ok: false, status: 403, reason: 'design' };
  const access = await accountAccess(row.google_sub);
  if (
    authorizeStoredFile({
      ownedDesignId: row.id,
      requestedDesignId: row.id,
      accessOpen: Boolean(access),
    }) !== 'allow'
  )
    return { ok: false, status: 403, reason: 'expired' };
  let parameters: Parameters;
  try {
    parameters = validate(claim.parameters ?? row.parameters);
  } catch {
    return { ok: false, status: 400, reason: 'design' };
  }
  const stored = asRecord(row.parameters);
  if (!stored || !sameParameters(stored, parameters as unknown as Record<string, unknown>))
    return { ok: false, status: 403, reason: 'design' };
  return {
    ok: true,
    path: designFilePath(row.id, claim.kind),
    kind: claim.kind,
    designId: row.id,
    parameters,
    row,
  };
}

function denied(access: Extract<FileAccess, { ok: false }>) {
  if (access.status === 404) return Response.json({ missing: true }, { status: 404 });
  const error =
    access.reason === 'expired'
      ? 'Your 30-day access has ended. A new $10 payment is required to download.'
      : 'This design is locked.';
  return Response.json({ error, reason: access.reason }, { status: access.status });
}

async function download(request: Request, claim: FileClaim) {
  const access = await requireFile(request, claim);
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

async function commit(request: Request, claim: FileClaim) {
  const access = await requireFile(request, claim);
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
          const access = await requireFile(request, claim);
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
  if (body.action === 'download') return download(request, body);
  if (body.action === 'commit') return commit(request, body);
  return Response.json({ error: 'Invalid request.' }, { status: 400 });
}
