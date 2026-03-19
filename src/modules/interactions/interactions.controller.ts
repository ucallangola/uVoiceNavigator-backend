import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions, Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { QueryInteractionsDto } from './dto/query-interactions.dto';
import { InteractionsService } from './interactions.service';

@ApiTags('interactions')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('interactions')
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @Get()
  @Permissions('interactions:read')
  @ApiOperation({ summary: 'List interactions with pagination and filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of interactions.' })
  findAll(@Query() query: QueryInteractionsDto) {
    return this.interactionsService.findAll(query);
  }

  @Get('inbound')
  @Permissions('interactions:read')
  @ApiOperation({ summary: 'List inbound interactions only' })
  @ApiResponse({ status: 200, description: 'Paginated list of inbound interactions.' })
  findInbound(@Query() query: QueryInteractionsDto) {
    return this.interactionsService.findAll({ ...query, recordType: 'inbound' });
  }

  @Get('outbound')
  @Permissions('interactions:read')
  @ApiOperation({ summary: 'List outbound interactions only' })
  @ApiResponse({ status: 200, description: 'Paginated list of outbound interactions.' })
  findOutbound(@Query() query: QueryInteractionsDto) {
    return this.interactionsService.findAll({ ...query, recordType: 'outbound' });
  }

  @Get('statistics')
  @Permissions('interactions:read')
  @ApiOperation({ summary: 'Get interaction aggregate statistics' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Start date' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'End date' })
  @ApiResponse({ status: 200, description: 'Interaction statistics.' })
  getStatistics(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.interactionsService.getStatistics(dateFrom, dateTo);
  }

  @Get(':id')
  @Permissions('interactions:read')
  @ApiOperation({ summary: 'Get interaction by ID' })
  @ApiParam({ name: 'id', description: 'Interaction UUID' })
  @ApiResponse({ status: 200, description: 'Interaction found.' })
  @ApiResponse({ status: 404, description: 'Interaction not found.' })
  findOne(@Param('id') id: string) {
    return this.interactionsService.findOne(id);
  }

  @Post()
  @Roles('admin', 'supervisor')
  @Permissions('interactions:write')
  @ApiOperation({ summary: 'Create a new interaction' })
  @ApiResponse({ status: 201, description: 'Interaction created.' })
  create(@Body() createInteractionDto: CreateInteractionDto) {
    return this.interactionsService.create(createInteractionDto);
  }

  @Put(':id')
  @Roles('admin', 'supervisor')
  @Permissions('interactions:write')
  @ApiOperation({ summary: 'Update an interaction' })
  @ApiParam({ name: 'id', description: 'Interaction UUID' })
  @ApiResponse({ status: 200, description: 'Interaction updated.' })
  @ApiResponse({ status: 404, description: 'Interaction not found.' })
  update(
    @Param('id') id: string,
    @Body() updateDto: Partial<CreateInteractionDto>,
  ) {
    return this.interactionsService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles('admin')
  @Permissions('interactions:delete')
  @ApiOperation({ summary: 'Delete an interaction' })
  @ApiParam({ name: 'id', description: 'Interaction UUID' })
  @ApiResponse({ status: 200, description: 'Interaction deleted.' })
  @ApiResponse({ status: 404, description: 'Interaction not found.' })
  remove(@Param('id') id: string) {
    return this.interactionsService.remove(id);
  }
}
