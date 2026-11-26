import { NestFactory } from '@nestjs/core';
import { McpStdioLogger, McpStdioServer } from '@nestjs/mcp';
import { AppModule, ObserveInstrument } from './app.module.js';

// stdout carries the protocol: every log line goes to stderr.
const app = await NestFactory.createApplicationContext(AppModule, {
  instrument: ObserveInstrument,
  logger: new McpStdioLogger(),
});
await app.get(McpStdioServer).listen();
await app.close();
