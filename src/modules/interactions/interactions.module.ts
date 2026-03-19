import { Module } from '@nestjs/common';
import { MssqlService } from '../../database/mssql.service';
import { InteractionsController } from './interactions.controller';
import { InteractionsService } from './interactions.service';

@Module({
  controllers: [InteractionsController],
  providers:   [InteractionsService, MssqlService],
  exports:     [InteractionsService],
})
export class InteractionsModule {}
