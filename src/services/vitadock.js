'use strict'

const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const request = require('request');

const HOSTNAME = process.env.HOSTNAME;

function queryStringToJSON (str) {
    var pairs = str.split('&');
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

let Vitadock = function(applicationToken, applicationSecret) {
    this._applicationToken = applicationToken;
    this._applicationSecret = applicationSecret;

    this._oAuth = new OAuth({
        consumer: {
            key: this._applicationToken,
            secret: this._applicationSecret
        },
        parameter_seperator: ',',
        signature_method: 'HMAC-SHA256',
        hash_function: function (base_string, key) {
            return crypto.createHmac('sha256', key).update(base_string).digest('base64');
        }
    });
};

Vitadock.prototype.getRequestUrl = function(callback) {
    callback = callback || function() {};

    let request_data = {
        url: 'https://cloud.vitadock.com/auth/unauthorizedaccesses',
        method: 'POST'
    };

    let oauth_header = this._oAuth.toHeader(this._oAuth.authorize(request_data));

    request({
        url: request_data.url,
        method: request_data.method,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: oauth_header.Authorization
        }
    }, function (error, response, body) {
        if (error) { callback(error); return; }
        let data = queryStringToJSON(body);
        console.log(data);
        callback(null, `https://cloud.vitadock.com/desiredaccessrights/request?oauth_token=${data.oauth_token}`, data.oauth_token, data.oauth_token_secret);
    });
};

Vitadock.prototype.authorizeAccessToken = function (accessToken, accessSecret, verifier, callback) {
    callback = callback || function () { };

    let request_data = {
        url: 'https://cloud.vitadock.com/auth/accesses/verify',
        method: 'POST',
        data: {
            oauth_verifier: verifier
        }
    };

    let token = {
        key: accessToken,
        secret: accessSecret
    };

    let oauth_header = this._oAuth.toHeader(this._oAuth.authorize(request_data, token));

    request({
        url: request_data.url,
        method: request_data.method,
        data: request_data.data,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: oauth_header.Authorization
        }
    }, function (error, response, body) {
        if (error) { return callback(error); }
        let data = queryStringToJSON(body);
        console.log(data);
        callback(error, data.oauth_token, data.oauth_token_secret);
    });
}

Vitadock.prototype.getData = function (accessToken, accessSecret, date_since, callback, start, max) {
    callback = callback || function () { };
    date_since = date_since || 0;
    start = start || 0
    max = max || 1000

    let request_data = {
        url: `https://cloud.vitadock.com/data/glucodockglucoses/sync?start=${start}&max=${max}&date_since=${date_since}`,
        method: 'GET',
    }

    let token = {
        key: accessToken,
        secret: accessSecret
    }

    let oauth_header = this._oAuth.toHeader(this._oAuth.authorize(request_data, token));

    request({
        url: request_data.url,
        method: request_data.method,
        headers: {
            'Accept': 'application/json',
            'Content-type': 'application/json',
            Authorization: oauth_header.Authorization
        }
    }, function (error, response, body) {
        if (error) { return callback(error) }
        let data = JSON.parse(body);
        callback(null, data);
    });
}

module.exports = Vitadock;