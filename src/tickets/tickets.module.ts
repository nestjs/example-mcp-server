import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service.js';
import { TicketsTools } from './tickets.tools.js';

@Module({
  providers: [TicketsService, TicketsTools],
})
export class TicketsModule {}
