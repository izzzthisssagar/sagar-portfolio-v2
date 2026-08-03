import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPostsController, PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [AuthModule],
  controllers: [PostsController, AdminPostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
