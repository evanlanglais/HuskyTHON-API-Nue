const axios = require('axios');
const crypto = require('crypto');
const { asyncRedis } = require('./redisClient');

// Redis keys (shared across all instances)
const COOKIE_KEY = 'ht-dd:cookie';
const LOCK_KEY = 'ht-dd:cookie:lock';

// TTL strategy. The DonorDrive cookies carry their own Max-Age/Expires (AWSALB ~7d,
// PORTALDATA ~30d), so we derive the Redis TTL from them, clamped for safety.
const MIN_TTL_MS = 5 * 60 * 1000;            // floor
const MAX_TTL_MS = 24 * 60 * 60 * 1000;      // cap so a stale cookie can't live forever
const DEFAULT_TTL_MS = 60 * 60 * 1000;       // used when nothing is parseable
const TTL_SAFETY_MARGIN = 0.9;               // use 90% of the real remaining lifetime

const L1_TTL_MS = 5 * 60 * 1000;             // in-process cache lifetime (short so invalidations propagate)
const PRIME_INTERVAL_MS = 60 * 60 * 1000;    // background refresh cadence
const PRIME_JITTER_MS = 30 * 1000;           // startup stagger across instances

const LOCK_PX_MS = 15 * 1000;                // distributed lock TTL
const POLL_TIMEOUT_MS = 4 * 1000;            // how long a lock loser waits for the winner
const POLL_INTERVAL_MS = 100;
const REDIS_OP_TIMEOUT_MS = 1000;            // cap per Redis op so a disconnected client (offline queue) can't hang us

// Compare-and-delete: only release the lock if we still own it.
const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

// L1 (in-process) cache + per-process single-flight.
let l1Cookie = null;
let l1ExpiresAt = 0;
let inFlight = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cap each Redis op: the v3 client queues commands while disconnected instead of failing,
// so without a timeout a Redis outage would hang request handlers. On timeout we reject and
// callers fall back to a direct fetch.
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    sleep(REDIS_OP_TIMEOUT_MS).then(() => {
      throw new Error(`redis op timed out: ${label}`);
    }),
  ]);
}

const redis = {
  get:  (k) => withTimeout(asyncRedis.get(k), 'get'),
  ttl:  (k) => withTimeout(asyncRedis.ttl(k), 'ttl'),
  del:  (k) => withTimeout(asyncRedis.del(k), 'del'),
  set:  (...args) => withTimeout(asyncRedis.set(...args), 'set'),
  eval: (...args) => withTimeout(asyncRedis.eval(...args), 'eval'),
};

function setL1(cookie, ttlMs) {
  l1Cookie = cookie;
  l1ExpiresAt = Date.now() + Math.min(L1_TTL_MS, ttlMs);
}

function clearL1() {
  l1Cookie = null;
  l1ExpiresAt = 0;
}

// Lifecycle logging. On by default; set DD_COOKIE_LOG=off to silence (errors always log).
const LOG_ENABLED = process.env.DD_COOKIE_LOG !== 'off';
function log(...args) {
  if (LOG_ENABLED) console.log('[ddCookie]', ...args);
}

// Identify a cookie without leaking its value: cookie names + a short content hash.
// Same fingerprint across calls = the same cookie is being reused; a changed hash = rotation.
function fingerprint(cookie) {
  if (!cookie) return '<none>';
  const names = cookie.split('; ').map((p) => p.split('=')[0]).join(',');
  const hash = crypto.createHash('sha256').update(cookie).digest('hex').slice(0, 8);
  return `${names}#${hash}`;
}

function secsLeft() {
  return Math.max(0, Math.round((l1ExpiresAt - Date.now()) / 1000));
}

/**
 * Turn a `set-cookie` response array into a request `cookie` header string.
 * Keeps only the `name=value` of each cookie, dropping attributes (Path, Expires, ...).
 */
function parseSetCookie(setCookieArr) {
  if (!Array.isArray(setCookieArr) || setCookieArr.length === 0) return null;
  const pairs = setCookieArr
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean);
  return pairs.length ? pairs.join('; ') : null;
}

/**
 * Derive an effective TTL (ms) from the cookies' own Max-Age / Expires.
 * Returns the minimum remaining lifetime across cookies, with a safety margin,
 * clamped to [MIN_TTL_MS, MAX_TTL_MS]. Falls back to DEFAULT_TTL_MS.
 */
function deriveTtlMs(setCookieArr) {
  if (!Array.isArray(setCookieArr) || setCookieArr.length === 0) return DEFAULT_TTL_MS;

  const now = Date.now();
  let min = Infinity;

  for (const raw of setCookieArr) {
    const attrs = raw.split(';').slice(1).map((a) => a.trim());
    let remaining = null;

    const maxAgeAttr = attrs.find((a) => /^max-age=/i.test(a));
    if (maxAgeAttr) {
      const secs = parseInt(maxAgeAttr.split('=')[1], 10);
      if (!Number.isNaN(secs)) remaining = secs * 1000;
    }

    if (remaining === null) {
      const expiresAttr = attrs.find((a) => /^expires=/i.test(a));
      if (expiresAttr) {
        const ts = Date.parse(expiresAttr.slice(expiresAttr.indexOf('=') + 1));
        if (!Number.isNaN(ts)) remaining = ts - now;
      }
    }

    if (remaining !== null && remaining > 0) min = Math.min(min, remaining);
  }

  if (min === Infinity) return DEFAULT_TTL_MS;
  return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.floor(min * TTL_SAFETY_MARGIN)));
}

/**
 * Hit DonorDrive's priming page to mint a fresh cookie.
 * Returns { cookie, ttlMs }. Throws if no set-cookie is returned.
 */
async function fetchFreshCookie() {
  const url = `${process.env.DONOR_DRIVE_URL}/index.cfm?fuseaction=donordrive.participantList&eventID=${process.env.HUSKYTHON_EVENT_ID}`;
  const resp = await axios.get(url, { maxRedirects: 0, validateStatus: (s) => s < 400 });
  const setCookie = resp.headers['set-cookie'];
  const cookie = parseSetCookie(setCookie);
  if (!cookie) throw new Error('DonorDrive returned no set-cookie');
  const ttlMs = deriveTtlMs(setCookie);
  log(`minted fresh cookie from DonorDrive ${fingerprint(cookie)} derivedTtl=${Math.round(ttlMs / 1000)}s`);
  return { cookie, ttlMs };
}

async function storeCookie(cookie, ttlMs) {
  const ttlSec = Math.floor(ttlMs / 1000);
  try {
    await redis.set(COOKIE_KEY, cookie, 'EX', ttlSec);
    log(`stashed cookie in redis key=${COOKIE_KEY} ttl=${ttlSec}s ${fingerprint(cookie)}`);
  } catch (err) {
    console.error('[ddCookie] failed to write cookie to redis:', err.message);
  }
  setL1(cookie, ttlMs);
}

/**
 * Acquire a fresh cookie, coordinating across the fleet via a Redis lock so only
 * one instance actually contacts DonorDrive.
 */
async function refreshWithLock() {
  const lockId = crypto.randomUUID();
  let gotLock = null;
  try {
    gotLock = await redis.set(LOCK_KEY, lockId, 'NX', 'PX', LOCK_PX_MS);
  } catch (err) {
    console.error('[ddCookie] lock acquire failed, fetching directly:', err.message);
    const { cookie, ttlMs } = await fetchFreshCookie();
    await storeCookie(cookie, ttlMs);
    return cookie;
  }

  if (gotLock === 'OK') {
    log('lock acquired — this instance will fetch from DonorDrive');
    try {
      const { cookie, ttlMs } = await fetchFreshCookie();
      await storeCookie(cookie, ttlMs);
      return cookie;
    } finally {
      try {
        await redis.eval(RELEASE_LUA, 1, LOCK_KEY, lockId);
        log('lock released');
      } catch (err) {
        console.error('[ddCookie] lock release failed:', err.message);
      }
    }
  }

  // Lock loser: wait briefly for the winner to publish the cookie.
  log('lock held by another instance — waiting for it to publish the cookie');
  const start = Date.now();
  const deadline = start + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const cached = await redis.get(COOKIE_KEY);
      if (cached) {
        const ttl = await redis.ttl(COOKIE_KEY);
        setL1(cached, ttl > 0 ? ttl * 1000 : L1_TTL_MS);
        log(`got cookie from peer via poll after ${Date.now() - start}ms ttl=${ttl}s ${fingerprint(cached)}`);
        return cached;
      }
    } catch (err) {
      console.error('[ddCookie] poll read failed:', err.message);
      break;
    }
  }

  // Winner is slow or crashed (lock PX not yet expired). Fetch directly rather than hang.
  console.warn('[ddCookie] peer did not publish within %dms — fetching directly', POLL_TIMEOUT_MS);
  const { cookie, ttlMs } = await fetchFreshCookie();
  await storeCookie(cookie, ttlMs);
  return cookie;
}

/**
 * Return a valid DonorDrive cookie string, fetching/priming as needed.
 * L1 (in-process) -> in-flight single-flight -> L2 (Redis) -> distributed refresh.
 */
async function getCookie() {
  if (l1Cookie && Date.now() < l1ExpiresAt) {
    log(`L1 hit — reusing in-process cookie (expires in ${secsLeft()}s) ${fingerprint(l1Cookie)}`);
    return l1Cookie;
  }
  if (inFlight) {
    log('joining in-flight refresh (single-flight) — no duplicate fetch');
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const cached = await redis.get(COOKIE_KEY);
      if (cached) {
        const ttl = await redis.ttl(COOKIE_KEY);
        setL1(cached, ttl > 0 ? ttl * 1000 : L1_TTL_MS);
        log(`L2 hit — reusing cookie from redis stash (ttl=${ttl}s) ${fingerprint(cached)}`);
        return cached;
      }
      log('cold miss — no cookie in redis, refreshing under lock');
    } catch (err) {
      // Redis unavailable: fall through to a direct fetch so requests still succeed.
      console.error('[ddCookie] redis read failed, fetching directly:', err.message);
      const { cookie, ttlMs } = await fetchFreshCookie();
      setL1(cookie, ttlMs);
      return cookie;
    }
    return refreshWithLock();
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Drop the cached cookie (both tiers) so the next getCookie() re-primes.
 * Used by the upstream auth-failure retry path.
 */
async function invalidateCookie() {
  log('invalidating cookie (clearing L1 + redis stash) — upstream rejected it, will re-prime');
  clearL1();
  try {
    await redis.del(COOKIE_KEY);
  } catch (err) {
    console.error('[ddCookie] invalidate del failed:', err.message);
  }
}

/**
 * Start the background primer: an initial fetch plus a periodic refresh, jittered so
 * instances don't fire in lockstep. The Redis lock means only one instance fetches.
 */
function startCookiePrimer() {
  const prime = async () => {
    log('primer tick — refreshing shared cookie');
    try {
      await refreshWithLock();
    } catch (err) {
      console.error('[ddCookie] prime failed:', err.message);
    }
  };
  const jitter = Math.floor(Math.random() * PRIME_JITTER_MS);
  log(`primer scheduled — first run in ${Math.round(jitter / 1000)}s, then every ${Math.round(PRIME_INTERVAL_MS / 60000)}min`);
  setTimeout(() => {
    prime();
    setInterval(prime, PRIME_INTERVAL_MS);
  }, jitter);
}

module.exports = {
  getCookie,
  invalidateCookie,
  startCookiePrimer,
  // exported for unit tests
  parseSetCookie,
  deriveTtlMs,
};
