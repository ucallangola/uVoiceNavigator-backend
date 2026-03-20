import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export interface ScannedFile {
  filename: string;   // relative path from sourceDir, e.g. "3_20_2026/file.wav"
  sourcePath: string; // absolute path
  fileSize: number;
  mimeType: string;
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.wma']);

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);

  constructor(private config: ConfigService) {}

  async scan(): Promise<ScannedFile[]> {
    const sourceDir    = this.config.get<string>('etl.sourceDir');
    const processedDir = path.normalize(this.config.get<string>('etl.processedDir'));
    const failedDir    = path.normalize(this.config.get<string>('etl.failedDir'));

    const files: ScannedFile[] = [];
    this.scanDir(sourceDir, sourceDir, processedDir, failedDir, files);
    this.logger.log(`Scanned ${sourceDir}: found ${files.length} audio file(s)`);
    return files;
  }

  private scanDir(
    baseDir:      string,
    currentDir:   string,
    processedDir: string,
    failedDir:    string,
    files:        ScannedFile[],
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err: any) {
      this.logger.error(`Cannot read directory "${currentDir}": ${err.message}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip the processed and failed output directories
        if (
          path.normalize(fullPath) === processedDir ||
          path.normalize(fullPath) === failedDir
        ) continue;

        this.scanDir(baseDir, fullPath, processedDir, failedDir, files);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) continue;

      const stat = fs.statSync(fullPath);
      const relativePath = path.relative(baseDir, fullPath); // e.g. "3_20_2026\file.wav"

      files.push({
        filename:   relativePath,
        sourcePath: fullPath,
        fileSize:   stat.size,
        mimeType:   this.mimeForExt(ext),
      });
    }
  }

  private mimeForExt(ext: string): string {
    const map: Record<string, string> = {
      '.mp3':  'audio/mpeg',
      '.wav':  'audio/wav',
      '.ogg':  'audio/ogg',
      '.m4a':  'audio/mp4',
      '.aac':  'audio/aac',
      '.flac': 'audio/flac',
      '.opus': 'audio/opus',
      '.wma':  'audio/x-ms-wma',
    };
    return map[ext] ?? 'application/octet-stream';
  }
}
