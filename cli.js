#!/usr/bin/env node

const { Command, Argument } = require('commander');

const { migrateApp } = require('./controllers/app')();
const { migrate } = require('./controllers/admin');
const { decrypt } = require('./lib/security');

const program = new Command();

program
  .name('ti2-cli')
  .description('TI2 Command line interface utilities')
  .version((require('./package.json')).version);

program.command('dbapp')
  .description('Handle database migrations for apps')
  .argument('<string>', 'integration to operate on')
  .addArgument(
    new Argument('<action>', 'action to take', 'migrate')
      .choices(['migrate', 'revert']),
  )
  .action(async (integration, action) => {
    await migrateApp({ integrationId: integration, action });
    process.exit(0);
  });

program.command('db')
  .description('Handle database migrations for integrations')
  .addArgument(
    new Argument('<action>', 'action to take', 'migrate')
      .choices(['migrate', 'revert']),
  )
  .action(async action => {
    await migrate({ action });
    process.exit(0);
  });

program.command('decrypt')
  .description('Handle database migrations for integrations')
  .description('decrypt a string')
  .addArgument(
    new Argument('<key>', 'key to decrypt'),
  )
.action(async key => {
    console.log(await decrypt(key));
    process.exit(0);
  });

program.parse();
