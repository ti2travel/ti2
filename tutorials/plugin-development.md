## Environment values

Plugin environment keys are passed down to the instance while is being created, this is the preferred way of accesing environmen keys from the plugins, such values are not design to hold client / user's API keys or specific data, they are to be stored on the database itself via the AppKey collection.

Plugin ENV variable name convention: ti2_pluginName_environmenVariableName, for example:

```env
ti2_tourconnect_apiUrl=http://backend:8080
```

## Methods

In oorder for an integration or system apps, we must use a set of standirzed methods to matain a compatibility; there are following methods are available, more can be supported but should be a part of the API TI2 spec to maximize it's compatibility.

**General Methods** (should always be included):
* [validateToken]{@link Plugin#validateToken}

**Content Methods** (related to marketing information update for profile, locations and/or products):
* [getProfile]{@link Plugin#getProfile}
* [updateProfile]{@link Plugin#updateProfile}
* [createLocation]{@link Plugin#createLocation}
* [updateLocation]{@link Plugin#updateLocation}
* [getProducts]{@link Plugin#getProducts}
* [createProduct]{@link Plugin#createProduct}
* [updateProduct]{@link Plugin#updateProduct}

**Booking Methods** (all related to bookings and operations):
* [searchBooking]{@link Plugin#searchBooking}
* [searchProducts]{@link Plugin#searchProducts}
* [searchAvailability]{@link Plugin#searchAvailability}
* [searchQuote]{@link Plugin#searchQuote}
* [createBooking]{@link Plugin#createBooking}

---


## Codebase setup

You can review some of the plugins previously developed and use them as a guide, plugin methods are encourage to include tests and return results on the same format, however the return values can include additional information, currently Ti2 is expected to run on node version 12.22.8; we suggest you use the same for your codebase.


After initializing your git environment for development; you can initialize your node project; we recommend naming your repo ti2-\<pluginname\> but it is not required.

```bash
$ node init .
```

## Entry file / constructor

The plugin is expected to have an index.js file that exports a Plugin Class like so:

```javascript
// index.js
class Plugin {
  constructor(params = {}) { // we get the env variables from here
    Object.entries(params).forEach(([attr, value]) => {
      this[attr] = value;
    });
  }
}
module.exports = Plugin;
```

The constructor of the plugins should extend the attributes with the received params, this allows the plugin to receive configurations or settings that are to be used by any user; that is settings that are shared across accounts.

By default Ti2 will pass down all environment variables that match the plugin name to it's constructor; for example, if the following environment variables are defined:

```
ti2_ventrata_acceptLanguage=en
ti2_travelgate_clientCode=tourconnect
ti2_tourconnect_apiUrl=http://backend:8080
```

The plugin named ti2-ventrata would receive acceptLanguage variable and it's value, ti2-travelgate the clientCode variable and ti-touconnect the apiUrl value.

## Method calling

On the previous example code we are declaring a validateToken method; we are normally expected to receive two parameters one is token and the second one payload.

```javascript
// index.js
class Plugin {
  constructor(params = {}) { // we get the env variables from here
    Object.entries(params).forEach(([attr, value]) => {
      this[attr] = value;
    });
  }
  async validateToken({
    token: {
      apiKey = this.apiKey,
      apiUrl = this.apiUrl,
    },
  }) {
   // TODO: actually test the apiKey against the integration.
    return assert(apiKey);
  }
}
module.exports = Plugin;
```

The token parameter includes all the settings for the current configured user; on these example we are defauring this settings to the ones configured to the pluging when it was instanced; so if the user settings do not include an apiUrl it will fall back to the environment variable on the running server.

## Testing Suite

The plugin should contain a test file, for the following example assumes we will be using jest as the testing platform.

```bash
$ npm i -D jest
```

```javascript
// index.test.js
const Plugin = require('./index');

const app = new Plugin({
  jwtKey: process.env.ti2_ventrata_jwtKey,
});

describe('Base Tests', () => {
  const token = { // a valid token to run tests
    apiKey: process.env.ti2_ventrata_apiKey,
    endpoint: process.env.ti2_ventrata_endpoint,
  };
  it('should not validate an invalid api key', async () => {
    const isValid = await app.validateToken({
    token: { apiKey: 'some Randomg Text' }
    }); 
    expect(isValid).toBeFalsy();
  });
  it('should not validate an invalid api key', async () => {
    const isValid = await app.validateToken({
      token,
    }); 
    expect(isValid).toBeTruthy();
  });
});

```

```bash
$ npx jest
```

## Adding the folder to a ti2 instance

After setting up a [Ti2 instance]{@tutorial setup-your-instance} you can add your development folder as a package on your instance's npm repo (not on the plugin's instance), like so:

```json
  "dependencies": {
    "ti2-myplugin": "file:../ti2-myplugin"
    }
```

## Extending the base API

Ti2 uses the [Swagger API specification](https://swagger.io/specification/) standard to define it's own methods, you can review the base methods [here](https://ti2-staging.tourconnect.com/api-docs/); these methods can be extender using the same format; this allows any plugin to extend the base API endpoints that are linked to any plugin method (part of the base methods or new ones).

All the extender methods would be availble under the /\[plugin name] namespace, i.e.: /ti2-greatPlugin/ping.

For Ti2 to pickup the extender definition one must create a new file on the root of the plugin named api.yml, such file would contain only the methods to be extender and it must comply with the current swagger version used on ti2.

```yaml
# api.yml
openapi: '3.0.0'
info:
  description: My amazing ti2-plugin
  version: 0.0.1 
  title: Ti2's new plugin
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    ServerInfo:
      type: object
      properties:
        name:
          type: string
        description:
          type: string
        version:
          type: string
        uptime:
          type: string
paths:
  /ping:
    get:
      tags:
        - public
      summary: Should return basic system status
      operationId: ping
      responses:
        '200':
          description: success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ServerInfo'
```

## Database Migrations (plugin's own database tables)

Ti2 uses [Sequelize v6.13](https://sequelize.org/v6) and is the database ORM we ecourage to use, you can add your own tables via migrations that should be placed under a migrations folder on the root of the plugin folder.

Migrations should be run after the fact, from the root of ti2 instance like so:


```
$  npm explore ti2<pluginName> -- npx sequelize db:migrate"
```

We strongly encourage all the plugin's table names are predicated with the plugin name (i.e. ti2-pluginName-cacheTable).

This should be executed ater the ti2 project migrations have been executed.

## Scheduled Task (to be released on v2)

TBD.
