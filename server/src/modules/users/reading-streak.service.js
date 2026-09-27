'use strict';

const { User } = require('./user.model');

/**
 * Reading-streak service (plan step 85, Phase 13), triggered by the
 * reading-activity worker on every counted poem read.
 *
 * Timezone model
 * --------------
 * A streak "day" is the calendar day in the READER's local time, never
 * server UTC (§8.15/plan 85: a UTC day boundary would silently reset
 * streaks for anyone east/west of Greenwich). The client sends its UTC
 * offset (`Date.getTimezoneOffset()`, minutes WEST of UTC) with the read;
 * the worker converts `now` with that offset and takes the YYYY-MM-DD
 * label as the local day. The local day is PERSISTED as a Date at UTC
 * midnight of that calendar day - a canonical, timezone-free encoding of
 * "which local day was last read" (Date at midnight never straddles a
 * day boundary, so equality/prev-day arithmetic is exact).
 *
 * Atomicity
 * ---------
 * Two reads landing concurrently must never double-increment, and two
 * reads on the same local day must never extend the streak twice. Both
 * are guaranteed by a single conditional `updateOne`:
 *   filter: `readingStreak.lastReadDate != today` (same-day re-entry
 *           matches nothing - the whole update is a no-op), and
 *   update: an aggregation pipeline that derives `current` from the
 *           PREVIOUS stored value (yesterday -> +1, else -> 1) inside
 *           the document itself - MongoDB applies filter+pipeline under
 *           one document-level atomic operation, so racing writers
 *           serialize and the loser's filter fails.
 * This is why the logic does not read-then-write: a JS round-trip
 * between reading `current` and writing `current + 1` would race.
 *
 * Self-reads/anon readers never reach this module (the worker skips
 * them before calling in); a vanished user matches 0 documents and is a
 * safe no-op, never a throw.
 */

/** Client offsets are getTimezoneOffset() minutes; clamp + fall back to UTC. */
function normalizeOffset(tzOffsetMinutes) {
  if (!Number.isFinite(tzOffsetMinutes)) return 0;
  return Math.max(-900, Math.min(900, Math.round(tzOffsetMinutes)));
}

/**
 * Local calendar day (YYYY-MM-DD) of `now` for a getTimezoneOffset-style
 * offset. Sign check: Dhaka (UTC+6) reports offset -360; local = UTC + 6h
 * = `now - offset * 60000`, so a 23:58 local instant rolls the label to
 * the NEXT day exactly when the reader's wall clock does.
 */
function localDayKey(now = new Date(), tzOffsetMinutes) {
  const offset = normalizeOffset(tzOffsetMinutes);
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

/** UTC-midnight Date encoding the local calendar day `YYYY-MM-DD`. */
function dayAsUtcDate(dayKey) {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

/**
 * Advance the reader's streak for the local day containing `now`.
 * Idempotent per local day: a second call the same day is a no-op
 * (`updated: false`), which makes worker retries/replays safe.
 *
 * @param {object} input
 * @param {string} input.userId - reader's id
 * @param {number} [input.tzOffsetMinutes] - reader's getTimezoneOffset() value
 * @param {Date} [input.now] - occurrence time; worker passes the job's
 *   `occurredAt` so a queue delay past midnight cannot shift the day
 * @returns {Promise<{updated: boolean, localDay: string}>}
 */
async function updateReadingStreak({ userId, tzOffsetMinutes, now = new Date() }) {
  if (!userId) return { updated: false, localDay: null };

  const localDay = localDayKey(now, tzOffsetMinutes);
  const today = dayAsUtcDate(localDay);
  const yesterday = new Date(today.getTime() - 86_400_000);

  // current = +1 when last read was yesterday (streak extends), else 1
  // (first read or a gap broke the streak); longest tracks the maximum.
  const newCurrent = {
    $cond: [
      { $eq: ['$readingStreak.lastReadDate', yesterday] },
      { $add: [{ $ifNull: ['$readingStreak.current', 0] }, 1] },
      1,
    ],
  };

  const result = await User.updateOne(
    { _id: userId, 'readingStreak.lastReadDate': { $ne: today } },
    [
      {
        $set: {
          readingStreak: {
            $let: {
              vars: { current: newCurrent },
              in: {
                current: '$$current',
                longest: { $max: [{ $ifNull: ['$readingStreak.longest', 0] }, '$$current'] },
                lastReadDate: today,
              },
            },
          },
        },
      },
    ],
    // Mongoose 9 refuses array updates unless the pipeline form is opted in.
    { updatePipeline: true },
  );

  return { updated: result.modifiedCount === 1, localDay };
}

module.exports = { updateReadingStreak, localDayKey, normalizeOffset };
