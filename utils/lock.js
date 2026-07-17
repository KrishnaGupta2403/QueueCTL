const { getDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const { Job, JobState } = require('../models/Job');
const logger = require('./logger');

const getNow = () => new Date().toISOString();

/**
 * Reclaims jobs that have been in 'processing' state beyond the lock timeout.
 * Resets them back to 'pending' state and clears locks so they can be re-attempted.
 * @param {number} [timeoutMs=300000] - Lock timeout duration in milliseconds (default: 5 minutes)
 * @returns {Promise<Job[]>} Array of reclaimed job instances
 */
async function reclaimStaleLocks(timeoutMs = 300000) {
  const db = await getDb();
  const thresholdISO = new Date(Date.now() - timeoutMs).toISOString();

  const staleRows = await db.all(
    `SELECT * FROM Jobs WHERE state = ? AND locked_at IS NOT NULL AND locked_at <= ?`,
    [JobState.PROCESSING, thresholdISO]
  );

  const reclaimedJobs = [];
  for (const row of staleRows) {
    const updatedRow = await repository.updateJobState(row.id, JobState.PENDING, {
      locked_by: null,
      locked_at: null,
    });
    if (updatedRow) {
      const validated = Job.validate(updatedRow);
      reclaimedJobs.push(validated);
      logger.warn(
        `Reclaimed stale job [${row.id}] (locked by "${row.locked_by}" at ${row.locked_at}). Reset to PENDING.`,
        { jobId: row.id }
      );
    }
  }

  return reclaimedJobs;
}

/**
 * Atomically selects the oldest eligible pending job using a BEGIN IMMEDIATE transaction,
 * sets its state to processing, and stamps locked_by and locked_at.
 * @param {string} workerId - Identifier of the worker picking up the job
 * @param {Object} [options={}]
 * @param {number} [options.lockTimeoutMs=300000] - Timeout in ms before checking/reclaiming stale locks
 * @returns {Promise<Job|null>} Selected job instance or null if no pending jobs are available
 */
let lastReclaimTime = 0;
let acquireMutex = Promise.resolve();

async function acquireLock(workerId, options = {}) {
  let releaseMutex;
  const prevMutex = acquireMutex;
  acquireMutex = new Promise((resolve) => { releaseMutex = resolve; });
  await prevMutex;

  try {
    // First, check and reclaim any stale locks (throttled to at most once per second during rapid polling)
    const lockTimeoutMs = options.lockTimeoutMs !== undefined ? options.lockTimeoutMs : 300000;
    if (lockTimeoutMs > 0 && (lockTimeoutMs < 300000 || Date.now() - lastReclaimTime >= 1000)) {
      lastReclaimTime = Date.now();
      await reclaimStaleLocks(lockTimeoutMs);
    }

    const db = await getDb();
    const now = getNow();

    const row = await db.get(`
      UPDATE Jobs 
      SET state = ?, locked_by = ?, locked_at = ?, updated_at = ? 
      WHERE id = (
        SELECT id FROM Jobs 
        WHERE state = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?) 
        ORDER BY created_at ASC LIMIT 1
      )
      RETURNING *
    `, [JobState.PROCESSING, workerId, now, now, JobState.PENDING, now]);

    return row ? Job.validate(row) : null;
  } finally {
    releaseMutex();
  }
}

/**
 * Releases the lock on a processing job, resetting its state back to pending.
 * Used for graceful shutdown or cancellation.
 * @param {string} jobId - ID of the job to release
 * @returns {Promise<Job|null>} Updated job instance or null if not found
 */
async function releaseLock(jobId) {
  const job = await repository.getJobById(jobId);
  if (!job) return null;

  if (job.state === JobState.PROCESSING) {
    const updatedJob = await repository.updateJobState(jobId, JobState.PENDING, {
      locked_by: null,
      locked_at: null,
    });
    return updatedJob ? Job.validate(updatedJob) : null;
  }

  return Job.validate(job);
}

module.exports = {
  acquireLock,
  pickAndLockJob: acquireLock,
  releaseLock,
  reclaimStaleLocks,
};
