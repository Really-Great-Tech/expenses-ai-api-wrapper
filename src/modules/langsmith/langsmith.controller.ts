import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LangSmithService } from '../../services/langsmith.service';

@ApiTags('langsmith')
@Controller('langsmith')
export class LangSmithController {
  constructor(
    private readonly langsmithService: LangSmithService
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Get LangSmith integration status',
    description: 'Returns the current status of LangSmith integration including connection and configuration'
  })
  @ApiResponse({
    status: 200,
    description: 'LangSmith status retrieved successfully',
  })
  async getStatus(): Promise<{
    enabled: boolean;
    connected: boolean;
    version: string;
    config?: {
      endpoint?: string;
      project?: string;
      hasCredentials: boolean;
    };
  }> {
    const healthStatus = this.langsmithService.getHealthStatus();
    
    return {
      enabled: healthStatus.enabled,
      connected: healthStatus.connected,
      version: '1.0.0',
      config: healthStatus.enabled ? {
        endpoint: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com',
        project: process.env.LANGSMITH_PROJECT || 'expense-processing-default',
        hasCredentials: !!process.env.LANGSMITH_API_KEY,
      } : undefined,
    };
  }

  @Get('health')
  @ApiOperation({
    summary: 'Get LangSmith health check',
    description: 'Returns basic health information for LangSmith integration'
  })
  @ApiResponse({
    status: 200,
    description: 'LangSmith health check completed',
  })
  async getHealth(): Promise<{
    status: 'healthy' | 'unhealthy';
    enabled: boolean;
    connected: boolean;
    timestamp: string;
  }> {
    const healthStatus = this.langsmithService.getHealthStatus();
    
    return {
      status: healthStatus.enabled && healthStatus.connected ? 'healthy' : 'unhealthy',
      enabled: healthStatus.enabled,
      connected: healthStatus.connected,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('flush')
  @ApiOperation({
    summary: 'Flush pending LangSmith traces',
    description: 'Forces LangSmith to flush any pending traces and generations'
  })
  @ApiResponse({
    status: 200,
    description: 'LangSmith flush completed successfully',
  })
  async flush(): Promise<{
    success: boolean;
    message: string;
    timestamp: string;
  }> {
    try {
      await this.langsmithService.flush();
      return {
        success: true,
        message: 'LangSmith flush completed successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        message: `LangSmith flush failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
