'use strict';

// Runs before the Postiz image entrypoint and fails closed on bad time, disk,
// or queue state. It also repairs overdue, invalid, and duplicate QUEUE rows.

const fs = require('fs');
const https = require('https');
const { Client } = require('/app/node_modules/pg');

const MIN_FREE_BYTES = 1024 * 1024 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 120;
const ADVISORY_LOCK = 739184221;

function fail(message) {
  console.error(`[postiz-guard] FAIL CLOSED: ${message}`);
  throw new Error(message);
}

function parseUtc(value) {
  const parsed = new Date(`${value.trim().replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid timestamp: ${value}`);
  return parsed;
}

function formatTimestamp(value) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ` +
    `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:00`;
}

function policyHours(name) {
  return /(quiet\s*moon|aiviq|daniel)/i.test(name || '') ? [10, 16, 22] : [16, 22];
}

function isValidSlot(value, hours) {
  return value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0 && hours.includes(value.getUTCHours());
}

function nextSlot(after, hours) {
  const base = new Date(after.getTime());
  base.setUTCHours(0, 0, 0, 0);
  for (let day = 0; day < 370; day += 1) {
    for (const hour of hours) {
      const candidate = new Date(base.getTime());
      candidate.setUTCDate(base.getUTCDate() + day);
      candidate.setUTCHours(hour, 0, 0, 0);
      if (candidate > after) return candidate;
    }
  }
  throw new Error('could not find a future schedule slot');
}

function trustedInternetTime() {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'www.google.com', path: '/generate_204', method: 'HEAD', timeout: 8000,
    }, (response) => {
      const value = response.headers.date;
      response.resume();
      if (!value) return reject(new Error('trusted time response had no Date header'));
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) return reject(new Error('trusted time Date header was invalid'));
      return resolve(new Date(parsed));
    });
    request.on('timeout', () => request.destroy(new Error('trusted time request timed out')));
    request.on('error', reject);
    request.end();
  });
}

async function main() {
  const stats = fs.statfsSync('/uploads');
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (freeBytes < MIN_FREE_BYTES) fail(`upload volume has ${freeBytes} bytes free; refusing to start below 1GB`);

  const trusted = await trustedInternetTime();
  const skew = Math.abs(Date.now() - trusted.getTime()) / 1000;
  if (skew > MAX_CLOCK_SKEW_SECONDS) fail(`clock differs from trusted HTTPS time by ${Math.round(skew)} seconds`);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK})`);

  try {
    const nowResult = await client.query(
      `SELECT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS.US') AS now_utc`,
    );
    const now = parseUtc(nowResult.rows[0].now_utc);
    const result = await client.query(`
      SELECT p.id,
             p."integrationId" AS integration_id,
             to_char(p."publishDate", 'YYYY-MM-DD HH24:MI:SS.US') AS publish_date,
             to_char(coalesce(p."createdAt", p."publishDate"), 'YYYY-MM-DD HH24:MI:SS.US') AS created_date,
             coalesce(i.name, '') AS integration_name
      FROM "Post" p
      LEFT JOIN "Integration" i ON i.id = p."integrationId"
      WHERE p.state = 'QUEUE'
      ORDER BY p."integrationId", p."publishDate", p."createdAt", p.id
    `);

    const byIntegration = new Map();
    for (const row of result.rows) {
      if (!byIntegration.has(row.integration_id)) byIntegration.set(row.integration_id, []);
      byIntegration.get(row.integration_id).push({
        id: row.id,
        publishDate: parseUtc(row.publish_date),
        createdDate: parseUtc(row.created_date),
        name: row.integration_name,
      });
    }

    const updates = [];
    for (const [integrationId, rows] of byIntegration.entries()) {
      const name = rows[0]?.name || '';
      const hours = policyHours(name);
      const seen = new Set();
      const kept = [];
      const move = [];

      for (const row of rows) {
        const key = row.publishDate.toISOString();
        if (row.publishDate > now && isValidSlot(row.publishDate, hours) && !seen.has(key)) {
          seen.add(key);
          kept.push(row);
        } else {
          move.push(row);
        }
      }

      let tail = new Date(now.getTime());
      for (const row of kept) if (row.publishDate > tail) tail = row.publishDate;
      for (const row of move) {
        const slot = nextSlot(tail, hours);
        updates.push({ id: row.id, slot });
        tail = slot;
      }
      if (move.length) console.log(`[postiz-guard] ${name || integrationId}: moving ${move.length} row(s) after ${formatTimestamp(tail)}`);
    }

    if (updates.length) {
      await client.query('BEGIN');
      try {
        for (const update of updates) {
          await client.query(
            `UPDATE "Post" SET "publishDate" = $1::timestamp, "updatedAt" = NOW()
             WHERE id = $2 AND state = 'QUEUE'`,
            [formatTimestamp(update.slot), update.id],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    const checks = await client.query(`
      WITH queue AS (
        SELECT p.*, coalesce(i.name, '') AS integration_name
        FROM "Post" p LEFT JOIN "Integration" i ON i.id = p."integrationId"
        WHERE p.state = 'QUEUE'
      ), duplicates AS (
        SELECT "integrationId", "publishDate" FROM queue GROUP BY 1, 2 HAVING count(*) > 1
      ), invalid AS (
        SELECT 1 FROM queue
        WHERE "publishDate" <= (NOW() AT TIME ZONE 'UTC')
           OR extract(minute FROM "publishDate") <> 0
           OR extract(second FROM "publishDate") <> 0
           OR (CASE WHEN integration_name ~* '(quiet\\s*moon|aiviq|daniel)'
                    THEN extract(hour FROM "publishDate") NOT IN (10, 16, 22)
                    ELSE extract(hour FROM "publishDate") NOT IN (16, 22)
              END)
      )
      SELECT
        (SELECT count(*) FROM queue) AS queue_count,
        (SELECT count(*) FROM queue WHERE "publishDate" <= (NOW() AT TIME ZONE 'UTC')) AS past_count,
        (SELECT count(*) FROM duplicates) AS duplicate_pair_count,
        (SELECT count(*) FROM invalid) AS invalid_slot_count
    `);
    const check = checks.rows[0];
    console.log(`[postiz-guard] queue=${check.queue_count} moved=${updates.length} past=${check.past_count} duplicates=${check.duplicate_pair_count} invalid=${check.invalid_slot_count}`);
    if (Number(check.past_count) || Number(check.duplicate_pair_count) || Number(check.invalid_slot_count)) {
      fail('queue invariants remain broken after repair');
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK})`).catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[postiz-guard] ${error.stack || error}`);
  process.exitCode = 78;
});
