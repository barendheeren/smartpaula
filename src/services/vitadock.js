'use strict'

const crypto = require('crypto');
const request = require('request');
const passport = require('passport');
const OAuth1Strategy = require('passport-oauth1').Strategy;

const HOSTNAME = process.env.HOSTNAME;

let Vitadock = function(applicationToken, applicationSecret, callbackUrl) {
    this._applicationToken = applicationToken;
    this._applicationSecret = applicationSecret;
    this._callbackUrl = callbackUrl;

    passport.use(new OAuth1Strategy({
            requestTokenURL: 'https://test-cloud.vitadock.com/auth/unauthorizedaccesses',
            accessTokenURL: 'https://www.example.com/oauth/access_token',
            userAuthorizationURL: 'https://www.example.com/oauth/authorize',
            consumerKey: this._applicationKey,
            consumerSecret: this._applicationSecret,
            callbackUrl: HOSTNAME + 'callback/vitadock',
            signatureMethod: "HMAC-SHA256"
        },
        function(token, tokenSecret, profile, cb) {
            console.log(token, tokenSecret, profile, cb)
        }
    ));
};

Vitadock.prototype.getRequestUrl = function(fbUser, callback) {
    callback = callback || function() {};

    passport.authenticate('oauth');
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