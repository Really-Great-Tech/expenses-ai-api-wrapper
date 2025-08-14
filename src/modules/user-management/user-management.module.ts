import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UserManagementController } from './user-management.controller';
import { UserSessionService } from '../../services/user-session.service';

@Module({
  imports: [ConfigModule],
  controllers: [UserManagementController],
  providers: [UserSessionService],
  exports: [UserSessionService],
})
export class UserManagementModule {}