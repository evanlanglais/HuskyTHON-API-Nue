const express = require('express');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');

const eventsRouter = require('./routes/events');
const donorDriveRouter = require('./routes/donorDrive');
const indexRouter = require('./routes/index');

const app = express();

app.use(logger('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('/', indexRouter);
app.use('/api', donorDriveRouter);
app.use('/api', eventsRouter);

app.get('/health', function (req, res) {
    res.status(200);
    res.send();
})

module.exports = app;
