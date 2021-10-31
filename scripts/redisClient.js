const redis = require('redis');
const client = redis.createClient(6380, process.env.CACHE_HOSTNAME, {auth_pass: process.env.CACHE_KEY, tls: {servername: process.env.CACHE_HOSTNAME}});

module.exports = {client};
