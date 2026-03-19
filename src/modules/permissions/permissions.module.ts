import { Module } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService, PrismaService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
