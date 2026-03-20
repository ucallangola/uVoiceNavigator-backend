import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as fs from 'fs';

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
    });
  }

  async upload(sourcePath: string, filename: string, mimeType: string): Promise<UploadResult> {
    const key = `${this.prefix}${filename}`;
    const body = fs.createReadStream(sourcePath);

    await this.client.send(new PutObjectCommand({
      Bucket:      this.bucket,
      Key:         key,
      Body:        body,
      ContentType: mimeType,
    }));

    const wasabiUrl = `${this.endpoint}/${this.bucket}/${key}`;
    this.logger.log(`Uploaded ${filename} → ${wasabiUrl}`);

    return { wasabiKey: key, wasabiUrl };
  }
}
