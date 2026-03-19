import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { PermissionsService } from './permissions.service';

@ApiTags('permissions')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List all permissions' })
  @ApiResponse({ status: 200, description: 'List of permissions.' })
  findAll() {
    return this.permissionsService.findAll();
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get permission by ID' })
  @ApiParam({ name: 'id', description: 'Permission UUID' })
  @ApiResponse({ status: 200, description: 'Permission found.' })
  @ApiResponse({ status: 404, description: 'Permission not found.' })
  findOne(@Param('id') id: string) {
    return this.permissionsService.findOne(id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create a new permission' })
  @ApiResponse({ status: 201, description: 'Permission created.' })
  @ApiResponse({ status: 409, description: 'Permission already exists.' })
  create(@Body() dto: CreatePermissionDto) {
    return this.permissionsService.create(dto);
  }
}
