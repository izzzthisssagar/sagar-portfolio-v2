import { Controller, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MediaService } from './media.service';

/**
 * Public, unauthenticated media delivery — deliberately separate from the admin file route
 * (`AdminMediaController`), which serves any status behind JwtAuthGuard. This only ever serves
 * APPROVED **image** assets and 404s for anything else (quarantined, rejected, archived, unknown,
 * or a document — approved PDFs, including the CV, are never reachable through this route),
 * without distinguishing which — a probing request learns nothing about an asset's real state.
 *
 * Deliberately NOT cached as immutable, despite the content-addressed storage key: the `:id` in
 * the URL is a stable database id, not the content hash, and the asset behind a given id can be
 * archived (revoking public availability) at any time — an immutable/one-year cache would keep
 * serving a since-revoked asset to anyone who already has it cached. Revalidation-based caching
 * (`must-revalidate`, `max-age=0`) forces every repeat request back to the origin, where a
 * revoked asset correctly 404s instead of being served stale from a shared/browser cache. The
 * ETag (the asset's own SHA-256) still lets an unchanged, still-approved asset short-circuit to
 * 304 without re-streaming the bytes.
 */
@ApiTags('media')
@Controller('media')
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':id/file') async file(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const result = await this.media.getApprovedFile(id);
    if (!result) throw new NotFoundException('Media not found.');
    const { buffer, mimeType, filename, sha256 } = result;
    const etag = `"${sha256}"`;
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ETag: etag,
    });
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.send(buffer);
  }
}
