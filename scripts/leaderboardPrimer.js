const axios = require('axios');

// Keep the leaderboard cache entries warm by periodically hitting the endpoints ourselves,
// exactly as a real client would. The normal cache.route() path populates the shared Redis
// cache on a miss, so a request landing just before each 60s entry expires keeps it fresh and
// every real client request is served from cache. The shared cache also dedups across
// instances: whichever instance's tick lands during a miss does the single upstream fetch,
// the rest get cache hits — no lock or bespoke cache writes needed.

const PRIME_PATHS = ['/api/participants/leaderboard', '/api/teams/leaderboard', '/api/events'];
const PRIME_INTERVAL_MS = 200 * 1000;   // shorter than the 300s cache TTL so entries never lapse
const REQUEST_TIMEOUT_MS = 15 * 1000;  // a cache miss does cookie + DonorDrive round-trips

const LOG_ENABLED = process.env.DD_PRIME_LOG !== 'off';
function log(...args) {
  if (LOG_ENABLED) console.log('[ddPrime]', ...args);
}

async function primeOnce(baseUrl) {
  for (const path of PRIME_PATHS) {
    const startedAt = Date.now();
    try {
      await axios.get(baseUrl + path, { timeout: REQUEST_TIMEOUT_MS });
      log(`warmed ${path} (${Date.now() - startedAt}ms)`);
    } catch (err) {
      console.error(`[ddPrime] failed to warm ${path}:`, err.message);
    }
  }
}

/**
 * Start the background leaderboard warmer: hit the leaderboard endpoints on this server on
 * an interval so their cache entries stay populated and client requests are always fast.
 * @param {number} port - the port this server is listening on
 */
function startLeaderboardPrimer(port) {
  const baseUrl = `http://127.0.0.1:${port}`;
  log(`warming ${PRIME_PATHS.join(', ')} every ${Math.round(PRIME_INTERVAL_MS / 1000)}s via ${baseUrl}`);
  const tick = () => primeOnce(baseUrl);
  tick(); // warm immediately on startup
  setInterval(tick, PRIME_INTERVAL_MS);
}

module.exports = { startLeaderboardPrimer };
