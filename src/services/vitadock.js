'use strict'

const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const request = require('request');
const qs = require('querystring');

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
        signature_method: 'HMAC_SHA256',
        hash_function: function(base_string, key) {
            return crypto.createHmac('sha256', key).update(base_string).digest('base64');
        }
    });
};

Vitadock.prototype.getRequestUrl = function(fbUser, callback) {
    callback = callback || function() {};

    request.post({
        url: 'https://test-cloud.vitadock.com/auth/unauthorizedaccesses',
        oauth: { consumer_key: this._applicationToken, consumer_secret: this._applicationSecret, signature_method: 'HMAC-SHA256' }
    }, function(error, response, body) {
        var req_data = qs.parse(body)
        console.log(error, req_data, body);
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