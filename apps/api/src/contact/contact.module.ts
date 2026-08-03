import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminContactController, ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { NotificationModule } from './notification/notification.module';

@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [ContactController, AdminContactController],
  providers: [ContactService],
  exports: [ContactService],
})
export class ContactModule {}
