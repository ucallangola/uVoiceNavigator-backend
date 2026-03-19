import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

export const AUDIO_PROCESSING_QUEUE = 'audio-processing';
export const PROCESS_AUDIO_JOB = 'process-audio';

@Processor(AUDIO_PROCESSING_QUEUE)
export class AudioProcessingProcessor {
  private readonly logger = new Logger(AudioProcessingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process(PROCESS_AUDIO_JOB)
  async handleProcessAudio(job: Job<{ audioId: string }>) {
    const { audioId } = job.data;

    this.logger.log(`Processing audio job: ${audioId}`);

    const audio = await this.prisma.audio.findUnique({ where: { id: audioId } });

    if (!audio) {
      this.logger.warn(`Audio not found: ${audioId}`);
      return;
    }

    if (audio.status !== 'pending') {
      this.logger.log(`Audio ${audioId} is not pending, skipping`);
      return;
    }

    try {
      // Simulate audio processing (transcription, analysis, etc.)
      // In production, this would call the actual audio processing service
      await this.simulateAudioProcessing(audio);

      await this.prisma.audio.update({
        where: { id: audioId },
        data: {
          status: 'processed',
          processedAt: new Date(),
        },
      });

      this.notificationsService.emit('audio:processed', { audioId, filename: audio.filename });
      this.notificationsService.emit('dashboard:refresh', {});
      this.logger.log(`Audio processed successfully: ${audioId}`);
    } catch (error) {
      this.logger.error(`Audio processing failed: ${audioId} - ${error.message}`);

      await this.prisma.audio.update({
        where: { id: audioId },
        data: { status: 'error' },
      });

      this.notificationsService.emit('audio:error', { audioId, filename: audio.filename, error: error.message });

      throw error;
    }
  }

  private async simulateAudioProcessing(audio: any): Promise<void> {
    // Placeholder for actual audio processing logic
    // In production, integrate with speech-to-text, sentiment analysis, etc.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
