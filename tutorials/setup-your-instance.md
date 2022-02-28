## Initializing your new Repo

We suggest creating a folder with your instance name+i2 (i.e acme-ti2); then initialize an node's npm package and install ti2 along with any plugins to be used.

```bash
$ mkdir acme-ti2
$ cd acmme-ti2
$ npm init .
$ npm i ti2 ti2-tourconnect
```

## Requirements

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

After installing the ti2 package you need to run the datbase migrations for ti2:

```
$  npm explore ti2<pluginName> -- npx sequelize db:migrate"
```

## Entry File

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
