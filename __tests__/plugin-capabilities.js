/* globals describe expect it */

const createApp = require('../index');

class SelectivePlugin {
  constructor({ cache, events, name }) {
    this.cache = cache;
    this.events = events;
    this.name = name;
  }
}

describe('host-owned plugin capabilities', () => {
  it('assigns configured capabilities when a plugin ignores unknown constructor fields', async () => {
    const app = await createApp({
      pluginCapabilities: {
        selective: { weeklyProductCatalogSync: true },
      },
      plugins: { selective: SelectivePlugin },
      startServer: false,
    });

    expect(app.plugins[0].capabilities).toEqual({
      weeklyProductCatalogSync: true,
    });
  });

  it('assigns configured capabilities to pre-instantiated plugins', async () => {
    const plugin = { name: 'instantiated' };
    const app = await createApp({
      pluginCapabilities: {
        instantiated: { weeklyProductCatalogSync: true },
      },
      pluginsInstantiated: [plugin],
      startServer: false,
    });

    expect(app.plugins[0].capabilities).toEqual({
      weeklyProductCatalogSync: true,
    });
  });
});
