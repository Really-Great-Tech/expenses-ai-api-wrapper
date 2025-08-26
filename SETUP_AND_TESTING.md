# NestJS Expense Processing Service - Setup and Testing Guide

## 🚀 Initial Setup

### 1. Install Dependencies
```bash
cd expenses-ai-api-wrapper
npm install
```

### 2. Environment Variables
Get a copy of `.env` file and save it in the root directory:

### 3. Install and Start Redis (Required for BullMQ)

For Windows: https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/install-redis-on-windows/

For Linux: https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/install-redis-on-linux/

For MacOS: https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/install-redis-on-mac-os/

### 4. Create /uploads/ directory
Create uploads directory at the root level. This is a local storage for expense files user uploads


### 5. Start the Application
```bash
npm run start:dev
```

## 🤖 AI Model Configuration

The service supports multiple AI providers with automatic fallback:

1. **Primary**: AWS Bedrock (Amazon Nova and Claude models)
2. **Fallback**: Anthropic API (Direct Claude access)


## 🧪 Testing the API

### 1. Access Swagger Documentation
 Expense Processing Service is running on: http://localhost:3000
📚 API Documentation available at: http://localhost:3000/rgt-expense/api/docs
```
http://localhost:3000/rgt-expense/api/docs
```

### 2. Test File Upload Endpoint
**POST** `/documents/process`
Upload an expense document. Enter a unique user id and the appropriate country. Select textract for the document reader and execute.


### 3. Check Processing Status
**GET** `/documents/status/{jobId}`

```bash
curl http://localhost:3000/documents/status/test-user-123
```

### 4. Get Processing Results
**GET** `/documents/results/{jobId}`

```bash
curl http://localhost:3000/documents/results/test-user-123
```


### Health Check
```bash
curl http://localhost:3000/health
```

## 🐛 Debugging

### Check Logs
```bash
# Application logs will show in console
npm run start:dev

# Check Redis connection
redis-cli ping
```

### Common Issues:
1. **Redis Connection Error**: Make sure Redis is running on port 6379
2. **LLM API Errors**: Verify API keys in .env file
3. **File Upload Errors**: Check file size (max 10MB) and supported formats
4. **Job Processing Stuck**: Check BullMQ dashboard or Redis for job status

### Monitor Job Queue
You can add Bull Dashboard for monitoring:
```bash
npm install bull-board
```
Or Redis Insight

