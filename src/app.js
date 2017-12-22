'use strict';

const apiai = require('apiai');
const jsforce = require('jsforce');
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
const Vitadock = require('./services/vitadock');

const sf12Answers = require('./data/sf12-answers');

const REST_PORT = (process.env.PORT || 5000);
const APIAI_ACCESS_TOKEN = process.env.APIAI_ACCESS_TOKEN;
const APIAI_LANG = process.env.APIAI_LANG || 'nl';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const NOKIA_API_KEY = process.env.NOKIA_API_KEY;
const NOKIA_API_SECRET = process.env.NOKIA_API_SECRET;
const WUNDERLIST_CLIENT_ID = process.env.WUNDERLIST_CLIENT_ID;
const WUNDERLIST_CLIENT_SECRET = process.env.WUNDERLIST_CLIENT_SECRET;
const VITADOCK_API_TOKEN = 'VAyawiKnhK8KwNPnM7Mjrw6hTb5RchEuivf7uXnvPAc2Ysjun7BxMz4AwkKo1eCm';
const VITADOCK_API_SECRET = 'lutENPhz51lEbAVJdPP2YR12i0Xv9wssW8rkMtaqLN8rVXYcmGvBoMwemoUcmCGT';
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

/** @const {Vitadock} Vitadock API interface */
const vitadock = new Vitadock(VITADOCK_API_TOKEN, VITADOCK_API_SECRET);

/** @const {jsforce} Salesforce API interface */
const salesforce = new jsforce.Connection();

/** @const {Map} Map of existing API.AI session ID's */
const sessionIds = new Map();

let recipeState = {};

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
        let /** string */ resolvedQuery = response.result.resolvedQuery;

        /** The API.AI intent @type {string} */
        let intent = response.result.metadata.intentId;
        let intentName = response.result.metadata.intentName;
        /** The API.AI action within an intent @type {string} */
        let action = response.result.action;
        /** Additional parameters passed by the intent @type {object} */
        let parameters = response.result.parameters;

        facebook.sendSenderAction(sender, 'typing_on');

        getOrRegisterUser(sender, 'FB').then(sender => {
            if (parameters.feedback) {
                let feedback = parameters.feedback === '👍' ? '+' : '-';
                pool.query('UPDATE log SET feedback = $1 WHERE client = $2 AND time = (select max(time) FROM log WHERE client = $2)', [feedback, sender]);
            } else {
                logAction(sender, intent, parameters);
            }

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
            } else {
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
                }
                ];
                console.log('Response as text message');

                // If the intent is one of a set of predefined "default" intents, someone needs to do a manual followup with this user.
                if (DEFAULT_INTENTS.includes(intent)) {
                    pool.query('SELECT handle FROM clients WHERE id = $1 AND type = \'SF\'', [sender]).then(result => {
                        let handle = result.rows[0].handle;
                        salesforce.sobject('Case')
                            .create({
                                AccountId: handle,
                                Status: 'New',
                                Origin: 'Smart Susan',
                                Subject: resolvedQuery,
                            },
                            function (err, ret) {
                                if (err || !ret.success) { return console.error(err, ret); }
                            });
                    });
                }

                switch (action) {
                    // User has answered a new PAM question
                    // TODO: Create some way of updating questionnares and questions that works on all questionnares
                    case "pam_sum":
                        let payload = response.result.payload;
                        let score = parameters.pam_score;

                        if (typeof score !== 'undefined') {
                            score = score || 0;
                            pool.query('SELECT id, salesforce_id FROM vragenlijsten WHERE client = $1 ORDER BY gestart DESC LIMIT 1', [sender])
                                .then(res => {
                                    let vragenlijst = res.rows[0].id;
                                    let salesforce_id = res.rows[0].salesforce_id;
                                    pool.query('SELECT * FROM antwoorden WHERE vragenlijst = $1', [vragenlijst])
                                        .then(res => {
                                            let answer_no = res.rowCount + 1;
                                            pool.query('INSERT INTO antwoorden (vragenlijst, waarde, antwoord_op, vraag) VALUES ($1, $2, (SELECT NOW()), $3)', [vragenlijst, score, answer_no]);
                                            if (isDefined(salesforce_id)) {
                                                pool.query('SELECT handle FROM clients WHERE id = $1 AND type = \'SF\'', [sender]).then(result => {
                                                    let handle = result.rows[0].handle;
                                                    salesforce.sobject('Questionnaire_Answer__c').create({
                                                        Account__c: handle,
                                                        Questionnaire__c: salesforce_id,
                                                        Question_Number__c: answer_no,
                                                        Score__c: score
                                                    },
                                                        function (err, ret) {
                                                            if (err || !ret.success) { return console.error(err, ret); }
                                                        })
                                                });
                                            }
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

                    case "SF12_sum":
                        let sf12Score = parameters.sf12_score;
                        if (typeof sf12Score !== 'undefined') {
                            sf12Score = sf12Score || 0;
                            pool.query('SELECT id, salesforce_id FROM vragenlijsten WHERE client = $1 ORDER BY gestart DESC LIMIT 1', [sender])
                                .then(res => {
                                    if (res.rowCount) {
                                        let vragenlijst = res.rows[0].id;
                                        let salesforce_id = res.rows[0].salesforce_id;
                                        pool.query('SELECT * FROM antwoorden WHERE vragenlijst = $1', [vragenlijst])
                                            .then(res => {
                                                let answer_no = res.rowCount + 1;
                                                pool.query('INSERT INTO antwoorden (vragenlijst, waarde, antwoord_op, vraag) VALUES ($1, $2, (SELECT NOW()), $3)', [vragenlijst, sf12Score, answer_no]);
                                                if (isDefined(salesforce_id)) {
                                                    pool.query('SELECT handle FROM clients WHERE id = $1 AND type = \'SF\'', [sender]).then(result => {
                                                        let handle = result.rows[0].handle;
                                                        let numericalSf12Score = sf12Score;
                                                        console.log(sf12Score, typeof sf12Score);
                                                        for (let list in sf12Answers) {
                                                            console.log(list);
                                                            if (sf12Answers.hasOwnProperty(list)) {
                                                                console.log('hasOwnProperty')
                                                                for (let item of sf12Answers[list]) {
                                                                    console.log(item.payload, sf12Score, typeof item.payload, typeof sf12Score, item.payload === sf12Score, item.payload == sf12Score, numericalSf12Score);
                                                                    if (item.payload == sf12Score) {
                                                                        numericalSf12Score = sf12Answers[list].indexOf(item)
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        console.log(numericalSf12Score, typeof numericalSf12Score);
                                                        salesforce.sobject('Questionnaire_Answer__c').create({
                                                            Account__c: handle,
                                                            Questionnaire__c: salesforce_id,
                                                            Question_Number__c: answer_no + 100,
                                                            Score__c: numericalSf12Score,
                                                            Answer_Text__c: sf12Score
                                                        },
                                                            function (err, ret) {
                                                                if (err || !ret.success) { return console.error(err, ret); }
                                                            })
                                                    });
                                                }
                                            });
                                    }
                                });
                        }


                        message.quick_replies = sf12Answers[parameters.question];
                        break;

                    // User wants to start a new questionnare
                    case "start_vragenlijst":
                        console.log(resolvedQuery);
                        if (resolvedQuery !== 'PAM_vragenlijst_start' && resolvedQuery !== 'SF12_vragenlijst_start') {
                            pool.query({ text: 'INSERT INTO vragenlijsten (client, vragenlijst) VALUES($1, $2)', values: [sender, parameters.vragenlijst] })
                                .catch(e => console.error(e, e.stack));
                        }
                        break;

                    // User wants to create a new wunderlist-list
                    case "create_wunderlist":
                        pool.query("SELECT * FROM connect_wunderlist WHERE client = $1", [sender]).then(result => {
                            let connection = result.rows[0];
                            wunderlist.createList(connection.access_token).done(list => {
                                pool.query("INSERT INTO wunderlist_lists (client, id, created_at) VALUES ($1, $2, $3)", [sender, list.id, list.created_at])
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
                                    }).catch(e => console.error(e, e.stack));;
                                wunderlist.createWebhook(connection.access_token, list.id, HOSTNAME + 'webhook/wunderlist/' + sender);
                            });
                        });
                        break;

                    // User wants to connect to a service
                    case "connect_service":
                        let service = response.result.parameters.service;
                        if (isDefined(service)) {
                            switch (service) {
                                case "Nokia":
                                    // Get a reqest token, and a login url to send to the user.
                                    nokia.getRequestUrl(sender, (error, url, oAuthToken, oAuthTokenSecret) => {
                                        if (!error) {
                                            pool.query('SELECT handle FROM clients WHERE id = $1 AND type = \'FB\'', [sender]).then(result => {
                                                let fbuser = result.rows[0].handle;
                                                facebook.sendMessage(fbuser, { text: url });
                                                pool.query('DELETE FROM connect_nokia WHERE client = $1', [sender]).then(() => {
                                                    pool.query('INSERT INTO connect_nokia (client, oauth_request_token, oauth_request_secret) VALUES ($1, $2, $3)', [sender, oAuthToken, oAuthTokenSecret])
                                                        .catch(e => console.error(e, e.stack));
                                                }).catch(e => console.error(e, e.stack));
                                            });
                                        }
                                    });
                                    break;
                                case "Wunderlist":
                                    message.text += '\n' + HOSTNAME + 'connect/wunderlist/' + sender;
                                    break;
                                case "Vitadock":
                                    vitadock.getRequestUrl((error, url, oAuthToken, oAuthTokenSecret) => {
                                        if (!error) {
                                            pool.query('SELECT handle FROM clients WHERE id = $1 AND type = \'FB\'', [sender]).then(result => {
                                                let fbuser = result.rows[0].handle;
                                                facebook.sendMessage(fbuser, { text: url });
                                                pool.query('DELETE FROM connect_vitadock WHERE client = $1', [sender]).then(() => {
                                                    pool.query('INSERT INTO connect_vitadock (client, oauth_request_token, oauth_request_secret) VALUES ($1, $2, $3)', [sender, oAuthToken, oAuthTokenSecret])
                                                        .catch(e => console.error(e, e.stack));
                                                }).catch(e => console.error(e, e.stack));
                                            });
                                        }
                                    })
                            }
                        }
                        break;
                    case "RecipeNameForLink":
                        if (parameters.RecipeNameToRecipeLink) {
                            pool.query('SELECT id, url, duration FROM recipes WHERE name = $1 LIMIT 1', [parameters.RecipeNameToRecipeLink.toLowerCase()]).then(result => {
                                recipeState[sender] = result.rows[0].id
                                let recipe = result.rows[0];
                                pool.query('SELECT handle FROM clients WHERE id = $1 AND type = \'FB\'', [sender]).then(result => {
                                    let fbuser = result.rows[0].handle;
                                    let request = apiAiService.eventRequest({
                                        name: 'RECIPE',
                                        data: {
                                            url: recipe.url,
                                            duration: recipe.duration
                                        }
                                    }, {
                                            sessionId: sessionIds.get(fbuser),

                                        });

                                    request.on('response', (response) => { handleResponse(response, fbuser); });
                                    request.on('error', (error) => console.error(error));
                                    request.end();
                                });
                            });
                        }
                        break;
                    case 'RecipeNameForLink.RecipeNameForLink-automatic.RecipeNameForLink-automatic-yes.RecipeNameForLink-automatic-yes-selectnumber':
                        let number = parameters.number;
                        pool.query("SELECT * FROM connect_wunderlist WHERE client = $1", [sender]).then(result => {
                            let connection = result.rows[0];
                            if (isDefined(connection)) {
                                pool.query('SELECT id from wunderlist_lists WHERE client = $1', [sender]).then(result => {
                                    if (result.rowCount) {
                                        addRecipeToList(result.rows[0].id, connection.access_token, recipeState[sender], number)
                                    } else {
                                        wunderlist.createList(connection.access_token).done(list => {
                                            pool.query("INSERT INTO wunderlist_lists (client, id, created_at) VALUES ($1, $2, $3)", [sender, list.id, list.created_at])
                                            addRecipeToList(list.id, connection.access_token, recipeState[sender], number);
                                        });
                                    }
                                })
                            }
                        });
                        break;
                    case "my_facebook_id":
                        message.text += '\n' + sender;
                        break;
                    default:
                        console.warn('Received an unknown action from API.ai: "' + action + '"');
                }

                console.log(action);
                console.log(sender);
                console.log(responseText);


                if (intentName === "Connected Wunderlist") {
                    message.quick_replies = [{
                        "content_type": "text",
                        "title": "Nieuwe lijst",
                        "payload": "Nieuwe lijst"
                    },
                    {
                        "content_type": "text",
                        "title": "Niet nu",
                        "payload": "Niet nu"
                    }];
                } else if (intentName === 'PAM_vragenlijst_einde') {
                    delete message.quick_replies;
                }

                if (isDefined(responseText)) {
                    // facebook API limit for text length is 640,
                    // so we must split message if needed
                    let splittedText = splitResponse(message.text);
                    // Send messages asynchronously, to ensure they arrive in the right order 
                    async.eachSeries(splittedText, (textPart, callback) => {
                        message.text = textPart;
                        pool.query('SELECT handle FROM clients WHERE id = $1 AND type = \'FB\'', [sender]).then(result => {
                            let fbuser = result.rows[0].handle;
                            console.log('found user ', fbuser, result.rows[0]);
                            facebook.sendMessage(fbuser, message, callback);
                        });
                    });
                } else {
                    facebook.sendSenderAction(sender, 'typing_off');
                }
            }

            // Some messages Have a custom payload, we need to handle this payload;
            response.result.fulfillment.messages.forEach(function (message) {
                let payload = message.payload;
                if (isDefined(payload)) {
                    /** @type {string} */
                    let followUp = payload.followUp;
                    /** @type {boolean} */
                    let vragenlijst_end = payload.vragenlijst_end;

                    if (isDefined(followUp)) {
                        pool.query('SELECT handle FROM clients WHERE id = $1 AND type = \'FB\'', [sender]).then(result => {
                            let fbuser = result.rows[0].handle;

                            let request = apiAiService.eventRequest({
                                name: followUp
                            }, {
                                    sessionId: sessionIds.get(fbuser)
                                });

                            request.on('response', (response) => { handleResponse(response, sender); });
                            request.on('error', (error) => console.error(error));
                            request.end();
                        });
                    }

                    if (isDefined(vragenlijst_end) && vragenlijst_end) {
                        pool.query('SELECT id FROM vragenlijsten WHERE client = $1 ORDER BY gestart DESC LIMIT 1', [sender]).then(res => {
                            let vragenlijst = res.rows[0].id;
                            pool.query('UPDATE vragenlijsten set gestopt = (SELECT NOW()) WHERE id = $1', [vragenlijst])
                        });
                    }
                }
            }, this);
        });
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

    if (types.length === 3 && types.includes(9) && types.includes(10) && types.includes(11)) {
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
    pool.query('SELECT *, extract(epoch from last_update) as time FROM connect_nokia WHERE client = $1 OR nokia_user = $1', [userid]).then(res => {
        let user = res.rows[0];
        nokia.getMeasurements(user.nokia_user, user.oauth_access_token, user.oauth_access_secret, user.time, measureGroups => {
            let measureTypes = [];
            let sentTypes = isDefined(user.sent_message) ? user.sent_message.split(',') : [];
            measureGroups.forEach(group => {
                let date = new Date(group.date * 1000).toISOString().slice(0, 19).replace('T', ' ');
                group.measures.forEach(measurement => {
                    let type = measurement.type;
                    let value = measurement.value * Math.pow(10, measurement.unit);
                    pool.query("SELECT * FROM clients WHERE id = $1 AND type = 'SF'", [user.client]).then(clientRes => {
                        if (clientRes.rowCount) {
                            let client = clientRes.rows[0];
                            measureTypes.push(type);
                            if (user && date && value) {
                                console.log('MEASUREMENT', type, user, date, value)
                                if (type === 9) {
                                    pool.query("INSERT INTO measure_blood (client, measure_date, diastolic) VALUES ($1, $2, $3) ON CONFLICT (client, measure_date) DO UPDATE SET diastolic = excluded.diastolic", [user.client, date, value]).then(res => {
                                        if (res.rowCount && res.rows[0].salesforce_id) {
                                            salesforce.sobject('Blood_Pressure_measurement__c')
                                                .update({
                                                    id: res.rows[0].salesforce_id,
                                                    Diastole_Blood_Pressure__c: value,
                                                    Date_Time_Measurement__c: Date(date).toISOString()
                                                }, function (err, ret) {
                                                    if (err || !ret.success) { return console.error(err, ret); }
                                                });
                                        } else {
                                            salesforce.sobject('Blood_Pressure_measurement__c')
                                                .create({
                                                    Diastole_Blood_Pressure__c: value,
                                                    Date_Time_Measurement__c: Date(date).toISOString()
                                                }, function (err, ret) {
                                                    if (err || !ret.success) { return console.error(err, ret); } else {
                                                        pool.query("UPDATE measure_blood SET salesforce_id = $1 WHERE client=$2 AND measure_date=$3", [ret.id, user.client, date])
                                                    }
                                                });
                                        }
                                    });
                                }
                                if (type === 10) {
                                    pool.query("INSERT INTO measure_blood (client, measure_date, systolic) VALUES ($1, $2, $3) ON CONFLICT (client, measure_date) DO UPDATE SET systolic = excluded.systolic", [user.client, date, value]).then(res => {
                                        if (res.rowCount && res.rows[0].salesforce_id) {
                                            salesforce.sobject('Blood_Pressure_measurement__c')
                                                .update({
                                                    id: res.rows[0].salesforce_id,
                                                    Systole_Blood_Pressure__c: value,
                                                    Date_Time_Measurement__c: Date(date).toISOString()
                                                }, function (err, ret) {
                                                    if (err || !ret.success) { return console.error(err, ret); }
                                                });
                                        } else {
                                            salesforce.sobject('Blood_Pressure_measurement__c')
                                                .create({
                                                    Systole_Blood_Pressure__c: value,
                                                    Date_Time_Measurement__c: Date(date).toISOString()
                                                }, function (err, ret) {
                                                    if (err || !ret.success) { return console.error(err, ret); } else {
                                                        pool.query("UPDATE measure_blood SET salesforce_id = $1 WHERE client=$2 AND measure_date=$3", [ret.id, user.client, date])
                                                    }
                                                });
                                        }
                                    });
                                }
                                if (type === 11) {
                                    pool.query("INSERT INTO measure_blood (client, measure_date, pulse) VALUES ($1, $2 $3) ON CONFLICT (client, measure_date) DO UPDATE SET pulse = excluded.pulse", [user.client, date, value]).then(res => {
                                        if (res.rowCount && res.rows[0].salesforce_id) {
                                            salesforce.sobject('Blood_Pressure_measurement__c')
                                                .update({
                                                    id: res.rows[0].salesforce_id,
                                                    Heartbeat__c: value,
                                                    Date_Time_Measurement__c: Date(date).toISOString()
                                                }, function (err, ret) {
                                                    if (err || !ret.success) { return console.error(err, ret); }
                                                });
                                        } else {
                                            salesforce.sobject('Blood_Pressure_measurement__c')
                                                .create({
                                                    Diastole_Blood_Pressure__c: value,
                                                    Heartbeat__c: value
                                                }, function (err, ret) {
                                                    if (err || !ret.success) { return console.error(err, ret); } else {
                                                        pool.query("UPDATE measure_blood SET salesforce_id = $1 WHERE client=$2 AND measure_date=$3", [ret.id, user.client, date])
                                                    }
                                                });
                                        }
                                    });
                                }
                                if (type === 1) {
                                    pool.query("INSERT INTO measure_weight (client, measure_date, weight) VALUES ($1, $2, $3) ON CONFLICT (client, measure_date) DO UPDATE SET weight = excluded.weight", [user.client, date, value]);
                                    salesforce.sobject('Weight_Measurements__c')
                                        .create({
                                            Account__c: client.handle,
                                            Date_Time_Measurement__c: Date(date).toISOString(),
                                            Value__c: value
                                        },
                                        function (err, ret) {
                                            if (err || !ret.success) { return console.error(err, ret); }
                                        });
                                }
                            }
                        }
                    });
                });
            })
            if (measureTypes.length > 0) {
                sendMeasurementMessage(measureTypes, user.client);
                measureTypes.forEach(type => {
                    let namedType = '';
                    if (type === 9 || type === 10 || type === 11) {
                        namedType = 'blood';
                    } else if (type === 1) {
                        namedType = 'weight';
                    }
                    let index = sentTypes.indexOf(namedType);
                    if (index > -1) {
                        sentTypes.splice(index, 1);
                    }
                })
            }

            pool.query('UPDATE connect_nokia SET last_update = (SELECT NOW()), sent_message = $1 WHERE client = $2 OR nokia_user = $2', [sentTypes.join(), userid]);
        });
    });
}

/**
 * Subscribe to nokia notifications either for a specific user, or for all users at once
 * @param {string|null} user User id to subscribe to, or null to subscribe to all users
 */
function subscribeToNokia(user) {
    let query = { text: 'SELECT * FROM connect_nokia' };
    if (isDefined(user)) {
        query.text += ' WHERE client = $1';
        query.values = [user];
    }
    pool.query(query).then(res => {
        res.rows.forEach(row => {
            nokia.subscribe(row.nokia, row.oauth_access_token, row.oauth_access_secret, 1, (error, responseData) => { if (error) console.log(error); });
            nokia.subscribe(row.nokia, row.oauth_access_token, row.oauth_access_secret, 4, (error, responseData) => { if (error) console.log(error); });

            // Get measurements, so that we have current data and don't have to wait for a new measurement to be made to be up to date
            getNokiaMeasurements(row.client);
        });
    })
}

/**
 * Subscribes to all Wunderlist lists.
 */
function subscribeToWunderlist() {
    pool.query("SELECT connect_wunderlist.client, connect_wunderlist.access_token, wunderlist_lists.id FROM wunderlist_lists LEFT JOIN connect_wunderlist ON wunderlist_lists.client = connect_wunderlist.client").then(result => {
        result.rows.forEach(row => {
            wunderlist.createWebhook(row.access_token, row.id, HOSTNAME + 'webhook/wunderlist/' + row.client);
        })
    })
}


/**
 * Checks if an object is either undefined or falsy
 * @param {any} obj Object to check
 * @returns {boolean} True if defined an thruthy, false if not defined or falsy
 */
function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

function createNewClient(handle, type) {
    let id = uuid.v4();
    return pool.query("INSERT INTO clients (id, handle, type, registration_date) VALUES ($1, $2, $3, (SELECT NOW()))", [id, handle, type])
        .then(res => {
            facebook.getProfile(handle, (profile) => {
                salesforce.sobject('Account').create({
                    name: profile.first_name + ' ' + profile.last_name,
                    RecordTypeId: '0120Y0000015YRyQAM',
                    GUID__c: id
                }, function (err, ret) {
                    if (err || !ret.success) { return console.error(err, ret); }
                    pool.query('INSERT INTO clients (id, handle, type, registration_date) VALUES ($1, $2, $3, (SELECT NOW()))', [id, ret.id, 'SF'])
                });
            });
            return id;
        });
}

function getOrRegisterUser(handle, type) {
    return pool.query("SELECT * FROM clients WHERE handle = $1 or id = $1", [handle]).then(res => {
        if (!res.rowCount) {
            return createNewClient(handle, 'FB');
        } else {
            return res.rows[0].id;
        }
    });
}

function logAction(user, intent, parameters) {
    if ('ignore' in parameters) {
        delete parameters['ignore'];
    }
    return pool.query("INSERT INTO log (client, intent, parameters, time) VALUES ($1, $2, $3, (SELECT NOW()))", [user, intent, JSON.stringify(parameters)]);
}

function addRecipeToList(list, accessToken, recipe, number) {
    pool.query('SELECT * FROM ingredients WHERE recipe = $1', [recipe]).then(result => {
        result.rows.forEach(row => {
            let item = "";
            if (row.amount) {
                item += (row.amount * number).toString();
                if (row.unit) {
                    item += ' ' + row.unit;
                }
            }
            item += ' ' + row.name

            console.log(item);

            wunderlist.createTask(list, accessToken, item);
        });
    });
}

function getVitaDockData(client, types) {
    types = types || [0, 1, 4];
    pool.query('SELECT *, extract(epoch from last_update) as time FROM connect_vitadock WHERE client = $1', [client]).then(result => {
        let userOAuth = result.rows[0];
        pool.query('SELECT handle FROM clients WHERE id = $1 AND type = \'SF\'', [client]).then(result => {
            let handle = result.rows[0].handle;
            for (let type of types) {
                vitadock.getData(userOAuth.oauth_access_token, userOAuth.oauth_access_secret, type, Math.round(userOAuth.time * 1000), (error, data) => {
                    if (error) { console.log(error); return; }
                    for (let item of data) {
                        let date = new Date(item.measurementDate);
                        if (type === 0) {
                            salesforce.sobject('Blood_Pressure_Measurement__c').create({
                                Account__c: handle,
                                Diastole_Blood_Pressure__c: item.diastole,
                                Systole_Blood_Pressure__c: item.systole,
                                Heartbeat__c: item.pulse,

                                Date_Time_Measurement__c: date.toISOString(),
                            },
                                function (err, ret) {
                                    if (err || !ret.success) { return console.error(err, ret); }
                                });
                        }
                        else if (type === 1) {
                            salesforce.sobject('Glucose_Measurement__c').create({
                                Account__c: handle,
                                Blood_Glucose__c: item.bloodGlucose,
                                Date_Time_Measurement__c: date.toISOString(),
                            },
                                function (err, ret) {
                                    if (err || !ret.success) { return console.error(err, ret); }
                                });
                        } else if (type === 4) {
                            salesforce.sobject('Weight_Measurements__c').create({
                                Account__c: handle,
                                Value__c: item.bodyWeight,
                                BMI__c: item.bmi,
                                Body_Fat_Percentage__c: item.bodyFat,
                                Body_Water_Percentage__c: item.bodyWater,
                                Bone_Mass_Percentage__c: item.boneMass,
                                Muscle_Mass_Percentage__c: item.muscleMass,
                                Date_Time_Measurement__c: date.toISOString(),
                            },
                                function (err, ret) {
                                    if (err || !ret.success) { return console.error(err, ret); }
                                });
                        }
                    }
                });
            }
            pool.query('UPDATE connect_vitadock SET last_update = (SELECT NOW()) WHERE client = $1', [client]);
        })
    });
}

function queryStringToJSON(str, sep) {
    sep = sep || '&'
    var pairs = str.split(sep);
    var result = {};
    pairs.forEach(function (pair) {
        pair = pair.split('=');
        var name = pair[0]
        var value = pair[1]
        if (name.length)
            if (result[name] !== undefined) {
                if (!result[name].push) {
                    result[name] = [result[name]];
                }
                result[name].push(value || '');
            } else {
                result[name] = value || '';
            }
    });
    return (result);
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

app.use('/static', express.static(path.resolve(__dirname, '../public')));
app.use('/portal', require('./portal'));

// Server frontpage
app.get('/', function (req, res) {
    res.send('This is Paula');
});

// Callback URL a user is sent to after logging in to their NOKIA Health account and authorized Paula
app.get('/connect/nokia/:clientId', (req, res) => {
    try {
        let client = req.params.clientId;
        let userid = req.query.userid;
        let oAuthToken = req.query.oauth_token;
        let oAuthVerifier = req.query.oauth_verifier;

        pool.query("SELECT * FROM connect_nokia WHERE client = $1", [client])
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

                        pool.query('UPDATE connect_nokia SET oauth_access_token = $1, oauth_access_secret = $2, nokia_user = $3, last_update = \'epoch\' WHERE client = $4', [oAuthToken, oAuthTokenSecret, userid, client]).then(() => {
                            pool.query("SELECT handle FROM clients WHERE id = $1 AND type = 'FB'", [client]).then(result => {
                                let handle = result.rows[0].handle;

                                if (!sessionIds.has(handle)) {
                                    sessionIds.set(handle, uuid.v1());
                                }

                                let request = apiAiService.eventRequest({
                                    name: 'nokia_connected'
                                }, {
                                        sessionId: sessionIds.get(handle)
                                    });

                                request.on('response', (response) => { handleResponse(response, client); });
                                request.on('error', (error) => console.error(error));

                                request.end();
                                subscribeToNokia(client);
                            })
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

// Page a user is sent to by Paula to connect to Wunderlist. Redirects to the wunderlist Login page
app.get('/connect/wunderlist/:clientId', (req, res) => {
    res.cookie('client', req.params.clientId, { maxAge: 1000 * 60 * 15, httpOnly: true })
        .redirect(wunderlist.getAuthUri());
});

// Callback URL a user is sent to after logging in to their Wunderlist account and authorized Paula
app.get('/connect/wunderlist/', (req, res) => {
    try {
        let user = req.cookies.client;
        let code = req.query.code;
        wunderlist.getAccessToken(code, user,
            accessToken => {
                pool.query('INSERT INTO connect_wunderlist (client, access_token) VALUES ($1, $2) ON CONFLICT (client) DO UPDATE SET access_token = excluded.access_token', [user, accessToken])
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
                    }, (err) => { res.status(400).json(err); });
            });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
});

app.get('/connect/vitadock', (req, res) => {
    try {
        let oAuthToken = req.query.oauth_token;
        let oAuthVerifier = req.query.oauth_verifier;

        pool.query("SELECT * FROM connect_vitadock WHERE oauth_request_token = $1", [oAuthToken])
            .then(result => {
                let userOAuth = result.rows[0];
                let client = userOAuth.client;
                vitadock.authorizeAccessToken(
                    userOAuth.oauth_request_token,
                    userOAuth.oauth_request_secret,
                    oAuthVerifier,
                    (error, oAuthRequestToken, oAuthRequestTokenSecret) => {
                        if (error) {
                            console.log(error);
                            response.end(JSON.stringify({
                                message: 'Error occured while getting access token',
                                error: error
                            }));
                            return;
                        }

                        pool.query('UPDATE connect_vitadock SET oauth_access_token = $1, oauth_access_secret = $2, last_update = \'epoch\' WHERE oauth_request_token = $3', [oAuthRequestToken, oAuthRequestTokenSecret, oAuthToken]).then(() => {
                            pool.query("SELECT handle FROM clients WHERE id = $1 AND type = 'FB'", [client]).then(result => {
                                let handle = result.rows[0].handle;

                                if (!sessionIds.has(handle)) {
                                    sessionIds.set(handle, uuid.v1());
                                }

                                let request = apiAiService.eventRequest({
                                    name: 'vitadock_connected'
                                }, {
                                        sessionId: sessionIds.get(handle)
                                    });

                                request.on('response', (response) => { handleResponse(response, client); });
                                request.on('error', (error) => console.error(error));

                                request.end();
                                getVitaDockData(client);
                            });
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

// Facebook API webhook
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

// Facebook API webhook
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

// Scheduler Webhook
app.post('/webhook/scheduler', (req, res) => {
    // Get last measurements from a user, if their last measurement for that type is longer then a week ago.
    pool.query('SELECT * FROM (' +
        '(SELECT distinct on (client) measure_blood.client, \'blood\' as measurement_type, measure_date, sent_message FROM measure_blood LEFT JOIN connect_nokia ON measure_blood.client = connect_nokia.client ORDER BY client, measure_date DESC)' +
        'UNION ALL ' +
        '(SELECT distinct on (client) measure_weight.client, \'weight\' as measurement_type, measure_date, sent_message FROM measure_weight LEFT JOIN connect_nokia ON measure_weight.client = connect_nokia.client ORDER BY client, measure_date DESC)' +
        ') as latest_records WHERE measure_date < (CURRENT_DATE - INTERVAL \'1 week\')').then(result => {
            let send = {}
            result.rows.forEach(row => {
                // Define what messages we need to send
                let user = row.client;
                let sent = isDefined(row.sent_message) ? row.sent_message.split(',') : [];
                let type = row.measurement_type;
                if (!(user in send)) {
                    send[user] = []
                }
                // Don't send a message if we've already sent one for this measurement
                if (!sent.includes(type)) {
                    send[user].push(type);
                }
            });
            for (let user in send) {
                if (!send.hasOwnProperty(user)) continue;

                if (!sessionIds.has(user)) {
                    sessionIds.set(user, uuid.v1());
                }

                send[user].forEach(type => {
                    pool.query('SELECT registration_date FROM clients WHERE registration_date < (CURRENT_DATE - INTERVAL \'1 week\') LIMIT 1')
                        .then(res => {
                            if (res.rowCount > 0) {
                                let request = apiAiService.eventRequest({
                                    name: 'old_measurement_' + type
                                }, {
                                        sessionId: sessionIds.get(user)
                                    });
                                request.on('response', (response) => { handleResponse(response, user); });
                                request.on('error', (error) => console.error(error));
                                request.end();

                                pool.query('SELECT sent_message FROM connect_nokia WHERE client = $1', [user]).then(result => {
                                    let userRecord = result.rows[0];
                                    let sentTypes = userRecord.sent_message.split(',');
                                    if (!sentTypes.includes(type)) {
                                        sentTypes.push(type);
                                    }
                                    pool.query('UPDATE connect_nokia SET sent_message = $1 WHERE client = $2', [sentTypes.join(), user]);
                                });
                            }
                        });
                });
            }
        });
    res.status(200).send()
});

// NOKIA Health Webhook
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

// Wunderlist Webhook
app.all('/webhook/wunderlist/:client', (req, res) => {
    try {
        let user = req.params.client;
        let body = JSON.parse(req.body);

        let operation = body.operation;
        let list = body.subject.parents[0].id;
        let id = body.subject.id;
        let item = body.after.title;
        let created_at = body.after.created_at;
        let completed_at = body.after.completed_at;
        let completed = body.after.completed;

        switch (operation) {
            case 'create':
                pool.query('INSERT INTO wunderlist_items (list, id, item, date_added) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET item = $1', [list, id, item, created_at]);
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

app.post('/webhook/salesforce', (req, res) => {
    let body = JSON.parse(req.body); 

    let user = body.UID;
    let intent = body.Intent;
    let response = body.Response;
    let subject = body.Subject;
    let questionnaire = body.Questionnaire;

    if (isDefined(user)) {
        pool.query("SELECT * FROM clients WHERE id = $1 OR handle = $1 AND type = 'SF' LIMIT 1", [user])
            .then(result => {
                if (result.rowCount) {
                    pool.query("SELECT * FROM clients WHERE id = $1 AND type = 'FB' LIMIT 1", [result.rows[0].id]).then(result => {
                        let id = result.rows[0].id;
                        let handle = result.rows[0].handle;
                        let type = result.rows[0].type;

                        if (!sessionIds.has(handle)) {
                            sessionIds.set(handle, uuid.v1());
                        }
                        if (isDefined(intent)) {
                            let request = apiAiService.eventRequest({
                                name: intent,
                            }, {
                                    sessionId: sessionIds.get(handle)
                                });

                            request.on('response', (response) => { handleResponse(response, handle); });
                            request.on('error', (error) => console.error(error));

                            if (isDefined(questionnaire)) {
                                let type;
                                if (intent.includes('PAM')) {
                                    type = 'PAM';
                                } else if (intent.includes('SF12')) {
                                    type = 'SF12';
                                }
                                pool.query('INSERT INTO vragenlijsten (client, vragenlijst, salesforce_id) VALUES ($1, $2, $3)', [id, type, questionnaire])
                            }

                            request.end();
                            res.status(200).send();
                        } else if (isDefined(response) && isDefined(subject)) {
                            facebook.sendMessage(handle, { text: 'Je vroeg "' + subject + '"' },
                                () => {
                                    facebook.sendMessage(handle, { text: response });
                                });
                            res.sendStatus(200);
                        } else {
                            console.error('Nothing given to respond...');
                            res.status(400).send('Nothing to respond...');
                        }

                    });
                } else {
                    console.error('User does not exist! ', user);
                    res.status(400).send('User does not exist!');
                }
            });
    } else {
        console.error('No user Defined ');
        res.status(400).send('No user given');
    }
});

app.all('/webhook/vitadock', (req, res) => {
    if (req.query.module_id === '0' || req.query.module_id === '1' || req.query.module_id === '4') {
        let authorization = queryStringToJSON(req.headers.authorization.substr(6), ',');    
        pool.query('SELECT client FROM connect_vitadock WHERE oauth_access_token = $1', [JSON.parse(authorization.oauth_token)]).then(result => {
            getVitaDockData(result.rows[0].client, [JSON.parse(req.query.module_id)]);
        });
    }
    res.status(200).send('OK');
});

app.listen(REST_PORT, () => {
    console.log('Rest service ready on port ' + REST_PORT);
});


salesforce.login('apiuser@radbouddiabetes.trial', 'REshape911', (err, userInfo) => {
    if (err) { return console.error(err); }
    // Subscribe to the facebook API
    facebook.doSubscribeRequest();
    // Subscribe to all Nokia Users
    subscribeToNokia();
    //Subscribe to all Wunderlist lists
    subscribeToWunderlist();
});