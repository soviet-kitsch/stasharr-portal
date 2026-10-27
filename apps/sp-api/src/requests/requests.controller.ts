import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequestOptionsDto } from './dto/request-options.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene-request.dto';
import { SubmitSceneRequestResponseDto } from './dto/submit-scene-request-response.dto';
import { ResumeSceneRequestDto } from './dto/resume-scene-request.dto';
import { RequestsService } from './requests.service';
import {
  BatchRequestActionDto,
  RequestActionDto,
} from './dto/request-action.dto';

@Controller('api/requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post('batch/preview')
  preview(@Body() dto: BatchRequestActionDto) {
    return this.requestsService.previewBatch(dto);
  }

  @Post('batch/execute')
  execute(@Body() dto: BatchRequestActionDto) {
    return this.requestsService.executeBatch(dto);
  }

  @Get(':stashId/history')
  history(@Param('stashId') id: string) {
    return this.requestsService.getHistory(id);
  }

  @Post(':stashId/outcome')
  outcome(@Param('stashId') id: string) {
    return this.requestsService.checkOutcome(id);
  }

  @Post(':stashId/search')
  search(@Param('stashId') id: string, @Body() dto: RequestActionDto) {
    return this.requestsService.searchAgain(id, dto.operationKey);
  }

  @Post(':stashId/dismiss')
  dismiss(@Param('stashId') id: string, @Body() dto: RequestActionDto) {
    return this.requestsService.setDismissed(id, dto.operationKey, true);
  }

  @Post(':stashId/restore')
  restore(@Param('stashId') id: string, @Body() dto: RequestActionDto) {
    return this.requestsService.setDismissed(id, dto.operationKey, false);
  }

  @Post(':stashId/rerequest')
  rerequest(@Param('stashId') id: string, @Body() dto: ResumeSceneRequestDto) {
    return this.requestsService.submitSceneRequest(id, dto, 'RE_REQUEST');
  }

  @Get(':stashId/options')
  getRequestOptions(
    @Param('stashId') stashId: string,
    @Query('scope') scope?: string,
  ): Promise<RequestOptionsDto> {
    return this.requestsService.getRequestOptions(stashId, scope);
  }

  @Post(':stashId')
  submitSceneRequest(
    @Param('stashId') stashId: string,
    @Body() payload: SubmitSceneRequestDto,
  ): Promise<SubmitSceneRequestResponseDto> {
    return this.requestsService.submitSceneRequest(stashId, payload);
  }
}
