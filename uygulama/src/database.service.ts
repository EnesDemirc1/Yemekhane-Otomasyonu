import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, Pool, RowDataPacket } from 'mysql2/promise';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly write: Pool;
  readonly read: Pool;

  constructor() {
    const common = {
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_KULLANICI,
      password: process.env.DB_SIFRE,
      database: process.env.DB_ADI,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 10,
      timezone: '+03:00',
      dateStrings: true,
      decimalNumbers: true
    };
    this.write = createPool({ ...common, host: process.env.DB_YAZMA_HOST });
    this.read = createPool({ ...common, host: process.env.DB_OKUMA_HOST });
  }

  async rows<T extends RowDataPacket = RowDataPacket>(sql: string, values: unknown[] = []) {
    const [result] = await this.read.query<T[]>(sql, values);
    return result;
  }

  async onModuleDestroy() {
    await Promise.all([this.write.end(), this.read.end()]);
  }
}
