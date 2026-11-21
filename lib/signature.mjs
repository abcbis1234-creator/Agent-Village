import { createHmac, timingSafeEqual } from 'node:crypto';

function secret() { return process.env.VILLAGE_EXPORT_SECRET ?? 'dev-insecure'; }

export function signExport(payload) {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', secret()).update(body).digest('hex');
  return { body, sig, alg: 'HS256', issuedAt: Date.now() };
}

export function verifyExport({ body, sig }) {
  const expected = createHmac('sha256', secret()).update(body).digest('hex');
  const a = Buffer.from(sig ?? '', 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}