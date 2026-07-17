const { jobService } = require('../services/jobService');

async function statusCommand(options = {}) {
  try {
    const status = await jobService.getJobStatus();
    if (!options.silent) {
      console.log(status.formatted);
    }
    return status;
  } catch (err) {
    if (!options.silent) {
      console.error('Error fetching job status:', err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await jobService.close();
    }
  }
}

if (require.main === module) {
  statusCommand().catch(() => process.exit(1));
}

module.exports = {
  statusCommand,
};
