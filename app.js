var express = require('express');
var logger = require('morgan');
var bodyParser = require('body-parser');
var async = require('async');
var debug = require('debug')('portal-chatbot:app');
var correlationIdHandler = require('portal-env').CorrelationIdHandler();

var chatbot = require('./chatbot');
var utils = require('./utils');

var app = express();
app.initialized = false;
app.lastErr = false;

// Correlation ID
app.use(correlationIdHandler);

logger.token('correlation-id', function (req, res) {
    return req.correlationId;
});
if (app.get('env') == 'development')
    app.use(logger('dev'));
else
    app.use(logger('{"date":":date[clf]","method":":method","url":":url","remote-addr":":remote-addr","version":":http-version","status":":status","content-length":":res[content-length]","referrer":":referrer","response-time":":response-time","correlation-id":":correlation-id"}'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.post('/', function (req, res, next) {
    debug("post('/')");
    if (!app.initialized)
        return res.status(503).json({ message: 'Initializing.' });
    if (req.app.processingWebhooks) {
        debug('Still processing last webhook load.');
        return res.send('OK');
    }

    req.app.processingWebhooks = true;
    processWebhooks(app, req.body, function (err) {
        req.app.processingWebhooks = false;
        if (err) {
            console.error(err);
            app.lastErr = err;
            return res.status(500).json(err);
        }
        app.lastErr = null;
        return res.send('OK');
    });
});

app._startupSeconds = utils.getUtc();
app.get('/ping', function (req, res, next) {
    var health = {
        name: 'chatbot',
        message: 'Up and running',
        uptime: (utils.getUtc() - app._startupSeconds),
        healthy: true,
        pingUrl: app.get('my_url') + 'ping'
    }; 
    if (!app.initialized) {
        health.healthy = 2;
        health.message = 'Initializing - Waiting for API';
        res.status(503);
    } else if (app.lastErr) {
        health.healthy = 0;
        health.message = lastErr.message;
        health.error = JSON.stringify(lastErr, null, 2);
        res.status(500);
    }
    res.json(health);
});

function processWebhooks(app, webhooks, callback) {
    debug('processWebhooks()');
    var baseUrl = app.get('api_url');

    async.eachSeries(webhooks, function (event, done) {
        // Brainfucking callback and closure orgy
        var acknowledgeEvent = function (ackErr) {
            if (ackErr)
                return ackCallback(ackErr);
            utils.apiDelete(app, 'webhooks/events/chatbot/' + event.id, done);
        };
        if (chatbot.isEventInteresting(event)) {
            chatbot.handleEvent(app, event, acknowledgeEvent);
        } else {
            acknowledgeEvent(null);
        }
    }, function (err) {
        if (err)
            return callback(err);
        return callback(null);
    });
}

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    debug("Not found: " + req.path);
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function (err, req, res, next) {
        debug(err);
        res.status(err.status || 500);
        res.jsonp({
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function (err, req, res, next) {
    debug(err);
    res.status(err.status || 500);
    res.jsonp({
        message: err.message,
        error: {}
    });
});


module.exports = app;
