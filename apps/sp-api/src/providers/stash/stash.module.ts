import { Module } from '@nestjs/common';
import { RuntimeHealthModule } from '../../runtime-health/runtime-health.module';
import { StashAdapter } from './stash.adapter';
import { StashdbModule } from '../stashdb/stashdb.module';
import { CatalogSourceIdentityService } from '../catalog/catalog-source-identity.service';

@Module({
  imports: [RuntimeHealthModule, StashdbModule],
  providers: [StashAdapter, CatalogSourceIdentityService],
  exports: [StashAdapter],
})
export class StashModule {}
