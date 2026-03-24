import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, Max, Min } from 'class-validator';

export class CreateAlertDto {
  @ApiProperty({ description: 'Recipient email address', example: 'manager@uvoice.com' })
  @IsEmail()
  @IsNotEmpty()
  recipientEmail: string;

  @ApiProperty({
    description: 'Alert type: instant (sent on ETL completion) or scheduled (sent at a specific hour)',
    enum: ['instant', 'scheduled'],
    default: 'instant',
  })
  @IsIn(['instant', 'scheduled'])
  @IsOptional()
  alertType?: 'instant' | 'scheduled' = 'instant';

  @ApiPropertyOptional({
    description: 'Hour of day to send scheduled alert (0-23) — required when alertType is scheduled',
    example: 8,
  })
  @IsInt()
  @Min(0)
  @Max(23)
  @IsOptional()
  sendHour?: number;

  @ApiPropertyOptional({ description: 'Whether alert is enabled', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;
}
