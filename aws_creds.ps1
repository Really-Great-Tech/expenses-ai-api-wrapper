# PowerShell script to retrieve AWS SSO credentials and set environment variables

$PROFILE_NAME = "rgt-developers-916473541114"

Write-Host "Setting up AWS credentials from SSO profile: $PROFILE_NAME" -ForegroundColor Green

# Verify SSO login is active
Write-Host "Verifying SSO login..." -ForegroundColor Yellow
$callerCheck = aws sts get-caller-identity --profile $PROFILE_NAME --output json 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: SSO session expired or invalid" -ForegroundColor Red
    Write-Host "Please run: aws sso login --profile $PROFILE_NAME" -ForegroundColor Yellow
    exit 1
}

Write-Host "Success: SSO login verified" -ForegroundColor Green

# Get credentials using export-credentials
Write-Host "Retrieving credentials..." -ForegroundColor Yellow
$credOutput = aws configure export-credentials --profile $PROFILE_NAME --format env 2>$null

if ($LASTEXITCODE -ne 0 -or -not $credOutput) {
    Write-Host "Error: Could not retrieve credentials" -ForegroundColor Red
    exit 1
}

# Parse the output to extract credentials
$lines = $credOutput -split "`n"
$ACCESS_KEY = ""
$SECRET_KEY = ""
$SESSION_TOKEN = ""

foreach ($line in $lines) {
    if ($line -match "^export AWS_ACCESS_KEY_ID=(.+)$") {
        $ACCESS_KEY = $matches[1]
    }
    elseif ($line -match "^export AWS_SECRET_ACCESS_KEY=(.+)$") {
        $SECRET_KEY = $matches[1]
    }
    elseif ($line -match "^export AWS_SESSION_TOKEN=(.+)$") {
        $SESSION_TOKEN = $matches[1]
    }
}

# Get region
$REGION = aws configure get region --profile $PROFILE_NAME 2>$null
if (-not $REGION) {
    $REGION = "eu-west-1"
}

# Verify we got all credentials
if (-not $ACCESS_KEY -or -not $SECRET_KEY -or -not $SESSION_TOKEN) {
    Write-Host "Error: Could not parse all required credentials" -ForegroundColor Red
    exit 1
}

# Set environment variables
$env:AWS_ACCESS_KEY_ID = $ACCESS_KEY
$env:AWS_SECRET_ACCESS_KEY = $SECRET_KEY
$env:AWS_SESSION_TOKEN = $SESSION_TOKEN
$env:AWS_REGION = $REGION
$env:AWS_DEFAULT_REGION = $REGION

# Create credentials object for JSON storage
$credentials = @{
    AWS_ACCESS_KEY_ID = $ACCESS_KEY
    AWS_SECRET_ACCESS_KEY = $SECRET_KEY
    AWS_SESSION_TOKEN = $SESSION_TOKEN
    AWS_REGION = $REGION
    AWS_DEFAULT_REGION = $REGION
    PROFILE_NAME = $PROFILE_NAME
    RETRIEVED_AT = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
    EXPIRES_AT = $null
}

# Try to extract expiration time from the credential output
foreach ($line in $lines) {
    if ($line -match "^export AWS_CREDENTIAL_EXPIRATION=(.+)$") {
        $credentials.EXPIRES_AT = $matches[1]
        break
    }
}

# Save credentials to JSON file
$jsonFile = "aws_credentials.json"
try {
    $credentials | ConvertTo-Json -Depth 2 | Out-File -FilePath $jsonFile -Encoding UTF8
    Write-Host "Success: Credentials saved to $jsonFile" -ForegroundColor Green
} catch {
    Write-Host "Warning: Could not save credentials to JSON file: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "Success: Retrieved and set credentials" -ForegroundColor Green
Write-Host ""
Write-Host "Environment variables set:" -ForegroundColor Green
Write-Host "AWS_ACCESS_KEY_ID: $($ACCESS_KEY.Substring(0, 8))..." -ForegroundColor Cyan
Write-Host "AWS_SECRET_ACCESS_KEY: $($SECRET_KEY.Substring(0, 8))..." -ForegroundColor Cyan
Write-Host "AWS_SESSION_TOKEN: $($SESSION_TOKEN.Substring(0, 20))..." -ForegroundColor Cyan
Write-Host "AWS_REGION: $REGION" -ForegroundColor Cyan
Write-Host ""
Write-Host "Credentials stored in: $jsonFile" -ForegroundColor Cyan
Write-Host "AWS credentials are now set for this PowerShell session" -ForegroundColor Green
Write-Host "Test with: aws sts get-caller-identity" -ForegroundColor Yellow
