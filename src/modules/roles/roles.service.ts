import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AssignPermissionDto } from './dto/assign-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  private readonly roleInclude = {
    permissions: {
      include: {
        permission: true,
      },
    },
  };

  async findAll() {
    return this.prisma.role.findMany({
      include: this.roleInclude,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: this.roleInclude,
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    return role;
  }

  async create(createRoleDto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { name: createRoleDto.name },
    });

    if (existing) {
      throw new ConflictException(`Role with name '${createRoleDto.name}' already exists`);
    }

    return this.prisma.role.create({
      data: createRoleDto,
      include: this.roleInclude,
    });
  }

  async assignPermission(roleId: string, assignPermissionDto: AssignPermissionDto) {
    await this.findOne(roleId);

    const permission = await this.prisma.permission.findUnique({
      where: { id: assignPermissionDto.permissionId },
    });

    if (!permission) {
      throw new NotFoundException(`Permission with ID ${assignPermissionDto.permissionId} not found`);
    }

    const existing = await this.prisma.rolePermission.findUnique({
      where: {
        roleId_permissionId: {
          roleId,
          permissionId: assignPermissionDto.permissionId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Permission already assigned to this role');
    }

    await this.prisma.rolePermission.create({
      data: {
        roleId,
        permissionId: assignPermissionDto.permissionId,
      },
    });

    return this.findOne(roleId);
  }

  async update(id: string, dto: Partial<{ name: string; description: string }>) {
    await this.findOne(id);
    return this.prisma.role.update({
      where: { id },
      data: dto,
      include: { permissions: { include: { permission: true } } },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.role.delete({ where: { id } });
    return { message: `Role ${id} deleted successfully` };
  }

  async removePermission(roleId: string, permissionId: string) {
    await this.findOne(roleId);

    const existing = await this.prisma.rolePermission.findUnique({
      where: {
        roleId_permissionId: { roleId, permissionId },
      },
    });

    if (!existing) {
      throw new NotFoundException('Permission is not assigned to this role');
    }

    await this.prisma.rolePermission.delete({
      where: {
        roleId_permissionId: { roleId, permissionId },
      },
    });

    return this.findOne(roleId);
  }
}
