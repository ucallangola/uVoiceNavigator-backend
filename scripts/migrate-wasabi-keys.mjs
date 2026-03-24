/**
 * migrate-wasabi-keys.mjs
 *
 * One-time migration: copies Wasabi objects that have literal backslashes in
 * their keys (Windows ETL artifact) to forward-slash keys, then updates the
 * wasabi_key and wasabi_url columns in the audios table.
 *
 * Run (from api/):
 *   node scripts/migrate-wasabi-keys.mjs [--dry-run] [--concurrency=20]
 *
 * --dry-run        prints what would be done without touching Wasabi or the DB.
 * --concurrency=N  how many copy+delete+update operations to run in parallel (default 20).
 */

import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import pg from 'pg';
const { Client } = pg;

// ── config ────────────────────────────────────────────────────────────────────
const WASABI_ACCESS_KEY = 'XPLHVKXHHV6WNYRW01KX';
const WASABI_SECRET_KEY = 'H2BFzrc9G7kzaNktzlDD7pHtn3NtqM0cO5VGsfzi';
const WASABI_BUCKET     = 'backup.ucall';
const WASABI_REGION     = 'us-west-1';
const WASABI_ENDPOINT   = 'https://s3.us-west-1.wasabisys.com';
const DATABASE_URL      = 'postgresql://cluyeye:Angola2026@10.11.1.117:5432/uvn_db?schema=public';

const DRY_RUN     = process.argv.includes('--dry-run');
const concArg     = process.argv.find(a => a.startsWith('--concurrency='));
const CONCURRENCY = concArg ? parseInt(concArg.split('=')[1], 10) : 20;

if (DRY_RUN) console.log('*** DRY RUN — no changes will be made ***\n');
console.log(`Concurrency: ${CONCURRENCY}\n`);

// ── S3 client ─────────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region:   WASABI_REGION,
  endpoint: WASABI_ENDPOINT,
  credentials: { accessKeyId: WASABI_ACCESS_KEY, secretAccessKey: WASABI_SECRET_KEY },
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

// ── helpers ───────────────────────────────────────────────────────────────────
/** Encode an S3 key for use in CopySource — preserves '/' path separators. */
function encodeCopySourceKey(key) {
  return encodeURIComponent(key).replace(/%2F/gi, '/');
}

function normalizeKey(key) {
  return key.replace(/\\/g, '/');
}

async function listAllObjects(prefix) {
  const keys = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket:            WASABI_BUCKET,
      Prefix:            prefix,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) keys.push(obj.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Run an array of async tasks with a max concurrency limit. */
async function runWithConcurrency(tasks, limit) {
  const results = [];
  const queue   = [...tasks];
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (queue.length) {
      const task = queue.shift();
      if (task) results.push(await task());
    }
  });
  await Promise.all(workers);
  return results;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function run() {
  // 1. Find all objects with backslash in their key
  console.log('Listing objects in Wasabi (audios/)...');
  const allKeys    = await listAllObjects('audios/');
  const toMigrate  = allKeys.filter(k => k.includes('\\'));
  const alreadyOk  = allKeys.length - toMigrate.length;
  console.log(`Total objects:         ${allKeys.length}`);
  console.log(`Need migration (\\):   ${toMigrate.length}`);
  console.log(`Already correct (/):  ${alreadyOk}\n`);

  if (toMigrate.length === 0) {
    console.log('Nothing to migrate. All keys already use forward slashes.');
    return;
  }

  if (DRY_RUN) {
    console.log('Sample (first 5):');
    for (const k of toMigrate.slice(0, 5)) {
      console.log(`  ${k.replace(/\\/g, '[\\]')} → ${normalizeKey(k)}`);
    }
    console.log(`\n(${toMigrate.length} total objects would be migrated)`);
    return;
  }

  // 2. Connect to DB
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  console.log('DB connected.\n');

  let copied = 0, deleted = 0, dbUpdated = 0, errors = 0;
  let done   = 0;

  const tasks = toMigrate.map(oldKey => async () => {
    const newKey  = normalizeKey(oldKey);
    const oldUrl  = `${WASABI_ENDPOINT}/${WASABI_BUCKET}/${oldKey}`;
    const newUrl  = `${WASABI_ENDPOINT}/${WASABI_BUCKET}/${newKey}`;

    try {
      // 3a. Copy to new key (server-side — no data transfer through client)
      const copySource = `${WASABI_BUCKET}/${encodeCopySourceKey(oldKey)}`;
      await s3.send(new CopyObjectCommand({
        Bucket:     WASABI_BUCKET,
        CopySource: copySource,
        Key:        newKey,
      }));
      copied++;

      // 3b. Delete the old key
      await s3.send(new DeleteObjectCommand({ Bucket: WASABI_BUCKET, Key: oldKey }));
      deleted++;

      // 3c. Update DB rows that reference the old URL
      const result = await db.query(
        `UPDATE audios
            SET wasabi_key = $1,
                wasabi_url = $2
          WHERE wasabi_url = $3
             OR wasabi_url = $4
             OR wasabi_key = $5`,
        [newKey, newUrl, oldUrl, oldKey, oldKey],
      );
      dbUpdated += result.rowCount ?? 0;
    } catch (err) {
      console.error(`\n✗ ERROR for key "${oldKey.slice(0, 60)}...": ${err.message}`);
      errors++;
    }

    done++;
    if (done % 50 === 0 || done === toMigrate.length) {
      const pct = Math.round((done / toMigrate.length) * 100);
      process.stdout.write(`\r  Progress: ${done}/${toMigrate.length} (${pct}%)  copied=${copied} deleted=${deleted} db=${dbUpdated} errors=${errors}   `);
    }
  });

  await runWithConcurrency(tasks, CONCURRENCY);
  await db.end();

  console.log('\n\n═══════════════════════════════════════');
  console.log(` Objects copied:  ${copied}`);
  console.log(` Objects deleted: ${deleted}`);
  console.log(` DB rows updated: ${dbUpdated}`);
  console.log(` Errors:          ${errors}`);
  console.log('═══════════════════════════════════════');

  if (errors > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
