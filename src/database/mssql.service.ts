import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

// How long to wait before retrying a failed connection (ms)
const RECONNECT_COOLDOWN_MS = 30_000;

@Injectable()
export class MssqlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MssqlService.name);
  private pool: sql.ConnectionPool | null = null;
  private connected = false;
  private lastFailedAt: number | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      this.connected = false;
    }
  }

  private get config(): sql.config {
    return {
      server:   this.configService.get<string>('mssql.server')!,
      port:     this.configService.get<number>('mssql.port')!,
      user:     this.configService.get<string>('mssql.user')!,
      password: this.configService.get<string>('mssql.password')!,
      database: this.configService.get<string>('mssql.database')!,
      options: {
        encrypt:                false,
        trustServerCertificate: true,
        enableArithAbort:       true,
      },
      pool: {
        max:               10,
        min:               0,           // 0 so an idle pool doesn't keep a bad connection open
        idleTimeoutMillis: 30_000,
      },
      connectionTimeout: 15_000,
      requestTimeout:    30_000,
    };
  }

  private async connect(): Promise<void> {
    // Respect cooldown — don't hammer the server on every incoming request
    if (this.lastFailedAt && Date.now() - this.lastFailedAt < RECONNECT_COOLDOWN_MS) {
      return;
    }

    // Close any stale pool before reconnecting
    if (this.pool) {
      try { await this.pool.close(); } catch { /* ignore */ }
      this.pool = null;
      this.connected = false;
    }

    try {
      this.pool = await sql.connect(this.config);
      this.connected = true;
      this.lastFailedAt = null;
      this.logger.log(
        `Connected to SQL Server ${this.config.server}:${this.config.port}/${this.config.database}`,
      );
    } catch (err: any) {
      this.pool = null;
      this.connected = false;
      this.lastFailedAt = Date.now();
      this.logger.error(`Failed to connect to SQL Server: ${err.message}`);
    }
  }

  isConnected(): boolean {
    return this.connected && this.pool?.connected === true;
  }

  async query<T = Record<string, unknown>>(
    sqlText: string,
    params: Record<string, { value: unknown; type?: sql.ISqlType }> = {},
  ): Promise<T[]> {
    // Try to reconnect if not connected (subject to cooldown)
    if (!this.isConnected()) {
      await this.connect();
    }

    // After reconnect attempt, pool may still be null if server is unreachable
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'SQL Server não está disponível. Verifique as credenciais e a conectividade.',
      );
    }

    const request = this.pool.request();

    for (const [name, { value, type }] of Object.entries(params)) {
      if (type) {
        request.input(name, type, value);
      } else {
        request.input(name, value);
      }
    }

    const result = await request.query<T>(sqlText);
    return result.recordset;
  }

  async queryScalar<T>(
    sqlText: string,
    params: Record<string, { value: unknown; type?: sql.ISqlType }> = {},
  ): Promise<T | null> {
    const rows = await this.query<Record<string, unknown>>(sqlText, params);
    if (!rows.length) return null;
    const firstVal = Object.values(rows[0])[0];
    return firstVal as T;
  }

  /** Expose mssql types for callers that need typed parameters */
  get types() {
    return sql;
  }
}
