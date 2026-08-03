import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type AdminRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import {
  CreatePostDto,
  ListPostsDto,
  PostWorkflowDto,
  PublicListPostsDto,
  UpdatePostDto,
} from './posts.dto';
import { PostsService } from './posts.service';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}
  @Get() list(@Query() query: PublicListPostsDto) {
    return this.posts.listPublic(query);
  }
  @Get(':slug') async get(@Param('slug') slug: string) {
    return { data: await this.posts.getPublicBySlug(slug) };
  }
}

@ApiTags('admin/posts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CsrfGuard)
@Controller('admin/posts')
export class AdminPostsController {
  constructor(private readonly posts: PostsService) {}

  @Get() list(@Query() query: ListPostsDto) {
    return this.posts.listAdmin(query);
  }
  @Get(':id') async get(@Param('id') id: string) {
    return { data: await this.posts.getAdmin(id) };
  }
  @Get(':id/preview') async preview(@Param('id') id: string) {
    return { data: await this.posts.getAdmin(id) };
  }
  @Post() async create(@Body() input: CreatePostDto, @Req() request: AdminRequest) {
    return { data: await this.posts.create(input, request.user?.sub) };
  }
  @Patch(':id') async update(
    @Param('id') id: string,
    @Body() input: UpdatePostDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.posts.update(id, input, request.user?.sub) };
  }
  @Post(':id/workflow') async workflow(
    @Param('id') id: string,
    @Body() input: PostWorkflowDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.posts.transitionStatus(id, input.transition, request.user?.sub) };
  }
  @Delete(':id') async remove(@Param('id') id: string, @Req() request: AdminRequest) {
    await this.posts.remove(id, request.user?.sub);
    return { data: { deleted: true } };
  }
}
