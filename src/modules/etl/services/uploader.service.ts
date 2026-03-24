import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as Ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

// Point fluent-ffmpeg at the bundled binary so no system ffmpeg is needed.
if (ffmpegStatic) Ffmpeg.setFfmpegPath(ffmpegStatic);

export interface UploadResult {
  wasabiKey: string;
  wasabiUrl: string;
}

@Injectable()
export class UploaderService {
  private readonly logger = new Logger(UploaderService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly endpoint: string;

  constructor(private config: ConfigService) {
    const wasabi = this.config.get('etl.wasabi');
    this.bucket   = wasabi.bucket;
    this.prefix   = wasabi.prefix;
    this.endpoint = wasabi.endpoint;

    this.client = new S3Client({
      region:   wasabi.region,
      endpoint: wasabi.endpoint,
      credentials: {
        accessKeyId:     wasabi.accessKey,
        secretAccessKey: wasabi.secretKey,
      },
      forcePathStyle: true,
      // Disable automatic checksum calculation/validation — Wasabi does not support
      // the x-amz-checksum-mode header that AWS SDK v3 adds by default, which causes
      // it to return 403 on presigned GET requests.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async upload(sourcePath: string, filename: string, mimeType: string): Promise<UploadResult> {
    // Normalize Windows backslashes to forward slashes — S3 uses / as the path separator.
    // path.relative() on Windows returns e.g. "3_2_2026\file.wav"; without this the
    // backslash ends up as a literal character in the Wasabi object key.
    const normalizedFilename = filename.replace(/\\/g, '/');
    const key  = `${this.prefix}${normalizedFilename}`;
    const body = fs.createReadStream(sourcePath);

    await this.client.send(new PutObjectCommand({
      Bucket:      this.bucket,
      Key:         key,
      Body:        body,
      ContentType: mimeType,
    }));

    const wasabiUrl = `${this.endpoint}/${this.bucket}/${key}`;
    this.logger.log(`Uploaded ${normalizedFilename} → ${wasabiUrl}`);

    return { wasabiKey: key, wasabiUrl };
  }

  /**
   * Streams an audio object from Wasabi, transcoding to browser-compatible PCM WAV on-the-fly.
   *
   * Many call-centre recordings are stored as GSM 6.10 WAV (format code 49) which
   * browsers cannot decode natively. ffmpeg (bundled via ffmpeg-static) converts the
   * stream to 16-bit 8 kHz mono PCM WAV before it reaches the client.
   */
  async getObjectStream(storedUrl: string): Promise<{
    body:        Readable;
    contentType: string;
  }> {
    const bucketPrefix = `${this.endpoint}/${this.bucket}/`;
    let key = storedUrl.startsWith(bucketPrefix)
      ? storedUrl.slice(bucketPrefix.length)
      : storedUrl;
    key = key.replace(/\\/g, '/');

    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key:    key,
    }));

    const s3Stream = response.Body as Readable;

    // Transcode to 16-bit PCM WAV (universally supported by browsers).
    // Input is piped from S3; output is a Readable piped back to the HTTP response.
    const transcoded = new Readable({ read() {} });

    Ffmpeg(s3Stream)
      .audioCodec('pcm_s16le')
      .audioFrequency(8000)
      .audioChannels(1)
      .format('wav')
      .on('error', (err) => {
        this.logger.error(`ffmpeg transcode error: ${err.message}`);
        transcoded.destroy(err);
      })
      .pipe(transcoded as any, { end: true });

    return {
      body:        transcoded,
      contentType: 'audio/wav',
    };
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Generates a presigned URL from a stored wasabiUrl.
   *
   * Strips the "endpoint/bucket/" prefix with simple string operations (avoids
   * new URL() which re-encodes special characters) and normalises any backslashes
   * to forward slashes before signing.
   *
   * Background: Windows ETL runs used path.relative() which produces backslash-
   * separated paths (e.g. "3_2_2026\file.wav"). Wasabi normalises '\' to '/' when
   * storing the object, so the object key is actually "audios/3_2_2026/file.wav".
   * A presigned URL with '%5C' (URL-encoded backslash) in the path fails with 403
   * because the signature is computed over '%5C' but Wasabi expects it over '/'.
   */
  async getSignedUrlForStoredUrl(storedUrl: string, expiresIn = 3600): Promise<string> {
    const bucketPrefix = `${this.endpoint}/${this.bucket}/`;
    let key = storedUrl.startsWith(bucketPrefix)
      ? storedUrl.slice(bucketPrefix.length)
      : storedUrl;

    // Normalise backslashes — Wasabi stores '\' as '/' internally; the presigned
    // URL must use '/' or the HMAC signature will not match (returns 403).
    key = key.replace(/\\/g, '/');

    return this.getSignedUrl(key, expiresIn);
  }
}
