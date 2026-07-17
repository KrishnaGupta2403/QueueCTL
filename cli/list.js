const { jobService } = require('../services/jobService');

async function listCommand(options = {}) {
  try {
    const jobs = await jobService.listJobs(options.state);

    if (!options.silent) {
      if (jobs.length === 0) {
        console.log(options.state ? `No jobs found with state: '${options.state}'.` : 'No jobs found.');
      } else {
        console.log(`\nFound ${jobs.length} job(s):\n`);
        jobs.forEach((job) => {
          console.log(`ID:         ${job.id}`);
          console.log(`Command:    ${job.command}`);
          console.log(`State:      ${job.state.toUpperCase()}`);
          console.log(`Attempts:   ${job.attempts}/${job.max_retries}`);
          console.log(`Created At: ${job.created_at}`);
          console.log(`Updated At: ${job.updated_at}`);
          if (job.last_error) console.log(`Last Error: ${job.last_error}`);
          console.log('--------------------------------------------------');
        });
      }
    }

    return jobs;
  } catch (err) {
    if (!options.silent) {
      console.error('Error listing jobs:', err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await jobService.close();
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let state = null;
  const stateIdx = args.indexOf('--state');
  if (stateIdx !== -1 && args[stateIdx + 1]) {
    state = args[stateIdx + 1];
  }
  listCommand({ state }).catch(() => process.exit(1));
}

module.exports = {
  listCommand,
};
