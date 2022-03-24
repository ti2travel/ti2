## Why ?

* You want to test your plugins before submitting it to our Ti2 instance, it is a good idea to spin up your own Ti2 test instance, you can test against all the Ti2 REST Apis (In the future, we will provide a Ti2 sandbox instance).

* You want to host your own server under your premises for production or staging purposes or becuase you want to run it inside your network.

When you are runnning a Ti2 server you can access the documentation page on the url (http://[yourinstance]/api-docs/) that serves the available API methods, you can review the [swagger documentation page online](https://ti2-staging.tourconnect.com/api-docs/) .

## Security

An admin api key is set trough an environment variable called adminKey; using this API key is possible to create Users and/or application authentications.

A new User / User Authentication can be created using the endpoint [createUserToken](https://ti2.tourconnect.dev/api-docs/#/admin/createUserToken); the return value consists of a JWT token for further user intraction with the App; the admin API key is required; no password is saved on the server side.

Apps / Integrations can be created using the admin API Key; this after the plugin had been added to the codebase; the app can be created using the endpoint [createApp](https://ti2.tourconnect.dev/api-docs/#/admin/createApp); such endpoint returns a key that can be used by the app to interact with user Ids; such interactions allow the app to push for changes related to user integrations, the app can list the users currently configured for it using the endpoint [listAppTokens](https://ti2.tourconnect.dev/api-docs/#/app/listAppTokens); the passwords for Apps are encripted onde the database using aes-256-cbc, more details can be found on the [``models/integrations.js``](https://github.com/ti2travel/ti2/blob/main/models/integration.js) file.

User + app integration credentials can be added after the app has been added to the system; these can be added by either the user, admin or the app itself using the endpoint [createAppToken](https://ti2.tourconnect.dev/api-docs/#/app/createAppToken). These keys are saved in JWT format on the database.

## Get Started

### Requirements and Evironment variables

A MySQl instance is required and the following environment variables are required:

- DB_URL (mysql connection in url format)
- dbCryptoKey (integration details encription key, should be a 32 chars base64 encoded random string)
- adminKey (a key for admin related requests)
- jwtKey (a key to encrypt user sessions request)
- frontendKey (an additional optional key to validate the origin of the requests)
- PORT (an optional port to run the http server, in case a port is not specified as a parameter)

```
DB_URL=mysql://root:@mysqlserver/ti2development
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


After installing the ti2 package you need to run the datbase migrations for ti2:

```
$  npm explore ti2<pluginName> -- npx sequelize db:migrate"
```

### Entry File

then just create an entry file like this : 

```javascript
// index.js
const ti2 = require('ti2')({
  plugins: {
    travelgate: require('ti2-travelgate'),
    ventrata: require('ti2-ventrata'),
    tourconnect: require('ti2-tourconnect'),
  },
});
```

and stat the server using node:

```
$ node index.js
```

## API logging

Currently logging is supported via elastic search, an elasticLogClient value can ben passed down, example:

```javascript
const { Client } = require('@elastic/elasticsearch');
const elasticLogsClient = (() => {
  if (!elasticLogs) return null;
  return new Client({ node: elasticLogs });
})();

const ti2 = require('ti2')({
  elasticLogsClient,
  plugins: {
    ventrata: require('ti2-ventrata'),
    travelgate: require('ti2-travelgate'),
    tourconnect: require('ti2-tourconnect'),
  },
});
```