import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('stats')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Get user statistics (total, active, inactive, admins)' })
  getStats() {
    return this.usersService.getStats();
  }

  @Get()
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'List users with pagination, search and filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of users.' })
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User found.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created.' })
  @ApiResponse({ status: 409, description: 'Email already exists.' })
  create(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.create(createUserDto, actorId);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update user profile and roles' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User updated.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.update(id, updateUserDto, actorId);
  }

  @Patch(':id/toggle-active')
  @Roles('admin')
  @ApiOperation({ summary: 'Toggle user active/inactive status' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Status toggled.' })
  toggleActive(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.toggleActive(id, actorId);
  }

  @Put(':id/password')
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: reset a user password (invalidates sessions)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Password reset.' })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.resetPassword(id, dto.password, actorId);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Soft delete user' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User deleted.' })
  remove(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.remove(id, actorId);
  }
}
