# Environment Variables Guide

This guide provides detailed information about all environment variables used in the RGT Expense Processing Service.

## Quick Start

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in the required values as described below
3. Ensure sensitive values are kept secure and never committed to version control

## Environment Variables Reference

### 🚀 Application Configuration

#### `NODE_ENV`
- **Description**: Defines the application environment
- **Default**: `development`
- **Options**: `development`, `production`, `test`
- **Example**: `NODE_ENV=production`
- **Required**: No

#### `PORT`
- **Description**: Port number the application will listen on
- **Default**: `3000`
- **Example**: `PORT=3000`
- **Required**: No

### 🔄 Redis Configuration

Redis is used for job queuing and caching.

#### `REDIS_HOST`
- **Description**: Redis server hostname
- **Default**: `localhost`
- **Docker**: Use `redis` (service name)
- **Example**: `REDIS_HOST=localhost`
- **Required**: Yes

#### `REDIS_PORT`
- **Description**: Redis server port
- **Default**: `6379`
- **Example**: `REDIS_PORT=6379`
- **Required**: No

#### `REDIS_PASSWORD`
- **Description**: Redis server password (if authentication is enabled)
- **Default**: Empty (no password)
- **Example**: `REDIS_PASSWORD=your_redis_password`
- **Required**: No

#### `REDIS_DB`
- **Description**: Redis database number to use
- **Default**: `0`
- **Example**: `REDIS_DB=0`
- **Required**: No

### 🤖 AI Service Configuration

The service supports multiple AI providers for document processing.

#### `LLM_PROVIDER`
- **Description**: Primary LLM provider to use
- **Options**: `openai`, `anthropic`
- **Default**: `openai`
- **Example**: `LLM_PROVIDER=anthropic`
- **Required**: Yes

#### `OPENAI_API_KEY`
- **Description**: OpenAI API key for GPT models
- **How to get**: Sign up at [OpenAI Platform](https://platform.openai.com/)
- **Example**: `OPENAI_API_KEY=sk-proj-...`
- **Required**: Yes (if using OpenAI)

#### `ANTHROPIC_KEY`
- **Description**: Anthropic API key for Claude models
- **How to get**: Sign up at [Anthropic Console](https://console.anthropic.com/)
- **Example**: `ANTHROPIC_KEY=sk-ant-...`
- **Required**: Yes (if using Anthropic)

#### `LLAMAINDEX_API_KEY`
- **Description**: LlamaIndex API key for advanced document parsing
- **How to get**: Sign up at [LlamaIndex Cloud](https://cloud.llamaindex.ai/)
- **Example**: `LLAMAINDEX_API_KEY=llx-...`
- **Required**: Yes (if using LlamaIndex document reader)

### ☁️ AWS Configuration

AWS services are used for document processing and storage.

#### `AWS_ACCESS_KEY_ID`
- **Description**: AWS access key ID
- **How to get**: Create IAM user in [AWS Console](https://aws.amazon.com/console/)
- **Example**: `AWS_ACCESS_KEY_ID=AKIA...`
- **Required**: Yes

#### `AWS_SECRET_ACCESS_KEY`
- **Description**: AWS secret access key
- **How to get**: Generated when creating IAM user
- **Example**: `AWS_SECRET_ACCESS_KEY=abc123...`
- **Required**: Yes

#### `AWS_REGION`
- **Description**: AWS region for services
- **Recommended**: `us-east-1`, `eu-west-1`, `ap-southeast-1`
- **Example**: `AWS_REGION=us-east-1`
- **Required**: Yes

**AWS Permissions Required:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "textract:AnalyzeDocument",
        "textract:DetectDocumentText",
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "*"
    }
  ]
}
```

### 📄 Document Reader Configuration

#### `DOCUMENT_READER`
- **Description**: Document parsing service to use
- **Options**: `textract`, `llamaparse`
- **Default**: `textract`
- **Example**: `DOCUMENT_READER=llamaparse`
- **Required**: No

**Comparison:**
- **textract**: AWS Textract - Good for basic OCR, requires AWS credentials
- **llamaparse**: LlamaIndex - Better for complex documents, requires LlamaIndex API key

### 📁 File Upload Configuration

#### `MAX_FILE_SIZE`
- **Description**: Maximum allowed file size for uploads
- **Default**: `50MB`
- **Format**: Number with unit (KB, MB, GB)
- **Example**: `MAX_FILE_SIZE=100MB`
- **Required**: No

#### `UPLOAD_PATH`
- **Description**: Directory path for storing uploaded files
- **Default**: `./uploads`
- **Docker**: Use `/app/uploads`
- **Example**: `UPLOAD_PATH=./uploads`
- **Required**: No

### ⚙️ Job Queue Configuration

#### `QUEUE_CONCURRENCY`
- **Description**: Number of jobs to process simultaneously
- **Default**: `10`
- **Recommended**: 5-20 depending on server resources
- **Example**: `QUEUE_CONCURRENCY=15`
- **Required**: No

#### `MAX_RETRY_ATTEMPTS`
- **Description**: Maximum number of retry attempts for failed jobs
- **Default**: `3`
- **Example**: `MAX_RETRY_ATTEMPTS=5`
- **Required**: No

#### `JOB_TIMEOUT`
- **Description**: Job timeout in milliseconds
- **Default**: `300000` (5 minutes)
- **Example**: `JOB_TIMEOUT=600000`
- **Required**: No

### 🔄 Processing Optimization

#### `USE_PARALLEL_PROCESSING`
- **Description**: Enable parallel processing for better performance
- **Default**: `true`
- **Options**: `true`, `false`
- **Example**: `USE_PARALLEL_PROCESSING=true`
- **Required**: No

### 📊 Monitoring Configuration

#### `ENABLE_SWAGGER`
- **Description**: Enable Swagger API documentation
- **Default**: `true`
- **Options**: `true`, `false`
- **Example**: `ENABLE_SWAGGER=true`
- **Required**: No
- **URL**: `http://localhost:3000/rgt-expense/api/docs`

#### `ENABLE_THROTTLING`
- **Description**: Enable API rate limiting
- **Default**: `true`
- **Options**: `true`, `false`
- **Example**: `ENABLE_THROTTLING=true`
- **Required**: No

#### `THROTTLE_TTL`
- **Description**: Throttling window duration in seconds
- **Default**: `60`
- **Example**: `THROTTLE_TTL=120`
- **Required**: No

#### `THROTTLE_LIMIT`
- **Description**: Maximum requests per throttling window
- **Default**: `100`
- **Example**: `THROTTLE_LIMIT=200`
- **Required**: No

## 🚀 Deployment Scenarios

### Local Development

```bash
# .env for local development
NODE_ENV=development
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
OPENAI_API_KEY=your_openai_key
ANTHROPIC_KEY=your_anthropic_key
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=us-east-1
DOCUMENT_READER=textract
```

### Docker Deployment

```bash
# .env for Docker deployment
NODE_ENV=production
PORT=3000
REDIS_HOST=redis  # Docker service name
REDIS_PORT=6379
OPENAI_API_KEY=your_openai_key
ANTHROPIC_KEY=your_anthropic_key
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=us-east-1
DOCUMENT_READER=textract
ENABLE_SWAGGER=false  # Disable in production
```

### Production Kubernetes

```bash
# Use Kubernetes secrets for sensitive data
NODE_ENV=production
PORT=3000
REDIS_HOST=redis-service
ENABLE_SWAGGER=false
ENABLE_THROTTLING=true
QUEUE_CONCURRENCY=20
MAX_FILE_SIZE=100MB
```

## 🔒 Security Best Practices

1. **Never commit `.env` files** to version control
2. **Use environment-specific values** for different deployments
3. **Rotate API keys regularly**
4. **Use least-privilege AWS IAM policies**
5. **Enable throttling in production**
6. **Disable Swagger in production**
7. **Use secure Redis configurations** with authentication
8. **Monitor API usage** and set up alerts

## 🆘 Troubleshooting

### Common Issues

**Redis Connection Failed**
```bash
# Check Redis is running
redis-cli ping
# Should return PONG
```

**AWS Permissions Error**
```bash
# Test AWS credentials
aws sts get-caller-identity
```

**API Key Invalid**
- Verify API keys are correctly copied
- Check for extra spaces or newlines
- Ensure keys haven't expired

**File Upload Issues**
- Check `MAX_FILE_SIZE` setting
- Verify `UPLOAD_PATH` directory exists and is writable
- Ensure sufficient disk space

## 📞 Support

For additional help:
1. Check the application logs
2. Verify all required environment variables are set
3. Test API endpoints using the health check: `GET /rgt-expense/actuator/health/liveness`
4. Review the API documentation at `/rgt-expense/api/docs`

## 🔄 Environment Variable Validation

The application will validate required environment variables on startup and provide clear error messages if any are missing or invalid.
