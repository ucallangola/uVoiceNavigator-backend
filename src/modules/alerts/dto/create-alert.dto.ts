import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAlertDto {
  @ApiProperty({ description: 'Recipient email address', example: 'manager@uvoice.com' })
  @IsEmail()
  @IsNotEmpty()
  recipientEmail: string;

  @ApiProperty({
    description: 'Alert type: periodic (cron-scheduled) or instant (sent on ETL completion)',
    enum: ['periodic', 'instant'],
    default: 'periodic',
  })
  @IsIn(['periodic', 'instant'])
  @IsOptional()
  alertType?: 'periodic' | 'instant' = 'periodic';

  @ApiPropertyOptional({
    description: 'Cron expression — required when alertType is periodic',
    example: '0 8 * * 1-5',
  })
  @IsString()
  @IsOptional()
  schedule?: string;

  @ApiPropertyOptional({ description: 'Whether alert is enabled', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;
}
