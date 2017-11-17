const request = require('request');
const ClientOAuth2 = require('client-oauth2');
const WunderlistSDK = require('wunderlist');

/**
 * Create a new Wunderlist API object
 * @param {string} clientId Your Wunderlist client ID
 * @param {string} clientSecret Your Wunderlist Client secret
 * @param {string} redirectUri URL a user is sent to after login in to Wunderlist and authorizing your app
 * @see https://developer.wunderlist.com/documentation
 */
let Wunderlist = function (clientId, clientSecret, redirectUri) {
    this._clientId = clientId;
    this._clientSecret = clientSecret;
    this._redirectUri = redirectUri;

    this._wunderlistAuth = new ClientOAuth2({
        clientId: clientId,
        clientSecret: clientSecret,
        accessTokenUri: 'https://www.wunderlist.com/oauth/access_token',
        authorizationUri: 'https://www.wunderlist.com/oauth/authorize',
        redirectUri: redirectUri
    });
};

Wunderlist.prototype.getAuthUri = function () {
    return this._wunderlistAuth.code.getUri();
};

Wunderlist.prototype.getAccessToken = function (code, userId, callback) {
    return request({
        url: 'https://www.wunderlist.com/oauth/access_token',
        method: 'POST',
        json: true,
        body: {
            client_id: this._clientId,
            client_secret: this._clientSecret,
            code: code
        }
    }, (error, response, body) => {
        console.log(error, body);
        if (callback) {
            callback(body.access_token);
        }
    });
};

/**
 * Create a new Wunderlist for a user.
 * @param {string} accessToken Access Token for the user the list should be created for.
 */
Wunderlist.prototype.createList = function (accessToken) {
    let wunderlistAPI = new WunderlistSDK({
        'accessToken': accessToken,
        'clientID': this._clientId
    });

    // TODO Add title as argument for this function
    return wunderlistAPI.http.lists.create({ title: 'Mijn boodschappen' })
        .done(function (listData, statusCode) {
            console.log(listData, statusCode);
            if (statusCode === 200) {
                return listData;
            }
        })
        .fail(function (resp, code) {
            console.log(resp);
        });
};

/**
 * Create a new task in a list for a user
 * @param {int} list List id to add the task to
 * @param {string} accessToken Access Token for the user the list should be created for.
 * @param {string} task Content of the task
 */
Wunderlist.prototype.createTask = function (list, accessToken, task) {
    let wunderlistAPI = new WunderlistSDK({
        'accessToken': accessToken,
        'clientID': this._clientId
    });

    return wunderlistAPI.http.tasks.create({ list_id: list, title: task })
        .done(function (listData, statusCode) {
            console.log(listData, statusCode);
            if (statusCode === 200) {
                return listData;
            }
        })
        .fail(function (resp, code) {
            console.log(resp);
        });
}

/**
 * Subsribes a new webhook for a specific list. (Wunderlist only allows for webhooks on list level.)
 * @param {string} accessToken Access Token for the user this list belongs to.
 * @param {integer} list List to subscribe to.
 * @param {string} callbackUri URI to callback to.
 */
Wunderlist.prototype.createWebhook = function (accessToken, list, callbackUri, callback) {
    return request({
        url: 'http://a.wunderlist.com/api/v1/webhooks',
        method: 'POST',
        json: true,
        headers: {
            'X-CLIENT-ID': this._clientId,
            'X-ACCESS-TOKEN': accessToken
        },
        body: {
            list_id: list,
            url: callbackUri,
            processor_type: 'generic',
            configuration: ''
        }
    }, (error, response, body) => {
        console.log(error, body);
        if (callback) {
            callback(body);
        }
    });
}

module.exports = Wunderlist;