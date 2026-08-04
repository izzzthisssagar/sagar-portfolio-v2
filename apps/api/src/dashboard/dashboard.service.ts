import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const now = new Date();
    const [
      totalProjects,
      projectsByStatus,
      confirmedMetrics,
      pendingMetrics,
      pendingFindings,
      activeSessions,
      unreadMessages,
      pendingMedia,
      rejectedMedia,
      publishedPosts,
      draftPosts,
      failedNotifications,
      activeCv,
      profile,
      recentAuditEvents,
      lastSuccessfulLogin,
      recentFailedLogins,
    ] = await Promise.all([
      this.prisma.project.count(),
      this.prisma.project.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.projectMetric.count({ where: { evidence: 'CONFIRMED' } }),
      this.prisma.projectMetric.count({ where: { evidence: { in: ['PENDING', 'UNAVAILABLE'] } } }),
      this.prisma.projectFinding.count({
        where: { evidenceStatus: { in: ['PENDING', 'UNAVAILABLE'] } },
      }),
      this.prisma.refreshSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
      this.prisma.contactMessage.count({ where: { status: 'NEW' } }),
      this.prisma.mediaAsset.count({ where: { status: 'QUARANTINED' } }),
      this.prisma.mediaAsset.count({ where: { status: 'REJECTED' } }),
      this.prisma.blogPost.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.blogPost.count({ where: { status: 'DRAFT' } }),
      this.prisma.contactDeliveryAttempt.count({ where: { status: 'FAILED' } }),
      this.prisma.cvDocument.count({ where: { active: true } }),
      this.prisma.profile.findFirst({ select: { portraitMediaId: true } }),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.auditLog.findFirst({
        where: { action: 'LOGIN_SUCCESS' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({
        where: { action: 'LOGIN_FAILURE', createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
      }),
    ]);

    return {
      totalProjects,
      projectsByStatus: Object.fromEntries(
        projectsByStatus.map((row) => [row.status.toLowerCase(), row._count._all]),
      ),
      confirmedMetrics,
      pendingEvidence: pendingMetrics + pendingFindings,
      activeSessions,
      unreadMessages,
      pendingMedia,
      rejectedMedia,
      publishedPosts,
      draftPosts,
      failedNotifications,
      activeCvConfigured: activeCv > 0,
      activePortraitConfigured: Boolean(profile?.portraitMediaId),
      recentAuditEvents,
      lastSuccessfulLoginAt: lastSuccessfulLogin?.createdAt ?? null,
      recentFailedLogins24h: recentFailedLogins,
    };
  }
}
