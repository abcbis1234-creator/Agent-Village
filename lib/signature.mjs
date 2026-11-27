import { createHmac, timingSafeEqual } from 'node:crypto';

// Signing exports with a public default would let anyone forge a "valid"
// export. Fail closed instead: operators must set VILLAGE_EXPORT_SECRET.
function secret() {
  const value = process.env.VILLAGE_EXPORT_SECRET;
  if (!value) throw new Error('VILLAGE_EXPORT_SECRET is not configured; refusing to sign or verify exports');
  return value;
}

export function signExport(payload) {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', secret()).update(body).digest('hex');
  return { body, sig, alg: 'HS256', issuedAt: Date.now() };
}

export function verifyExport({ body, sig }) {
  let expected;
  try {
    expected = createHmac('sha256', secret()).update(body).digest('hex');
  } catch {
    return false; // unconfigured secret can never verify
  }
  const a = Buffer.from(sig ?? '', 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
