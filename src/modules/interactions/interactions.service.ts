// ============================================================
// InteractionsService — SQL Server (BCB Go Contact)
//
// Data comes from two tables in [DBC].[dbo]:
//   CallRecordManualImportBCBInbs  → recordType = 'inbound'
//   CallRecordManualImportBCBOuts  → recordType = 'outbound'
//
// COLUMN MAPPING — update the constants below if the actual
// column names in SQL Server differ from these defaults.
// Run: SELECT TOP 1 * FROM [dbo].[CallRecordManualImportBCBInbs]
// to verify.
// ============================================================

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createPaginatedResult } from '../../common/pagination/paginated-result.interface';
import { MssqlService } from '../../database/mssql.service';
import { QueryInteractionsDto } from './dto/query-interactions.dto';

// ── Inbound column names ────────────────────────────────────
const INB = {
  id:           'Id',
  callId:       'CallId',
  contactId:    'ContactId',
  date:         '[Date]',
  agentId:      'AgentId',
  agentName:    'Agent',
  campaign:     'Campaign',
  campaignType: 'CampaignType',
  skill:        'Skill',
  customerName: 'CustomerName',
  customerPhone:'Number1',
  ani:          'Ani',
  dnis:         'Dnis',
  segment:      'Segmento',
  talkTime:     'TalkTime',
  handleTime:   'HandleTime',
  holdTime:     'HoldTime',
  ivrTime:      'IvrTime',
  waitTime:     'QueueWaitTime',
  wrapTime:     'AfterCallWorkTime',
  disposition:  'Disposition',
  dispositionGroupA: 'DispositionGroupA',
  dispositionGroupB: 'DispositionGroupB',
  dispositionGroupC: 'DispositionGroupC',
  abandoned:    'Abandoned',
  list:         'ListName',
  ivrContact:   'FichaSbaContactoMarcadoNoIvr',
  ivrNif:       'FichaSbaNifMarcadoNoIvr',
  ivrAccountNumber: 'FichaSbaNumeroContaMarcadoNoIvr',
};

// ── Outbound column names ───────────────────────────────────
const OUT = {
  id:           'Id',
  callId:       'CallId',
  contactId:    'ContactId',
  date:         '[Date]',
  agentId:      'AgentId',
  agentName:    'Agent',
  campaign:     'Campaign',
  campaignType: 'CampaignType',
  skill:        'Skill',
  customerName: 'CustomerName',
  customerPhone:'Number1',
  ani:          'Ani',
  dnis:         'Dnis',
  talkTime:     'TalkTime',
  handleTime:   'HandleTime',
  holdTime:     'HoldTime',
  ivrTime:      'IvrTime',
  waitTime:     'QueueWaitTime',
  wrapTime:     'AfterCallWorkTime',
  disposition:  'Disposition',
  dispositionGroupA: 'DispositionGroupA',
  dispositionGroupB: 'DispositionGroupB',
  dispositionGroupC: 'DispositionGroupC',
  abandoned:    'Abandoned',
  dialResult:   'DialResult',
  list:         'ListName',
};

// Helper: convert a time column to seconds (INT)
function toSec(col: string): string {
  return `ISNULL(DATEDIFF(SECOND, '00:00:00', ${col}), 0)`;
}

// Helper: build aliased SELECT list for one table
function inbSelect(): string {
  return `
    CAST(${INB.id} AS NVARCHAR(50))                          AS id,
    'inbound'                                                 AS recordType,
    ISNULL(CAST(${INB.callId}    AS NVARCHAR(100)), '')       AS callId,
    ${INB.date}                                               AS date,
    ISNULL(${INB.agentName},  '')                             AS agentName,
    ISNULL(CAST(${INB.agentId}   AS NVARCHAR(50)),  '')       AS agentId,
    ISNULL(${INB.campaign},   '')                             AS campaign,
    ISNULL(${INB.campaignType},'')                            AS campaignType,
    ISNULL(${INB.skill},      '')                             AS skill,
    ISNULL(${INB.customerName},'')                            AS customerName,
    ''                                                        AS customerEmail,
    ISNULL(${INB.customerPhone}, '')                          AS customerPhone,
    ISNULL(${INB.ani},        '')                             AS ani,
    ISNULL(${INB.dnis},       '')                             AS dnis,
    ISNULL(${INB.segment},    '')                             AS segment,
    ISNULL(${INB.list},       '')                             AS list,
    ISNULL(CAST(${INB.contactId} AS NVARCHAR(100)), '')       AS contactId,
    ${toSec(INB.talkTime)}                                    AS talkTime,
    ${toSec(INB.handleTime)}                                  AS handleTime,
    ${toSec(INB.holdTime)}                                    AS holdTime,
    ${toSec(INB.ivrTime)}                                     AS ivrTime,
    ${toSec(INB.waitTime)}                                    AS waitTime,
    ${toSec(INB.wrapTime)}                                    AS wrapTime,
    ISNULL(${INB.disposition}, '')                            AS disposition,
    ISNULL(${INB.dispositionGroupA}, '')                      AS dispositionGroupA,
    ISNULL(${INB.dispositionGroupB}, '')                      AS dispositionGroupB,
    ISNULL(${INB.dispositionGroupC}, '')                      AS dispositionGroupC,
    ''                                                        AS dialResult,
    ISNULL(${INB.abandoned},  0)                              AS abandoned,
    1                                                         AS callCount,
    0                                                         AS suspensionCount,
    ISNULL(${INB.ivrContact}, '')                             AS ivrContact,
    ISNULL(${INB.ivrNif},     '')                             AS ivrNif,
    ISNULL(${INB.ivrAccountNumber}, '')                       AS ivrAccountNumber,
    MONTH(${INB.date})                                        AS businessMonth,
    DATEPART(WEEKDAY, ${INB.date})                            AS businessDayOfWeek,
    DAY(${INB.date})                                          AS businessDayOfMonth,
    DATEPART(HOUR, ${INB.date})                               AS businessHour,
    0                                                         AS evaluated,
    'processed'                                               AS status
  FROM [dbo].[CallRecordManualImportBCBInbs]`;
}

function outSelect(): string {
  return `
    CAST(${OUT.id} AS NVARCHAR(50))                          AS id,
    'outbound'                                                AS recordType,
    ISNULL(CAST(${OUT.callId}    AS NVARCHAR(100)), '')       AS callId,
    ${OUT.date}                                               AS date,
    ISNULL(${OUT.agentName},  '')                             AS agentName,
    ISNULL(CAST(${OUT.agentId}   AS NVARCHAR(50)),  '')       AS agentId,
    ISNULL(${OUT.campaign},   '')                             AS campaign,
    ISNULL(${OUT.campaignType},'')                            AS campaignType,
    ISNULL(${OUT.skill},      '')                             AS skill,
    ISNULL(${OUT.customerName},'')                            AS customerName,
    ''                                                        AS customerEmail,
    ISNULL(${OUT.customerPhone}, '')                          AS customerPhone,
    ISNULL(${OUT.ani},        '')                             AS ani,
    ISNULL(${OUT.dnis},       '')                             AS dnis,
    ''                                                        AS segment,
    ISNULL(${OUT.list},       '')                             AS list,
    ISNULL(CAST(${OUT.contactId} AS NVARCHAR(100)), '')       AS contactId,
    ${toSec(OUT.talkTime)}                                    AS talkTime,
    ${toSec(OUT.handleTime)}                                  AS handleTime,
    ${toSec(OUT.holdTime)}                                    AS holdTime,
    ${toSec(OUT.ivrTime)}                                     AS ivrTime,
    ${toSec(OUT.waitTime)}                                    AS waitTime,
    ${toSec(OUT.wrapTime)}                                    AS wrapTime,
    ISNULL(${OUT.disposition}, '')                            AS disposition,
    ISNULL(${OUT.dispositionGroupA}, '')                      AS dispositionGroupA,
    ISNULL(${OUT.dispositionGroupB}, '')                      AS dispositionGroupB,
    ISNULL(${OUT.dispositionGroupC}, '')                      AS dispositionGroupC,
    ISNULL(${OUT.dialResult},  '')                            AS dialResult,
    ISNULL(${OUT.abandoned},   0)                             AS abandoned,
    1                                                         AS callCount,
    0                                                         AS suspensionCount,
    ''                                                        AS ivrContact,
    ''                                                        AS ivrNif,
    ''                                                        AS ivrAccountNumber,
    MONTH(${OUT.date})                                        AS businessMonth,
    DATEPART(WEEKDAY, ${OUT.date})                            AS businessDayOfWeek,
    DAY(${OUT.date})                                          AS businessDayOfMonth,
    DATEPART(HOUR, ${OUT.date})                               AS businessHour,
    0                                                         AS evaluated,
    'processed'                                               AS status
  FROM [dbo].[CallRecordManualImportBCBOuts]`;
}

@Injectable()
export class InteractionsService {
  private readonly logger = new Logger(InteractionsService.name);

  constructor(private mssql: MssqlService) {}

  async findAll(query: QueryInteractionsDto) {
    const {
      page = 1,
      limit = 10,
      search,
      recordType,
      agentName,
      campaign,
      dateFrom,
      dateTo,
      talkTimeMin,
      talkTimeMax,
      orderBy = 'date',
      orderDir = 'desc',
    } = query;

    const offset = (page - 1) * limit;
    const params: Record<string, { value: unknown }> = {};
    const filters: string[] = [];

    if (dateFrom) {
      filters.push(`date >= @dateFrom`);
      params['dateFrom'] = { value: new Date(dateFrom) };
    }
    if (dateTo) {
      filters.push(`date <= @dateTo`);
      params['dateTo'] = { value: new Date(dateTo) };
    }
    if (agentName) {
      filters.push(`agentName LIKE @agentName`);
      params['agentName'] = { value: `%${agentName}%` };
    }
    if (campaign) {
      filters.push(`campaign LIKE @campaign`);
      params['campaign'] = { value: `%${campaign}%` };
    }
    if (search) {
      filters.push(`(agentName LIKE @search OR customerPhone LIKE @search OR campaign LIKE @search OR callId LIKE @search)`);
      params['search'] = { value: `%${search}%` };
    }
    if (talkTimeMin !== undefined) {
      filters.push(`talkTime >= @talkTimeMin`);
      params['talkTimeMin'] = { value: talkTimeMin };
    }
    if (talkTimeMax !== undefined) {
      filters.push(`talkTime <= @talkTimeMax`);
      params['talkTimeMax'] = { value: talkTimeMax };
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    // Determine which source tables to include
    let unionSql: string;
    if (recordType === 'inbound') {
      unionSql = `SELECT ${inbSelect()}`;
    } else if (recordType === 'outbound') {
      unionSql = `SELECT ${outSelect()}`;
    } else {
      unionSql = `SELECT ${inbSelect()} UNION ALL SELECT ${outSelect()}`;
    }

    const safeOrderBy = ['date', 'agentName', 'campaign', 'talkTime', 'handleTime'].includes(orderBy)
      ? orderBy
      : 'date';
    const safeDir = orderDir === 'asc' ? 'ASC' : 'DESC';

    const dataSql = `
      WITH cte AS (${unionSql})
      SELECT * FROM cte
      ${whereClause}
      ORDER BY ${safeOrderBy} ${safeDir}
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;

    const countSql = `
      WITH cte AS (${unionSql})
      SELECT COUNT(*) AS total FROM cte
      ${whereClause}
    `;

    const [rows, countRows] = await Promise.all([
      this.mssql.query<any>(dataSql, params),
      this.mssql.query<{ total: number }>(countSql, params),
    ]);

    const total = countRows[0]?.total ?? 0;
    return createPaginatedResult(rows, total, page, limit);
  }

  async findOne(id: string) {
    const sql = `
      WITH cte AS (
        SELECT ${inbSelect()}
        UNION ALL
        SELECT ${outSelect()}
      )
      SELECT TOP 1 * FROM cte WHERE id = @id
    `;

    const rows = await this.mssql.query<any>(sql, { id: { value: id } });

    if (!rows.length) {
      throw new NotFoundException(`Interaction with ID ${id} not found`);
    }

    return rows[0];
  }

  async getStatistics(dateFrom?: string, dateTo?: string) {
    const params: Record<string, { value: unknown }> = {};
    const filters: string[] = [];

    if (dateFrom) {
      filters.push(`date >= @dateFrom`);
      params['dateFrom'] = { value: new Date(dateFrom) };
    }
    if (dateTo) {
      filters.push(`date <= @dateTo`);
      params['dateTo'] = { value: new Date(dateTo) };
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const unionSql = `SELECT ${inbSelect()} UNION ALL SELECT ${outSelect()}`;

    const statsSql = `
      WITH cte AS (${unionSql})
      SELECT
        COUNT(*)                                             AS total,
        SUM(CASE WHEN recordType = 'inbound'  THEN 1 ELSE 0 END) AS inbound,
        SUM(CASE WHEN recordType = 'outbound' THEN 1 ELSE 0 END) AS outbound,
        SUM(CASE WHEN abandoned = 1           THEN 1 ELSE 0 END) AS abandoned,
        SUM(CASE WHEN evaluated = 1           THEN 1 ELSE 0 END) AS evaluated,
        AVG(CAST(talkTime   AS FLOAT))                       AS avgTalkTime,
        AVG(CAST(handleTime AS FLOAT))                       AS avgHandleTime,
        AVG(CAST(holdTime   AS FLOAT))                       AS avgHoldTime,
        AVG(CAST(waitTime   AS FLOAT))                       AS avgWaitTime,
        AVG(CAST(wrapTime   AS FLOAT))                       AS avgWrapTime,
        SUM(CAST(talkTime   AS BIGINT))                      AS totalTalkTime,
        SUM(CAST(handleTime AS BIGINT))                      AS totalHandleTime
      FROM cte
      ${whereClause}
    `;

    const rows = await this.mssql.query<any>(statsSql, params);
    const s = rows[0] ?? {};

    const total    = s.total    ?? 0;
    const inbound  = s.inbound  ?? 0;
    const outbound = s.outbound ?? 0;
    const abandoned = s.abandoned ?? 0;
    const evaluated = s.evaluated ?? 0;

    const abandonRate    = total > 0 ? (abandoned / total) * 100 : 0;
    const evaluationRate = total > 0 ? (evaluated / total) * 100 : 0;

    return {
      totalInteractions:   total,
      totalInbound:        inbound,
      totalOutbound:       outbound,
      totalAbandoned:      abandoned,
      totalEvaluated:      evaluated,
      totalPending:        0,
      totalProcessed:      total,
      totalErrors:         0,
      abandonRate:         Math.round(abandonRate    * 100) / 100,
      evaluationRate:      Math.round(evaluationRate * 100) / 100,
      processingRate:      100,
      averageTalkTime:     Math.round(s.avgTalkTime   ?? 0),
      averageHandleTime:   Math.round(s.avgHandleTime ?? 0),
      averageHoldTime:     Math.round(s.avgHoldTime   ?? 0),
      averageWaitTime:     Math.round(s.avgWaitTime   ?? 0),
      averageWrapTime:     Math.round(s.avgWrapTime   ?? 0),
      totalTalkTime:       s.totalTalkTime   ?? 0,
      totalHandleTime:     s.totalHandleTime ?? 0,
    };
  }

  // create / update / remove kept as no-ops (data is read-only from SQL Server)
  async create(_dto: any) {
    return { message: 'Interactions are read-only from SQL Server source.' };
  }

  async update(_id: string, _dto: any) {
    return { message: 'Interactions are read-only from SQL Server source.' };
  }

  async remove(_id: string) {
    return { message: 'Interactions are read-only from SQL Server source.' };
  }
}
