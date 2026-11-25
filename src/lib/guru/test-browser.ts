import { createHash, timingSafeEqual } from 'node:crypto';
import type { GuruIdentity } from './visitor';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const oneWeekSeconds = 7 * 24 * 60 * 60;

export function testBrowserFingerprint(identity: GuruIdentity) {
 return hash(`guru-test-browser:${identity.visitorHash}:${identity.networkHash}`);
}

/** The fingerprint is an enrollment identifier, not a credential a client can submit. */
export function testBrowserIdentity(identity: GuruIdentity, grant: string | undefined, now = Date.now()) {
 if (!grant) return null;
 const [fingerprint, expiry, extra] = grant.split('.');
 if (extra !== undefined || !/^[a-f0-9]{64}$/.test(fingerprint) || !/^\d{10}$/.test(expiry ?? '')) return null;
 const remaining = Number(expiry) - Math.floor(now / 1000);
 if (remaining <= 0 || remaining > oneWeekSeconds) return null;
 const actual = testBrowserFingerprint(identity);
 if (!timingSafeEqual(Buffer.from(fingerprint, 'hex'), Buffer.from(actual, 'hex'))) return null;
 return {
  visitorHash: hash('guru-test-visitor:' + actual),
  networkHash: hash('guru-test-network:' + actual),
 };
}
