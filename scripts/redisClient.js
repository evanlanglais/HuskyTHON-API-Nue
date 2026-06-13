const redis = require('redis');
const { promisify } = require('util');

const useTLS = process.env.REDIS_TLS === 'true';
const port = parseInt(process.env.CACHE_PORT || (useTLS ? '6380' : '6379'));

const options = {
    // Keep reconnecting (with backoff) so the client recovers when Redis comes back,
    // without tight-looping or spamming connection errors.
    retry_strategy: (opts) => Math.min((opts.attempt || 1) * 200, 3000),
};
if (process.env.CACHE_KEY) options.auth_pass = process.env.CACHE_KEY;
if (useTLS) options.tls = { servername: process.env.CACHE_HOSTNAME };

const client = redis.createClient(port, process.env.CACHE_HOSTNAME, options);

// Surface connection errors instead of letting the v3 client throw unhandled.
client.on('error', (err) => console.error('[redis] client error:', err.message));

// Promisified helpers for code that wants async/await. The bare `client` is kept
// for express-redis-cache, which consumes the v3 callback API directly.
// `set` is variadic: set(key, val, 'NX', 'PX', ms) -> null when NX fails;
//                    set(key, val, 'EX', seconds) -> 'OK'.
const asyncRedis = {
  get:  promisify(client.get).bind(client),
  set:  promisify(client.set).bind(client),
  ttl:  promisify(client.ttl).bind(client),
  del:  promisify(client.del).bind(client),
  eval: promisify(client.eval).bind(client),
};

module.exports = { client, asyncRedis };
