import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PostsService } from './posts.service';

const post = {
  id: 'post1',
  title: 'Testing an OTP flow beyond the happy path',
  slug: 'testing-otp-beyond-happy-path',
  excerpt: 'A sufficiently long excerpt describing the article.',
  body: 'Real Markdown body content for the article.',
  readingTime: 1,
  author: 'Sagar Thapa',
  status: 'DRAFT',
  publishedAt: null,
  seoTitle: 'Testing an OTP flow beyond the happy path',
  seoDescription: 'A sufficiently long excerpt describing the article.',
  canonicalUrl: null,
  displayOrder: 0,
  socialImageId: null,
  featuredImageId: null,
  featuredImage: null,
  categoryId: 'cat1',
  createdAt: new Date(),
  updatedAt: new Date(),
  tags: [] as { id: string; name: string; slug: string }[],
} as const;

function setup() {
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    blogPost: {
      create: vi.fn().mockResolvedValue(post),
      update: vi.fn().mockResolvedValue({ ...post, slug: 'changed' }),
      delete: vi.fn().mockResolvedValue(post),
    },
    blogCategory: { upsert: vi.fn().mockResolvedValue({ id: 'cat1' }) },
    blogTag: { upsert: vi.fn() },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    blogPost: {
      findUnique: vi.fn().mockResolvedValue(post),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([post]),
      count: vi.fn().mockResolvedValue(1),
    },
    $transaction: vi.fn((value: unknown) =>
      typeof value === 'function'
        ? (value as (client: unknown) => unknown)(tx)
        : Promise.all(value as Promise<unknown>[]),
    ),
  };
  return { service: new PostsService(prisma as never), prisma, tx, auditCreate };
}

describe('PostsService', () => {
  it('orders admin list by displayOrder and public list by publishedAt desc', async () => {
    const { service, prisma } = setup();
    await service.listAdmin({ page: 1, limit: 20 });
    expect(prisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] }),
    );
    await service.listPublic({ page: 1, limit: 20 });
    expect(prisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PUBLISHED' }),
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('rejects a public lookup of a non-published post', async () => {
    const { service } = setup();
    await expect(service.getPublicBySlug('draft')).rejects.toThrow('Post not found');
  });

  it('creates as DRAFT, updates, deletes, and audits each mutation', async () => {
    const { service, tx, auditCreate } = setup();
    await service.create(
      { title: post.title, slug: post.slug, excerpt: post.excerpt, body: post.body },
      'admin',
    );
    expect(tx.blogPost.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT' }) }),
    );
    await service.update('post1', { slug: 'changed' }, 'admin');
    await service.remove('post1', 'admin');
    expect(auditCreate.mock.calls.map((call) => call[0].data.action)).toEqual([
      'POST_CREATED',
      'POST_UPDATED',
      'POST_DELETED',
    ]);
  });

  it('maps duplicate slugs to HTTP 409', async () => {
    const { service, tx } = setup();
    tx.blogPost.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );
    await expect(
      service.create({
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        body: post.body,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to publish a post missing required content', async () => {
    const { service, prisma } = setup();
    prisma.blogPost.findUnique.mockResolvedValueOnce({ ...post, excerpt: '' });
    await expect(service.transitionStatus('post1', 'publish', 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses to publish when the featured image is not approved', async () => {
    const { service, prisma } = setup();
    prisma.blogPost.findUnique.mockResolvedValueOnce({
      ...post,
      featuredImageId: 'media1',
      featuredImage: { id: 'media1', status: 'QUARANTINED' },
    });
    await expect(service.transitionStatus('post1', 'publish', 'admin')).rejects.toThrow(
      'Post is not ready to publish.',
    );
  });

  it('publishes once and never moves publishedAt on a later transition', async () => {
    const { service, prisma, tx } = setup();
    const now = new Date('2026-01-01T00:00:00Z');
    prisma.blogPost.findUnique.mockResolvedValueOnce({ ...post, publishedAt: now });
    await service.transitionStatus('post1', 'archive', 'admin');
    expect(tx.blogPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ publishedAt: expect.anything() }),
      }),
    );
  });

  it('re-validates a published post on update and rejects an invalid edit', async () => {
    const { service, prisma } = setup();
    prisma.blogPost.findUnique.mockResolvedValueOnce({ ...post, status: 'PUBLISHED' });
    await expect(service.update('post1', { excerpt: '' } as never, 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
