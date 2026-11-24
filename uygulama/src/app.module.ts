import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { RedisService } from './redis.service';
import { ApiController } from './api.controller';

@Module({ controllers: [ApiController], providers: [DatabaseService, RedisService] })
export class AppModule {}
