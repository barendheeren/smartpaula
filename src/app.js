'use strict';

const apiai = require('apiai');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('node-uuid');
const request = require('request');
const JSONbig = require('json-bigint');
const async = require('async');
const { Pool, Client } = require('pg');
const util = require('util');
const path = require('path');
const cookieParser = require('cookie-parser');

const Wunderlist = require('./services/wunderlist');
const Facebook = require('./services/facebook');
const Nokia = require('./services/nokia');

const REST_PORT = (process.env.PORT || 5000);
const APIAI_ACCESS_TOKEN = process.env.APIAI_ACCESS_TOKEN;
const APIAI_LANG = process.env.APIAI_LANG || 'nl';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const NOKIA_API_KEY = process.env.NOKIA_API_KEY;
const NOKIA_API_SECRET = process.env.NOKIA_API_SECRET;
const WUNDERLIST_CLIENT_ID = process.env.WUNDERLIST_CLIENT_ID;
const WUNDERLIST_CLIENT_SECRET = process.env.WUNDERLIST_CLIENT_SECRET;
const HOSTNAME = process.env.HOSTNAME;
const DEFAULT_INTENT_REFER_TO = process.env.DEFAULT_INTENT_REFER_TO;
const DEFAULT_INTENTS = ['57b82498-053c-4776-8be9-228c420e6c13', 'b429ecdc-21f4-4a07-8165-3620023185ba'];
const VIEWS = __dirname + '/views/';

/** @const {Pool} Postgres connection pool */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** @const {Apiai} API.AI interface */
const apiAiService = apiai(APIAI_ACCESS_TOKEN, {
    language: APIAI_LANG,
    requestSource: "fb"
});

/** @const {Nokia} Nokia API interface */
const nokia = new Nokia(NOKIA_API_KEY, NOKIA_API_SECRET, HOSTNAME + 'connect/nokia/');

/** @const {Wunderlist} Wunderlist API interface */
const wunderlist = new Wunderlist(WUNDERLIST_CLIENT_ID, WUNDERLIST_CLIENT_SECRET, HOSTNAME + 'connect/wunderlist');

/** @const {Facebook} Facebook API interface */
const facebook = new Facebook(FB_VERIFY_TOKEN, FB_PAGE_ACCESS_TOKEN);

/** @const {Map} Map of existing API.AI session ID's */
const sessionIds = new Map();

/**
 * Handles an API.AI message, and responds accordingly to the Facebook user.
 * Handling includes e.g. database operations that should occur as a result of a previous message.
 * @param {object} response A valid API.AI response
 * @param {number} sender A Facebook ID to respond to.
 */
function handleResponse(response, sender) {
    if (isDefined(response.result)) {
        let /** string */ responseText = response.result.fulfillment.speech;
        let /** object */ responseData = response.result.fulfillment.data;
        let /** string */ resolvedQuery = response.result.resolvedQuery

        /** The API.AI intent @type {string} */
        let intent = response.result.metadata.intentId;
        /** The API.AI action within an intent @type {string} */
        let action = response.result.action;
        /** Additional parameters passed by the intent @type {object} */
        let parameters = response.result.parameters;

        if (isDefined(responseData) && isDefined(responseData.facebook)) {
            // If the response is specifically a facebook message, send it directly to the user.
            // (Is this ever used?)
            if (!Array.isArray(responseData.facebook)) {
                try {
                    console.log('Response as formatted message');
                    facebook.sendMessage(sender, responseData.facebook + ' geformatteerd bericht');
                } catch (err) {
                    facebook.sendMessage(sender, {
                        text: err.message
                    });
                }
            } else {
                responseData.facebook.forEach((facebookMessage) => {
                    try {
                        if (facebookMessage.sender_action) {
                            console.log('Response as sender action');
                            facebook.sendSenderAction(sender, facebookMessage.sender_action);
                        } else {
                            console.log('Response as formatted message');
                            facebook.sendMessage(sender, facebookMessage);
                        }
                    } catch (err) {
                        facebook.sendMessage(sender, {
                            text: err.message
                        });
                    }
                });
            }
        } else if (isDefined(responseText)) {
            let message = {
                text: responseText
            };
            /**
             * These are the standard questionnare responses
             * @type {Array}
             */
            let quickReplies = [{
                "content_type": "text",
                "title": "😁",
                "payload": "4"
            },
            {
                "content_type": "text",
                "title": "🙂",
                "payload": "3"
            },
            {
                "content_type": "text",
                "title": "😞",
                "payload": "2"
            },
            {
                "content_type": "text",
                "title": "😡",
                "payload": "1"
            },
            {
                "content_type": "text",
                "title": "N.v.t",
                "payload": "0"
            }];
            console.log('Response as text message');

            // If the intent is one of a set of predefined "default" intents, someone needs to do a manual followup with this user.
            if (DEFAULT_INTENTS.includes(intent)) {
                facebook.getProfile(sender, (profile) => {
                    // Forward the message to a predefined facebook user

                    // Disabled while in development
                    // facebook.sendMessage(DEFAULT_INTENT_REFER_TO, {text:'Hallo, ik heb een vraag gekregen van ' + profile.first_name + ' ' + profile.last_name + ' die ik niet kan beantwoorden:\n "' + resolvedQuery + '"'})
                    console.log('Default intent')
                });
            }

            console.log(response.result);

            switch (action) {
                // User has answered a new PAM question
                // TODO: Create some way of updating questionnares and questions that works on all questionnares
                case "pam_sum":
                    let payload = response.result.payload;
                    let score = parameters.pam_score;

                    if (isDefined(score)) {
                        console.log(action, 'score is defined', score);

                        pool.query('SELECT id FROM vragenlijsten WHERE fbuser = $1 ORDER BY gestart DESC LIMIT 1', [sender])
                            .then(res => {
                                let vragenlijst = res.rows[0].id;
                                console.log('vragenlijst', vragenlijst);
                                pool.query('SELECT * FROM antwoorden WHERE vragenlijst = $1', [vragenlijst])
                                    .then(res => {
                                        let answer_no = res.rowCount + 1;
                                        console.log('answer_no', answer_no);
                                        pool.query('INSERT INTO antwoorden (vragenlijst, waarde, antwoord_op, vraag) VALUES ($1, $2, (SELECT NOW()), $3)', [vragenlijst, score, answer_no]);
                                    });
                            });
                    }
                    message.quick_replies = quickReplies;

                    response.result.fulfillment.messages.forEach(function (message) {
                        let payload = message.payload;
                        if (isDefined(payload) && isDefined(payload.vragenlijst_end) && payload.vragenlijst_end) {
                            delete message.quick_replies;
                        }
                    });
                    break;

                // User wants to start a new questionnare
                case "start_vragenlijst":
                    pool.query({ text: 'INSERT INTO vragenlijsten (fbuser, vragenlijst) VALUES($1, $2)', values: [sender, parameters.vragenlijst] })
                        .then(res => { console.log(res); })
                        .catch(e => console.error(e, e.stack));
                    break;

                // User wants to create a new wunderlist-list
                case "create_wunderlist":
                    pool.query("SELECT * FROM connect_wunderlist WHERE fbuser = $1", [sender]).then(result => {
                        let connection = result.rows[0];
                        wunderlist.createList(connection.access_token).done(list => {
                            pool.query("INSERT INTO wunderlist_lists (fbuser, id, created_at) VALUES ($1, $2, $3)", [sender, list.id, list.created_at])
                                .then(() => {
                                    let request = apiAiService.eventRequest({
                                        name: 'new_list',
                                        data: {
                                            name: list.title
                                        }
                                    }, {
                                            sessionId: sessionIds.get(sender)
                                        });
                                    request.on('response', (response) => { handleResponse(response, sender); });
                                    request.on('error', (error) => console.error(error));

                                    request.end();
                                });
                            wunderlist.createWebhook(connection.access_token, list.id, HOSTNAME + 'webhook/wunderlist/' + sender, (someresult) => { console.log(someresult); });
                        }
                        );
                    });
                    break;

                // User wants to connect to a service
                case "connect_service":
                    let service = response.result.parameters.service;
                    if (isDefined(service)) {
                        switch (service) {
                            // So far, only Nokia health (formerly Withings) is supported
                            case "Nokia":
                                // Get a reqest token, and a login url to send to the user.
                                nokia.getRequestUrl(sender, (error, url, oAuthToken, oAuthTokenSecret) => {
                                    if (!error) {
                                        facebook.sendMessage(sender, { text: url });
                                        pool.query('DELETE FROM connect_nokia WHERE fbuser = $1', [sender]).then(() => {
                                            pool.query('INSERT INTO connect_nokia (fbuser, oauth_request_token, oauth_request_secret) VALUES ($1, $2, $3)', [sender, oAuthToken, oAuthTokenSecret]);
                                        });
                                    }
                                });
                                break;
                            case "Wunderlist":
                                message.text += '\n' + HOSTNAME + 'connect/wunderlist/' + sender;
                                break;
                        }
                    }
                    break;
                default:
                    console.log('Received an unknown action from API.ai: "' + action + '"');
            }

            // facebook API limit for text length is 640,
            // so we must split message if needed
            let splittedText = splitResponse(message.text);
            // Send messages asynchronously, to ensure they arrive in the right order 
            async.eachSeries(splittedText, (textPart, callback) => {
                message.text = textPart;
                facebook.sendMessage(sender, message, callback);
            });
        }

        // Some messages Have a custom payload, we need to handle this payload;
        response.result.fulfillment.messages.forEach(function (message) {
            let payload = message.payload
            if (isDefined(payload)) {
                /** @type {string} */
                let followUp = payload.followUp;
                /** @type {boolean} */
                let vragenlijst_end = payload.vragenlijst_end;

                if (isDefined(followUp)) {
                    let request = apiAiService.eventRequest({
                        name: followUp
                    }, {
                            sessionId: sessionIds.get(sender)
                        });

                    request.on('response', (response) => { handleResponse(response, sender); });
                    request.on('error', (error) => console.error(error));

                    request.end();
                }

                if (isDefined(vragenlijst_end) && vragenlijst_end) {
                    pool.query('SELECT id FROM vragenlijsten WHERE fbuser = $1 ORDER BY gestart DESC LIMIT 1', [sender]).then(res => {
                        let vragenlijst = res.rows[0].id;
                        pool.query('UPDATE vragenlijsten set gestopt = (SELECT NOW()) WHERE id = $1', [vragenlijst])
                    });
                }
            }
        }, this);

    }
}

function processEvent(event) {
    var sender = event.sender.id.toString();

    if ((event.message && event.message.text) || (event.postback && event.postback.payload)) {
        var text = event.message ? event.message.text : event.postback.payload;
        // Handle a text message from this sender

        if (!sessionIds.has(sender)) {
            sessionIds.set(sender, uuid.v1());
        }

        console.log("proces event: ", text);
        //send message to api.ai
        let apiaiRequest = apiAiService.textRequest(text, {
            sessionId: sessionIds.get(sender)
        });
        //receive message from api.ai
        apiaiRequest.on('response', (response) => { handleResponse(response, sender); });
        apiaiRequest.on('error', (error) => console.error('Error: ' + error));
        apiaiRequest.end();
    }
}

/**
 * Splits a string in 640 character long chunks
 * @param {string} str String to split
 */
function splitResponse(str) {
    if (str.length <= 640) {
        return [str];
    }

    return chunkString(str, 640);
}

/**
 * Splits a string into chunks
 * @param {string} s String to chuck up
 * @param {number} len Chunk length
 * @return {array} Array of string chunks
 */
function chunkString(s, len) {
    var curr = len,
        prev = 0;

    var output = [];

    while (s[curr]) {
        if (s[curr++] == ' ') {
            output.push(s.substring(prev, curr));
            prev = curr;
            curr += len;
        } else {
            var currReverse = curr;
            do {
                if (s.substring(currReverse - 1, currReverse) == ' ') {
                    output.push(s.substring(prev, currReverse));
                    prev = currReverse;
                    curr = currReverse + len;
                    break;
                }
                currReverse--;
            } while (currReverse > prev)
        }
    }
    output.push(s.substr(prev));
    return output;
}

/**
 * Send facebook message to user, based on what new measurements have been received.
 * @param {Array<number>} types measurement types, according to the Nokia Health API
 * @param {number} user Facebook User Id
 */
function sendMeasurementMessage(types, user) {
    let event = 'new_measurement_';

    if (types.length === 3 && types.includes(9) && types.includes(10) && types.includes(9)) {
        event += 'blood';
    } else if (types.length === 1 && types[0] === 1) {
        event += 'weight';
    } else {
        event += 'multiple';
    }

    if (!sessionIds.has(user)) {
        sessionIds.set(user, uuid.v1());
    }

    let request = apiAiService.eventRequest({
        name: event
    }, {
            sessionId: sessionIds.get(user)
        });

    request.on('response', (response) => { handleResponse(response, user); });
    request.on('error', (error) => console.error(error));

    request.end();
}

function getNokiaMeasurements(userid) {
    pool.query('SELECT *, extract(epoch from last_update) as time FROM connect_nokia WHERE fbuser = $1 OR nokia_user = $1', [userid]).then(res => {
        let user = res.rows[0];
        nokia.getMeasurements(user.nokia_user, user.oauth_access_token, user.oauth_access_secret, user.time, measureGroups => {
            let measureTypes = [];
            measureGroups.forEach(group => {
                let date = new Date(group.date * 1000).toISOString().slice(0, 19).replace('T', ' ');
                group.measures.forEach(measurement => {
                    let type = measurement.type;
                    let value = measurement.value * Math.pow(10, measurement.unit);
                    measureTypes.push(type);
                    if (type === 9) {
                        pool.query("INSERT INTO measure_blood (fbuser, measure_date, diastolic) VALUES ($1, $2, $3) ON CONFLICT (fbuser, measure_date) DO UPDATE SET diastolic = excluded.diastolic", [user.fbuser, date, value]);
                    }
                    if (type === 10) {
                        pool.query("INSERT INTO measure_blood (fbuser, measure_date, systolic) VALUES ($1, $2, $3) ON CONFLICT (fbuser, measure_date) DO UPDATE SET systolic = excluded.systolic", [user.fbuser, date, value]);
                    }
                    if (type === 11) {
                        pool.query("INSERT INTO measure_blood (fbuser, measure_date, pulse) VALUES ($1, $2, $3) ON CONFLICT (fbuser, measure_date) DO UPDATE SET pulse = excluded.pulse", [user.fbuser, date, value]);
                    }
                    if (type === 1) {
                        pool.query("INSERT INTO measure_weight (fbuser, measure_date, weight) VALUES ($1, $2, $3) ON CONFLICT (fbuser, measure_date) DO UPDATE SET weight = excluded.weight", [user.fbuser, date, value]);
                    }
                });
            })
            if (measureTypes.length > 0) {
                sendMeasurementMessage(measureTypes, user.fbuser);
            }
            pool.query('UPDATE connect_nokia SET last_update = (SELECT NOW()), sent_message = NULL WHERE fbuser = $1 OR nokia_user = $1', [userid]);


        });
    });
}

/**
 * Subscribe to nokia notifications either for a specific user, or for all users at once
 * @param {number|null} fbuser Facebook user id to subscribe to, or null to subscribe to all users
 */
function subscribeToNokia(fbuser) {
    let query = { text: 'SELECT * FROM connect_nokia' };
    if (isDefined(fbuser)) {
        query.text += ' WHERE fbuser = $1';
        query.values = [fbuser];
    }
    pool.query(query).then(res => {
        res.rows.forEach(row => {
            nokia.subscribe(row.nokia, row.oauth_access_token, row.oauth_access_secret, 1, (error, responseData) => { if (error) console.log(error); });
            nokia.subscribe(row.nokia, row.oauth_access_token, row.oauth_access_secret, 4, (error, responseData) => { if (error) console.log(error); });

            // Get measurements, so that we have current data and don't have to wait for a new measurement to be made to be up to date
            getNokiaMeasurements(row.fbuser);
        });
    })
}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

const app = express();
const frontofficeid = 1533050426761050;

app.use(bodyParser.text({
    type: 'application/json'
})); //geen response als deze weggelaten wordt
app.use(bodyParser.urlencoded({
    extended: false
})); //toegevoegd: heeft invloed verwerking event
app.use(bodyParser.json()); //toegevoegd: corrigeert de werking weer
app.use(cookieParser());

var debugtekst = "";

app.use('/static', express.static(path.resolve(__dirname, '../public')))
app.use('/portal', require('./portal'));

// Server frontpage
app.get('/', function (req, res) {
    res.send('This is Paula');
});

app.get('/connect/nokia/:fbUserId', (req, res) => {
    try {
        let fbUser = req.params.fbUserId;
        let userid = req.query.userid;
        let oAuthToken = req.query.oauth_token;
        let oAuthVerifier = req.query.oauth_verifier;

        pool.query("SELECT * FROM connect_nokia WHERE fbuser = $1", [fbUser])
            .then(result => {
                let userOAuth = result.rows[0];
                nokia.getAccessToken(
                    userOAuth.oauth_request_token,
                    userOAuth.oauth_request_secret,
                    oAuthVerifier,
                    (error, oAuthToken, oAuthTokenSecret, results) => {
                        if (error) {
                            console.log(error);
                            response.end(JSON.stringify({
                                message: 'Error occured while getting access token',
                                error: error
                            }));
                            return;
                        }

                        pool.query('UPDATE connect_nokia SET oauth_access_token = $1, oauth_access_secret = $2, nokia_user = $3, last_update = \'epoch\' WHERE fbuser = $4', [oAuthToken, oAuthTokenSecret, userid, fbUser]).then(() => {
                            let request = apiAiService.eventRequest({
                                name: 'nokia_connected'
                            }, {
                                    sessionId: sessionIds.get(fbUser)
                                });

                            request.on('response', (response) => { handleResponse(response, fbUser); });
                            request.on('error', (error) => console.error(error));

                            request.end();
                            subscribeToNokia(fbUser);
                        });

                    });
            })
        return res.status(200).json({
            status: "ok"
        });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }

});

app.get('/connect/wunderlist/:fbUserId', (req, res) => {
    res.cookie('fbuser', req.params.fbUserId, { maxAge: 1000 * 60 * 15, httpOnly: true })
        .redirect(wunderlist.getAuthUri());
});

app.get('/connect/wunderlist/', (req, res) => {
    try {
        let user = req.cookies.fbuser;
        let code = req.query.code;
        wunderlist.getAccessToken(code, user,
            accessToken => {
                pool.query('INSERT INTO connect_wunderlist (fbuser, access_token) VALUES ($1, $2) ON CONFLICT (fbuser) DO UPDATE SET access_token = excluded.access_token', [user, accessToken])
                    .then(() => {
                        if (!sessionIds.has(user)) {
                            sessionIds.set(user, uuid.v1());
                        }
                        let request = apiAiService.eventRequest({
                            name: 'wunderlist_connected'
                        }, {
                                sessionId: sessionIds.get(user)
                            });

                        request.on('response', (response) => { handleResponse(response, user); });
                        request.on('error', (error) => console.error(error));

                        request.end();

                        res.status(200).send();
                    }, (err) => { res.status(400).json(err) });
            });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
})

app.get('/webhook/', (req, res) => {
    if (req.query['hub.verify_token'] == FB_VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);

        setTimeout(() => {
            doSubscribeRequest();
        }, 5000);
    } else {
        res.send('Error, wrong validation token');
    }
});

//ontvangen van FB bericht
app.post('/webhook/', (req, res) => {
    try {
        var data = JSONbig.parse(req.body);

        if (data.entry) {
            let entries = data.entry;
            entries.forEach((entry) => {
                let messaging_events = entry.messaging;
                if (messaging_events) {
                    messaging_events.forEach((event) => {
                        if (event.message && !event.message.is_echo ||
                            event.postback && event.postback.payload) {
                            //sendFBMessage(event.sender.id, {text: "Debugtekst fb: " + debugtekst});
                            processEvent(event);
                            //sendFBMessage(event.sender.id, {text: "Jij bent: " + event.sender.id});
                        }
                    });
                }
            });
        }

        return res.status(200).json({
            status: "ok"
        });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }

});

app.post('/webhook/scheduler', (req, res) => {
    pool.query('SELECT fbuser FROM connect_nokia WHERE last_update > (CURRENT_DATE - INTERVAL \'1 week\') AND sent_message = NULL').then(result => {
        console.log(result);
        result.rows.forEach(row => {
            let user = row.fbuser;
            if (!sessionIds.has(user)) {
                sessionIds.set(user, uuid.v1());
            }

            let request = apiAiService.eventRequest({
                name: 'old_measurement'
            }, {
                    sessionId: sessionIds.get(user)
                });
            request.on('response', (response) => { handleResponse(response, user); });
            request.on('error', (error) => console.error(error));

            request.end();
            pool.query('UPDATE connect_nokia SET sent_message = true WHERE fbuser = $1', [user]);
        })
    })
    res.status(200).send()
});

app.all('/webhook/nokia/:userid/:type', (req, res) => {
    try {
        let startDate = req.body.startdate;
        let enddate = req.body.enddate;

        getNokiaMeasurements(req.params.userid)

        return res.status(200).end();
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }

});

app.all('/webhook/wunderlist/:fbuser', (req, res) => {
    try {

        let user = req.params.fbuser;
        let body = JSON.parse(req.body);

        let operation = body.operation;
        let list = body.subject.parents[0].id;
        let id = body.subject.id;
        let item = body.after.title;
        let created_at = body.after.created_at;
        let completed_at = body.after.completed_at;
        let completed = body.after.completed;

        console.log(req.body);
        switch (operation) {
            case 'create':
                pool.query('INSERT INTO wunderlist_items (list, id, item, date_added) VALUES ($1, $2, $3, $4)', [list, id, item, created_at]);
                break;
            case 'update':
                if (completed) {
                    pool.query('UPDATE wunderlist_items SET item = $1, date_checked = $2 WHERE id = $3', [item, completed_at, id]);
                } else {
                    pool.query('UPDATE wunderlist_items SET item = $1 WHERE id = $2', [item, id]);
                }
                break;
        }


    } catch (err) {
        console.log(err);
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
});


//bewerking van api.ai vanuit webhook alvorens terug te sturen
//app.post('/herokuai', function (req1, res1) {
//         try {
//         var requestBody = req1.action;
//         debugtekst = "herokuai webhook: " + requestBody.action;
//            } catch (err) {
//                console.error("Can't process request", err);
//                debugtekst = "herokuai webhook err: " + err;
//         }
//});


app.listen(REST_PORT, () => {
    console.log('Rest service ready on port ' + REST_PORT);
});

facebook.doSubscribeRequest();
subscribeToNokia();

pool.query("SELECT connect_wunderlist.fbuser, connect_wunderlist.access_token, wunderlist_lists.id FROM wunderlist_lists LEFT JOIN connect_wunderlist ON wunderlist_lists.fbuser = connect_wunderlist.fbuser").then(result => {
    result.rows.forEach(row => {
        wunderlist.createWebhook(row.access_token, row.id, HOSTNAME + 'webhook/wunderlist/' + row.fbuser);
    })
})