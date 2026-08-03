import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminProfileController, ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [AuthModule],
  controllers: [ProfileController, AdminProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
