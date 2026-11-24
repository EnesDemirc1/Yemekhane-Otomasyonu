import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as net from 'node:net';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private pending: Array<{ resolve: (value: string) => void; reject: (reason: Error) => void }> = [];

  constructor() {
    this.socket = net.createConnection({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379) });
    this.socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    });
    this.socket.on('error', error => {
      for (const request of this.pending.splice(0)) request.reject(error);
    });
  }

  private flush() {
    while (this.pending.length && this.buffer.length) {
      const parsed = this.parse(this.buffer, 0);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.next);
      this.pending.shift()!.resolve(parsed.value);
    }
  }

  private parse(buffer: Buffer, start: number): { value: any; next: number } | null {
    const end = buffer.indexOf('\r\n', start);
    if (end < 0) return null;
    const type = String.fromCharCode(buffer[start]);
    const header = buffer.toString('utf8', start + 1, end);
    if (type === '+' || type === ':') return { value: header, next: end + 2 };
    if (type === '-') throw new Error(header);
    const size = Number(header);
    if (type === '$') {
      if (size < 0) return { value: '', next: end + 2 };
      if (buffer.length < end + 2 + size + 2) return null;
      return { value: buffer.toString('utf8', end + 2, end + 2 + size), next: end + 2 + size + 2 };
    }
    if (type === '*') {
      const values: string[] = [];
      let cursor = end + 2;
      for (let index = 0; index < size; index++) {
        const item = this.parse(buffer, cursor);
        if (!item) return null;
        values.push(item.value);
        cursor = item.next;
      }
      return { value: values, next: cursor };
    }
    return { value: '', next: end + 2 };
  }

  async command(...parts: Array<string | number>) {
    const payload = `*${parts.length}\r\n${parts.map(part => `$${Buffer.byteLength(String(part))}\r\n${part}\r\n`).join('')}`;
    return new Promise<string>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(payload);
    });
  }

  async get(key: string) { return this.command('GET', key); }
  async set(key: string, value: string, seconds?: number) {
    return seconds ? this.command('SET', key, value, 'EX', seconds) : this.command('SET', key, value);
  }
  async del(key: string) { return this.command('DEL', key); }
  async expire(key: string, seconds: number) { return this.command('EXPIRE', key, seconds); }
  async keys(pattern: string) { return this.command('KEYS', pattern) as unknown as string[]; }

  async deletePattern(pattern: string) {
    const keys = await this.keys(pattern);
    if (keys.length) await this.command('DEL', ...keys);
  }

  async onModuleDestroy() {
    this.socket.end();
  }
}
