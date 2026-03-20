import { registerAs } from '@nestjs/config';

export default registerAs('etl', () => ({
  sourceDir:    process.env.ETL_SOURCE_DIR    || '/mnt/audios/incoming',
  processedDir: process.env.ETL_PROCESSED_DIR || '/mnt/audios/processed',
  failedDir:    process.env.ETL_FAILED_DIR    || '/mnt/audios/failed',
  cronSchedule: process.env.ETL_CRON          || '0 */1 * * *', // every hour
  wasabi: {
    accessKey:  process.env.WASABI_ACCESS_KEY || '',
    secretKey:  process.env.WASABI_SECRET_KEY || '',
    region:     process.env.WASABI_REGION     || 'us-west-1',
    endpoint:   process.env.WASABI_ENDPOINT   || 'https://s3.us-west-1.wasabisys.com',
    bucket:     process.env.WASABI_BUCKET     || 'backup.ucall',
    prefix:     process.env.WASABI_PREFIX     || 'audios/',
  },
}));
