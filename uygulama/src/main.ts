import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '1mb' }));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: false });
  await app.listen(8000, '0.0.0.0');
}

bootstrap();
