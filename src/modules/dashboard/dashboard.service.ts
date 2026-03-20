import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MssqlService } from '../../database/mssql.service';

// SQL that unions both BCB tables and provides a consistent shape
const BCB_UNION = `
  SELECT
    CAST(Id AS NVARCHAR(50)) AS id,
    'inbound'  AS recordType,
    [Date]     AS date,
    ISNULL(Agent,   '')                                      AS agentName,
    ISNULL(CAST(AgentId AS NVARCHAR(50)), '')                AS agentId,
    ISNULL(Campaign, '')                                     AS campaign,
    ISNULL(DATEDIFF(SECOND, '00:00:00', TalkTime), 0)        AS talkTime,
    ISNULL(Abandoned, 0)                                     AS abandoned
  FROM [dbo].[CallRecordManualImportBCBInbs]
  UNION ALL
  SELECT
    CAST(Id AS NVARCHAR(50)) AS id,
    'outbound' AS recordType,
    [Date]     AS date,
    ISNULL(Agent,   '')                                      AS agentName,
    ISNULL(CAST(AgentId AS NVARCHAR(50)), '')                AS agentId,
    ISNULL(Campaign, '')                                     AS campaign,
    ISNULL(DATEDIFF(SECOND, '00:00:00', TalkTime), 0)        AS talkTime,
    ISNULL(Abandoned, 0)                                     AS abandoned
  FROM [dbo].[CallRecordManualImportBCBOuts]
`;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private prisma: PrismaService,
    private mssql:  MssqlService,
  ) {}

  private getDateRange(period: string): { start: Date; end: Date } {
    const end   = new Date();
    const start = new Date();

    switch (period) {
      case '14d': start.setDate(start.getDate() - 14); break;
      case '30d': start.setDate(start.getDate() - 30); break;
      case '90d': start.setDate(start.getDate() - 90); break;
      default:    start.setDate(start.getDate() - 7);
    }

    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  async getStats(period: string = '7d') {
    const { start, end } = this.getDateRange(period);

    const today     = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday    = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const tomorrowStart = new Date(today);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    // Audio stats still come from Prisma/PostgreSQL
    const [
      totalAudiosToday,
      totalAudiosYesterday,
      processedAudios,
      totalAudios,
      totalSizeAgg,
    ] = await Promise.all([
      this.prisma.audio.count({ where: { uploadedAt: { gte: today, lt: tomorrowStart } } }),
      this.prisma.audio.count({ where: { uploadedAt: { gte: yesterday, lt: today } } }),
      this.prisma.audio.count({ where: { uploadedAt: { gte: start, lte: end }, status: 'processed' } }),
      this.prisma.audio.count({ where: { uploadedAt: { gte: start, lte: end } } }),
      this.prisma.audio.aggregate({ _sum: { fileSize: true } }),
    ]);

    // Interaction stats from SQL Server
    const intStats = await this.mssql.query<any>(`
      WITH cte AS (${BCB_UNION})
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN recordType = 'inbound'  THEN 1 ELSE 0 END) AS inbound,
        SUM(CASE WHEN recordType = 'outbound' THEN 1 ELSE 0 END) AS outbound,
        SUM(CASE WHEN abandoned  = 1          THEN 1 ELSE 0 END) AS abandoned
      FROM cte
      WHERE date >= @start AND date <= @end
    `, {
      start: { value: start },
      end:   { value: end },
    });

    const s = intStats[0] ?? {};
    const processingRate = totalAudios > 0
      ? Math.round((processedAudios / totalAudios) * 100)
      : 0;

    return {
      totalAudiosToday,
      totalAudiosYesterday,
      totalInteractions: s.total    ?? 0,
      totalInbound:      s.inbound  ?? 0,
      totalOutbound:     s.outbound ?? 0,
      totalAbandoned:    s.abandoned ?? 0,
      processingRate,
      storageUsed: totalSizeAgg._sum.fileSize || 0,
    };
  }

  async getTrends(period: string = '7d') {
    const { start, end } = this.getDateRange(period);

    const diffMs   = end.getTime() - start.getTime();
    const totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    // ── Single MSSQL query: interactions grouped by day ────────────────
    const intRows = await this.mssql.query<{
      day: Date; interactions: number; inbound: number; outbound: number; abandoned: number;
    }>(`
      WITH cte AS (${BCB_UNION})
      SELECT
        CAST(date AS DATE)                                          AS day,
        COUNT(*)                                                     AS interactions,
        SUM(CASE WHEN recordType = 'inbound'  THEN 1 ELSE 0 END)   AS inbound,
        SUM(CASE WHEN recordType = 'outbound' THEN 1 ELSE 0 END)   AS outbound,
        SUM(CASE WHEN abandoned  = 1          THEN 1 ELSE 0 END)   AS abandoned
      FROM cte
      WHERE date >= @start AND date <= @end
      GROUP BY CAST(date AS DATE)
      ORDER BY day
    `, { start: { value: start }, end: { value: end } });

    const intMap = new Map<string, (typeof intRows)[0]>();
    for (const r of intRows) {
      intMap.set(new Date(r.day).toISOString().split('T')[0], r);
    }

    // ── Build day starts array ──────────────────────────────────────────
    const dayStarts = Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });

    // ── Parallel Prisma queries (local PG — fast) ───────────────────────
    const audioStats = await Promise.all(
      dayStarts.map(dayStart => {
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        return Promise.all([
          this.prisma.audio.count({ where: { uploadedAt: { gte: dayStart, lt: dayEnd } } }),
          this.prisma.audio.count({ where: { uploadedAt: { gte: dayStart, lt: dayEnd }, status: 'processed' } }),
          this.prisma.audio.count({ where: { uploadedAt: { gte: dayStart, lt: dayEnd }, status: 'error' } }),
        ]);
      }),
    );

    return dayStarts.map((day, i) => {
      const key = day.toISOString().split('T')[0];
      const ir  = intMap.get(key);
      const [audios, processed, errors] = audioStats[i];
      return {
        date:         key,
        audios,
        processed,
        errors,
        interactions: Number(ir?.interactions ?? 0),
        inbound:      Number(ir?.inbound      ?? 0),
        outbound:     Number(ir?.outbound     ?? 0),
        abandoned:    Number(ir?.abandoned    ?? 0),
      };
    });
  }

  async getHourlyData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // ── Single MSSQL query: group by hour for today ─────────────────────
    const intRows = await this.mssql.query<{
      hour: number; inbound: number; outbound: number;
    }>(`
      WITH cte AS (${BCB_UNION})
      SELECT
        DATEPART(HOUR, date)                                        AS hour,
        SUM(CASE WHEN recordType = 'inbound'  THEN 1 ELSE 0 END)  AS inbound,
        SUM(CASE WHEN recordType = 'outbound' THEN 1 ELSE 0 END)  AS outbound
      FROM cte
      WHERE CAST(date AS DATE) = CAST(@today AS DATE)
      GROUP BY DATEPART(HOUR, date)
      ORDER BY hour
    `, { today: { value: today } });

    const intHourMap = new Map<number, (typeof intRows)[0]>();
    for (const r of intRows) intHourMap.set(r.hour, r);

    // ── Parallel Prisma queries per hour ────────────────────────────────
    const audioByHour = await Promise.all(
      Array.from({ length: 24 }, (_, hour) => {
        const hs = new Date(today); hs.setHours(hour, 0, 0, 0);
        const he = new Date(today); he.setHours(hour + 1, 0, 0, 0);
        return this.prisma.audio.count({ where: { uploadedAt: { gte: hs, lt: he } } });
      }),
    );

    return Array.from({ length: 24 }, (_, hour) => {
      const ir = intHourMap.get(hour);
      return {
        hour,
        label:    `${String(hour).padStart(2, '0')}:00`,
        inbound:  Number(ir?.inbound  ?? 0),
        outbound: Number(ir?.outbound ?? 0),
        interactions: Number((ir?.inbound ?? 0) + (ir?.outbound ?? 0)),
        audios:   audioByHour[hour],
      };
    });
  }

  async getTopAgents(period: string = '7d', limit: number = 10) {
    const { start, end } = this.getDateRange(period);

    const rows = await this.mssql.query<any>(`
      WITH cte AS (${BCB_UNION})
      SELECT TOP ${limit}
        agentName,
        agentId,
        COUNT(*)                     AS totalInteractions,
        AVG(CAST(talkTime   AS FLOAT)) AS avgTalkTime,
        SUM(CAST(talkTime   AS BIGINT)) AS totalTalkTime
      FROM cte
      WHERE date >= @start AND date <= @end
        AND agentName != ''
      GROUP BY agentName, agentId
      ORDER BY totalInteractions DESC
    `, {
      start: { value: start },
      end:   { value: end },
    });

    return rows.map(a => ({
      agentName:         a.agentName,
      agentId:           a.agentId,
      totalInteractions: a.totalInteractions,
      avgTalkTime:       Math.round(a.avgTalkTime ?? 0),
      totalTalkTime:     a.totalTalkTime ?? 0,
    }));
  }

  async getDispositions(period: string = '7d') {
    const { start, end } = this.getDateRange(period);

    const rows = await this.mssql.query<{ disposition: string; count: number }>(`
      WITH cte AS (
        SELECT ISNULL(Disposition, '') AS disposition, [Date] AS date
        FROM [dbo].[CallRecordManualImportBCBInbs]
        UNION ALL
        SELECT ISNULL(Disposition, '') AS disposition, [Date] AS date
        FROM [dbo].[CallRecordManualImportBCBOuts]
      )
      SELECT TOP 10
        disposition,
        COUNT(*) AS count
      FROM cte
      WHERE date >= @start AND date <= @end
        AND disposition != ''
      GROUP BY disposition
      ORDER BY count DESC
    `, {
      start: { value: start },
      end:   { value: end },
    });

    const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
    return rows.map(r => ({
      name:       r.disposition,
      value:      Number(r.count),
      percentage: total > 0 ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
    }));
  }

  async getSourceDistribution() {
    // Source distribution still from Prisma/audio files
    const [goContactCount, five9Count, goContactTotal, five9Total] = await Promise.all([
      this.prisma.audio.count({ where: { source: 'GO_CONTACT' } }),
      this.prisma.audio.count({ where: { source: 'FIVE9' } }),
      this.prisma.audio.aggregate({
        where: { source: 'GO_CONTACT' },
        _sum:  { fileSize: true, duration: true },
      }),
      this.prisma.audio.aggregate({
        where: { source: 'FIVE9' },
        _sum:  { fileSize: true, duration: true },
      }),
    ]);

    const total = goContactCount + five9Count;

    return {
      total,
      sources: [
        {
          source:        'GO_CONTACT',
          count:         goContactCount,
          percentage:    total > 0 ? Math.round((goContactCount / total) * 100 * 10) / 10 : 0,
          totalFileSize: goContactTotal._sum.fileSize || 0,
          totalDuration: goContactTotal._sum.duration || 0,
        },
        {
          source:        'FIVE9',
          count:         five9Count,
          percentage:    total > 0 ? Math.round((five9Count / total) * 100 * 10) / 10 : 0,
          totalFileSize: five9Total._sum.fileSize || 0,
          totalDuration: five9Total._sum.duration || 0,
        },
      ],
    };
  }
}
