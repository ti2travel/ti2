#!/usr/bin/env node

const { Command, Argument } = require('commander');

const { migrateApp } = require('./controllers/app')();
const { migrate } = require('./controllers/admin');
const { decrypt, encrypt } = require('./lib/security');
const { queue, redisResults } = require('./worker/queue');

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
  .description('decrypt a string')
  .addArgument(
    new Argument('<key>', 'key to decrypt'),
  )
.action(async key => {
    console.log(await decrypt(key));
    process.exit(0);
  });
program.command('encrypt')
  .description('encrypt a string')
  .addArgument(
    new Argument('<key>', 'key to encrypt'),
  )
.action(async key => {
    console.log(await encrypt(key));
    process.exit(0);
  });

program.command('queue:list [pattern]')
  .description('List jobs in the queue, optionally filtering by ID pattern (e.g., "jobId*", "*suffix", "prefix*suffix")')
  .action(async (pattern) => {
    try {
      await queue.isReady(); // Ensure queue is ready
      const jobTypes = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'];
      let message = `Fetching jobs of types: ${jobTypes.join(', ')}...`;
      if (pattern) {
        message += ` matching pattern "${pattern}"`;
      }
      console.log(message);
      let jobs = await queue.getJobs(jobTypes);

      if (pattern) {
        const regexPatternText = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
        const regexPattern = new RegExp(regexPatternText);
        console.log(`Using filter regex: ${regexPattern}`);
        jobs = jobs.filter(job => regexPattern.test(job.id.toString()));
      }

      if (jobs.length === 0) {
        if (pattern) {
          console.log(`No jobs found matching pattern "${pattern}".`);
        } else {
          console.log('No jobs found in the queue.');
        }
      } else {
        console.log(`Found ${jobs.length} jobs:`);
        for (const job of jobs) {
          const state = await job.getState();
          const progress = job.progress();
          const timestamp = new Date(job.timestamp).toISOString();
          console.log(`\n- ID: ${job.id}`);
          console.log(`  State: ${state}`);
          console.log(`  Progress: ${progress}`);
          console.log(`  Added: ${timestamp}`);
          console.log(`  Name (Queue): ${job.name}`);
          console.log(`  Data: ${JSON.stringify(job.data, null, 2)}`);
          if (job.opts.repeat) {
            console.log(`  Repeat Options: ${JSON.stringify(job.opts.repeat)}`);
          }
          if (state === 'failed' && job.failedReason) {
            console.log(`  Failed Reason: ${job.failedReason}`);
          }
        }
      }
    } catch (error) {
      console.error('Error listing queue jobs:', error);
      process.exit(1);
    }
    process.exit(0);
  });

program.command('queue:remove')
  .description('Remove job instances from the queue by ID or pattern (e.g., "jobId*", "*suffix", "prefix*suffix")')
  .argument('<pattern>', 'Job ID or glob-like pattern for job IDs to remove')
  .action(async (pattern) => {
    try {
      await queue.isReady(); // Ensure queue is ready
      console.log(`Attempting to remove job instances matching pattern: "${pattern}"`);

      const jobTypes = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'];
      const jobs = await queue.getJobs(jobTypes);
      let removedCount = 0;
      const removedJobIds = [];

      const regexPatternText = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
      const regexPattern = new RegExp(regexPatternText);

      console.log(`Using regex: ${regexPattern}`);

      for (const job of jobs) {
        if (regexPattern.test(job.id.toString())) {
          try {
            await job.remove();
            removedJobIds.push(job.id.toString());
            removedCount++;
            console.log(`Removed job ${job.id} from Bull queue.`);
          } catch (e) {
            console.error(`Failed to remove job ${job.id} from Bull queue:`, e.message);
          }
        }
      }

      if (removedCount > 0) {
        console.log(`Successfully removed ${removedCount} job instance(s) from Bull queue.`);
        if (removedJobIds.length > 0) {
          console.log(`Attempting to remove ${removedJobIds.length} result(s) from Redis for the removed jobs...`);
          try {
            const delCount = await redisResults.del(removedJobIds);
            console.log(`Removed ${delCount} result(s) from Redis.`);
          } catch (e) {
            console.error('Failed to remove results from Redis:', e.message);
          }
        }
      } else {
        console.log(`No job instances found matching pattern "${pattern}".`);
      }
    } catch (error) {
      console.error('Error removing queue jobs:', error);
      process.exit(1);
    }
    process.exit(0);
  });

program.parse();
