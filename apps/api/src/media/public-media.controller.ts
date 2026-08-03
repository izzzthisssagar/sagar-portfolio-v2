import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MediaService } from './media.service';

/**
 * Public, unauthenticated media delivery — deliberately separate from the admin file route
 * (`AdminMediaController`), which serves any status behind JwtAuthGuard. This only ever serves
 * APPROVED assets and 404s for anything else (quarantined, rejected, archived, or unknown),
 * without distinguishing which — a probing request learns nothing about an asset's real state.
 * A fuller public delivery design (immutable cache keys, broader coverage) is Phase 18; this is
 * the minimum needed for the portrait and confirmed project evidence to render publicly now.
 */
@ApiTags('media')
@Controller('media')
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':id/file') async file(@Param('id') id: string, @Res() res: Response) {
    const result = await this.media.getApprovedFile(id);
    if (!result) throw new NotFoundException('Media not found.');
    const { buffer, mimeType, filename } = result;
    res
      .set({
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`,
        'Cache-Control': 'public, max-age=3600',
      })
      .send(buffer);
  }
}
