import { Module } from '@nestjs/common';
import { IndexingModule } from '../indexing/indexing.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { RequestsModule } from '../requests/requests.module';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

@Module({
  imports: [
    IndexingModule,
    IntegrationsModule,
    WhisparrModule,
    StashdbModule,
    RequestsModule,
  ],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService],
})
export class DiagnosticsModule {}
