import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AssignPermissionDto } from './dto/assign-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List all roles with their permissions' })
  @ApiResponse({ status: 200, description: 'List of roles.' })
  findAll() {
    return this.rolesService.findAll();
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ status: 201, description: 'Role created.' })
  @ApiResponse({ status: 409, description: 'Role name already exists.' })
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.rolesService.create(createRoleDto);
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get role by ID' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role found.' })
  @ApiResponse({ status: 404, description: 'Role not found.' })
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a role' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role updated.' })
  @ApiResponse({ status: 404, description: 'Role not found.' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateRoleDto>) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete a role' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role deleted.' })
  @ApiResponse({ status: 404, description: 'Role not found.' })
  remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }

  @Post(':id/permissions')
  @Roles('admin')
  @ApiOperation({ summary: 'Assign a permission to a role' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Permission assigned.' })
  @ApiResponse({ status: 404, description: 'Role or permission not found.' })
  @ApiResponse({ status: 409, description: 'Permission already assigned.' })
  assignPermission(
    @Param('id') id: string,
    @Body() assignPermissionDto: AssignPermissionDto,
  ) {
    return this.rolesService.assignPermission(id, assignPermissionDto);
  }

  @Delete(':id/permissions/:permissionId')
  @Roles('admin')
  @ApiOperation({ summary: 'Remove a permission from a role' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiParam({ name: 'permissionId', description: 'Permission UUID' })
  @ApiResponse({ status: 200, description: 'Permission removed.' })
  removePermission(@Param('id') id: string, @Param('permissionId') permissionId: string) {
    return this.rolesService.removePermission(id, permissionId);
  }
}
