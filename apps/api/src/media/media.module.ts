import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminMediaController } from './media.controller';
import { MediaService } from './media.service';
import { PublicMediaController } from './public-media.controller';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AdminMediaController, PublicMediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
