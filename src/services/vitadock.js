'use strict'

const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const request = require('request');

const HOSTNAME = process.env.HOSTNAME;

let Vitadock = function(applicationToken, applicationSecret, callbackUrl) {
    this._applicationToken = applicationToken;
    this._applicationSecret = applicationSecret;
    this._callbackUrl = callbackUrl;

    this._oAuth = new OAuth.OAuth({
        consumer: {
            key: this._applicationToken,
            secret: this._applicationSecret
        },
        signature_method: 'HMAC_SHA256',
        hash_function: function(base_string, key) {
            return crypto.createHmac('sha256', key).update(base_string).digest('base64');
        }
    });
};

Vitadock.prototype.getRequestUrl = function(fbUser, callback) {
    callback = callback || function() {};

    var request_data = {
        url: 'https://test-cloud.vitadock.com/auth/unauthorizedaccesses',
        method: 'POST',
        data: {
            oauth_callback: HOSTNAME + 'bah'
        }
    };

    request({
        url: request_data.url,
        type: request_data.method,
        headers: OAuth.toHeader(OAuth.authorize(request_data, {
            key: this._applicationToken,
            secret: this._applicationSecret
        }))
    }, function(error, response, body) {
        console.log(error, response, body);
    });
    /**
    this._oAuth.getOAuthRequestToken((error, oAuthToken, oAuthTokenSecret, results) => {
        let authUrl = 'https://test-cloud.vitadock.com/desiredaccessrights/request?' +
            'oauth_consumer_key=' + this._applicationToken +
            '&oauth_token=' + oAuthToken;
        if (error) {
            callback(error);
            return;
        }
        callback(null, authUrl, oAuthToken, oAuthTokenSecret);
    });
     */
};

module.exports = Vitadock;