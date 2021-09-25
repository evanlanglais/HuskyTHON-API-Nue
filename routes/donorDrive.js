const express = require('express');
const router = express.Router();
const cache = require('express-redis-cache')({ prefix: 'ht-dd', expire: 60 });

router.get('/',
    cache.route(),
    async function(req, res) {
    try {

    } catch (e) {
        console.error(e);
        return res.status(500);
    }
});

module.exports = router;
