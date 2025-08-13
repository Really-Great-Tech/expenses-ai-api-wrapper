# LLM-as-Judge Validation Setup Guide

## ✅ **Good News: No Additional Installation Required!**

All necessary dependencies for the LLM-as-judge validation system are already included in your existing `package.json`. The validation system uses existing dependencies like:

- `@aws-sdk/client-bedrock-runtime` - For Bedrock LLM access
- `llamaindex` - For LLM interfaces
- `ts-node` - For running TypeScript scripts
- `zod` - For schema validation
- All NestJS dependencies for API endpoints

## 🚀 **Quick Setup Checklist**

### **1. Verify Dependencies (Already Done)**
```bash
# These are already in your package.json, no need to install
npm install  # Only if you haven't run this recently
```

### **2. Environment Configuration**
Make sure your `.env` file has the judge model configurations:

```bash
# Judge Models for LLM-as-Judge Validation
BEDROCK_JUDGE_MODEL_1=eu.amazon.nova-pro-v1:0
BEDROCK_JUDGE_MODEL_2=eu.amazon.nova-lite-v1:0
BEDROCK_JUDGE_MODEL_3=anthropic.claude-3-5-sonnet-20241022-v2:0

# AWS Configuration (should already be set)
AWS_REGION=eu-west-1
AWS_PROFILE=rgt-developers-916473541114
```

### **3. AWS Credentials**
Ensure your AWS credentials are configured for Bedrock access:
```bash
# Check if AWS credentials are working
aws sts get-caller-identity --profile rgt-developers-916473541114
```

### **4. Verify TypeScript Compilation**
```bash
# Make sure TypeScript compiles without errors
npm run build
```

## 🎯 **Ready to Use!**

Once the above is verified, you can immediately start using the validation system:

### **Individual Validation (Swagger):**
1. Start the server: `npm run start:dev`
2. Go to Swagger UI: `http://localhost:3000/api`
3. Use `POST /documents/validate/{jobId}` endpoint

### **Batch Validation (Swagger):**
1. Use `POST /documents/validate-batch` endpoint
2. Validates all completed jobs automatically

### **Batch Validation (Command Line):**
```bash
# Run validation on all files in results directory
npm run validate-standalone

# With custom options
npm run validate-standalone -- --results-dir ./results --output-dir ./validation_results --verbose
```

## 🔍 **Test the Setup**

### **Quick Test:**
1. **Start the server:**
   ```bash
   npm run start:dev
   ```

2. **Check health endpoint:**
   ```bash
   curl http://localhost:3000/documents/health
   ```
   Should show `llmValidation: true` in the agents section.

3. **Test with existing results:**
   ```bash
   npm run validate-standalone
   ```
   Should process any existing files in `./results/` directory.

## 🚨 **Troubleshooting**

### **If you get AWS credential errors:**
```bash
# Configure AWS profile
aws configure --profile rgt-developers-916473541114

# Or use SSO
aws sso login --profile rgt-developers-916473541114
```

### **If TypeScript compilation fails:**
```bash
# Clean and rebuild
rm -rf dist/
npm run build
```

### **If validation fails:**
1. Check AWS Bedrock access permissions
2. Verify judge model names in `.env`
3. Check application logs for detailed error messages

## 📊 **Expected File Structure After Running**

```
your-project/
├── results/                          # Main processing results
│   ├── filename1_result.json
│   └── filename2_result.json
├── validation_results/               # Validation results
│   ├── filename1_llm_validation.json
│   ├── filename2_llm_validation.json
│   ├── batch_validation_summary.json
│   └── validation_summary.json
└── ...
```

## ✅ **You're All Set!**

No additional installations are needed. The LLM-as-judge validation system is ready to use with your existing setup. Just ensure your AWS credentials and environment variables are configured correctly.