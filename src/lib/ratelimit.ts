/**
 * Request admission for `/api/chat`.
 *
 * This route is the one place the app spends money: every call is forwarded to
 * the model provider with the server's key, and the key is the operator's, not
 * the caller's. That makes an unprotected route an open proxy: anyone who
 * finds the URL can burn the account's quota from a script, and the bill lands
 * on whoever owns the key. There is no account and no sign-in, so there is
 * nothing to hang a per-user limit on, which is exactly why the limits below
 * are per address and deliberately generous rather than strict.
 *
 * Two checks, in order:
 *
 *   1. **Same-origin.** A browser sends `Origin` on a cross-origin POST and on
 *      every POST from a page on another site. A request whose origin is a
 *      different host is refused. This is what stops a third-party page from
 *      embedding the app's API as a free backend, and it is the check that
 *      matters in practice, since the common abuse is a script on someone
 *      else's site rather than a determined attacker with curl.
 *   2. **A token bucket per address.** Enough for a class's worth of students
 *      behind one school NAT, small enough that a runaway loop is cut off.
 *
 * The bucket lives in module memory. That is honest about what it is: on a
 * serverless deployment each instance has its own bucket, so the effective
 * limit is per instance, and a cold start resets it. It stops the accidental
 * and the casual case, which is what can be stopped without a shared store.
 * Adding Redis for a real budget is a deployment decision, not something to
 * pretend this file already does.
 */

/** Requests allowed in a burst. */
const CAPACITY = 30;

/** Tokens restored per second. One request every four seconds, sustained. */
const REFILL_PER_SECOND = 0.25;

/** Hard ceiling on tracked addresses, so the map cannot grow without bound. */
const MAX_TRACKED = 5000;

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/** The client address, as the platform reports it. */
export function clientAddress(request: Request): string {
  // Vercel sets `x-forwarded-for` with the client first and its own proxies
  // after. The first entry is the caller; the rest are hops we do not trust.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * True when the request came from this app's own pages.
 *
 * A missing `Origin` is allowed: a same-origin `fetch` may omit it on some
 * browsers, and non-browser clients (the test harness, curl during
 * development) send none. Refusing those would break the app to stop an attack
 * that the rate limit already covers. A present, mismatched origin is refused.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Takes one token for `address`, or returns the seconds to wait.
 *
 * `now` is injectable so the behaviour can be tested without waiting.
 */
export function takeToken(
  address: string,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfter: number } {
  let bucket = buckets.get(address);
  if (!bucket) {
    // Evict before inserting, so a flood of distinct addresses cannot grow the
    // map past the cap. The oldest quarter goes, which is cheap and keeps the
    // active addresses.
    if (buckets.size >= MAX_TRACKED) {
      const drop = Math.ceil(MAX_TRACKED / 4);
      let i = 0;
      for (const key of buckets.keys()) {
        buckets.delete(key);
        if (++i >= drop) break;
      }
    }
    bucket = { tokens: CAPACITY, updatedAt: now };
    buckets.set(address, bucket);
  }

  const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsed * REFILL_PER_SECOND);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    const retryAfter = Math.ceil((1 - bucket.tokens) / REFILL_PER_SECOND);
    return { ok: false, retryAfter };
  }

  bucket.tokens -= 1;
  return { ok: true };
}

/** Clears every bucket. For tests only. */
export function resetLimits(): void {
  buckets.clear();
}

export const LIMITS = { CAPACITY, REFILL_PER_SECOND };
