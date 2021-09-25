const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');

const eventsRouter = require('./routes/events');
const donorDriveRouter = require('./routes/donorDrive');

const app = express();

app.use(logger('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', donorDriveRouter);
app.use('/api', eventsRouter);

module.exports = app;
