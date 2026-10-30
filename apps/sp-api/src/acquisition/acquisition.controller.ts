import { Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ImportMatchReviewService } from './import-match-review.service';
import { AcquisitionScenesFeedDto } from './dto/acquisition-scene-feed.dto';
import { AcquisitionScenesQueryDto } from './dto/acquisition-scenes-query.dto';
import { StashAvailabilityService } from './stash-availability.service';
import { AcquisitionService } from './acquisition.service';

@Controller('api/acquisition')
export class AcquisitionController {
  constructor(
    private readonly acquisitionService: AcquisitionService,
    private readonly matchReview: ImportMatchReviewService,
    private readonly availability: StashAvailabilityService,
  ) {}

  @Get('scenes/:sceneId/stash-availability')
  @Header('Cache-Control', 'no-store')
  checkStash(@Param('sceneId') id: string) {
    return this.availability.check(id);
  }

  @Get('scenes/:sceneId/match-review')
  reviewMatch(@Param('sceneId') sceneId: string) {
    return this.matchReview.review(sceneId);
  }

  @Post('scenes/:sceneId/reconcile')
  reconcileScene(@Param('sceneId') sceneId: string) {
    return this.matchReview.reconcile(sceneId);
  }

  @Get('scenes')
  getAcquisitionScenes(
    @Query() query: AcquisitionScenesQueryDto,
  ): Promise<AcquisitionScenesFeedDto> {
    return this.acquisitionService.getScenesFeed(
      query.page,
      query.perPage,
      query.lifecycle,
    );
  }
}
