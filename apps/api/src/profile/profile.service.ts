import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaCategory, MediaStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** Exactly one Profile row is expected to exist (created by the content seed) — this never
   * fabricates one on the fly, since every required field (name, headline, bio, ...) would need
   * invented content to satisfy the schema. If it's missing, that's a seed/deployment problem to
   * surface, not paper over. */
  private async requireProfile() {
    const profile = await this.prisma.profile.findFirst();
    if (!profile) {
      throw new NotFoundException(
        'No Profile row exists yet — run the content seed before managing the portrait.',
      );
    }
    return profile;
  }

  async getAdmin() {
    const profile = await this.prisma.profile.findFirst({ include: { portraitMedia: true } });
    return profile;
  }

  /** Public, unauthenticated subset for SEO metadata and structured data (see docs/seo.md) — name,
   * headline, and bio only. Excludes `email`: the site already has a dedicated contact form, and
   * publishing the raw address in page metadata/JSON-LD only invites scraping. */
  async getPublic() {
    const profile = await this.prisma.profile.findFirst();
    if (!profile) return null;
    return { name: profile.name, headline: profile.headline, bio: profile.bio };
  }

  async getPublicPortrait() {
    const profile = await this.prisma.profile.findFirst({ include: { portraitMedia: true } });
    const portrait = profile?.portraitMedia;
    if (!portrait || portrait.status !== MediaStatus.APPROVED) return null;
    return {
      mediaId: portrait.id,
      altText: portrait.altText,
      width: portrait.width,
      height: portrait.height,
    };
  }

  async setPortrait(mediaId: string, actorId?: string) {
    const profile = await this.requireProfile();
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media) throw new BadRequestException('Media asset not found.');
    if (media.category !== MediaCategory.IMAGE || media.status !== MediaStatus.APPROVED) {
      throw new BadRequestException({
        code: 'PORTRAIT_REQUIRES_APPROVED_IMAGE',
        message: 'The portrait must be an approved image.',
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.profile.update({
        where: { id: profile.id },
        data: { portraitMediaId: mediaId },
        include: { portraitMedia: true },
      });
      await tx.auditLog.create({
        data: {
          action: 'PORTRAIT_ACTIVATED',
          resource: 'Profile',
          resourceId: profile.id,
          ...(actorId ? { actorId } : {}),
          metadata: { mediaId },
        },
      });
      return next;
    });
    return updated;
  }

  async clearPortrait(actorId?: string) {
    const profile = await this.requireProfile();
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.profile.update({
        where: { id: profile.id },
        data: { portraitMediaId: null },
        include: { portraitMedia: true },
      });
      await tx.auditLog.create({
        data: {
          action: 'PORTRAIT_CLEARED',
          resource: 'Profile',
          resourceId: profile.id,
          ...(actorId ? { actorId } : {}),
        },
      });
      return next;
    });
    return updated;
  }
}
