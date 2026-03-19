import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryInteractionsDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Search across agent name, customer name, phone' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by record type', enum: ['inbound', 'outbound'] })
  @IsOptional()
  @IsIn(['inbound', 'outbound'])
  recordType?: string;

  @ApiPropertyOptional({ description: 'Filter by agent name' })
  @IsOptional()
  @IsString()
  agentName?: string;

  @ApiPropertyOptional({ description: 'Filter by campaign' })
  @IsOptional()
  @IsString()
  campaign?: string;

  @ApiPropertyOptional({ description: 'Filter by status', enum: ['processed', 'pending', 'error'] })
  @IsOptional()
  @IsIn(['processed', 'pending', 'error'])
  status?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO 8601)', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Minimum talk time in seconds' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  talkTimeMin?: number;

  @ApiPropertyOptional({ description: 'Maximum talk time in seconds' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  talkTimeMax?: number;

  @ApiPropertyOptional({ description: 'Field to order by', default: 'date' })
  @IsOptional()
  @IsString()
  orderBy?: string = 'date';

  @ApiPropertyOptional({ description: 'Order direction', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  orderDir?: 'asc' | 'desc' = 'desc';
}
