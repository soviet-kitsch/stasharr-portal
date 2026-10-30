import { Module } from '@nestjs/common';
import { RuntimeHealthModule } from '../../runtime-health/runtime-health.module';
import { WhisparrSceneDeletionAdapter } from './whisparr-scene-deletion.adapter';
import { WhisparrAdapter } from './whisparr.adapter';

@Module({
  imports: [RuntimeHealthModule],
  providers: [WhisparrAdapter, WhisparrSceneDeletionAdapter],
  exports: [WhisparrAdapter, WhisparrSceneDeletionAdapter],
})
export class WhisparrModule {}
