import { Module } from '@nestjs/common';
import { IndexingModule } from '../indexing/indexing.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { AcquisitionController } from './acquisition.controller';
import { AcquisitionService } from './acquisition.service';
import { ImportMatchReviewService } from './import-match-review.service';

@Module({
  imports: [IndexingModule, IntegrationsModule, WhisparrModule],
  controllers: [AcquisitionController],
  providers: [AcquisitionService, ImportMatchReviewService],
})
export class AcquisitionModule {}
