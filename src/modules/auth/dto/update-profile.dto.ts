import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ description: 'Full name', example: 'João Silva' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
}
