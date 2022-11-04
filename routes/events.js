const express = require('express');
const router = express.Router();
const { client } = require('../scripts/redisClient');
const cache = require('express-redis-cache')({ client: client, prefix: 'ht-events', expire: 60 });
const { calendar } = require('@googleapis/calendar');
const { DateTime } = require("luxon");
const { HuskythonEvent } = require("../scripts/api");

router.get('/main-event',
    cache.route(),
    function (req, res){
        return res.send({
            dateAsString: process.env.MAIN_EVENT_DATE
        });
    }
);

router.get('/events',
    cache.route(),
    async function(req, res) {
    try {
        return res.send(await getEventsList());
    } catch (e) {
        console.error(e);
        return res.status(500);
    }
});

async function getEventsList() {
    const calendarClient = new calendar("v3")
    const events = await calendarClient.events.list({calendarId: "huskython465@gmail.com", auth: process.env.GOOGLE_API_KEY, key: process.env.GOOGLE_API_KEY});
    if (events.status !== 200) throw `Calendar API call failed -- ${events.status} - ${events.statusText}`;

    const eventsList = [];

    const tz = events.data.timeZone;
    for (const event of events.data.items)
    {
        const isAllDayEvent = !!event.start.date;
        const startDateString = isAllDayEvent ? event.start.date : event.start.dateTime;
        const endDateString = isAllDayEvent ? event.end.date : event.end.dateTime;

        if (DateTime.fromISO(endDateString, {zone: tz}) < DateTime.now())
        {
            continue;
        }

        const htEvent = HuskythonEvent(event.id, event.summary, startDateString, endDateString, isAllDayEvent, tz, event.location, event.htmlLink);
        eventsList.push(htEvent);
    }

    eventsList.sort((htEvent1, htEvent2) => DateTime.fromISO(htEvent1.start) - DateTime.fromISO(htEvent2.start));

    return eventsList;
}

module.exports = router;
