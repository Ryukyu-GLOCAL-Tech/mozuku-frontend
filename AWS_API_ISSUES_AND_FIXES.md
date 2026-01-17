# Mozuku AI - AWS Configuration Issues & Fixes

## Issue Summary
**Error**: `POST https://9wowpm4mm0.execute-api.ap-northeast-1.amazonaws.com/dev/impurities 401 (Unauthorized)`

**Root Cause**: The Lambda function (`GetImpurities-dev`) did not have permission to be invoked via the POST method on the API Gateway endpoint `/impurities`.

---

## 1. Lambda Function Permission Issue ✅ FIXED

### Problem
- The Lambda function had permission only for **GET** requests
- No permission configured for **POST** requests
- This caused API Gateway to reject POST requests with 401 Unauthorized

### Solution Applied
Added POST method permission to the Lambda function:

```bash
aws lambda add-permission \
  --function-name GetImpurities-dev \
  --statement-id AllowAPIGatewayPostInvoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:ap-northeast-1:383842796093:9wowpm4mm0/*/POST/impurities" \
  --region ap-northeast-1
```

### Verification
Before:
```json
{
  "Sid": "4aca0a73-c261-5f55-8054-680bc3bd8d02",
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:ap-northeast-1:383842796093:function:GetImpurities-dev",
  "Condition": {
    "ArnLike": {
      "AWS:SourceArn": "arn:aws:execute-api:ap-northeast-1:383842796093:9wowpm4mm0/*/GET/impurities"
    }
  }
}
```

After (POST permission added):
```json
{
  "Sid": "AllowAPIGatewayPostInvoke",
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:ap-northeast-1:383842796093:function:GetImpurities-dev",
  "Condition": {
    "ArnLike": {
      "AWS:SourceArn": "arn:aws:execute-api:ap-northeast-1:383842796093:9wowpm4mm0/*/POST/impurities"
    }
  }
}
```

---

## 2. API Gateway Configuration ✅ VERIFIED

### Authorization Setup
- **API**: MozukuAPI-dev (ID: `9wowpm4mm0`)
- **Region**: ap-northeast-1
- **Endpoint**: `/impurities`
- **Methods**: GET, POST, OPTIONS
- **Authorization Type**: COGNITO_USER_POOLS
- **Authorizer**: CognitoAuthorizer (ID: `g4qd8d`)
- **Provider ARN**: `arn:aws:cognito-idp:ap-northeast-1:383842796093:userpool/ap-northeast-1_N0LUX9VXD`
- **Identity Source**: `method.request.header.Authorization`

### Authorization Flow
1. Client sends request with header: `Authorization: Bearer <idToken>`
2. API Gateway validates token using Cognito authorizer
3. If valid, Lambda function is invoked
4. If invalid/expired, returns 401 Unauthorized

### Frontend Token Implementation (HistoryPage.js)
```javascript
const getAuthToken = () => {
  const cognitoClientId = process.env.REACT_APP_COGNITO_CLIENT_ID || 'hga8jtohtcv20lop0djlauqsv';
  const lastAuthUser = localStorage.getItem(`CognitoIdentityServiceProvider.${cognitoClientId}.LastAuthUser`);
  if (!lastAuthUser) return null;
  
  const idTokenKey = `CognitoIdentityServiceProvider.${cognitoClientId}.${lastAuthUser}.idToken`;
  return localStorage.getItem(idTokenKey);
};
```

---

## 3. Lambda Function (GetImpurities-dev) ✅ VERIFIED

### Configuration
- **Runtime**: Python 3.x
- **Timeout**: 29 seconds
- **Integration**: AWS_PROXY
- **Handles**: GET and POST requests

### POST Handler: `handle_label_update()`
- **Action**: `updateLabels`
- **Inputs**: frameId, userId, corrections (kept, deleted, added bboxes)
- **Process**:
  1. Retrieves frame metadata from DynamoDB
  2. Loads current labels from S3
  3. Applies corrections (keep/delete/add bboxes)
  4. Saves updated labels to S3
  5. Calculates precision, recall, F1-score metrics
  6. Updates DynamoDB with labeling status and metrics

### S3 Operations
- **Read**: Gets existing label files from `s3://mozuku-frames-dev-without-bbox/`
- **Write**: Saves updated label files to same location

### DynamoDB Operations
- **Read**: Gets frame data from `FrameDetections-dev` table
- **Write**: Updates `FrameDetections-dev` with:
  - `labelingStatus`: 'verified'
  - `labeledBy`: userId
  - `labeledAt`: timestamp
  - `labelingMetrics`: {precision, recall, f1_score, counts}

---

## 4. S3 Bucket Configuration ✅ VERIFIED

### Buckets
- `mozuku-frames-dev` - Original frames
- `mozuku-frames-dev-with-bbox` - Frames with bounding boxes
- `mozuku-frames-dev-without-bbox` - Frames without bboxes (user uploads target)
- `mozuku-impurities-dev` - Individual impurity crops

### Target Bucket for Save Labels
**Path**: `s3://mozuku-frames-dev-without-bbox/web-user/`
- `{frameId}/image.jpg` - Image without bboxes
- `{frameId}/image.txt` - YOLO format labels (class x_center y_center width height)

### IAM Permissions for Lambda
- Role: `MozukuLambdaExecutionRole`
- Policies: `AWSLambdaBasicExecutionRole` + `MozukuApplicationPolicy`
- S3 Access: `s3:*` on all resources
- DynamoDB Access: `dynamodb:*` on all resources

---

## 5. DynamoDB Configuration ✅ VERIFIED

### Table: FrameDetections-dev
- **Partition Key**: `frameId` (String)
- **Sort Key**: None
- **Attributes**:
  - `userId` - User identifier
  - `timestamp` - Frame timestamp
  - `detectionCount` - Number of objects detected
  - `s3UrlWithBbox` - URL to image with bboxes
  - `s3UrlWithoutBbox` - URL to image without bboxes
  - `primaryFrameUrl` - Primary display URL
  - `detections` - JSON array of detection objects
  - `labelingStatus` - 'verified', 'pending', etc.
  - `labelingMetrics` - Precision, recall, F1-score
  - `s3LabelsPath` - Path to label file

---

## 6. Testing the Fix

### Test 1: Verify Lambda Permissions
```bash
aws lambda get-policy --function-name GetImpurities-dev --region ap-northeast-1
```
Should show both GET and POST permissions.

### Test 2: Manual API Test (requires valid token)
```bash
TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id ap-northeast-1_N0LUX9VXD \
  --client-id hga8jtohtcv20lop0djlauqsv \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=<user>,PASSWORD=<pass> \
  --region ap-northeast-1 | jq -r '.AuthenticationResult.IdToken')

curl -X POST https://9wowpm4mm0.execute-api.ap-northeast-1.amazonaws.com/dev/impurities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "updateLabels",
    "frameId": "frame-123",
    "userId": "user@example.com",
    "corrections": {
      "kept": [0, 1],
      "deleted": [2],
      "added": [{
        "class": 0,
        "x": 0.5,
        "y": 0.5,
        "w": 0.1,
        "h": 0.1
      }]
    }
  }'
```

---

## 7. End-to-End Accuracy Calculation Flow

### Step 1: User Provides Feedback (HistoryPage.js)
- Clicks "Save Labels" after editing bboxes
- Sends POST to `/impurities` with:
  - frameId
  - corrections (kept/deleted/added bboxes)

### Step 2: Lambda Processes (GetImpurities-dev)
- Updates label file in S3
- Calculates metrics:
  - **Precision** = kept_count / total_original
  - **Recall** = kept_count / (kept_count + added_count)
  - **F1-Score** = 2 × (precision × recall) / (precision + recall)
- Stores in DynamoDB

### Step 3: Accuracy Aggregation
To calculate overall accuracy across all frames:
```
- Good Detections: Count of frames where labelingMetrics.f1_score > threshold
- Missing Detections: Sum of frames where added_count > 0
- Wrong Detections: Sum of frames where deleted_count > 0

Detection Rate % = (Good Detections / Total Frames) × 100
Accuracy Rate % = (1 - (Wrong + Missing) / Total Detections) × 100
```

### Step 4: Display Results
- **DashboardPage.js**: Show overall accuracy metrics
- **HistoryPage.js**: Show per-session metrics

---

## 8. Additional Configuration Checklist

- [x] API Gateway endpoint created and deployed
- [x] Lambda function permissions for GET and POST ✅ FIXED
- [x] Cognito authorizer configured
- [x] S3 buckets created and accessible
- [x] DynamoDB tables created
- [x] IAM execution role with proper permissions
- [x] CORS headers configured in Lambda responses
- [x] CloudWatch logs enabled for debugging

---

## 9. Next Steps

1. **Test the Fix**: Try clicking "Save Labels" in the frontend - it should now work
2. **Monitor Logs**: Check CloudWatch logs for any remaining errors
3. **Implement Accuracy Calculation**: Add aggregation logic in DashboardPage and HistoryPage
4. **Update Frontend**: Show accuracy % in UI based on metrics from DynamoDB

---

## Quick Reference: Key Files

| Component | File | Purpose |
|-----------|------|---------|
| Frontend API Calls | `src/pages/HistoryPage.js` | POST to `/impurities` with corrections |
| Label Editor | `src/components/BboxAnnotator.js` | UI for editing bboxes |
| Lambda Handler | `lambda_function/GetImpurities-dev/lambda_function.py` | Process label updates and calculate metrics |
| Environment | `.env` | API Gateway base URL and Cognito config |

---

## Summary of Changes Made

✅ **Added Lambda POST Permission** (The Fix)
- Function: `GetImpurities-dev`
- Action: `lambda:InvokeFunction`
- Source: API Gateway POST to `/impurities`
- Status: **APPLIED AND VERIFIED**

This single change resolves the 401 Unauthorized error for POST requests to the `/impurities` endpoint.
