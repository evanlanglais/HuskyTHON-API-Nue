const express = require('express');
const router = express.Router();
const axios = require('axios');
const {client} = require('../scripts/redisClient');
const cache = require('express-redis-cache')({ client: client, prefix: 'ht-dd', expire: 60 });
const crypto = require('crypto');

router.get('/participants/search',
    function (req, res, next) {
        const hash = crypto.createHash('md5').update(req.query.q).digest('hex');
        res.express_redis_cache_name = 'participant-search-' + hash;
        next();
    },
    cache.route(),
    async function(req, res) {
        try {
            // From what I can tell, dance marathon doesn't like us using search and so locks it behind an authorization.
            // We need to manually pull the cookies that are 'being set' when a user navigates to their website
            // in order to high-jack the authorization and use those cookies for _our_ search query
            const headersResponse = await axios.get(`${process.env.DONOR_DRIVE_URL}/index.cfm?fuseaction=donordrive.participantList&eventID=${process.env.HUSKYTHON_EVENT_ID}`);
            const response = await axios.get(`${process.env.DONOR_DRIVE_URL}/api/events/${process.env.HUSKYTHON_EVENT_ID}/participants`,
                {
                    params: {
                        select: "avatarImageURL,campaignName,displayName,participantID,fundraisingGoal,sumDonations,teamID,teamName",
                        where: `displayName LIKE '%${req.query.q}%'`,
                        orderBy: "displayName ASC",
                        limit: "5"
                    },
                    headers: {
                        cookie: headersResponse.headers["set-cookie"]
                    }
                }
            );

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500);
        }
    }
);

router.get('/participants/leaderboard',
    cache.route(),
    async function(req, res) {
        try {
            const headersResponse = await axios.get(`${process.env.DONOR_DRIVE_URL}/index.cfm?fuseaction=donordrive.participantList&eventID=${process.env.HUSKYTHON_EVENT_ID}`);
            const response = await axios.get(`${process.env.DONOR_DRIVE_URL}/api/events/${process.env.HUSKYTHON_EVENT_ID}/participants`,
                {
                    params: {
                        select: "avatarImageURL,campaignName,displayName,eventID,eventName,fundraisingGoal,participantID,sumDonations,teamID,teamName",
                        orderBy: "sumDonations DESC,displayName ASC",
                        limit: "10"
                    },
                    headers: {
                        cookie: headersResponse.headers["set-cookie"]
                    }
                }
            );

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500);
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
            return res.status(500);
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
            return res.status(500);
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
            // From what I can tell, dance marathon doesn't like us using search and so locks it behind an authorization.
            // We need to manually pull the cookies that are 'being set' when a user navigates to their website
            // in order to high-jack the authorization and use those cookies for _our_ search query
            const headersResponse = await axios.get(`${process.env.DONOR_DRIVE_URL}/index.cfm?fuseaction=donordrive.participantList&eventID=${process.env.HUSKYTHON_EVENT_ID}`);
            const response = await axios.get(`${process.env.DONOR_DRIVE_URL}/api/events/${process.env.HUSKYTHON_EVENT_ID}/teams`,
                {
                    params: {
                        select: "avatarImageURL,name,teamID",
                        where: `name LIKE '%${req.query.q}%'`,
                        orderBy: "name ASC",
                        limit: "5"
                    },
                    headers: {
                        cookie: headersResponse.headers["set-cookie"]
                    }
                }
            );

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500);
        }
    }
);

router.get('/teams/leaderboard',
    cache.route(),
    async function(req, res) {
        try {
            const headersResponse = await axios.get(`${process.env.DONOR_DRIVE_URL}/index.cfm?fuseaction=donordrive.participantList&eventID=${process.env.HUSKYTHON_EVENT_ID}`);
            const response = await axios.get(`${process.env.DONOR_DRIVE_URL}/api/events/${process.env.HUSKYTHON_EVENT_ID}/teams`, {
                params: {
                    select: "avatarImageURL,eventID,eventName,fundraisingGoal,name,sumDonations,teamID",
                    orderBy: "sumDonations DESC,name ASC",
                    limit: "10"
                },
                headers: {
                    cookie: headersResponse.headers["set-cookie"]
                }
            });

            return res.json(response.data);
        } catch(error) {
            console.log(error);
            return res.status(500);
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
            return res.status(500);
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
            return res.status(500);
        }
    }
);

module.exports = router;
