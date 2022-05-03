## Why would I want to run my own instance?

* Scenario 1: You want to test your plugins before submitting it to our Ti2 instance, it is a good idea to spin up your own Ti2 test instance, you can test against all the Ti2 REST Apis (In the future, we will provide a Ti2 sandbox instance).

* Scenario 2: You want to host your own Ti2 server so you can have everything under your own control.

When you are runnning a Ti2 server you can access the documentation page on the url (http://[yourinstance]/api-docs/) that shows the available API methods, you can review the [swagger documentation page online](https://ti2-staging.tourconnect.com/api-docs/) .

## Security

An admin api key is set trough an environment variable called adminKey; using this API key is possible to create Users and/or application authentications.

A new User/User Authentication can be created using the endpoint [createUserToken](https://ti2.tourconnect.dev/api-docs/#/admin/createUserToken); the return value consists of a JWT token for further user intraction with the App; the admin API key is required; no password is saved on the server side.

Apps/Integrations can be created using the admin API Key; this after the plugin had been added to the codebase; the app can be created using the endpoint [createApp](https://ti2.tourconnect.dev/api-docs/#/admin/createApp); such endpoint returns a key that can be used by the app to interact with user Ids; such interactions allow the app to push for changes related to user integrations, the app can list the users currently configured for it using the endpoint [listAppTokens](https://ti2.tourconnect.dev/api-docs/#/app/listAppTokens); the passwords for Apps are encripted onde the database using aes-256-cbc, more details can be found on the [``models/integrations.js``](https://github.com/ti2travel/ti2/blob/main/models/integration.js) file.

User + app integration credentials can be added after the app has been added to the system; these can be added by either the user, admin or the app itself using the endpoint [createAppToken](https://ti2.tourconnect.dev/api-docs/#/app/createAppToken). These keys are saved in JWT format on the database.

## Get Started

### Requirements and Evironment variables

A MySQl instance is required and the following environment variables are required:

- DB_URL (mysql connection in url format)
- REDIS_URL (a redis database url to store the background queue)
- dbCryptoKey (integration details encription key, should be a 32 chars base64 encoded random string)
- adminKey (a key for admin related requests)
- jwtKey (a key to encrypt user sessions request)
- frontendKey (an additional optional key to validate the origin of the requests)
- PORT (an optional port to run the http server, in case a port is not specified as a parameter)

```
DB_URL=mysql://root:@mysqlserver/ti2development
REDIS_URL=redis://redis:6379
dbCryptoKey=cG9VYmJyQ2tlSDVHeXQ4RUN4VlNieEJRejNYWDlZU0g=
jwtSecret=C8k0mrHVfWVTP7pIoZEHRrvFgTULhw3E4swDq1aoDH4P
frontendKey=IpOiLahrGQxsQimwoK7Z
adminKey=bCviyz7iKyuEBoOVlODn
```

### Initialize a new NodeJS project

We suggest creating a folder with your instance name+i2 (i.e acme-ti2); then initialize an node's npm package and install ti2 along with any plugins to be used.

```bash
$ mkdir acme-ti2
$ cd acmme-ti2
$ npm init .
$ npm i ti2 ti2-tourconnect
```


After installing the ti2 package you need to run the database migrations for ti2:

```
$  ti2 db migrate
```

### Entry File

then just create an entry file like this : 

```javascript
// index.js

module.exports = (async () => {
    const ti2 = await require('ti2')({
      plugins: {
        ventrata: require('ti2-ventrata'),
        travelgate: require('ti2-travelgate'),
        tourconnect: require('ti2-tourconnect'),
      },
    });
    return ti2;
})();

```

and start the server:

```bash
$ node index.js
```

in order to support the background job queue (required by some plugins) you should consider the following example:

```javascript
const plugins = {
  ventrata: require('ti2-ventrata'),
  travelgate: require('ti2-travelgate'),
  tourconnect: require('ti2-tourconnect'),
};

module.exports = (async () => {
  if (process.argv.indexOf('worker') > 0) {
    const worker = await require('ti2')({
      plugins,
      worker: true,
    });
    return worker;
  } else {
    const ti2 = await require('ti2')({
      plugins,
    });
    return ti2;
  }
})();
```

and start a background worker (on a second terminal), required for some plugins:

```bash
$ node index.js worker
```

## API logging

Currently logging is supported via elastic search, an elasticLogClient value can ben passed down, example:

```javascript
const { Client } = require('@elastic/elasticsearch');
const elasticLogsClient = (() => {
  if (!elasticLogs) return null;
  return new Client({ node: elasticLogs });
})();

const plugins = {
  ventrata: require('ti2-ventrata'),
  travelgate: require('ti2-travelgate'),
  tourconnect: require('ti2-tourconnect'),
};

module.exports = (async () => {
  if (process.argv.indexOf('worker') > 0) {
    const worker = await require('ti2')({
      elasticLogsClient,
      plugins,
      worker: true,
    });
    return worker;
  } else {
    const ti2 = await require('ti2')({
      elasticLogsClient,
      plugins,
    });
    return ti2;
  }
})();
```
