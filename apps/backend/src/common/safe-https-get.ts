import * as https from 'https';
import { lookup as dnsLookup } from 'dns';
import { BadRequestException } from '@nestjs/common';
import { assertSafePublicUrl, isPrivateIp } from './assert-safe-public-url';

export type SafeGetOptions = {
  /** Whole request, including DNS and the body. */
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  /** Content types we are willing to read. */
  allowedTypes?: RegExp;
};

/**
 * DNS lookup used for the actual connection. The address is checked HERE, at connect time, not before: a hostname that
 * answers with a public address to an early check and a private one to the connection (DNS rebinding) is refused, and
 * so is any hostname that has even one private address among its answers.
 */
export function guardedLookup(
  hostname: string,
  options: unknown,
  cb: (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
): void {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err, '');
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('blocked address'), '');
    if ((options as { all?: boolean } | null)?.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

const FAIL = 'Could not read that URL. Check that it is a public https address that answers within a few seconds.';

export type SafeRequestOptions = SafeGetOptions & { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string };

/**
 * One request to a public https URL that a user supplied, with the protections a server needs when it fetches addresses
 * its users type in: https only, default port only, no credentials in the URL, no IP literals, the connection address is
 * checked at connect time (so DNS rebinding can not swap in a private address), redirects are never followed, and the
 * response is size and time limited. Failures are reported generically so the endpoint can not be used to map the
 * network. It returns the status and does not judge it: callers decide what counts as success.
 */
export async function safeHttpsRequest(rawUrl: string, opts: SafeRequestOptions = {}): Promise<{ status: number; contentType: string; body: string }> {
  const { timeoutMs = 8000, maxBytes = 2_000_000, accept = 'application/json, text/csv, text/plain', method = 'GET', headers = {}, body } = opts;
  const u = assertSafePublicUrl(rawUrl, 'url');
  if (u.port && u.port !== '443') throw new BadRequestException('url must use the standard https port');

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: 443,
        path: `${u.pathname}${u.search}`,
        headers: { accept, 'user-agent': 'Loofta/1.0', 'accept-encoding': 'identity', ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}), ...headers },
        lookup: guardedLookup as never,
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '');
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return finish(() => reject(new BadRequestException('That response is too large.')));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            return finish(() => reject(new BadRequestException('That response is too large.')));
          }
          chunks.push(c);
        });
        res.on('end', () => finish(() => resolve({ status, contentType, body: Buffer.concat(chunks).toString('utf8') })));
        res.on('error', () => finish(() => reject(new BadRequestException(FAIL))));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(() => reject(new BadRequestException(FAIL)));
    }, timeoutMs);
    req.on('error', () => finish(() => reject(new BadRequestException(FAIL))));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** GET a public https URL for a list we parse ourselves: only a 200 with a JSON, CSV or plain text body counts. */
export async function safeHttpsGet(rawUrl: string, opts: SafeGetOptions = {}): Promise<{ contentType: string; body: string }> {
  const { allowedTypes = /^(application\/json|text\/csv|text\/plain|application\/csv)\b/i } = opts;
  const res = await safeHttpsRequest(rawUrl, opts);
  if (res.status !== 200 || !allowedTypes.test(res.contentType)) throw new BadRequestException(FAIL);
  return { contentType: res.contentType, body: res.body };
}
