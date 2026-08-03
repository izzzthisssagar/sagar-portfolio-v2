import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { AdminCvController, CvDownloadController } from './cv.controller';
import { CvService } from './cv.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [CvDownloadController, AdminCvController],
  providers: [CvService],
  exports: [CvService],
})
export class CvModule {}
