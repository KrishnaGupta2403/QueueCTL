#!/usr/bin/env node
const { Command } = require('commander');
const { enqueueCommand } = require('./cli/enqueue');
const { startWorkerCommand, stopWorkerCommand } = require('./cli/worker');
const { statusCommand } = require('./cli/status');
const { listCommand } = require('./cli/list');
const { listDlqCommand, retryDlqCommand } = require('./cli/dlq');
const { setConfigCommand, getConfigCommand } = require('./cli/config');

const program = new Command();

program
  .name('queuectl')
  .description('A robust, concurrency-safe Node.js & SQLite job queueing system.')
  .version('1.0.0');

// 1. Enqueue Subcommand
program
  .command('enqueue [json]')
  .description('Enqueue a new background job using a JSON string or flags')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .option('-i, --id <id>', 'Unique job ID')
  .option('-c, --command <cmd>', 'Command string to execute')
  .option('-r, --max-retries <n>', 'Maximum retry attempts on failure')
  .option('-b, --backoff-base <n>', 'Exponential backoff base value')
  .action(async (jsonInput, options) => {
    try {
      let fullCommandString = options.command;
      const cIndex = process.argv.findIndex((arg) => arg === '-c' || arg === '--command');
      if (cIndex !== -1 && cIndex + 1 < process.argv.length) {
        const parts = [];
        for (let idx = cIndex + 1; idx < process.argv.length; idx++) {
          const token = process.argv[idx];
          if (['--id', '-i', '--max-retries', '-r', '--backoff-base', '-b'].includes(token)) {
            break;
          }
          parts.push(token);
        }
        if (parts.length > 0) {
          fullCommandString = parts.join(' ');
        }
      }

      await enqueueCommand(jsonInput, {
        id: options.id,
        command: fullCommandString,
        maxRetries: options.maxRetries,
        backoffBase: options.backoffBase,
      });
    } catch (err) {
      process.exit(1);
    }
  });

// 2. Worker Subcommands
const workerCmd = program
  .command('worker')
  .description('Manage background worker processes');

workerCmd
  .command('start')
  .description('Start a pool of background workers to process jobs')
  .option('--count <n>', 'Number of worker instances to launch', '1')
  .option('--poll-interval <ms>', 'Polling interval in milliseconds when queue is empty', '500')
  .option('--drain', 'Auto-exit workers when all pending tasks are completed')
  .action(async (options) => {
    try {
      await startWorkerCommand(options);
    } catch (err) {
      process.exit(1);
    }
  });

workerCmd
  .command('stop')
  .description('Signal all running workers to finish their current job and stop gracefully')
  .action(async () => {
    try {
      await stopWorkerCommand();
    } catch (err) {
      process.exit(1);
    }
  });

// 3. Status Subcommand
program
  .command('status')
  .description('Display aggregated counts of jobs grouped by state and active workers')
  .action(async () => {
    try {
      await statusCommand();
    } catch (err) {
      process.exit(1);
    }
  });

// 4. List Subcommand
program
  .command('list')
  .description('List individual job rows with timestamps and attempt history')
  .option('-s, --state <state>', 'Filter jobs by state (pending, processing, completed, failed, dead, all)')
  .action(async (options) => {
    try {
      await listCommand({ state: options.state });
    } catch (err) {
      process.exit(1);
    }
  });

// 5. DLQ Subcommands
const dlqCmd = program
  .command('dlq')
  .description('Manage the Dead Letter Queue (jobs in dead state)');

dlqCmd
  .command('list')
  .description('List all jobs currently in the Dead Letter Queue')
  .action(async () => {
    try {
      await listDlqCommand();
    } catch (err) {
      process.exit(1);
    }
  });

dlqCmd
  .command('retry <jobId>')
  .description('Reset a dead job to pending state with attempts=0 so it re-enters the normal queue flow')
  .option('-c, --command <cmd>', 'Optional new command string if correcting a bad command')
  .action(async (jobId, options) => {
    try {
      await retryDlqCommand(jobId, { command: options.command });
    } catch (err) {
      process.exit(1);
    }
  });

// 6. Config Subcommands
const configCmd = program
  .command('config')
  .description('Manage global defaults for max-retries and backoff-base');

configCmd
  .command('set <key> <value>')
  .description('Set a global configuration value (e.g. max-retries, backoff-base)')
  .action(async (key, value) => {
    try {
      await setConfigCommand(key, value);
    } catch (err) {
      process.exit(1);
    }
  });

configCmd
  .command('get [key]')
  .description('Get a specific configuration setting or display all if key is omitted')
  .action(async (key) => {
    try {
      await getConfigCommand(key);
    } catch (err) {
      process.exit(1);
    }
  });

configCmd
  .command('show')
  .description('Display all current configuration settings')
  .action(async () => {
    try {
      await getConfigCommand('show', { showAll: true });
    } catch (err) {
      process.exit(1);
    }
  });

if (require.main === module) {
  program.parseAsync(process.argv).catch(() => process.exit(1));
}

module.exports = {
  program,
};
