function HuskythonEvent(id, summary, start, end, allDay, timezone, location, link) {
    return {
        id,
        summary,
        start,
        end,
        allDay,
        timezone,
        location,
        link
    }
}

module.exports = {
    HuskythonEvent
};
