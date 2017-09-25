'use strict'

const OAuth = require('oauth');

const HOSTNAME = process.env.HOSTNAME;

let Vitadock = function(applicationToken, applicationSecret, callbackUrl) {
    this._applicationToken = applicationToken;
    this._applicationSecret = applicationSecret;
    this._callbackUrl = callbackUrl;

    this._oAuth = new OAuth.OAuth(
        'https://cloud.vitadock.com/auth/unauthorizedaccesses',
        'https://cloud.vitadock.com/auth/accesses/verify',
        this._applicationToken,
        this._applicationSecret,
        '1.0',
        this._callbackUrl,
        'HMAC-SHA1'
    );
    console.log(this._oAuth);
};

Vitadock.prototype.getRequestUrl = function(fbUser, callback) {
    callback = callback || function() {};
    console.log(this);
    this._oAuth.getOAuthRequestToken((error, oAuthToken, oAuthTokenSecret, results) => {
        let authUrl = 'http://localhost/desiredaccessrights/request?' +
            'oauth_consumer_key=' + this._apiKey +
            '&oauth_token=' + oAuthToken;
        if (error) {
            callback(error);
            return;
        }
        callback(null, authUrl, oAuthToken, oAuthTokenSecret);
    });
};

module.exports = Vitadock;