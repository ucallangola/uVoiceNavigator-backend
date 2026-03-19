import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

@Injectable()
export class MssqlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MssqlService.name);
  private pool: sql.ConnectionPool | null = null;
  private connected = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.close();
      this.connected = false;
    }
  }

  private async connect() {
    const config: sql.config = {
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
        min:               1,
        idleTimeoutMillis: 30000,
      },
      connectionTimeout: 15000,
      requestTimeout:    30000,
    };

    try {
      this.pool = await sql.connect(config);
      this.connected = true;
      this.logger.log(`Connected to SQL Server ${config.server}:${config.port}/${config.database}`);
    } catch (err: any) {
      this.connected = false;
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
    if (!this.pool || !this.connected) {
      await this.connect();
    }

    const request = this.pool!.request();

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

  async queryScalar<T>(sqlText: string, params: Record<string, { value: unknown; type?: sql.ISqlType }> = {}): Promise<T | null> {
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
