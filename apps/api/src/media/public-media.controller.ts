import { Controller, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MediaService } from './media.service';

/**
 * Public, unauthenticated media delivery — deliberately separate from the admin file route
 * (`AdminMediaController`), which serves any status behind JwtAuthGuard. This only ever serves
 * APPROVED assets and 404s for anything else (quarantined, rejected, archived, or unknown),
 * without distinguishing which — a probing request learns nothing about an asset's real state.
 *
 * Cached as immutable: storage keys are content-addressed by SHA-256 (see `media.service.ts`
 * upload dedup), so a given `:id` always resolves to the same bytes for its lifetime — an
 * `id`/`sha256` pair never needs revalidating. The ETag is the asset's own SHA-256, so a
 * conditional request short-circuits to 304 without re-streaming the file.
 */
@ApiTags('media')
@Controller('media')
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':id/file') async file(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.media.getApprovedFile(id);
    if (!result) throw new NotFoundException('Media not found.');
    const { buffer, mimeType, filename, sha256 } = result;
    const etag = `"${sha256}"`;
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: etag,
    });
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.send(buffer);
  }
}
