const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { client } = require('../scripts/redisClient');
const cache = require('express-redis-cache')({ client, prefix: 'ht-dd', expire: 300 });
const { getCookie, invalidateCookie } = require('../scripts/donorDriveCookie');

// Without an 'error' listener, express-redis-cache's EventEmitter would throw on any
// internal Redis error. Log instead.
cache.on('error', (err) => console.error('[ht-dd cache] error:', err.message));

// Auth failures from DonorDrive: 401/403, or a 302 redirect back to the login page
// (which would otherwise be silently followed and return a 200 of HTML).
function isAuthFailure(err) {
    const status = err.response && err.response.status;
    return status === 401 || status === 403 || status === 302;
}

// GET an authenticated DonorDrive endpoint using the shared cookie (see
// scripts/donorDriveCookie.js). On an auth failure, invalidate the cookie, re-prime,
// and retry exactly once.
async function authedGet(url, params) {
    let cookie = await getCookie();
    try {
        return await axios.get(url, { headers: { cookie }, params, maxRedirects: 0 });
    } catch (err) {
        if (isAuthFailure(err)) {
            await invalidateCookie();
            cookie = await getCookie();
            return await axios.get(url, { headers: { cookie }, params, maxRedirects: 0 });
        }
        throw err;
    }
}

router.get('/participants/search',
    function (req, res, next) {
        const hash = crypto.createHash('md5').update(req.query.q).digest('hex');
        res.express_redis_cache_name = 'participant-search-' + hash;
        next();
    },
    cache.route(),
    async function(req, res) {
        try {
            // Search/leaderboard are locked behind a session cookie; getCookie() supplies a
            // shared, primed one (see scripts/donorDriveCookie.js) instead of fetching per request.
            const response = await authedGet(
                `${process.env.DONOR_DRIVE_URL}/api/events/${process.env.HUSKYTHON_EVENT_ID}/participants`,
                {
                    select: "avatarImageURL,campaignName,displayName,participantID,fundraisingGoal,sumDonations,teamID,teamName",
                    where: `displayName LIKE '%${req.query.q}%'`,
                    orderBy: "displayName ASC",
                    limit: "5"
                }
            );

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500).json({ error: 'upstream error' });
        }
    }
);

router.get('/participants/leaderboard',
    cache.route(),
    async function(req, res) {
        // Normally served from the warm cache (kept primed by scripts/leaderboardPrimer.js);
        // this handler only runs on a cache miss.
        try {
            const response = await authedGet(
                `${process.env.DONOR_DRIVE_URL}/api/events/${process.env.HUSKYTHON_EVENT_ID}/participants`,
                {
                    select: "avatarImageURL,campaignName,displayName,eventID,eventName,fundraisingGoal,participantID,sumDonations,teamID,teamName",
                    orderBy: "sumDonations DESC,displayName ASC",
                    limit: "10"
                }
            );

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500).json({ error: 'upstream error' });
        }
    }
)

router.get('/participants/:id',
    function (req, res, next) {
        res.express_redis_cache_name = 'participant-' + req.params.id;
        next();
    },
    cache.route(),
    async function(req, res) {
        try {
            const response = await axios.get(`${process.env.DONOR_DRIVE_URL}/api/participants/${req.params.id}`, {
                params: {
                    limit: "1"
                }
            });

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500).json({ error: 'upstream error' });
        }
    }
);

router.get('/participants/:id/donations',
    function (req, res, next) {
        res.express_redis_cache_name = 'participant-donations-' + req.params.id;
        next();
    },
    cache.route(),
    async function(req, res) {
        try {
            const response = await axios.get(`${process.env.DONOR_DRIVE_URL}/api/participants/${req.params.id}/donations`, {
                params: {
                    select: "displayName,message,amount,createdDateUTC",
                    orderBy: "createdDateUTC DESC"
                }
            });

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500).json({ error: 'upstream error' });
        }
    }
);

router.get('/teams/search',
    function (req, res, next) {
        const hash = crypto.createHash('md5').update(req.query.q).digest('hex');
        res.express_redis_cache_name = 'teams-search-' + hash;
        next();
    },
    cache.route(),
    async function(req, res) {
        try {
            // Search/leaderboard are locked behind a session cookie; getCookie() supplies a
            // shared, primed one (see scripts/donorDriveCookie.js) instead of fetching per request.
            const response = await authedGet(
                `${process.env.DONOR_DRIVE_URL}/api/events/${process.env.HUSKYTHON_EVENT_ID}/teams`,
                {
                    select: "avatarImageURL,name,teamID",
                    where: `name LIKE '%${req.query.q}%'`,
                    orderBy: "name ASC",
                    limit: "5"
                }
            );

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500).json({ error: 'upstream error' });
        }
    }
);

router.get('/teams/leaderboard',
    cache.route(),
    async function(req, res) {
        // Served from the warm cache when primed; handler runs only on a cache miss.
        try {
            const response = await authedGet(
                `${process.env.DONOR_DRIVE_URL}/api/events/${process.env.HUSKYTHON_EVENT_ID}/teams`,
                {
                    select: "avatarImageURL,eventID,eventName,fundraisingGoal,name,sumDonations,teamID",
                    orderBy: "sumDonations DESC,name ASC",
                    limit: "10"
                }
            );

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500).json({ error: 'upstream error' });
        }
    }
)

router.get('/teams/:id',
    function (req, res, next) {
        res.express_redis_cache_name = 'team-' + req.params.id;
        next();
    },
    cache.route(),
    async function(req, res) {
        try {
            const response = await axios.get(`${process.env.DONOR_DRIVE_URL}/api/teams/${req.params.id}`, {
                params: {
                    limit: "1"
                }
            });

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500).json({ error: 'upstream error' });
        }
    }
);

router.get('/teams/:id/participants',
    function (req, res, next) {
        res.express_redis_cache_name = 'team-participants-' + req.params.id;
        next();
    },
    cache.route(),
    async function(req, res) {
        try {
            const response = await axios.get(`${process.env.DONOR_DRIVE_URL}/api/teams/${req.params.id}/participants`, {
                params: {
                    select: "displayName,participantID,sumDonations",
                    orderBy: "sumDonations DESC,displayName ASC"
                }
            });

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500).json({ error: 'upstream error' });
        }
    }
);

module.exports = router;
