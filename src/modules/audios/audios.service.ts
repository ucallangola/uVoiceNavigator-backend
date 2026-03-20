import { Injectable, NotFoundException } from '@nestjs/common';
import { createPaginatedResult } from '../../common/pagination/paginated-result.interface';
import { PrismaService } from '../../database/prisma.service';
import { MssqlService } from '../../database/mssql.service';
import { CreateAudioDto } from './dto/create-audio.dto';
import { QueryAudiosDto } from './dto/query-audios.dto';

@Injectable()
export class AudiosService {
  constructor(
    private prisma:  PrismaService,
    private mssql:   MssqlService,
  ) {}

  async findAll(query: QueryAudiosDto) {
    const {
      page = 1,
      limit = 10,
      search,
      agentName,
      customerPhone,
      source,
      status,
      dateFrom,
      dateTo,
      orderBy = 'uploadedAt',
      orderDir = 'desc',
    } = query;

    const skip = (page - 1) * limit;
    const where: any = {};

    if (agentName) {
      where.agentName = { contains: agentName, mode: 'insensitive' };
    }

    if (customerPhone) {
      where.customerPhone = { contains: customerPhone };
    }

    if (source) {
      where.source = source;
    }

    if (status) {
      where.status = status;
    }

    if (dateFrom || dateTo) {
      where.uploadedAt = {};
      if (dateFrom) where.uploadedAt.gte = new Date(dateFrom);
      if (dateTo) where.uploadedAt.lte = new Date(dateTo);
    }

    if (search) {
      where.OR = [
        { filename: { contains: search, mode: 'insensitive' } },
        { agentName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search } },
      ];
    }

    const allowedOrderFields = ['uploadedAt', 'processedAt', 'agentName', 'duration', 'fileSize', 'status', 'createdAt'];
    const orderField = allowedOrderFields.includes(orderBy) ? orderBy : 'uploadedAt';

    const [audios, total] = await Promise.all([
      this.prisma.audio.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderField]: orderDir },
      }),
      this.prisma.audio.count({ where }),
    ]);

    return createPaginatedResult(audios, total, page, limit);
  }

  async findOne(id: string) {
    const audio = await this.prisma.audio.findUnique({ where: { id } });

    if (!audio) {
      throw new NotFoundException(`Audio with ID ${id} not found`);
    }

    return audio;
  }

  async getDashboardStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const tomorrowStart = new Date(today);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const [
      totalAudiosToday,
      totalAudiosYesterday,
      totalAudios,
      processedAudios,
      totalSizeAgg,
    ] = await Promise.all([
      this.prisma.audio.count({
        where: {
          uploadedAt: { gte: today, lt: tomorrowStart },
        },
      }),
      this.prisma.audio.count({
        where: {
          uploadedAt: { gte: yesterday, lt: today },
        },
      }),
      this.prisma.audio.count(),
      this.prisma.audio.count({ where: { status: 'processed' } }),
      this.prisma.audio.aggregate({ _sum: { fileSize: true } }),
    ]);

    // Interaction stats from SQL Server (BCB Go Contact)
    const intRows = await this.mssql.query<{
      total: number; inbound: number; outbound: number; abandoned: number;
    }>(`
      SELECT
        COUNT(*)                                               AS total,
        SUM(CASE WHEN src = 'inbound'  THEN 1 ELSE 0 END)    AS inbound,
        SUM(CASE WHEN src = 'outbound' THEN 1 ELSE 0 END)    AS outbound,
        SUM(CASE WHEN abandoned = 1    THEN 1 ELSE 0 END)    AS abandoned
      FROM (
        SELECT 'inbound'  AS src, ISNULL(Abandoned, 0) AS abandoned
          FROM [dbo].[CallRecordManualImportBCBInbs]
        UNION ALL
        SELECT 'outbound' AS src, ISNULL(Abandoned, 0) AS abandoned
          FROM [dbo].[CallRecordManualImportBCBOuts]
      ) cte
    `);

    const ir = intRows[0];
    const totalInteractions = Number(ir?.total    ?? 0);
    const totalInbound      = Number(ir?.inbound  ?? 0);
    const totalOutbound     = Number(ir?.outbound ?? 0);
    const totalAbandoned    = Number(ir?.abandoned ?? 0);

    const processingRate =
      totalAudios > 0 ? Math.round((processedAudios / totalAudios) * 100) : 0;

    return {
      totalAudiosToday,
      totalAudiosYesterday,
      totalInteractions,
      totalInbound,
      totalOutbound,
      totalAbandoned,
      processingRate,
      storageUsed: totalSizeAgg._sum.fileSize || 0,
    };
  }

  async create(createAudioDto: CreateAudioDto) {
    return this.prisma.audio.create({
      data: createAudioDto,
    });
  }

  async update(id: string, updateDto: Partial<CreateAudioDto> & { processedAt?: string }) {
    await this.findOne(id);

    const data: any = { ...updateDto };

    if (updateDto.status === 'processed' && !data.processedAt) {
      data.processedAt = new Date();
    }

    if (data.processedAt && typeof data.processedAt === 'string') {
      data.processedAt = new Date(data.processedAt);
    }

    return this.prisma.audio.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.audio.delete({ where: { id } });
    return { message: `Audio ${id} deleted successfully` };
  }
}
