import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // makes ConfigService injectable everywhere without re-importing
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
