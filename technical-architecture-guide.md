# Country Policy Data Management and Processing Pipeline
## Complete Technical Architecture Guide

Based on the factory/spec/base.md architecture principles, here's the comprehensive technical guide for the Country Policy Data Management and Processing Pipeline shown in your diagram:

## System Overview

The Country Policy Data Management and Processing Pipeline is a **web scraping and policy management system** that automatically collects, processes, and maintains country-specific expense compliance policies. The system follows the event-driven architecture patterns established in the main Expenses AI system.

## Architecture Components

### 1. **Data Ingestion Layer**

```mermaid
classDiagram
    class Datasource {
        +string id
        +string type
        +string source
        +string country
        +string version
        +string content
        +string status
        +Date createdAt
        +Date updatedAt
        +processDataSource()
        +validateInput()
        +updateContent()
    }
    
    class DataIngestionTypes {
        <<enumeration>>
        URL
        FILE
        CSV
        DOCX
    }
    
    class DataIngestionStatus {
        <<enumeration>>
        PENDING
        PROCESSING
        COMPLETED
        FAILED
    }
    
    Datasource --> DataIngestionTypes
    Datasource --> DataIngestionStatus
```

**Supported Input Types:**
- **URLs**: Web pages containing policy information
- **Files**: CSV, DOCX documents with structured policy data
- **Direct Content**: Manually entered policy rules and compliance data

### 2. **Scraping Engine Architecture**

```mermaid
classDiagram
    class ScrapingEngine {
        +processDataSource(datasource)
        +extractWebContent(url)
        +parseFileContent(file, type)
        +discoverLinks(content)
        +performTraversal(links, parentNodeId)
    }
    
    class ScrapingResult {
        +Node rootNode
        +Node[] childNodes
        +string aggregatedContent
        +number confidenceScore
        +ProcessingMetrics metrics
    }
    
    class ProcessingMetrics {
        +number totalNodes
        +number successfulNodes
        +number failedNodes
        +number averageConfidence
        +number processingTimeMs
    }
    
    ScrapingEngine --> ScrapingResult
    ScrapingResult --> ProcessingMetrics
```

### 3. **Node Hierarchy Management**

```mermaid
classDiagram
    class Node {
        +string id
        +string parentId
        +string dataSourceId
        +string url
        +string status
        +string content
        +number confidence
        +NodeMetadata metadata
        +createChildNode()
        +updateContent()
        +calculateConfidence()
    }
    
    class NodeMetadata {
        +Date scrapedAt
        +number contentLength
        +number processingTime
        +string[] links
    }
    
    class NodeHierarchy {
        +Node rootNode
        +Node[] childNodes
        +buildHierarchy()
        +aggregateContent()
        +validateStructure()
    }
    
    Node --> NodeMetadata
    NodeHierarchy --> Node
    Node --> Node : parent-child
```

## Processing Pipeline Flow

### **Stage 1: Initial Scraping**
```mermaid
flowchart TD
    A[Datasource Input] --> B[Scraping Engine]
    B --> C[Content Extraction]
    C --> D{Datasource Type?}
    D -->|URL| E[Extract Web Content]
    D -->|File| F[Parse File Content]
    D -->|CSV| G[Parse CSV Data]
    D -->|DOCX| H[Extract Document Text]
    E --> I[Create Root Node]
    F --> I
    G --> I
    H --> I
    I --> J[Store Raw Content]
    J --> K[Calculate Confidence Score]
    K --> L[Link Discovery]
    L --> M[Update Node Metadata]
```

### **Stage 2: Conditional Traversal**
```mermaid
flowchart TD
    A[Root Node Content] --> B[Link Analysis Engine]
    B --> C{Links/Tags Found?}
    C -->|No Links| D[Skip Traversal]
    C -->|Links Found| E[One-Level Traversal Only]
    E --> F[Process Each Link]
    F --> G[Extract Link Content]
    G --> H[Create Child Node]
    H --> I[Link to Parent Node]
    I --> J[Calculate Child Confidence]
    J --> K[Store Child Content]
    K --> L{More Links?}
    L -->|Yes| F
    L -->|No| M[Complete Traversal]
    D --> N[Proceed to Aggregation]
    M --> N
```

### **Stage 3: Content Aggregation**
```mermaid
flowchart TD
    A[Root Node Content] --> E[Content Combiner]
    B[Child Node 1 Content] --> E
    C[Child Node 2 Content] --> E
    D[Child Node N Content] --> E
    E --> F[Combine All Content]
    F --> G[Add Source Separators]
    G --> H[Generate Aggregated Content]
    H --> I[Update Datasource.content]
    I --> J[Validate Content Quality]
    J --> K{Quality Threshold Met?}
    K -->|Yes| L[Proceed to AI Processing]
    K -->|No| M[Quality Error Response]
```

### **Stage 4: AI Processing**
```mermaid
flowchart TD
    A[Aggregated Content] --> B[AI Agent Processing]
    B --> C[Policy Structure Analysis]
    C --> D[Receipt Standards Extraction]
    D --> E[Compliance Rules Extraction]
    E --> F[Additional Policies Extraction]
    F --> G[Country Policy Creation]
    G --> H[Version ID Generation]
    H --> I[Policy Validation]
    I --> J{Validation Passed?}
    J -->|Yes| K[Store Country Policy]
    J -->|No| L[AI Processing Error]
    K --> M[Update Active Policy Reference]
    M --> N[Trigger Policy Update Events]
```

## Database Schema Design

```mermaid
erDiagram
    Country ||--o{ Version : "has versions"
    Country ||--|| CountryPolicy : "has active policy"
    Version ||--|| CountryPolicy : "linked to policy"
    Version ||--o{ Datasource : "contains datasources"
    Country ||--o{ Datasource : "belongs to country"
    Datasource ||--o{ Node : "contains nodes"
    Node ||--o{ Node : "parent-child hierarchy"
    
    Country {
        string id PK
        string name
        boolean active
        string active_policy_id FK
    }
    
    Version {
        string country_id PK, FK
        string version_id PK "v2024.01.15"
        string policy_id FK
        datetime created_at
    }
    
    Datasource {
        string id PK
        string type "url|file|csv|docx"
        string source
        text content "aggregated from all nodes"
        string status
        string version_id FK
        string country_id FK
        datetime created_at
        datetime updated_at
    }
    
    Node {
        string id PK
        string parent_id FK "self-reference"
        string datasource_id FK
        string url
        string status
        text content "raw scraped content"
        float confidence
        json metadata
        datetime scraped_at
    }
    
    CountryPolicy {
        string id PK
        string country_id FK
        string version_id FK
        json receipt_standards
        json compliance_policies_gross_up
        json compliance_policies_additional
        boolean is_active
        datetime created_at
        datetime updated_at
    }
```


### **Queue Architecture Flow**

```mermaid
sequenceDiagram
    participant Client
    participant ScrapingQueue
    participant ScrapingEngine
    participant StatusQueue
    participant PolicyQueue
    
    Client->>ScrapingQueue: Publish Scraping Request
    ScrapingQueue->>ScrapingEngine: Consume Message
    ScrapingEngine->>StatusQueue: Publish "SCRAPING" Status
    ScrapingEngine->>ScrapingEngine: Extract Initial Content
    ScrapingEngine->>StatusQueue: Publish "TRAVERSING" Status
    ScrapingEngine->>ScrapingEngine: Perform Link Traversal
    ScrapingEngine->>StatusQueue: Publish "AGGREGATING" Status
    ScrapingEngine->>ScrapingEngine: Combine All Content
    ScrapingEngine->>StatusQueue: Publish "AI_PROCESSING" Status
    ScrapingEngine->>ScrapingEngine: AI Policy Extraction
    ScrapingEngine->>PolicyQueue: Publish Policy Update
    ScrapingEngine->>StatusQueue: Publish "COMPLETED" Status
```




### **Error Handling Strategy**

```mermaid
flowchart TD
    A[Processing Error Detected] --> B{Error Type Classification}
    
    B -->|Network Error| C[Network Error Handler]
    B -->|Content Parsing Error| D[Parsing Error Handler]
    B -->|Link Discovery Error| E[Discovery Error Handler]
    B -->|Traversal Error| F[Traversal Error Handler]
    B -->|AI Processing Error| G[AI Error Handler]
    B -->|Quality Threshold Error| H[Quality Error Handler]
    
    C --> C1{Transient?}
    C1 -->|Yes| C2[Retry with Backoff]
    C1 -->|No| C3[Dead Letter Queue]
    
    D --> D1[Alternative Parser]
    D --> D2[Manual Review Queue]
    
    E --> E1[Skip Link Discovery]
    E1 --> E2[Continue with Root Content]
    
    F --> F1[Skip Failed Link]
    F1 --> F2[Continue with Other Links]
    
    G --> G1[Fallback AI Model]
    G1 --> G2[Manual Processing Queue]
    
    H --> H1[Quality Recommendations]
    H1 --> H2[User Feedback]
```

## Integration with Main System

### **Policy Integration Flow**

```mermaid
sequenceDiagram
    participant ExpenseSystem
    participant CountryPolicyAPI
    participant PolicyCache
    participant Database
    
    ExpenseSystem->>CountryPolicyAPI: Request Active Policy
    CountryPolicyAPI->>PolicyCache: Check Cache
    alt Cache Hit
        PolicyCache->>CountryPolicyAPI: Return Cached Policy
    else Cache Miss
        CountryPolicyAPI->>Database: Query Active Policy
        Database->>CountryPolicyAPI: Return Policy Data
        CountryPolicyAPI->>PolicyCache: Update Cache
    end
    CountryPolicyAPI->>ExpenseSystem: Return Policy Rules
    ExpenseSystem->>ExpenseSystem: Apply Compliance Validation
```

### **Version Management System**

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Review : Submit for Review
    Review --> Approved : Validation Passed
    Review --> Draft : Validation Failed
    Approved --> Active : Set as Active Policy
    Active --> Deprecated : New Version Activated
    Deprecated --> [*] : Archive Old Version
    
    Active --> Active : Policy Updates
    Approved --> Approved : Minor Corrections
```

### **Real-time Policy Updates**

```mermaid
flowchart TD
    A[Policy Update Detected] --> B[Version Comparison]
    B --> C{Significant Changes?}
    C -->|Yes| D[Create New Version]
    C -->|No| E[Update Current Version]
    
    D --> F[Generate Version ID]
    F --> G[Store New Policy]
    G --> H[Update Active Reference]
    H --> I[Trigger Cache Invalidation]
    
    E --> J[Update Policy Content]
    J --> I
    
    I --> K[Publish Update Event]
    K --> L[Notify Expense System]
    L --> M[Update Validation Rules]
    M --> N[Log Audit Trail]
```





## Conclusion

This Country Policy Data Management and Processing Pipeline provides a robust foundation for automatically maintaining up-to-date country-specific compliance policies. The design emphasizes:

1. **Event-Driven Architecture**: Complete RabbitMQ-based message processing
2. **Intelligent Scraping**: Advanced one-level traversal with quality validation
3. **Hierarchical Data Management**: Clear parent-child node relationships
4. **Content Aggregation**: Comprehensive data collection from multiple sources
5. **AI-Powered Processing**: Automated policy extraction and structuring
6. **Version Control**: Complete audit trail with policy versioning
7. **Quality Assurance**: Comprehensive validation and error handling
8. **Scalability**: Horizontal scaling with queue-based processing

The architecture ensures that expense processing systems always have access to current, accurate country policies while maintaining full traceability and automated updates.
