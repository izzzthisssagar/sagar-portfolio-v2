import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaStatus, Prisma, PublicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreatePostDto,
  ListPostsDto,
  PublicListPostsDto,
  UpdatePostDto,
  WorkflowTransition,
} from './posts.dto';
import { validatePostForPublication } from './publication-rules';

const DEFAULT_CATEGORY_SLUG = 'field-notes';
const DEFAULT_CATEGORY_NAME = 'Field Notes';
const DEFAULT_AUTHOR = 'Sagar Thapa';

const statusToDb = (status: string) => status.toUpperCase() as PublicationStatus;
const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const WORKFLOW_STATUS: Record<WorkflowTransition, PublicationStatus> = {
  draft: PublicationStatus.DRAFT,
  review: PublicationStatus.REVIEW,
  publish: PublicationStatus.PUBLISHED,
  archive: PublicationStatus.ARCHIVED,
};
const WORKFLOW_AUDIT_ACTION: Record<WorkflowTransition, string> = {
  draft: 'POST_UNPUBLISHED',
  review: 'POST_SENT_TO_REVIEW',
  publish: 'POST_PUBLISHED',
  archive: 'POST_ARCHIVED',
};

const PUBLIC_INCLUDE = {
  tags: true,
  featuredImage: true,
} satisfies Prisma.BlogPostInclude;

type PostWithRelations = Prisma.BlogPostGetPayload<{ include: typeof PUBLIC_INCLUDE }>;

function postView(post: PostWithRelations) {
  return {
    ...post,
    status: post.status.toLowerCase(),
    tags: post.tags.map((tag) => tag.name),
    featuredImage: post.featuredImage
      ? {
          id: post.featuredImage.id,
          altText: post.featuredImage.altText,
          status: post.featuredImage.status,
        }
      : null,
  };
}

function estimateReadingTime(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  private async defaultCategoryId(tx: Prisma.TransactionClient): Promise<string> {
    const category = await tx.blogCategory.upsert({
      where: { slug: DEFAULT_CATEGORY_SLUG },
      update: {},
      create: { slug: DEFAULT_CATEGORY_SLUG, name: DEFAULT_CATEGORY_NAME },
    });
    return category.id;
  }

  private async tagConnections(tx: Prisma.TransactionClient, tags: string[] | undefined) {
    if (!tags?.length) return undefined;
    const rows = await Promise.all(
      tags.map((name) =>
        tx.blogTag.upsert({
          where: { slug: slugify(name) },
          update: {},
          create: { slug: slugify(name), name },
        }),
      ),
    );
    return { set: rows.map((row) => ({ id: row.id })) };
  }

  private async list(
    query: ListPostsDto | PublicListPostsDto,
    publication: PublicationStatus | undefined,
    search?: string,
  ) {
    const where: Prisma.BlogPostWhereInput = {
      ...(publication ? { status: publication } : {}),
      ...(query.tag ? { tags: { some: { slug: slugify(query.tag) } } } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              { excerpt: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.BlogPostOrderByWithRelationInput[] = publication
      ? [{ publishedAt: 'desc' }, { id: 'asc' }]
      : [{ displayOrder: 'asc' }, { id: 'asc' }];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: PUBLIC_INCLUDE,
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { data: data.map(postView), meta: { page: query.page, limit: query.limit, total } };
  }

  listPublic(query: PublicListPostsDto) {
    return this.list(query, PublicationStatus.PUBLISHED);
  }

  listAdmin(query: ListPostsDto) {
    return this.list(query, query.status ? statusToDb(query.status) : undefined, query.search);
  }

  async getPublicBySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, status: PublicationStatus.PUBLISHED },
      include: PUBLIC_INCLUDE,
    });
    if (!post) throw new NotFoundException('Post not found');
    return postView(post);
  }

  async getAdmin(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id }, include: PUBLIC_INCLUDE });
    if (!post) throw new NotFoundException('Post not found');
    return postView(post);
  }

  async create(input: CreatePostDto, actorId?: string) {
    try {
      const post = await this.prisma.$transaction(async (tx) => {
        const categoryId = await this.defaultCategoryId(tx);
        const tagConnect = await this.tagConnections(tx, input.tags);
        const { tags, ...rest } = input;
        void tags;
        const created = await tx.blogPost.create({
          data: {
            ...rest,
            excerpt: input.excerpt ?? '',
            body: input.body ?? '',
            status: PublicationStatus.DRAFT,
            categoryId,
            author: DEFAULT_AUTHOR,
            readingTime: estimateReadingTime(input.body ?? ''),
            seoTitle: input.seoTitle ?? input.title,
            seoDescription: input.seoDescription ?? input.excerpt ?? '',
            ...(tagConnect ? { tags: { connect: tagConnect.set } } : {}),
          },
          include: PUBLIC_INCLUDE,
        });
        await tx.auditLog.create({
          data: {
            action: 'POST_CREATED',
            resource: 'BlogPost',
            resourceId: created.id,
            ...(actorId ? { actorId } : {}),
          },
        });
        return created;
      });
      return postView(post);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Post slug already exists');
      throw error;
    }
  }

  async update(id: string, input: UpdatePostDto, actorId?: string) {
    const current = await this.getAdmin(id);
    // A published post must stay valid for publication after every edit — validate the merge of
    // stored + proposed change the same way transitionStatus validates before publishing.
    if (current.status === 'published') {
      const errors = validatePostForPublication({ ...current, ...input });
      if (errors.length) {
        throw new BadRequestException({
          code: 'PUBLICATION_INVALID',
          message: 'This update would leave the published post without required content.',
          details: errors,
        });
      }
    }
    try {
      const post = await this.prisma.$transaction(async (tx) => {
        const tagConnect = await this.tagConnections(tx, input.tags);
        const { tags, ...rest } = input;
        void tags;
        const updated = await tx.blogPost.update({
          where: { id },
          data: {
            ...rest,
            ...(input.body ? { readingTime: estimateReadingTime(input.body) } : {}),
            ...(tagConnect ? { tags: tagConnect } : {}),
          },
          include: PUBLIC_INCLUDE,
        });
        await tx.auditLog.create({
          data: {
            action: 'POST_UPDATED',
            resource: 'BlogPost',
            resourceId: id,
            ...(actorId ? { actorId } : {}),
            metadata: { changedFields: Object.keys(input) },
          },
        });
        return updated;
      });
      return postView(post);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Post slug already exists');
      throw error;
    }
  }

  async remove(id: string, actorId?: string) {
    await this.getAdmin(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.blogPost.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: 'POST_DELETED',
          resource: 'BlogPost',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
        },
      });
    });
  }

  async transitionStatus(id: string, transition: WorkflowTransition, actorId?: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { id },
      include: PUBLIC_INCLUDE,
    });
    if (!post) throw new NotFoundException('Post not found');
    if (transition === 'publish') {
      const errors = validatePostForPublication(post);
      if (post.featuredImageId && post.featuredImage?.status !== MediaStatus.APPROVED) {
        errors.push('Featured image must be an approved media asset.');
      }
      if (errors.length) {
        throw new BadRequestException({
          code: 'PUBLICATION_INVALID',
          message: 'Post is not ready to publish.',
          details: errors,
        });
      }
    }
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.blogPost.update({
        where: { id },
        data: {
          status: WORKFLOW_STATUS[transition],
          ...(transition === 'publish' && !post.publishedAt ? { publishedAt: now } : {}),
        },
        include: PUBLIC_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          action: WORKFLOW_AUDIT_ACTION[transition],
          resource: 'BlogPost',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
          metadata: { transition },
        },
      });
      return next;
    });
    return postView(updated);
  }
}
