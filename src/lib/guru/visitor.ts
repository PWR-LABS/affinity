import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const VISITOR_COOKIE = '__Host-affinity-guru';
const TTL = 31 * 86400;
export type GuruIdentity = { visitorHash: string; networkHash: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Canonicalize IPv4/mapped IPv4, and group IPv6 into /64 networks. */
export function networkAddress(raw: string) {
 const ip = raw.trim();
 if (isIP(ip) === 4) return ip;
 if (isIP(ip) !== 6 || ip.includes('%')) throw Error('Verified client address required');
 const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
 const [left, right] = normalized.split('::');
 const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
 const words = right === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
 const parts = words.map(x => parseInt(x, 16));
 if (parts.slice(0, 5).every(x => x === 0) && parts[5] === 0xffff) {
  return [parts[6] >> 8, parts[6] & 255, parts[7] >> 8, parts[7] & 255].join('.');
 }
 return parts.slice(0, 4).map(x => x.toString(16)).join(':') + '::/64';
}

export function visitorIdentity(req: Request, secret: string | undefined, header: string | undefined, now = Date.now()) {
 if (!secret || !/^(?:[0-9a-f]{2}){32,}$/i.test(secret)) throw Error('Stable server-only visitor secret required');
 // No inferred proxy trust and no client-provided X-Forwarded-For chain. The
 // deployment must verify its ingress overwrites this single-address header.
 if (header !== 'cf-connecting-ip' && header !== 'x-affinity-client-ip') throw Error('Verified ingress configuration required');
 const network = networkAddress(req.headers.get(header) ?? '');
 const mac = (value: string) => createHmac('sha256', Buffer.from(secret, 'hex')).update(value).digest('hex');
 const cookies = (req.headers.get('cookie') ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(VISITOR_COOKIE + '='));
 let token = cookies.length === 1 ? cookies[0].slice(VISITOR_COOKIE.length + 1) : '';
 const [id, expires, signature, extra] = token.split('.');
 const expiry = Number(expires);
 const valid = !extra && uuid.test(id ?? '') && /^\d{10}$/.test(expires ?? '') && expiry > now / 1000 && expiry <= now / 1000 + TTL && /^[0-9a-f]{64}$/.test(signature ?? '') && timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(mac(`cookie:${id}.${expires}`), 'hex'));
 if (!valid) { const payload = `${randomUUID()}.${Math.floor(now / 1000) + TTL}`; token = `${payload}.${mac('cookie:' + payload)}`; }
 const [visitor, expiration] = token.split('.');
 return {
  identity: { visitorHash: mac('visitor:' + visitor), networkHash: mac('network:' + network) },
  cookie: `${VISITOR_COOKIE}=${token}; Path=/; Max-Age=${Math.max(1, Number(expiration) - Math.floor(now / 1000))}; HttpOnly; Secure; SameSite=Strict`,
 };
}
