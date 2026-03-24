import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import pg from 'pg';
const { Client } = pg;

const s3 = new S3Client({
  region: 'us-west-1',
  endpoint: 'https://s3.us-west-1.wasabisys.com',
  credentials: { accessKeyId: 'XPLHVKXHHV6WNYRW01KX', secretAccessKey: 'H2BFzrc9G7kzaNktzlDD7pHtn3NtqM0cO5VGsfzi' },
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const BUCKET   = 'backup.ucall';
const ENDPOINT = 'https://s3.us-west-1.wasabisys.com';

const db = new Client({ connectionString: 'postgresql://cluyeye:Angola2026@10.11.1.117:5432/uvn_db' });
await db.connect();
const r = await db.query("SELECT wasabi_url FROM audios WHERE status='processed' AND wasabi_url IS NOT NULL LIMIT 1");
await db.end();

const storedUrl = r.rows[0].wasabi_url;
console.log('DB wasabi_url:', storedUrl);

const prefix = `${ENDPOINT}/${BUCKET}/`;
let key = storedUrl.startsWith(prefix) ? storedUrl.slice(prefix.length) : storedUrl;
key = key.replace(/\\/g, '/');
console.log('\nKey used for signing:', key);

// HEAD (non-presigned) — should work if object exists
const headRes = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
console.log('\nHeadObject status:', headRes.$metadata.httpStatusCode, '→ object EXISTS');

// Presigned GET
const signed = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
console.log('\nFull signed URL:');
console.log(signed);

const date = signed.match(/X-Amz-Date=([^&]+)/)?.[1];
console.log('\nX-Amz-Date in URL:', date);

const headSigned = await fetch(signed, { method: 'HEAD' });
console.log('HEAD presigned status:', headSigned.status, headSigned.statusText);
