import { Module } from '@nestjs/common';
import { IndexingModule } from '../indexing/indexing.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { RequestsController } from './requests.controller';
import { RequestDeletionService } from './request-deletion.service';
import { RequestsService } from './requests.service';
import { RequestOperationsService } from './request-operations.service';
import { StashModule } from '../providers/stash/stash.module';

@Module({
  imports: [
    IndexingModule,
    IntegrationsModule,
    WhisparrModule,
    StashdbModule,
    StashModule,
  ],
  controllers: [RequestsController],
  providers: [
    RequestsService,
    RequestOperationsService,
    RequestDeletionService,
  ],
  exports: [RequestOperationsService],
})
export class RequestsModule {}
