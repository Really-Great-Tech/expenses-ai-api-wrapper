# MVP Architecture Plan: Expenses AI for Papaya

## Executive Summary

This document outlines the MVP architecture for a scalable, production-ready AI-powered expense processing service for Expenses AI. The system processes expense documents using multi-agent AI workflows, provides compliance validation, and offers real-time processing status tracking.

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Components](#architecture-components)
3. [Technology Stack](#technology-stack)
4. [Data Flow Architecture](#data-flow-architecture)
5. [Scalability Design](#scalability-design)
6. [Security & Compliance](#security--compliance)
7. [Monitoring & Observability](#monitoring--observability)
8. [Deployment Strategy](#deployment-strategy)
9. [API Design](#api-design)
10. [Performance Requirements](#performance-requirements)
11. [Disaster Recovery](#disaster-recovery)
12. [Cost Optimization](#cost-optimization)

## System Overview

### Core Functionality
- **Document Processing**: Multi-format expense document ingestion (PDF, images)
- **AI-Powered Analysis**: Multi-agent workflow for classification, extraction, and validation
- **Compliance Checking**: Country-specific expense policy validation
- **Real-time Processing**: Asynchronous job processing with status tracking
- **Quality Assessment**: Image quality analysis and recommendations

### Key Features
- Multi-tenant user management with session tracking
- Parallel processing with two-stage agent execution
- LLM-as-judge validation system
- Comprehensive audit trails via Langfuse
- RESTful API with OpenAPI documentation
- Health monitoring and metrics collection

## Architecture Components

### 1. API Gateway Layer
```
┌─────────────────────────────────────────┐
│              Load Balancer              │
│         (AWS ALB / NGINX)               │
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│            API Gateway                  │
│    - Rate Limiting (100 req/min)       │
│    - Authentication & Authorization    │
│    - Request/Response Logging          │
│    - CORS Management                   │
└─────────────────────────────────────────┘
```

### 2. Application Layer
```
┌─────────────────────────────────────────┐
│         NestJS Application              │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │ Controllers │  │    Services     │   │
│  │             │  │                 │   │
│  │ - Document  │  │ - Processing    │   │
│  │ - Health    │  │ - User Session  │   │
│  │ - Validation│  │ - Langfuse      │   │
│  │ - Invoice   │  │ - Dataset Mgmt  │   │
│  └─────────────┘  └─────────────────┘   │
│                                         │
│  ┌─────────────────────────────────────┐ │
│  │         AI Agent Layer              │ │
│  │                                     │ │
│  │ - File Classification Agent        │ │
│  │ - Data Extraction Agent            │ │
│  │ - Issue Detection Agent            │ │
│  │ - Citation Generator Agent         │ │
│  │ - Image Quality Assessment Agent   │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 3. Processing Layer
```
┌─────────────────────────────────────────┐
│         Job Queue System                │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │   BullMQ    │  │     Redis       │   │
│  │             │  │                 │   │
│  │ - Job Queue │  │ - Queue Storage │   │
│  │ - Scheduler │  │ - Session Cache │   │
│  │ - Retry     │  │ - Rate Limiting │   │
│  │ - Metrics   │  │ - Pub/Sub       │   │
│  └─────────────┘  └─────────────────┘   │
└─────────────────────────────────────────┘
```

### 4. AI Services Layer
```
┌─────────────────────────────────────────┐
│           AI Provider Layer             │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │AWS Bedrock  │  │   Anthropic     │   │
│  │             │  │   (Fallback)    │   │
│  │ - Nova Pro  │  │ - Claude 3.5    │   │
│  │ - Nova Lite │  │ - Sonnet        │   │
│  │ - Claude 3.5│  │                 │   │
│  └─────────────┘  └─────────────────┘   │
│                                         │
│  ┌─────────────────────────────────────┐ │
│  │      Document Processing            │ │
│  │                                     │ │
│  │ - AWS Textract (Primary)           │ │
│  │ - LlamaIndex (Alternative)         │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 5. Data Layer
```
┌─────────────────────────────────────────┐
│            Storage Layer                │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │File Storage │  │   Databases     │   │
│  │             │  │                 │   │
│  │ - S3 Bucket │  │ - PostgreSQL    │   │
│  │ - Local FS  │  │   (User Data)   │   │
│  │ - CDN       │  │ - Redis         │   │
│  │             │  │   (Cache/Queue) │   │
│  └─────────────┘  └─────────────────┘   │
└─────────────────────────────────────────┘
```

### 6. Observability Layer
```
┌─────────────────────────────────────────┐
│        Monitoring & Logging             │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │  Langfuse   │  │   Monitoring    │   │
│  │             │  │                 │   │
│  │ - LLM Traces│  │ - Prometheus    │   │
│  │ - Prompts   │  │ - Grafana       │   │
│  │ - Analytics │  │ - AlertManager  │   │
│  │ - Debugging │  │ - ELK Stack     │   │
│  └─────────────┘  └─────────────────┘   │
└─────────────────────────────────────────┘
```

## Technology Stack

### Backend Framework
- **NestJS**: Enterprise-grade Node.js framework
- **TypeScript**: Type-safe development
- **Express**: HTTP server foundation

### AI & ML Services
- **AWS Bedrock**: Primary LLM provider (Nova Pro/Lite, Claude 3.5)
- **Anthropic Claude**: Fallback LLM provider
- **AWS Textract**: Document OCR and analysis
- **LlamaIndex**: Alternative document processing

### Queue & Caching
- **BullMQ**: Advanced job queue system
- **Redis**: In-memory data store and cache
- **IORedis**: Redis client with clustering support

### Storage
- **AWS S3**: Object storage for documents
- **AWS Aurora/PostgreSQL**: Relational database for structured data

### Monitoring & Observability
- **Langfuse**: LLM observability and prompt management
- **Prometheus**: Metrics collection
- **Grafana**: Visualization and dashboards

### Development & Deployment
- **Docker**: Containerization
- **Docker Compose**: Local development orchestration
- **AWS ECS/EKS**: Container orchestration
- **GitHub Actions**: CI/CD pipeline

## Data Flow Architecture

### 1. Document Ingestion Flow
```mermaid
graph TD
    A[Client Upload] --> B[API Gateway]
    B --> C[Document Controller]
    C --> D[File Validation]
    D --> E[Store in S3]
    E --> F[Create Job in Queue]
    F --> G[Return Job ID]
```

### 2. Enhanced Processing Pipeline with Quality Gates
```mermaid
graph TD
    A[Job Queue] --> B[Duplicate Check]
    B --> C{File Hash Exists?}
    C -->|Yes| D[Return Cached Result]
    C -->|No| E[Document Reader]
    E --> F[Markdown Extraction]
    F --> G[Image Quality Assessment]
    G --> H{Quality Score > Threshold?}
    H -->|No| I[Return Quality Error]
    H -->|Yes| J[Parallel Group 1]
    
    J --> K[Classification Agent]
    J --> L[Extraction Agent]
    G --> J
    
    K --> M[Parallel Group 2]
    L --> M
    
    M --> N[Issue Detection Agent]
    M --> O[Citation Generator Agent]
    
    N --> P[LLM Validation]
    O --> P
    P --> Q[Save Results & Cache]
    Q --> R[Update Job Status]
```

### 3. Duplicate Detection Flow
```mermaid
graph TD
    A[File Upload] --> B[Generate SHA-256 Hash]
    B --> C[Check Redis Cache]
    C --> D{Hash + User Exists?}
    D -->|Yes| E[Check Result Status]
    E --> F{Processing Complete?}
    F -->|Yes| G[Return Cached Result]
    F -->|No| H[Return Job Status]
    D -->|No| I[Store Hash + Job ID]
    I --> J[Start Processing]
    J --> K[Cache Results on Completion]
```

### 4. Quality Gate Decision Tree
```mermaid
graph TD
    A[Image Quality Assessment] --> B{Blur Score > 0.7?}
    B -->|Yes| C[FAIL: Image too blurry]
    B -->|No| D{Contrast Score < 0.6?}
    D -->|Yes| E[FAIL: Poor contrast]
    D -->|No| F{Glare Level High/Medium?}
    F -->|Yes| G[FAIL: Glare interference]
    F -->|No| H{Tears/Folds Detected?}
    H -->|High Severity| I[FAIL: Document damaged]
    H -->|No/Low| J[Quality Check PASSED]
    J --> K[Continue Processing]
    
    C --> L[Return Quality Error + Recommendations]
    E --> L
    G --> L
    I --> L
```

### 5. User Session Management
```mermaid
graph TD
    A[User Request] --> B[Session Service]
    B --> C[Generate Session ID]
    C --> D[Create Job Mapping]
    D --> E[Store in Redis]
    E --> F[Link to Langfuse Trace]
```

## Scalability Design

### Horizontal Scaling Strategy

#### 1. Application Layer Scaling
```yaml
# Kubernetes Deployment Example
apiVersion: apps/v1
kind: Deployment
metadata:
  name: expense-processing-api
spec:
  replicas: 3  # Start with 3, auto-scale to 10
  selector:
    matchLabels:
## Parallel Processing Architecture

### Two-Stage Parallel Execution
The system implements a sophisticated two-stage parallel processing architecture that maximizes throughput while maintaining data dependencies:

**Parallel Group 1 - Independent Processing**: The first stage executes two agents simultaneously as they can operate independently on the source document:

- **File Classification Agent**: Determines document type and expense category
- **Data Extraction Agent**: Extracts structured data from the document content

**Parallel Group 2 - Dependent Processing**: The second stage runs two agents concurrently, both utilizing results from Group 1:
- **Issue Detection Agent**: Analyzes compliance issues using policy rules, extracted data and classification results
- **Citation Generator Agent**: Creates citations and references using extracted data and document content

**Performance Benefits**: The two-stage approach ensures data dependencies are respected while maximizing concurrent execution.

**Resource Optimization**: Each parallel group is designed to utilize available CPU cores efficiently while managing memory usage and API rate limits for external AI services.
      app: expense-processing-api
  template:
    spec:
      containers:
      - name: api
        image: expense-processing:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
```

#### 2. Queue Processing Scaling
- **Multiple Worker Instances**: Scale BullMQ workers independently
- **Queue Partitioning**: Separate queues by priority/type
- **Concurrency Control**: Configurable per-worker concurrency

#### 3. Database Scaling
- **Read Replicas**: PostgreSQL read replicas for query scaling
- **Connection Pooling**: PgBouncer for connection management
- **Redis Clustering**: Redis Cluster for cache scaling

### Vertical Scaling Considerations
- **Memory**: 2-8GB per instance based on document volume
- **CPU**: 2-8 cores for AI processing workloads
- **Storage**: SSD for temporary files, S3 for permanent storage

### Auto-scaling Triggers
```yaml
# HPA Configuration
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: expense-processing-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: expense-processing-api
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## Security & Compliance

### 1. Authentication & Authorization
The system implements JWT-based authentication with role-based access control. Each authenticated request includes a token containing user identification, assigned roles, permissions, and expiration time. The system supports three primary user roles:

- **Admin Role**: Full system access including user management, system configuration, and all processing operations
- **User Role**: Standard access for document processing, result retrieval, and personal data management
- **Viewer Role**: Read-only access to results and status information without processing capabilities

Authentication tokens are validated on each request, with automatic refresh mechanisms to maintain session continuity while ensuring security through token expiration.

### 2. Data Protection
- **Encryption at Rest**: AES-256 for stored documents
- **Encryption in Transit**: TLS 1.3 for all communications
- **PII Handling**: Automatic detection and masking
- **Data Retention**: Configurable retention policies
- **Duplicate Prevention**: SHA-256 file hashing with Redis cache
- **File Integrity**: Checksum validation on upload and processing
- **Cache Security**: Encrypted Redis cache with TTL expiration

### 3. API Security
The API implements comprehensive security measures to protect against common attacks and ensure data integrity:

**Rate Limiting**: Each IP address is limited to 100 requests per minute to prevent abuse and ensure fair resource allocation. The system returns appropriate HTTP status codes and headers when limits are exceeded.

**Input Validation**: All incoming requests undergo strict validation to ensure data integrity and prevent injection attacks. Required fields like country and ICP are validated for presence and format, while optional parameters like document reader selection are sanitized.

**Request Sanitization**: All user inputs are sanitized to remove potentially malicious content, with special attention to file uploads and text parameters that could contain executable code or SQL injection attempts.

### 4. Compliance Features
- **GDPR Compliance**: Data subject rights implementation
- **SOC 2**: Security controls and audit trails
- **HIPAA Ready**: Healthcare data handling capabilities
- **Audit Logging**: Comprehensive activity logging

## Monitoring & Observability

### 1. Application Metrics
```typescript
// Enhanced metrics collection with quality and duplicate tracking
interface ProcessingMetrics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  duplicateJobs: number;
  qualityFailures: number;
  timeoutFailures: number;
  averageProcessingTime: number;
  averageQualityScore: number;
  queueHealth: QueueHealthMetrics;
}

// Quality gate metrics
interface QualityMetrics {
  blurFailures: number;
  contrastFailures: number;
  glareFailures: number;
  tearFailures: number;
  obstructionFailures: number;
  overallQualityScore: number;
  qualityPassRate: number;
}

// Duplicate detection metrics
interface DuplicateMetrics {
  totalDuplicatesDetected: number;
  cacheHitRate: number;
  duplicatesByUser: Record<string, number>;
  averageCacheRetrievalTime: number;
}

// Performance tracking
interface PerformanceMetrics {
  responseTime: number;
  throughput: number;
  errorRate: number;
  cpuUsage: number;
  memoryUsage: number;
}
```

### 2. Health Checks
The system implements multi-layered health monitoring to ensure reliable operation:

**Liveness Checks**: Verify that the application is running and responsive. These lightweight checks confirm basic application functionality and return system uptime information. Kubernetes uses these checks to determine if a pod should be restarted.

**Readiness Checks**: Perform comprehensive validation of all system dependencies before accepting traffic. This includes:
- Database connectivity and query response times
- Redis cache availability and performance
- AI service provider accessibility and response validation
- File storage system availability and write permissions

**Dependency Monitoring**: Each external dependency is monitored independently with specific timeout thresholds. If any critical dependency fails, the system gracefully degrades service or returns appropriate error responses rather than failing silently.

### 3. Alerting Strategy
The monitoring system implements intelligent alerting to ensure rapid response to operational issues:

**Error Rate Monitoring**: Alerts trigger when HTTP 5xx error rates exceed 10% over a 5-minute period, indicating potential system issues requiring immediate attention. These critical alerts notify on-call engineers within 2 minutes of detection.

**Queue Health Monitoring**: Warning alerts activate when job queues exceed 100 waiting jobs for more than 5 minutes, suggesting processing bottlenecks or resource constraints that may require scaling intervention.

**Quality Gate Alerts**: Monitor image quality failure rates and alert when quality rejections exceed 30% over 5 minutes, indicating potential issues with document submission guidelines or quality threshold calibration.

**Performance Degradation**: Track response time increases, memory usage spikes, and CPU utilization patterns to predict and prevent system overload before it impacts users.

### 4. Distributed Tracing
- **Langfuse Integration**: LLM-specific tracing and analytics
- **OpenTelemetry**: Standard distributed tracing
- **Correlation IDs**: Request tracking across services

## Deployment Strategy

### 1. Environment Strategy
```
Development → Staging → Production
     ↓           ↓          ↓
   Local      AWS Dev    AWS Prod
   Docker     ECS/EKS    ECS/EKS
```

### 2. Infrastructure as Code
All infrastructure is defined and managed through code to ensure consistency, repeatability, and version control:

**Terraform Configuration**: Infrastructure components are defined using Terraform, enabling automated provisioning of AWS ECS clusters, services, load balancers, and networking components. Each environment (development, staging, production) uses parameterized configurations to maintain consistency while allowing environment-specific customizations.

**Container Orchestration**: ECS services are configured with appropriate resource allocation, health checks, and deployment strategies. The system supports rolling deployments with zero downtime by maintaining minimum healthy instance counts during updates.

**Environment Management**: Infrastructure code includes environment-specific variables for scaling parameters, resource limits, and configuration values. This approach ensures that infrastructure changes are tested in lower environments before production deployment.

### 3. CI/CD Pipeline
The deployment pipeline ensures code quality and reliable releases through automated testing and deployment:

**Automated Testing**: Every code change triggers comprehensive testing including unit tests, integration tests, and end-to-end testing. The pipeline prevents deployment of code that fails any test suite, ensuring quality gates are maintained.

**Container Building**: Successful tests trigger automated Docker image building with unique tags based on Git commit hashes. Images are pushed to Amazon ECR (Elastic Container Registry) for secure storage and distribution.

**Progressive Deployment**: The system supports multiple deployment strategies including blue-green deployments and rolling updates. Production deployments occur only after successful testing and staging environment validation.

**Rollback Capabilities**: Each deployment maintains previous versions for rapid rollback if issues are detected. Automated health checks during deployment can trigger automatic rollbacks if service health degrades.

### 4. Blue-Green Deployment
The system implements blue-green deployment strategy for zero-downtime updates and rapid rollback capabilities:

**Dual Environment Strategy**: Maintains two identical production environments (blue and green) where one serves live traffic while the other remains idle or serves as a staging environment for the next release.

**Traffic Switching**: New deployments are first deployed to the inactive environment, thoroughly tested, and then traffic is switched over instantly. This approach eliminates downtime and provides immediate rollback capability.

**Automated Validation**: Before traffic switching, automated tests validate the new deployment including health checks, performance benchmarks, and functional testing. Manual approval gates can be configured for critical releases.

**Gradual Rollout**: The system supports gradual traffic shifting, allowing a percentage of traffic to be routed to the new version while monitoring for issues before full cutover.

## API Design

### 1. Enhanced RESTful API Design
The API provides comprehensive document processing capabilities with built-in duplicate detection and quality validation:

**Document Processing Endpoint**: The primary processing endpoint first generates a SHA-256 hash of the uploaded file and checks against a user-scoped cache for duplicates. If a duplicate is found, the system immediately returns the cached results without reprocessing, significantly improving response times and reducing computational costs.

For new files, the system validates file format, size constraints, and user permissions before queuing the document for processing. The endpoint supports configurable quality thresholds and timeout values, allowing clients to specify processing requirements based on their use case.

**Status Monitoring**: The status endpoint provides real-time processing updates with enhanced error categorization. Errors are classified into specific types (TIMEOUT_ERROR, QUALITY_ERROR, DUPLICATE_ERROR, NETWORK_ERROR, PROCESSING_ERROR) to enable intelligent client-side handling and user feedback.

**Results Retrieval**: The results endpoint returns comprehensive processing outcomes including quality scores, duplicate indicators, and detailed processing metrics. Results include confidence scores for AI-generated insights and quality assessments for transparency.

**Validation Services**: A dedicated validation endpoint allows post-processing verification using LLM-as-judge techniques, providing additional confidence scoring and compliance verification.

**Request/Response Structure**: All endpoints support structured request validation with required fields (country, ICP) and optional parameters (document reader selection, quality thresholds, timeout values). Responses include comprehensive metadata about processing status, quality metrics, and performance indicators.

**Enhanced Data Transfer Objects**: Request validation includes country and ICP as required fields, with optional parameters for document reader selection, quality check bypass, configurable quality thresholds (0.1-1.0 range), and timeout settings (30 seconds to 1 minute maximum).

**Response Types**: Processing responses include job identification, status indicators, duplicate flags, quality issue details, and estimated processing times. Status responses provide comprehensive progress tracking across all processing phases including quality assessment and LLM validation.

### 2. Real-Time Communication
The system provides WebSocket-based real-time updates for enhanced user experience during document processing:

**Job Subscription Model**: Clients can subscribe to specific job updates by providing a job ID, enabling real-time progress tracking without polling. The system maintains secure, user-scoped connections to ensure data privacy and prevents unauthorized access to job status information.

**Progress Notifications**: As documents move through the processing pipeline (quality assessment, classification, extraction, compliance checking, citation generation), clients receive immediate updates with progress percentages and current stage information. This includes detailed progress tracking for each processing phase.

**Error Broadcasting**: Quality failures, timeouts, and processing errors are immediately broadcast to subscribed clients, allowing for immediate user feedback and potential corrective actions. Error messages include specific categorization and actionable recommendations.

**Connection Management**: The WebSocket gateway handles connection lifecycle, automatic reconnection, and graceful degradation when real-time updates are unavailable. CORS configuration allows cross-origin connections while maintaining security through proper authentication.

**Event-Driven Updates**: The system emits structured progress events containing job identification, current processing stage, completion percentages, and any relevant metadata. Clients can handle these events to update user interfaces in real-time.

### 3. OpenAPI Documentation
```typescript
// Swagger configuration
const config = new DocumentBuilder()
  .setTitle('Expense Processing Service')
  .setDescription('AI-powered expense document processing service')
  .setVersion('1.0')
  .addTag('documents', 'Document processing endpoints')
  .addTag('validation', 'Validation endpoints')
  .addTag('health', 'Health check endpoints')
  .addBearerAuth()
  .build();
```

## Performance Requirements

### 1. Response Time Targets
```
Endpoint                    Target      Acceptable
─────────────────────────────────────────────────
POST /documents/process     < 200ms     < 500ms
GET  /documents/:id/status  < 100ms     < 200ms
GET  /documents/:id/results < 150ms     < 300ms
Processing Pipeline         < 30s       < 60s
```

### 2. Throughput Requirements
## Enhanced Processing Logic

### 1. Duplicate Detection Service
The duplicate detection service implements intelligent file deduplication to optimize processing resources and improve response times:

**Hash-Based Detection**: Each uploaded file is processed through SHA-256 hashing to create a unique fingerprint. This cryptographic hash ensures that even minor file modifications result in different hashes, while identical files always produce the same hash regardless of filename or upload time.

**User-Scoped Caching**: Duplicate detection operates within user boundaries, meaning files are only considered duplicates within the same user's context. This approach maintains data privacy while enabling efficient caching. The cache key combines the file hash with the user identifier to create unique storage keys.

**Cache Management**: The system maintains a Redis-based cache with configurable TTL (Time To Live) settings, defaulting to 24 hours. This balance ensures recent duplicates are caught while preventing indefinite cache growth. Cache entries include the original job ID, processing results, and timestamp information.

**Immediate Response**: When duplicates are detected, the system immediately returns cached results without initiating new processing jobs, significantly reducing response times and computational overhead.

### 2. Quality Gate Service
The quality gate service implements comprehensive image quality validation to ensure optimal processing results:

**Multi-Dimensional Quality Assessment**: The service evaluates multiple quality dimensions including blur detection, contrast assessment, glare identification, and physical document damage (tears, folds). Each dimension has configurable thresholds that can be adjusted based on processing requirements and accuracy needs.

**Configurable Thresholds**: Quality standards are environment-configurable, allowing different thresholds for development, staging, and production environments. Default thresholds include blur detection at 0.7 confidence, contrast assessment at 0.6, and glare detection at medium severity level.

**Scoring Algorithm**: The service calculates an overall quality score by applying weighted penalties for detected issues. Blur detection reduces the score by 70%, poor contrast by 60%, glare by 80%, and significant tears by 70%. The overall minimum acceptable score defaults to 0.5 but can be configured.

**Early Termination**: When quality issues are detected that fall below thresholds, processing is immediately terminated with specific error messages and recommendations. This prevents wasted computational resources on documents that cannot be accurately processed.

**Detailed Feedback**: Quality failures include specific issue descriptions and actionable recommendations, such as "Please upload a clearer image with better focus" for blur issues or "Please upload an image without glare or reflections" for glare problems.

### 3. Enhanced Job Processing with Timeouts and Retry Logic
The enhanced job processor implements comprehensive timeout management and intelligent retry strategies:

**Timeout Management**: All processing jobs are subject to a configurable timeout limit, defaulting to 60 seconds (1 minute). The system uses Promise.race() to compete the processing operation against a timeout promise, ensuring that no job can consume resources indefinitely. When timeouts occur, processing is immediately terminated with appropriate error responses.

**Processing Pipeline**: The job processor follows a structured execution flow:
1. **Duplicate Detection**: First checks if the file has been processed before using SHA-256 hashing and user-scoped caching
2. **Quality Gate Validation**: Assesses image quality against configurable thresholds for blur, contrast, glare, and document damage
3. **Core Processing**: Executes the full AI processing pipeline with parallel agent execution for classification, extraction, and compliance checking
4. **Result Caching**: Stores successful results for future duplicate detection with appropriate TTL settings

**Error Classification**: The system defines specific error types for different failure scenarios:
- **JobTimeoutError**: Triggered when processing exceeds the 60-second limit, includes timeout duration information
- **QualityGateError**: Raised when image quality falls below acceptable thresholds, includes detailed quality assessment results
- **ProcessingError**: General processing failures with wrapped original error context for debugging

**Graceful Degradation**: When timeouts occur, the system immediately terminates processing and returns appropriate error responses rather than allowing resource exhaustion. Quality gate failures prevent unnecessary processing of unsuitable documents, saving computational resources and providing immediate feedback to users.

**Result Handling**: Successful processing results include quality scores, duplicate indicators, processing metadata, and comprehensive timing information. Failed processing attempts provide detailed error categorization and actionable recommendations for resolution.

### 4. Intelligent Retry Strategy Configuration
The system implements sophisticated retry logic that adapts to different error types and failure scenarios:

**Retry Decision Matrix**: The retry strategy uses intelligent decision-making based on error classification:
- **Quality Gate Failures**: Never retried as they indicate fundamental document issues that won't resolve with additional attempts
- **Timeout Errors**: Only retried once, as subsequent attempts are likely to timeout again
- **Duplicate Detection Errors**: Never retried as they represent successful duplicate identification
- **File System Errors**: Never retried for missing files, as they indicate permanent issues
- **Network/API Errors**: Retried up to 3 attempts with exponential backoff for transient issues

**Exponential Backoff**: Retry delays increase exponentially (2 seconds, 4 seconds, 8 seconds) with a maximum cap of 10 seconds to prevent excessive delays while allowing transient issues to resolve.

**Queue Management**: The system maintains job history with configurable retention (100 completed jobs, 50 failed jobs) to balance debugging capabilities with storage efficiency.

**Error Message Enhancement**: Custom error messages provide specific guidance based on failure type, helping users understand whether issues are temporary (retry-able) or permanent (requiring corrective action).

### 5. Enhanced Monitoring and Alerting
The monitoring system includes specialized alerts for quality gates, duplicates, and timeout scenarios:

**Quality Failure Monitoring**: Alerts trigger when quality gate failure rates exceed 30% over a 5-minute period, indicating potential issues with document submission guidelines, quality threshold calibration, or user education needs. These warnings help identify trends in document quality.

**Duplicate Detection Tracking**: Informational alerts activate when duplicate detection rates exceed 50% over 5 minutes, which may indicate user workflow issues or potential system abuse. While not critical, high duplicate rates can inform user experience improvements.

**Timeout Spike Detection**: Critical alerts fire when job timeout rates exceed 10% over 1 minute, suggesting system performance degradation, resource constraints, or processing bottlenecks requiring immediate attention.

**Trend Analysis**: The monitoring system tracks quality score distributions, duplicate patterns by user, and timeout frequency to identify optimization opportunities and system health trends.


## Key Architectural Decisions

### 1. Duplicate Detection Strategy
- **File Hashing**: SHA-256 for reliable duplicate detection
- **User-Scoped Caching**: Duplicates are detected per user to maintain data isolation
- **TTL Management**: 24-hour cache expiration to balance storage and performance
- **Early Return**: Immediate response for duplicates without processing overhead

### 2. Quality Gate Implementation
- **Multi-Dimensional Assessment**: Blur, contrast, glare, tears, and obstructions
- **Configurable Thresholds**: Environment-based quality standards
- **Early Termination**: Stop processing immediately on quality failures
- **Detailed Feedback**: Specific recommendations for quality improvements

### 3. Timeout and Retry Logic
- **Hard Timeout**: 60-second processing limit with immediate termination
- **Smart Retry**: Context-aware retry decisions based on error type
- **Exponential Backoff**: Progressive delay for transient failures
- **Error Categorization**: Specific error types for better client handling

This enhanced architecture ensures robust, production-ready processing with comprehensive quality controls and efficient resource utilization.
```
Metric                      Target      Peak
─────────────────────────────────────────────
Documents/hour              1,000       2,500
Concurrent users            100         250
API requests/second         50          125
Queue processing rate       10 jobs/s   25 jobs/s
```

### 3. Resource Utilization
```yaml
# Resource allocation per component
api:
  cpu: "500m"
  memory: "1Gi"
  replicas: 3

worker:
  cpu: "1000m"
  memory: "2Gi"
  replicas: 2

redis:
  cpu: "250m"
  memory: "512Mi"
  replicas: 1

postgres:
  cpu: "500m"
  memory: "1Gi"
  replicas: 1
```

## Disaster Recovery

### 1. Backup Strategy
```yaml
# Automated backup configuration
backups:
  database:
    frequency: "daily"
    retention: "30 days"
    encryption: true
    
  files:
    frequency: "hourly"
    retention: "7 days"
    cross_region: true
    
  configuration:
    frequency: "on_change"
    retention: "90 days"
    version_control: true
```

### 2. Recovery Procedures
```bash
#!/bin/bash
# Disaster recovery script

# 1. Restore database
pg_restore --host=$DB_HOST --username=$DB_USER \
  --dbname=$DB_NAME backup_file.sql

# 2. Restore file storage
aws s3 sync s3://backup-bucket/ s3://primary-bucket/

# 3. Restart services
kubectl rollout restart deployment/expense-processing-api
kubectl rollout restart deployment/expense-processing-worker

# 4. Verify health
curl -f http://api.example.com/health/readiness
```

### 3. RTO/RPO Targets
```
Component           RTO        RPO
─────────────────────────────────
API Service         < 5 min    < 1 min
Database            < 15 min   < 5 min
File Storage        < 10 min   < 1 hour
Processing Queue    < 2 min    < 30 sec
```

## Cost Optimization

### 1. Resource Optimization
```typescript
// Dynamic scaling based on queue depth
interface ScalingPolicy {
  metric: 'queue_depth' | 'cpu_usage' | 'memory_usage';
  threshold: number;
  scaleUp: number;
  scaleDown: number;
  cooldown: number;
}

const scalingPolicies: ScalingPolicy[] = [
  {
    metric: 'queue_depth',
    threshold: 50,
    scaleUp: 2,
    scaleDown: 1,
    cooldown: 300, // 5 minutes
  },
];
```

### 2. AI Service Cost Management
```typescript
// Cost tracking per request
interface CostMetrics {
  llm_tokens_used: number;
  estimated_cost: number;
  model_used: string;
  processing_time: number;
}
```

### 3. Storage Optimization
```yaml
# S3 lifecycle policies
lifecycle_rules:
  - id: "expense-documents"
    status: "Enabled"
    transitions:
      - days: 30
        storage_class: "STANDARD_IA"
      - days: 90
        storage_class: "GLACIER"
      - days: 365
        storage_class: "DEEP_ARCHIVE"
```


## Success Metrics

### Technical Metrics
- **Uptime**: 99.9% availability
- **Performance**: < 45s average processing time
- **Accuracy**: > 95% document classification accuracy
- **Throughput**: 1000+ documents/hour
- **Error Rate**: < 1% processing failures

### Business Metrics
- **User Satisfaction**: > 4.5/5 rating
- **Processing Cost**: < $0.10 per document
- **Time to Value**: < 60s total processing time
- **Compliance**: 100% audit trail coverage
- **Scalability**: Support 10x traffic growth

## Conclusion

This MVP architecture provides a solid foundation for a scalable, production-ready AI-powered expense processing service. The design emphasizes:

1. **Modularity**: Clear separation of concerns with microservices architecture
2. **Scalability**: Horizontal and vertical scaling capabilities
3. **Reliability**: Comprehensive error handling and recovery mechanisms
4. **Observability**: Full visibility into system performance and behavior
5. **Security**: Enterprise-grade security and compliance features
6. **Cost Efficiency**: Optimized resource utilization and cost management

The phased implementation approach ensures rapid time-to-market while building towards a robust, enterprise-ready solution.