#!/usr/bin/env node

const { Command, Argument } = require('commander');

const { migrateApp } = require('./controllers/app.js');

const program = new Command();

program
  .name('ti2-cli')
  .description('TI2 Command line interface utilities')
  .version((require('./package.json')).version);

program.command('migrate')
  .description('Handle database migrations for integrations')
  .argument('<string>', 'integration to operate on')
  .addArgument(
    new Argument('<action>', 'action to take', 'migrate')
      .choices(['migrate', 'revert']),
  )
  .action(async (integration, action) => {
    await migrateApp({ integrationId: integration, action });
  });

program.parse();
