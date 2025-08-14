import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { UserSessionService } from '../../services/user-session.service';

@ApiTags('user-management')
@Controller('users')
export class UserManagementController {
  constructor(private readonly userSessionService: UserSessionService) {}

  @Post('create-session')
  @ApiOperation({
    summary: 'Create or get user session',
    description: 'Create a new user session or get existing session for hierarchical job tracking',
  })
  @ApiBody({
    description: 'User session creation parameters',
    schema: {
      type: 'object',
      properties: {
        actualUserId: {
          type: 'string',
          description: 'Actual user identifier',
          example: 'user_john_doe_123',
        },
        metadata: {
          type: 'object',
          properties: {
            userAgent: { type: 'string' },
            ipAddress: { type: 'string' },
            clientId: { type: 'string' },
          },
        },
      },
      required: ['actualUserId'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'User session created or retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          actualUserId: 'user_john_doe_123',
          sessionId: 'session_user_john_doe_123_2025-08-14T14-45-00-000Z_abc12345',
          jobIds: [],
          createdAt: '2025-08-14T14:45:00.000Z',
          lastActivity: '2025-08-14T14:45:00.000Z',
        },
      },
    },
  })
  async createUserSession(
    @Body() body: { 
      actualUserId: string; 
      metadata?: {
        userAgent?: string;
        ipAddress?: string;
        clientId?: string;
      };
    }
  ) {
    try {
      const session = await this.userSessionService.createOrGetUserSession(
        body.actualUserId,
        body.metadata
      );

      return {
        success: true,
        data: session,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to create user session: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':actualUserId')
  @ApiOperation({
    summary: 'Get user session and jobs',
    description: 'Retrieve user session information and all associated jobs',
  })
  @ApiParam({
    name: 'actualUserId',
    description: 'Actual user identifier',
    example: 'user_john_doe_123',
  })
  @ApiResponse({
    status: 200,
    description: 'User session retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          session: {
            actualUserId: 'user_john_doe_123',
            sessionId: 'session_user_john_doe_123_2025-08-14T14-45-00-000Z_abc12345',
            jobIds: ['job_user_john_doe_123_1723644300000_def45678'],
            createdAt: '2025-08-14T14:45:00.000Z',
            lastActivity: '2025-08-14T14:46:00.000Z',
          },
          jobs: [
            {
              jobId: 'job_user_john_doe_123_1723644300000_def45678',
              actualUserId: 'user_john_doe_123',
              sessionId: 'session_user_john_doe_123_2025-08-14T14-45-00-000Z_abc12345',
              createdAt: '2025-08-14T14:46:00.000Z',
              filename: 'receipt.pdf',
              country: 'Germany',
              icp: 'Global People',
            },
          ],
          stats: {
            totalJobs: 1,
            firstJobDate: '2025-08-14T14:46:00.000Z',
            lastJobDate: '2025-08-14T14:46:00.000Z',
          },
        },
      },
    },
  })
  async getUserSession(@Param('actualUserId') actualUserId: string) {
    try {
      const session = this.userSessionService.getUserSession(actualUserId);
      
      if (!session) {
        throw new HttpException('User session not found', HttpStatus.NOT_FOUND);
      }

      const jobs = this.userSessionService.getUserJobs(actualUserId);
      const stats = this.userSessionService.getUserStats(actualUserId);

      return {
        success: true,
        data: {
          session,
          jobs,
          stats,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to get user session: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':actualUserId/jobs')
  @ApiOperation({
    summary: 'Get all jobs for a user',
    description: 'Retrieve all jobs associated with a specific user',
  })
  @ApiParam({
    name: 'actualUserId',
    description: 'Actual user identifier',
    example: 'user_john_doe_123',
  })
  @ApiResponse({
    status: 200,
    description: 'User jobs retrieved successfully',
  })
  async getUserJobs(@Param('actualUserId') actualUserId: string) {
    try {
      const jobs = this.userSessionService.getUserJobs(actualUserId);
      const stats = this.userSessionService.getUserStats(actualUserId);

      return {
        success: true,
        data: {
          jobs,
          stats,
        },
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get user jobs: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List all users',
    description: 'Get a list of all users with their session information',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Limit number of results',
    example: 50,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Offset for pagination',
    example: 0,
  })
  @ApiResponse({
    status: 200,
    description: 'Users list retrieved successfully',
  })
  async listUsers(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    try {
      const allUsers = this.userSessionService.getAllUsers();
      const limitNum = limit ? parseInt(limit) : 50;
      const offsetNum = offset ? parseInt(offset) : 0;

      // Apply pagination
      const paginatedUsers = allUsers.slice(offsetNum, offsetNum + limitNum);

      // Add stats for each user
      const usersWithStats = paginatedUsers.map(user => ({
        ...user,
        stats: this.userSessionService.getUserStats(user.actualUserId),
      }));

      return {
        success: true,
        data: {
          users: usersWithStats,
          total: allUsers.length,
          limit: limitNum,
          offset: offsetNum,
        },
      };
    } catch (error) {
      throw new HttpException(
        `Failed to list users: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('job/:jobId/user')
  @ApiOperation({
    summary: 'Get user from job ID',
    description: 'Reverse lookup: get user information from a job ID',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Job identifier',
    example: 'job_user_john_doe_123_1723644300000_def45678',
  })
  @ApiResponse({
    status: 200,
    description: 'User information retrieved successfully',
  })
  async getUserFromJobId(@Param('jobId') jobId: string) {
    try {
      const jobMapping = this.userSessionService.getJobMapping(jobId);
      
      if (!jobMapping) {
        throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
      }

      const session = this.userSessionService.getUserSession(jobMapping.actualUserId);

      return {
        success: true,
        data: {
          jobMapping,
          session,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to get user from job ID: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('cleanup')
  @ApiOperation({
    summary: 'Cleanup old sessions',
    description: 'Remove old user sessions and their associated jobs',
  })
  @ApiBody({
    description: 'Cleanup parameters',
    schema: {
      type: 'object',
      properties: {
        olderThanDays: {
          type: 'number',
          description: 'Remove sessions older than this many days',
          example: 30,
          default: 30,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Cleanup completed successfully',
  })
  async cleanupOldSessions(
    @Body() body: { olderThanDays?: number }
  ) {
    try {
      const cleanedCount = await this.userSessionService.cleanupOldSessions(
        body.olderThanDays || 30
      );

      return {
        success: true,
        data: {
          cleanedSessions: cleanedCount,
          message: `Cleaned up ${cleanedCount} old sessions`,
        },
      };
    } catch (error) {
      throw new HttpException(
        `Failed to cleanup old sessions: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('health/status')
  @ApiOperation({
    summary: 'Get user management service health',
    description: 'Check the health status of the user management service',
  })
  @ApiResponse({
    status: 200,
    description: 'Health status retrieved successfully',
  })
  async getHealthStatus() {
    try {
      const health = this.userSessionService.getHealthStatus();

      return {
        success: true,
        data: health,
      };
    } catch (error) {
      throw new HttpException(
        `Health check failed: ${error.message}`,
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}