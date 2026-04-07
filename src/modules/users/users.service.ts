import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createPaginatedResult } from '../../common/pagination/paginated-result.interface';
import { PrismaService } from '../../database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private readonly userSelect = {
    id: true,
    name: true,
    email: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
    roles: {
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    },
  };

  async findAll(query: QueryUsersDto) {
    const {
      page = 1,
      limit = 10,
      search,
      orderBy = 'createdAt',
      orderDir = 'desc',
      roleId,
      isActive,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (roleId) {
      where.roles = { some: { roleId } };
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const allowedOrderFields = ['name', 'email', 'createdAt', 'isActive', 'updatedAt'];
    const orderField = allowedOrderFields.includes(orderBy) ? orderBy : 'createdAt';

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: this.userSelect,
        skip,
        take: limit,
        orderBy: { [orderField]: orderDir },
      }),
      this.prisma.user.count({ where }),
    ]);

    return createPaginatedResult(users, total, page, limit);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      select: this.userSelect,
    });

    if (!user) {
      throw new NotFoundException(`Utilizador com ID ${id} não encontrado`);
    }

    return user;
  }

  async create(createUserDto: CreateUserDto, actorId?: string) {
    const { password, roleIds, ...userData } = createUserDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (existingUser) {
      throw new ConflictException(`Já existe um utilizador com o email ${userData.email}`);
    }

    const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const passwordHash = await bcrypt.hash(password, bcryptRounds);

    const user = await this.prisma.user.create({
      data: {
        ...userData,
        passwordHash,
        roles: roleIds
          ? { create: roleIds.map((roleId) => ({ roleId })) }
          : undefined,
      },
      select: this.userSelect,
    });

    if (actorId) {
      await this.audit(actorId, 'create_user', user.id);
    }

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto, actorId?: string) {
    await this.findOne(id);

    const { password, roleIds, ...userData } = updateUserDto;

    if (userData.email) {
      const existingUser = await this.prisma.user.findFirst({
        where: { email: userData.email, id: { not: id }, deletedAt: null },
      });
      if (existingUser) {
        throw new ConflictException(`O email ${userData.email} já está a ser utilizado`);
      }
    }

    const updateData: any = { ...userData };

    if (password) {
      const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
      updateData.passwordHash = await bcrypt.hash(password, bcryptRounds);
    }

    if (roleIds !== undefined) {
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      updateData.roles = { create: roleIds.map((roleId) => ({ roleId })) };
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: this.userSelect,
    });

    if (actorId) {
      await this.audit(actorId, 'update_user', id, { fields: Object.keys(userData) });
    }

    return user;
  }

  async remove(id: string, actorId?: string) {
    if (actorId && id === actorId) {
      throw new BadRequestException('Não pode eliminar a sua própria conta');
    }

    await this.findOne(id);

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, refreshToken: null },
    });

    if (actorId) {
      await this.audit(actorId, 'delete_user', id);
    }

    return { message: `Utilizador eliminado com sucesso` };
  }

  async toggleActive(id: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('Não pode alterar o seu próprio estado de acesso');
    }

    const user = await this.findOne(id);
    const newActive = !user.isActive;

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        isActive: newActive,
        // Invalidate sessions when deactivating
        ...(newActive === false ? { refreshToken: null } : {}),
      },
      select: { id: true, isActive: true, name: true, email: true },
    });

    await this.audit(actorId, newActive ? 'activate_user' : 'deactivate_user', id);

    return updated;
  }

  async resetPassword(id: string, newPassword: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException(
        'Para alterar a sua própria senha use o endpoint /auth/me/password',
      );
    }

    await this.findOne(id);

    const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const passwordHash = await bcrypt.hash(newPassword, bcryptRounds);

    // Reset password and invalidate all active sessions
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, refreshToken: null },
    });

    await this.audit(actorId, 'reset_password', id);

    return { message: 'Senha redefinida com sucesso. Sessões anteriores foram encerradas.' };
  }

  async getStats() {
    const [total, active, inactive] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.user.count({ where: { deletedAt: null, isActive: false } }),
    ]);

    // Count users with admin role
    const adminRoleExists = await this.prisma.role.findFirst({ where: { name: 'admin' } });
    const admins = adminRoleExists
      ? await this.prisma.userRole.count({ where: { roleId: adminRoleExists.id } })
      : 0;

    return { total, active, inactive, admins };
  }

  private async audit(
    actorId: string,
    action: string,
    resourceId?: string,
    metadata?: object,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: { userId: actorId, action, resource: 'user', resourceId, metadata },
      });
    } catch {
      // Audit log failures should never crash the main operation
    }
  }
}
