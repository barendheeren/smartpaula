'use strict'

const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const request = require('request');

const HOSTNAME = process.env.HOSTNAME;

let Vitadock = function(applicationToken, applicationSecret, callbackUrl) {
    this._applicationToken = applicationToken;
    this._applicationSecret = applicationSecret;
    this._callbackUrl = callbackUrl;

    this._oAuth = new OAuth({
        consumer: {
            key: this._applicationToken,
            secret: this._applicationSecret
        },
        signature_method: 'HMAC-SHA256',
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
        data: {}
    };

    var oauth_header = this._oAuth.toHeader(this._oAuth.authorize(request_data, {
        key: this._applicationToken,
        secret: this._applicationSecret
    }));

    console.log(oauth_header);

    request.post({
        url: 'https://test-cloud.vitadock.com/auth/unauthorizedaccesses',
        headers: [
            oauth_header,
        ]
    }, function(error, response, body) {
        console.log(error, body);
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