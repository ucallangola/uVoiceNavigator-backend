import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'New password for the user (min 8 chars, uppercase, digit, special char)',
    example: 'NewSecure1!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/, {
    message:
      'Password must contain at least one uppercase letter, one digit, and one special character',
  })
  password: string;
}
