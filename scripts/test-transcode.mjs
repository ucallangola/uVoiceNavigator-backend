import Ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';
import fs from 'fs';

Ffmpeg.setFfmpegPath(ffmpegStatic);

const s3 = new S3Client({
  region: 'us-west-1', endpoint: 'https://s3.us-west-1.wasabisys.com',
  credentials: { accessKeyId: 'XPLHVKXHHV6WNYRW01KX', secretAccessKey: 'H2BFzrc9G7kzaNktzlDD7pHtn3NtqM0cO5VGsfzi' },
  forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
});

const db = new pg.Client({ connectionString: 'postgresql://cluyeye:Angola2026@10.11.1.117:5432/uvn_db' });
await db.connect();
const r = await db.query("SELECT wasabi_url FROM audios WHERE status='processed' AND wasabi_url IS NOT NULL LIMIT 1");
await db.end();

const storedUrl = r.rows[0].wasabi_url;
const prefix = 'https://s3.us-west-1.wasabisys.com/backup.ucall/';
const key = storedUrl.startsWith(prefix) ? storedUrl.slice(prefix.length).replace(/\\/g, '/') : storedUrl;
console.log('Key:', key.slice(0, 100));

const resp = await s3.send(new GetObjectCommand({ Bucket: 'backup.ucall', Key: key }));
const s3Stream = resp.Body;

const outPath = 'C:/Users/cluyeye/AppData/Local/Temp/test-transcoded.wav';
const out = fs.createWriteStream(outPath);

Ffmpeg(s3Stream)
  .audioCodec('pcm_s16le').audioFrequency(8000).audioChannels(1).format('wav')
  .on('error', e => { console.error('ffmpeg error:', e.message); process.exit(1); })
  .on('end', () => {
    const size = fs.statSync(outPath).size;
    console.log('Transcoded OK → ' + outPath + ' (' + size + ' bytes)');
    // Check first bytes for PCM WAV header
    const buf = Buffer.alloc(36);
    const fd = fs.openSync(outPath, 'r');
    fs.readSync(fd, buf, 0, 36, 0);
    fs.closeSync(fd);
    console.log('Output format code:', buf.readUInt16LE(20), '(should be 1 for PCM)');
    console.log('Sample rate:', buf.readUInt32LE(24), '| Channels:', buf.readUInt16LE(22));
  })
  .pipe(out);
