# Ti2
Tourism Industry Interchange

## Getting Started

### Requirements

Some environment variables are required for ti2 to start

- DB_URL (mysql connection in url format)
- dbCryptoKey (integration details encription key)
- adminKey (a key for admin related requests)
- jwtKey (a key to encrypt user sessions request)
- frontendKey (an additional optional key to validate the origin of the requests)
- PORT (an optional port to run the http server, in case a port is not specified as a parameter)

### Starting your server

You can start your own instance by adding a requirement on your own nodejs project as follows:

```bash
$ npm i ti2
```

To start the server with default values use the following: 

```javascript
const ti2 = require('ti2')({
  plugins: {
    travelgate: require('ti2-travelgate'),
    ventrata: require('ti2-ventrata'),
    tourconnect: require('ti2-tourconnect'),
  },
});
```

## Plugins

Plugins are the connectores to other systems and/or features you intent to use; by default the server will start an API service on port 10010 and the swagger documentation on the path //api-docs, (you can disable wither by passing the startServer param as False or the apiDocs as False.

Plugin environment keys are passed down to the instance while is being created, this is the preferred way of accesing environmen keys from the plugins, such values are not design to hold client / user's API keys or specific data, they are to be stored on the database itself via the AppKey collection.

Plugin ENV variable name convention: ti2_pluginName_environmenVariableName, for example:

```env
ti2_tourconnect_apiUrl=http://backend:8080
```

### Available Plugins

| Repo | Features | Maintainer |
| ---- | -------- | ---------- |
| [ti2-ventrata](https://github.com/TourConnect/ti2-ventrata)     | Bookings: Search, Cancellation | TourConnect |
| [ti2-travelgate](https://github.com/TourConnect/ti2-travelgate) | Bookings: Search, Cancellation | TourConnect |

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

## Contributing

Contributions are welcome and ecouraged.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement". Don't forget to give the project a star! Thanks again!

- Fork the Project
- Create your Feature Branch (git checkout -b feature/AmazingFeature)
- Commit your Changes (git commit -m 'Add some AmazingFeature')
- Push to the Branch (git push origin feature/AmazingFeature)
- Open a Pull Request

Feel free to check the [Issues Page](https://github.com/TourConnect/ti2/issues).

## License

Distributed under the GPL-3 License. See LICENSE.txt for more information.

TL;DR Here's what the license entails:

1. Anyone can copy, modify and distribute this software.
2. You have to include the license and copyright notice with each and every distribution.
3. You can use this software privately.
4. You can use this software for commercial purposes.
5. If you dare build your business solely from this code, you risk open-sourcing the whole code base.
6. If you modify it, you have to indicate changes made to the code.
7. Any modifications of this code base MUST be distributed with the same license, GPLv3.
8. This software is provided without warranty.
9. The software author or license can not be held liable for any damages inflicted by the software.
