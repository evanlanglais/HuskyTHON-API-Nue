const redis = require('redis');

const useTLS = process.env.REDIS_TLS === 'true';
const port = parseInt(process.env.CACHE_PORT || (useTLS ? '6380' : '6379'));

const options = {};
if (process.env.CACHE_KEY) options.auth_pass = process.env.CACHE_KEY;
if (useTLS) options.tls = { servername: process.env.CACHE_HOSTNAME };

const client = redis.createClient(port, process.env.CACHE_HOSTNAME, options);

module.exports = {client};
