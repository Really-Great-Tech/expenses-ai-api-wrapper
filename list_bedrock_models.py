import os
from dotenv import load_dotenv
import boto3

# Load AWS credentials from .env
load_dotenv()

aws_access_key = os.getenv("BEDROCK_AWS_ACCESS_KEY_ID")
aws_secret_key = os.getenv("BEDROCK_AWS_SECRET_ACCESS_KEY")
aws_session_token = os.getenv("BEDROCK_AWS_SESSION_TOKEN")
aws_region = os.getenv("BEDROCK_AWS_REGION", "eu-west-1")

# Create a Bedrock client
bedrock = boto3.client(
    "bedrock",
    region_name=aws_region,
    aws_access_key_id=aws_access_key,
    aws_secret_access_key=aws_secret_key,
    aws_session_token=aws_session_token
)

# Fetch available foundation models
response = bedrock.list_foundation_models()

print("✅ All Available Bedrock Foundation Models:\n")
for model in response.get("modelSummaries", []):
    model_id = model.get("modelId", "N/A")
    provider = model.get("providerName", "N/A")
    status = model.get("modelLifecycle", {}).get("status", "UNKNOWN")
    input_modalities = ", ".join(model.get("inputModalities", []))
    output_modalities = ", ".join(model.get("outputModalities", []))
    inference_type = model.get("inferenceTypesSupported", [])

    print(f"Model ID:       {model_id}")
    print(f"Provider:       {provider}")
    print(f"Status:         {status}")
    print(f"Input:          {input_modalities}")
    print(f"Output:         {output_modalities}")
    print(f"Inference:      {', '.join(inference_type)}")
    print("-" * 50)
