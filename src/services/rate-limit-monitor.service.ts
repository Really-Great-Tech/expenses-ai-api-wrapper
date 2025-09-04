import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface RateLimitEvent {
  timestamp: string;
  service: string;
  modelId: string;
  provider: 'bedrock' | 'anthropic';
  errorType: 'throttling' | 'rate_limit' | 'quota_exceeded';
  errorMessage: string;
  requestDetails: {
    endpoint?: string;
    region?: string;
    retryAttempt?: number;
    concurrentRequests?: number;
    totalCallsBeforeRateLimit?: number;
    callsInCurrentWindow?: number;
    windowDurationMs?: number;
    requestsPerSecond?: number;
  };
  context: {
    filename?: string;
    userId?: string;
    processingStage?: string;
    totalRequestsInWindow?: number;
    windowStartTime?: string;
    successfulCallsBeforeLimit?: number;
    timeToRateLimit?: number;
    averageCallsPerSecond?: number;
  };
  recovery: {
    fallbackUsed: boolean;
    fallbackProvider?: string;
    retrySuccessful?: boolean;
    retryDelayMs?: number;
  };
}

export interface RateLimitSummary {
  totalEvents: number;
  eventsByProvider: Record<string, number>;
  eventsByModel: Record<string, number>;
  eventsByErrorType: Record<string, number>;
  firstEventTime: string;
  lastEventTime: string;
  averageRecoveryTime: number;
  fallbackSuccessRate: number;
}

@Injectable()
export class RateLimitMonitorService {
  private readonly logger = new Logger(RateLimitMonitorService.name);
  private readonly rateLimitLogPath: string;
  private readonly summaryLogPath: string;
  private rateLimitEvents: RateLimitEvent[] = [];
  private requestCounter = new Map<string, { count: number; windowStart: number; totalCalls: number; firstCallTime: number }>();
  private readonly windowSizeMs = 60000; // 1 minute window for tracking
  private globalCallCounter = 0;
  private sessionStartTime = Date.now();

  constructor() {
    // Create rate-limit-logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'rate-limit-logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.rateLimitLogPath = path.join(logsDir, 'rate-limit-events.json');
    this.summaryLogPath = path.join(logsDir, 'rate-limit-summary.json');

    // Load existing events if file exists
    this.loadExistingEvents();

    this.logger.log(`✅ Rate limit monitor initialized. Logs will be saved to: ${this.rateLimitLogPath}`);
  }

  /**
   * Record a rate limit event
   */
  async recordRateLimitEvent(event: Omit<RateLimitEvent, 'timestamp'>): Promise<void> {
    const rateLimitEvent: RateLimitEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.rateLimitEvents.push(rateLimitEvent);

    // Log the event
    this.logger.warn(`🚨 RATE LIMIT DETECTED:`);
    this.logger.warn(`   Provider: ${event.provider}`);
    this.logger.warn(`   Model: ${event.modelId}`);
    this.logger.warn(`   Error Type: ${event.errorType}`);
    this.logger.warn(`   Service: ${event.service}`);
    this.logger.warn(`   Context: ${event.context.filename || 'N/A'} - ${event.context.processingStage || 'N/A'}`);
    this.logger.warn(`   Fallback Used: ${event.recovery.fallbackUsed ? '✅' : '❌'}`);
    this.logger.warn(`   Error: ${event.errorMessage}`);

    // Save to file immediately
    await this.saveEventsToFile();
    await this.updateSummary();
  }

  /**
   * Check if an error is a rate limit error
   */
  isRateLimitError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code?.toLowerCase() || '';
    const errorName = error.name?.toLowerCase() || '';

    // AWS Bedrock rate limit indicators
    const bedrockRateLimitIndicators = [
      'throttlingexception',
      'throttled',
      'rate limit',
      'rate exceeded',
      'too many requests',
      'quota exceeded',
      'service quota',
      'request limit',
      'api rate limit',
      'modelnotreadyexception',
      'modelstreamingexception',
      'validationexception',
    ];

    // Anthropic rate limit indicators
    const anthropicRateLimitIndicators = [
      'rate_limit_error',
      'rate limit exceeded',
      'too_many_requests',
      'quota_exceeded',
      'overloaded_error',
    ];

    const allIndicators = [...bedrockRateLimitIndicators, ...anthropicRateLimitIndicators];

    return allIndicators.some(indicator => 
      errorMessage.includes(indicator) || 
      errorCode.includes(indicator) || 
      errorName.includes(indicator)
    );
  }

  /**
   * Determine the error type from the error
   */
  determineErrorType(error: any): 'throttling' | 'rate_limit' | 'quota_exceeded' {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code?.toLowerCase() || '';

    if (errorMessage.includes('quota') || errorCode.includes('quota')) {
      return 'quota_exceeded';
    }
    if (errorMessage.includes('throttl') || errorCode.includes('throttl')) {
      return 'throttling';
    }
    return 'rate_limit';
  }

  /**
   * Track request count for a service/model combination
   */
  trackRequest(service: string, modelId: string): void {
    const key = `${service}:${modelId}`;
    const now = Date.now();
    const current = this.requestCounter.get(key);
    
    // Increment global counter
    this.globalCallCounter++;

    if (!current || (now - current.windowStart) > this.windowSizeMs) {
      // Start new window but preserve total calls
      const totalCalls = current ? current.totalCalls + 1 : 1;
      const firstCallTime = current ? current.firstCallTime : now;
      this.requestCounter.set(key, {
        count: 1,
        windowStart: now,
        totalCalls,
        firstCallTime
      });
    } else {
      // Increment in current window
      this.requestCounter.set(key, {
        count: current.count + 1,
        windowStart: current.windowStart,
        totalCalls: current.totalCalls + 1,
        firstCallTime: current.firstCallTime
      });
    }
  }

  /**
   * Get current request count for a service/model combination
   */
  getCurrentRequestCount(service: string, modelId: string): number {
    const key = `${service}:${modelId}`;
    const current = this.requestCounter.get(key);
    
    if (!current || (Date.now() - current.windowStart) > this.windowSizeMs) {
      return 0;
    }
    
    return current.count;
  }

  /**
   * Get total calls made for a service/model combination
   */
  getTotalCallCount(service: string, modelId: string): number {
    const key = `${service}:${modelId}`;
    const current = this.requestCounter.get(key);
    return current ? current.totalCalls : 0;
  }

  /**
   * Get detailed call statistics for a service/model combination
   */
  getCallStatistics(service: string, modelId: string): {
    totalCalls: number;
    callsInCurrentWindow: number;
    windowDurationMs: number;
    averageCallsPerSecond: number;
    timeToRateLimit?: number;
  } {
    const key = `${service}:${modelId}`;
    const current = this.requestCounter.get(key);
    const now = Date.now();
    
    if (!current) {
      return {
        totalCalls: 0,
        callsInCurrentWindow: 0,
        windowDurationMs: 0,
        averageCallsPerSecond: 0,
      };
    }

    const windowDuration = now - current.windowStart;
    const totalDuration = now - current.firstCallTime;
    const averageCallsPerSecond = totalDuration > 0 ? (current.totalCalls / (totalDuration / 1000)) : 0;

    return {
      totalCalls: current.totalCalls,
      callsInCurrentWindow: current.count,
      windowDurationMs: windowDuration,
      averageCallsPerSecond: parseFloat(averageCallsPerSecond.toFixed(2)),
      timeToRateLimit: totalDuration,
    };
  }

  /**
   * Get global session statistics
   */
  getSessionStatistics(): {
    totalCalls: number;
    sessionDurationMs: number;
    averageCallsPerSecond: number;
    rateLimitEvents: number;
  } {
    const now = Date.now();
    const sessionDuration = now - this.sessionStartTime;
    const averageCallsPerSecond = sessionDuration > 0 ? (this.globalCallCounter / (sessionDuration / 1000)) : 0;

    return {
      totalCalls: this.globalCallCounter,
      sessionDurationMs: sessionDuration,
      averageCallsPerSecond: parseFloat(averageCallsPerSecond.toFixed(2)),
      rateLimitEvents: this.rateLimitEvents.length,
    };
  }

  /**
   * Get rate limit summary statistics
   */
  getRateLimitSummary(): RateLimitSummary {
    if (this.rateLimitEvents.length === 0) {
      return {
        totalEvents: 0,
        eventsByProvider: {},
        eventsByModel: {},
        eventsByErrorType: {},
        firstEventTime: '',
        lastEventTime: '',
        averageRecoveryTime: 0,
        fallbackSuccessRate: 0,
      };
    }

    const eventsByProvider: Record<string, number> = {};
    const eventsByModel: Record<string, number> = {};
    const eventsByErrorType: Record<string, number> = {};
    let totalRecoveryTime = 0;
    let recoveryCount = 0;
    let fallbackSuccessCount = 0;

    this.rateLimitEvents.forEach(event => {
      // Count by provider
      eventsByProvider[event.provider] = (eventsByProvider[event.provider] || 0) + 1;
      
      // Count by model
      eventsByModel[event.modelId] = (eventsByModel[event.modelId] || 0) + 1;
      
      // Count by error type
      eventsByErrorType[event.errorType] = (eventsByErrorType[event.errorType] || 0) + 1;
      
      // Recovery metrics
      if (event.recovery.retryDelayMs) {
        totalRecoveryTime += event.recovery.retryDelayMs;
        recoveryCount++;
      }
      
      if (event.recovery.fallbackUsed && event.recovery.retrySuccessful) {
        fallbackSuccessCount++;
      }
    });

    return {
      totalEvents: this.rateLimitEvents.length,
      eventsByProvider,
      eventsByModel,
      eventsByErrorType,
      firstEventTime: this.rateLimitEvents[0].timestamp,
      lastEventTime: this.rateLimitEvents[this.rateLimitEvents.length - 1].timestamp,
      averageRecoveryTime: recoveryCount > 0 ? totalRecoveryTime / recoveryCount : 0,
      fallbackSuccessRate: this.rateLimitEvents.length > 0 ? (fallbackSuccessCount / this.rateLimitEvents.length) * 100 : 0,
    };
  }

  /**
   * Get recent rate limit events (last N events)
   */
  getRecentEvents(limit: number = 10): RateLimitEvent[] {
    return this.rateLimitEvents.slice(-limit);
  }

  /**
   * Clear all recorded events
   */
  async clearEvents(): Promise<void> {
    this.rateLimitEvents = [];
    await this.saveEventsToFile();
    await this.updateSummary();
    this.logger.log('🧹 Rate limit events cleared');
  }

  /**
   * Load existing events from file
   */
  private loadExistingEvents(): void {
    try {
      if (fs.existsSync(this.rateLimitLogPath)) {
        const data = fs.readFileSync(this.rateLimitLogPath, 'utf8');
        const parsed = JSON.parse(data);
        this.rateLimitEvents = parsed.events || [];
        this.logger.log(`📂 Loaded ${this.rateLimitEvents.length} existing rate limit events`);
      }
    } catch (error) {
      this.logger.warn(`⚠️ Failed to load existing rate limit events: ${error.message}`);
      this.rateLimitEvents = [];
    }
  }

  /**
   * Save events to JSON file
   */
  private async saveEventsToFile(): Promise<void> {
    try {
      const data = {
        metadata: {
          totalEvents: this.rateLimitEvents.length,
          lastUpdated: new Date().toISOString(),
          version: '1.0.0',
        },
        events: this.rateLimitEvents,
      };

      fs.writeFileSync(this.rateLimitLogPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      this.logger.error(`❌ Failed to save rate limit events: ${error.message}`);
    }
  }

  /**
   * Update summary file
   */
  private async updateSummary(): Promise<void> {
    try {
      const summary = this.getRateLimitSummary();
      const summaryData = {
        metadata: {
          generatedAt: new Date().toISOString(),
          version: '1.0.0',
        },
        summary,
        recentEvents: this.getRecentEvents(5),
      };

      fs.writeFileSync(this.summaryLogPath, JSON.stringify(summaryData, null, 2), 'utf8');
    } catch (error) {
      this.logger.error(`❌ Failed to save rate limit summary: ${error.message}`);
    }
  }

  /**
   * Get rate limit logs file path
   */
  getRateLimitLogsPath(): string {
    return this.rateLimitLogPath;
  }

  /**
   * Get summary logs file path
   */
  getSummaryLogsPath(): string {
    return this.summaryLogPath;
  }
}