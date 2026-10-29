import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { DiagnosticsService } from './diagnostics.service';
import {
  DiagnosticSearchDto,
  DiagnosticTableQuery,
  HydraSettingsDto,
} from './diagnostics.dto';

@Controller('api')
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}
  @Get('acquisition/table') table(@Query() query: DiagnosticTableQuery) {
    return this.diagnostics.table(query);
  }
  @Get('requests/:id/diagnostics') details(
    @Param('id') id: string,
    @Query('eventBefore') eventBefore?: string,
    @Query('attemptBefore') attemptBefore?: string,
  ) {
    return this.diagnostics.details(id, eventBefore, attemptBefore);
  }
  @Post('acquisition/diagnostics/refresh') async refreshAll() {
    await this.diagnostics.observe();
    return { outcome: 'OBSERVED' };
  }
  @Post('requests/:id/diagnostics/refresh') async refresh(
    @Param('id') id: string,
  ) {
    await this.diagnostics.observe();
    return this.diagnostics.details(id);
  }
  @Post('requests/:id/diagnostic-searches') search(
    @Param('id') id: string,
    @Body() dto: DiagnosticSearchDto,
  ) {
    return this.diagnostics.start(id, dto.operationKey);
  }
  @Post('requests/:id/diagnostic-searches/:attemptId/close') close(
    @Param('id') id: string,
    @Param('attemptId') attemptId: string,
  ) {
    return this.diagnostics.closeInterrupted(id, attemptId);
  }
  @Get('settings/hydra-search') settings() {
    return this.diagnostics.settings();
  }
  @Put('settings/hydra-search') save(@Body() dto: HydraSettingsDto) {
    return this.diagnostics.saveSettings(dto);
  }
  @Get('requests/:id/hydra-terms') terms(@Param('id') id: string) {
    return this.diagnostics.terms(id);
  }
}
