'use strict';

const request = require('request');

let Facebook = function (verifyToken, pageAccessToken) {
    this._verifyToken = verifyToken;
    this._pageAccessToken = pageAccessToken;
};

Facebook.prototype.sendSenderAction = function (sender, action, callback) {
    setTimeout(() => {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: this._pageAccessToken
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
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
};

/**
 * Subscribe to the facebook message service
 */
Facebook.prototype.doSubscribeRequest = function () {
    request({
            method: 'POST',
            uri: "https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=" + this._pageAccessToken
        },
        (error, response, body) => {
            if (error) {
                console.error('Error while subscription: ', error);
            } else {
                console.log('Subscription result: ', response.body);
            }
        });
};

/**
 * Sends a chat message to a facebook user
 * @param {number} sender Facebook user id to send the message to
 * @param {object} messageData Message data to send
 * @param {function} callback Callback function, called when the sending has completed (failed or succeeded)
 */
Facebook.prototype.sendMessage = function (sender, messageData, callback) {
    this.sendSenderAction(sender, 'typing_off', () => {
        setTimeout(() => {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {
                    access_token: this._pageAccessToken
                },
                method: 'POST',
                json: {
                    recipient: {
                        id: sender
                    },
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
            }, 5000);
        });
    });
};

/**
 * Fetches basic facebook user data (name, gender, age)
 * @param {number} facebookId Facebook Id to find user data for
 * @param {function} callback Callback function, called with the user's profile
 */
Facebook.prototype.getProfile = function (facebookId, callback) {
    request({
        url: 'https://graph.facebook.com/v2.6/' + facebookId,
        qs: {
            access_token: this._pageAccessToken
        },
        method: 'GET'
    }, (error, response, body) => {
        if (error) {
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
            callback(JSON.parse(body));
        } else if (callback) {
            callback(JSON.parse(body));
        }
    });
};

module.exports = Facebook;