'use strict';

const apiai = require('apiai');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('node-uuid');
const request = require('request');
const JSONbig = require('json-bigint');
const async = require('async');
const pg = require('pg');

const REST_PORT = (process.env.PORT || 5000);
const APIAI_ACCESS_TOKEN = process.env.APIAI_ACCESS_TOKEN;
const APIAI_LANG = process.env.APIAI_LANG || 'nl';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

const apiAiService = apiai(APIAI_ACCESS_TOKEN, {language: APIAI_LANG, requestSource: "fb"});
const sessionIds = new Map();

const DEFAULT_INTENTS = ['57b82498-053c-4776-8be9-228c420e6c13', 'b429ecdc-21f4-4a07-8165-3620023185ba'];
const DEFAULT_INTENT_REFER_TO = '1581441435202307';

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
        let apiaiRequest = apiAiService.textRequest(text,
            {
                sessionId: sessionIds.get(sender)
            });
        //receive message from api.ai
        apiaiRequest.on('response', (response) => {
            if (isDefined(response.result)) {
                let responseText = response.result.fulfillment.speech;
                let responseData = response.result.fulfillment.data;
                let resolvedQuery = response.result.resolvedQuery
                let action = response.result.action; //actie in intent
                let intent = response.result.metadata.intentId;

                console.log(response.result);
                response.result.fulfillment.messages.forEach(function(element) {
                    console.log(element);
                }, this);

                if (isDefined(responseData) && isDefined(responseData.facebook)) {
                    if (!Array.isArray(responseData.facebook)) {
                        try {
                            console.log('Response as formatted message');
                            sendFBMessage(sender, responseData.facebook + ' geformatteerd bericht');
                        } catch (err) {
                            sendFBMessage(sender, {text: err.message});
                        }
                    } else {
                        responseData.facebook.forEach((facebookMessage) => {
                            try {
                                if (facebookMessage.sender_action) {
                                    console.log('Response as sender action');
                                    //sendFBMessage(sender, ' debug fb action: ' + sender_action);
                                    sendFBSenderAction(sender, facebookMessage.sender_action);
                                }
                                else {
                                    console.log('Response as formatted message');
                                    sendFBMessage(sender, facebookMessage + ' geformatteerd bericht 2');
                                }
                            } catch (err) {
                                sendFBMessage(sender, {text: err.message});
                            }
                        });
                    }
                //hier komen de standaard tekst antwoorden van api.ai terecht
                } else if (isDefined(responseText)) {
                    let message = {text: responseText};
                    let quickReplies = [
                        {
                            "content_type":"text",
                            "title":"😁",
                            "payload":"4"
                        },
                        {
                            "content_type":"text",
                            "title":"🙂",
                            "payload":"3"
                        },
                        {
                            "content_type":"text",
                            "title":"😞",
                            "payload":"2"
                        },
                        {
                            "content_type":"text",
                            "title":"😡",
                            "payload":"1"
                        },
                        {
                            "content_type":"text",
                            "title":"N.v.t",
                            "payload":"0"
                        }
                    ];
                    console.log('Response as text message');

                    // Controleer of het antwoord uit de default intents voortkomt. Zo ja, stuur de vraag dan door.
                    if(DEFAULT_INTENTS.includes(intent)){
                        getFBProfile(sender, (profile) => {
                            // Disabled while in development
                            // sendFBMessage(DEFAULT_INTENT_REFER_TO, {text:'Hallo, ik heb een vraag gekregen van ' + profile.first_name + ' ' + profile.last_name + ' die ik niet kan beantwoorden:\n "' + resolvedQuery + '"'})
                            console.log('Default intent')
                        });
                    }

                    //achterhaal of er intelligentie nodig is
                    var speech ="";
                    switch(action) {
                        case "who_are_you": //check if user is known
                            speech += action;
                        break;
                        case "pam_sum": //calculate PAM score
                            speech += response.result.parameters.pam_score;
                            
                            //hoe geef je waarde aan api.ai variabele?
                            //apiaiRequest.contexts.pam_sum.paramaters.pam_total += response.result.parameters.pam_score
                        break;
                        default:
                            speech += 'Sorry, de actie is niet bekend.';
                    }
  
                    // facebook API limit for text length is 640,
                    // so we must split message if needed
                    var splittedText = splitResponse(responseText);

                    async.eachSeries(splittedText, (textPart, callback) => {
                        //sendFBMessage(sender, {text: textPart + ' debug callback: ' + speech}, callback);
                        sendFBMessage(sender, message, callback);
                    });
                }

            }
        });
        apiaiRequest.on('error', (error) => console.error(error));
        apiaiRequest.end();
    }
}

function splitResponse(str) {
    if (str.length <= 640) {
        return [str];
    }

    return chunkString(str, 640);
}

function chunkString(s, len) {
    var curr = len, prev = 0;

    var output = [];

    while (s[curr]) {
        if (s[curr++] == ' ') {
            output.push(s.substring(prev, curr));
            prev = curr;
            curr += len;
        }
        else {
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

function getFBProfile (facebookId, callback) {
    request({
        url: 'https://graph.facebook.com/v2.6/' + facebookId,
        qs: {access_token: FB_PAGE_ACCESS_TOKEN},
        method: 'GET'
    }, (error, response, body) => {
        if (error) {
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        } else if (callback) {
            callback(JSON.parse(body));
        }
    });
}

function sendFBMessage(sender, messageData, callback) {
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: FB_PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
            recipient: {id: sender},
            message: messageData
        }
    }, (error, response, body) => {
        if (error) {
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }

        if (callback) {
            callback();
        }
    });
}

function sendFBSenderAction(sender, action, callback) {
    setTimeout(() => {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {access_token: FB_PAGE_ACCESS_TOKEN},
            method: 'POST',
            json: {
                recipient: {id: sender},
                sender_action: action
            }
        }, (error, response, body) => {
            if (error) {
                console.log('Error sending action: ', error);
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
            if (callback) {
                callback();
            }
        });
    }, 1000);
}

function doSubscribeRequest() {
    request({
            method: 'POST',
            uri: "https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=" + FB_PAGE_ACCESS_TOKEN
        },
        (error, response, body) => {
            if (error) {
                console.error('Error while subscription: ', error);
            } else {
                console.log('Subscription result: ', response.body);
            }
        });
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
app.use(bodyParser.text({type: 'application/json'})); //geen response als deze weggelaten wordt
app.use(bodyParser.urlencoded({extended: false})); //toegevoegd: heeft invloed verwerking event
app.use(bodyParser.json()); //toegevoegd: corrigeert de werking weer

pg.defaults.ssl = true; //

var debugtekst = "";

// Server frontpage
app.get('/', function (req, res) {
        res.send('This is Paula');
        });

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

doSubscribeRequest();
