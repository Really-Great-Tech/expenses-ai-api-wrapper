# Rate Limit Monitoring System

This document explains the rate limit monitoring system implemented for tracking and logging AWS Bedrock model rate limits during concurrent expense processing.

## Overview

The rate limit monitoring system captures and logs rate limit events when processing multiple receipt files concurrently. This helps understand the actual rate limits of Bedrock models and provides insights for optimizing concurrent processing.

## Components

### 1. RateLimitMonitorService (`src/services/rate-limit-monitor.service.ts`)

The core service that:
- Detects rate limit errors from AWS Bedrock and Anthropic APIs
- Logs detailed rate limit events to JSON files
- Tracks request counts and recovery metrics
- Provides summary statistics

**Key Features:**
- Automatic error type detection (throttling, rate_limit, quota_exceeded)
- Fallback tracking and success rates
- Request counting with sliding windows and total call tracking
- **Precise call counting**: Shows exactly how many calls were made before hitting rate limits
- **Time-to-rate-limit tracking**: Measures how long it takes to reach rate limits
- **Request rate analysis**: Calculates calls per second when rate limits occur
- Comprehensive event logging with context

### 2. Enhanced BedrockLlmService (`src/utils/bedrockLlm.ts`)

Modified to:
- Integrate with RateLimitMonitorService
- Detect rate limit errors automatically
- Log detailed context information
- Handle fallback scenarios with tracking

### 3. Updated Agents

All processing agents now:
- Accept RateLimitMonitorService instances
- Pass context information (filename, userId, processing stage)
- Enable detailed rate limit tracking per operation

## JSON File Structure

### Rate Limit Events File (`rate-limit-logs/rate-limit-events.json`)

```json
{
  "metadata": {
    "totalEvents": 5,
    "lastUpdated": "2024-01-15T10:30:00.000Z",
    "version": "1.0.0"
  },
  "events": [
    {
      "timestamp": "2024-01-15T10:25:30.123Z",
      "service": "BedrockLlmService",
      "modelId": "eu.amazon.nova-pro-v1:0",
      "provider": "bedrock",
      "errorType": "throttling",
      "errorMessage": "ThrottlingException: Rate exceeded",
      "requestDetails": {
        "region": "eu-west-1",
        "retryAttempt": 1,
        "concurrentRequests": 15,
        "totalCallsBeforeRateLimit": 47,
        "callsInCurrentWindow": 15,
        "windowDurationMs": 8500,
        "requestsPerSecond": 5.53
      },
      "context": {
        "filename": "receipt_001.pdf",
        "userId": "user_123",
        "processingStage": "data-extraction",
        "totalRequestsInWindow": 15,
        "windowStartTime": "2024-01-15T10:24:30.123Z",
        "successfulCallsBeforeLimit": 46,
        "timeToRateLimit": 8500,
        "averageCallsPerSecond": 5.41
      },
      "recovery": {
        "fallbackUsed": true,
        "fallbackProvider": "anthropic",
        "retrySuccessful": true,
        "retryDelayMs": 1250
      }
    }
  ]
}
```

### Summary File (`rate-limit-logs/rate-limit-summary.json`)

```json
{
  "metadata": {
    "generatedAt": "2024-01-15T10:30:00.000Z",
    "version": "1.0.0"
  },
  "summary": {
    "totalEvents": 5,
    "eventsByProvider": {
      "bedrock": 4,
      "anthropic": 1
    },
    "eventsByModel": {
      "eu.amazon.nova-pro-v1:0": 4,
      "claude-3-5-sonnet-20241022": 1
    },
    "eventsByErrorType": {
      "throttling": 3,
      "rate_limit": 2
    },
    "firstEventTime": "2024-01-15T10:20:00.000Z",
    "lastEventTime": "2024-01-15T10:25:30.123Z",
    "averageRecoveryTime": 1150,
    "fallbackSuccessRate": 80.0
  },
  "recentEvents": [
    // Last 5 events for quick reference
  ]
}
```

## Usage

### Running Rate Limit Tests

1. **Basic Test Script:**
   ```bash
   node scripts/run-rate-limit-test.js
   ```

2. **Manual Testing:**
   ```typescript
   import { testRateLimits, testExtremeRateLimits } from './scripts/test-rate-limits';
   
   // Test with gradual concurrency increase
   await testRateLimits();
   
   // Test with high burst concurrency
   await testExtremeRateLimits();
   ```

### Integration in Your Code

```typescript
import { RateLimitMonitorService } from './src/services/rate-limit-monitor.service';
import { ExpenseProcessingService } from './src/services/expense-processing.service';

// Initialize with rate limit monitoring
const rateLimitMonitor = new RateLimitMonitorService();
const expenseService = new ExpenseProcessingService(
  langfuseService,
  userSessionService,
  rateLimitMonitor
);

// Process files - rate limits will be automatically detected and logged
const result = await expenseService.processExpenseDocument(
  markdownContent,
  filename,
  imagePath,
  country,
  icp,
  complianceData,
  expenseSchema,
  progressCallback,
  markdownExtractionInfo,
  true, // useParallelProcessing
  userId
);

// Check for rate limit events and call statistics
const summary = rateLimitMonitor.getRateLimitSummary();
const sessionStats = rateLimitMonitor.getSessionStatistics();
const callStats = rateLimitMonitor.getCallStatistics('BedrockLlmService', modelId);

console.log(`Rate limit events detected: ${summary.totalEvents}`);
console.log(`Total calls made: ${sessionStats.totalCalls}`);

if (summary.totalEvents > 0) {
  const recentEvents = rateLimitMonitor.getRecentEvents(1);
  if (recentEvents.length > 0) {
    const event = recentEvents[0];
    console.log(`🚨 RATE LIMIT REACHED:`);
    console.log(`   - Successful calls before limit: ${event.context.successfulCallsBeforeLimit}`);
    console.log(`   - Time to rate limit: ${(event.context.timeToRateLimit / 1000).toFixed(1)}s`);
    console.log(`   - Request rate: ${event.context.averageCallsPerSecond} calls/sec`);
  }
}
```

### Accessing Rate Limit Data

```typescript
const rateLimitMonitor = new RateLimitMonitorService();

// Get summary statistics
const summary = rateLimitMonitor.getRateLimitSummary();

// Get recent events with call details
const recentEvents = rateLimitMonitor.getRecentEvents(10);

// Get detailed call statistics
const callStats = rateLimitMonitor.getCallStatistics('BedrockLlmService', modelId);
const sessionStats = rateLimitMonitor.getSessionStatistics();

console.log(`Call Statistics:`);
console.log(`- Total calls: ${callStats.totalCalls}`);
console.log(`- Calls in current window: ${callStats.callsInCurrentWindow}`);
console.log(`- Average calls/sec: ${callStats.averageCallsPerSecond}`);
console.log(`- Session duration: ${(sessionStats.sessionDurationMs / 1000).toFixed(1)}s`);

// Get file paths
const eventsPath = rateLimitMonitor.getRateLimitLogsPath();
const summaryPath = rateLimitMonitor.getSummaryLogsPath();

// Clear events (for testing)
await rateLimitMonitor.clearEvents();
```

## Rate Limit Detection

The system automatically detects rate limit errors based on:

### AWS Bedrock Indicators
- `ThrottlingException`
- `ModelNotReadyException`
- `ValidationException`
- Error messages containing: "rate limit", "throttled", "quota exceeded"

### Anthropic Indicators
- `rate_limit_error`
- `too_many_requests`
- `quota_exceeded`
- `overloaded_error`

## Configuration

### Environment Variables

```bash
# Bedrock Configuration
BEDROCK_AWS_REGION=eu-west-1
BEDROCK_MODEL=eu.amazon.nova-pro-v1:0
BEDROCK_RATE_LIMIT_PER_SECOND=10

# Validation Configuration (affects concurrent requests)
VALIDATION_DIMENSION_CONCURRENCY=6
VALIDATION_JUDGE_CONCURRENCY=3
PARALLEL_VALIDATION_ENABLED=true

# Langfuse (optional, can be disabled for testing)
LANGFUSE_ENABLED=false
```

### Concurrency Settings

The system respects these concurrency limits:
- **File Processing**: Controlled by your application logic
- **Agent Operations**: Each agent can run concurrently
- **Validation**: Controlled by `VALIDATION_*_CONCURRENCY` settings
- **Rate Limiting**: Monitored and logged automatically

## Interpreting Results

### Understanding Rate Limit Events

1. **High `throttling` events**: Bedrock is actively limiting requests
2. **`quota_exceeded` events**: You've hit daily/monthly limits
3. **High `fallbackSuccessRate`**: Anthropic fallback is working well
4. **Low `averageRecoveryTime`**: Quick recovery from rate limits

### Optimization Strategies

Based on rate limit data:

1. **Reduce Concurrency**: Lower concurrent request counts
2. **Add Delays**: Implement exponential backoff
3. **Batch Processing**: Group requests to reduce frequency
4. **Load Balancing**: Distribute across multiple models/regions

## Troubleshooting

### No Rate Limits Detected

If no rate limits are detected during testing:

1. **Increase Concurrency**: Try higher concurrent request counts
2. **Reduce Delays**: Remove artificial delays between requests
3. **Check Credentials**: Ensure AWS credentials are working
4. **Verify Model Access**: Confirm Bedrock model access in your region

### High Rate Limit Events

If you're seeing many rate limit events:

1. **Reduce Concurrency**: Lower the number of concurrent requests
2. **Add Rate Limiting**: Implement client-side rate limiting
3. **Use Queuing**: Implement request queuing with delays
4. **Monitor Patterns**: Check if rate limits occur at specific times

## Files Created

The rate limit monitoring system creates these files:

```
rate-limit-logs/
├── rate-limit-events.json      # Detailed event log
└── rate-limit-summary.json     # Summary statistics
```

## Testing Scenarios

### Scenario 1: Gradual Load Testing
- Tests concurrency levels: 5, 10, 15, 20, 25
- 30-second delays between tests
- Comprehensive analysis of each level

### Scenario 2: Burst Testing
- Immediate burst of 50 concurrent requests
- Designed to trigger rate limits quickly
- Useful for understanding immediate limits

### Scenario 3: Production Monitoring
- Continuous monitoring during normal operations
- Automatic logging of any rate limit events with precise call counts
- No impact on normal processing flow
- Real-time threshold discovery and adaptation

### Scenario 4: Threshold Discovery
- Systematic testing to find exact rate limit boundaries
- Measurement of calls-to-rate-limit for different request patterns
- Time-based analysis of rate limit recovery
- Request rate optimization based on discovered thresholds

## Best Practices

1. **Monitor Regularly**: Check rate limit logs periodically
2. **Set Alerts**: Monitor for high rate limit event counts
3. **Optimize Gradually**: Use data to tune concurrency settings
4. **Plan for Peaks**: Account for higher usage periods
5. **Test Fallbacks**: Ensure Anthropic fallback works reliably

## Support

For issues or questions about the rate limit monitoring system:

1. Check the log files in `rate-limit-logs/`
2. Review the summary statistics
3. Examine recent events for patterns
4. Adjust concurrency settings based on findings

The system is designed to be non-intrusive and provide valuable insights into Bedrock rate limiting behavior during concurrent expense processing operations.