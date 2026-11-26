import { Module } from '@nestjs/common';
import { AccessTokenVerifier } from './access-token.verifier.js';

@Module({
  providers: [AccessTokenVerifier],
  exports: [AccessTokenVerifier],
})
export class AuthModule {}
