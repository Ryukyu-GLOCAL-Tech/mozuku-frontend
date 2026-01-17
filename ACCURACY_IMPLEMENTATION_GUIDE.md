# Mozuku AI - Manual Accuracy Tracking Implementation Guide

## Overview
This guide explains how to implement manual accuracy calculation for your impurity detection system using user feedback.

---

## Architecture Flow

```
┌─────────────────┐
│  User Views     │
│ Frame Details   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│   User Provides Feedback:       │
│ ✓ All detected (DONE button)    │
│ ✓ Missing objects (edit count)  │
│ ✓ Wrong detections (edit count) │
│ ✓ Edit labels (BboxAnnotator)   │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Save Labels to S3 + DynamoDB   │
│ • Image without bbox (JPG)      │
│ • YOLO format labels (TXT)      │
│ • Metrics (precision, recall)   │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Calculate Accuracy %:          │
│ • Good detections / total       │
│ • Missing detection count       │
│ • Wrong detection count         │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Display in UI:                 │
│ • Dashboard: Overall accuracy % │
│ • History: Per-session metrics  │
└─────────────────────────────────┘
```

---

## 1. Frontend Implementation (React)

### A. BboxAnnotator.js - Label Editing Component
Located: `src/components/BboxAnnotator.js`

**Features:**
- Draw new bounding boxes
- Delete existing bboxes (mark as 'deleted')
- Keep/validate detected objects
- Convert to YOLO format for storage

**Key Methods:**
```javascript
handleSaveLabels() // Prepares corrections object
  └─ corrections = {
       kept: [array of kept indices],
       deleted: [array of deleted indices],
       added: [array of new boxes in YOLO format]
     }
```

### B. HistoryPage.js - Save Feedback

**Flow:**
1. User clicks "View Details" on a session
2. Frame displays with detected objects
3. User can:
   - Edit labels (opens BboxAnnotator)
   - Mark as done
   - Report missing objects
   - Report wrong detections

**Updated Error Handling** (Already implemented):
```javascript
handleSaveLabels(corrections) {
  // Gets auth token from localStorage
  // POSTs to /impurities endpoint
  // Handles 401 errors with helpful messages
  // Updates local state on success
}
```

---

## 2. Backend Implementation (AWS Lambda)

### Function: GetImpurities-dev
Located: `lambda_function/GetImpurities-dev/lambda_function.py`

#### A. POST Handler - Update Labels
```python
def handle_label_update(event, cors_headers):
    """
    Receives corrections from frontend and:
    1. Loads current labels from S3
    2. Applies corrections (keep/delete/add)
    3. Calculates precision, recall, F1-score
    4. Saves updated labels to S3
    5. Updates DynamoDB with metrics
    """
```

**Process:**
```python
1. Parse request body
   └─ Extract: frameId, userId, corrections

2. Get frame metadata from DynamoDB
   └─ Retrieve s3LabelsPath, detections

3. Load current labels from S3
   └─ Read YOLO format file

4. Apply corrections
   ├─ Keep: Filter current_labels by kept indices
   ├─ Delete: Remove indices in deleted list
   └─ Add: Append new YOLO format boxes

5. Save updated labels to S3
   └─ Put file at same s3LabelsPath

6. Calculate metrics
   ├─ precision = kept / total_original
   ├─ recall = kept / (kept + added)
   └─ f1_score = 2 * (p*r) / (p+r)

7. Update DynamoDB
   └─ Set labelingStatus = 'verified'
   └─ Store labelingMetrics
   └─ Record labeledBy user and labeledAt time
```

**S3 Structure:**
```
s3://mozuku-frames-dev-without-bbox/
└── web-user/
    └── {frameId}/
        ├── image.jpg        (frame without bbox)
        └── image.txt        (YOLO format labels)
```

**YOLO Format (image.txt):**
```
<class> <x_center> <y_center> <width> <height>
```
- All values normalized 0-1
- Example: `0 0.5 0.5 0.1 0.1` (class 0, centered, 10% size)

---

## 3. Data Storage

### DynamoDB Table: FrameDetections-dev

**Updated Fields After Save:**
```json
{
  "frameId": "frame-123",
  "userId": "user@example.com",
  "timestamp": 1705424400000,
  "labelingStatus": "verified",  // NEW: pending, verified, rejected
  "labeledBy": "user@example.com",  // NEW: who verified
  "labeledAt": 1705425000000,  // NEW: when verified
  "labelingMetrics": {  // NEW: quality metrics
    "precision": 0.95,
    "recall": 0.92,
    "f1_score": 0.935,
    "original_count": 20,      // boxes from model
    "kept_count": 19,          // user marked as good
    "deleted_count": 1,        // user marked as wrong
    "added_count": 0           // user added new boxes
  },
  "detectionCount": 20,
  "detections": [...],
  "s3UrlWithBbox": "s3://...",
  "s3UrlWithoutBbox": "s3://...",
  "s3LabelsPath": "s3://mozuku-frames-dev-without-bbox/web-user/frame-123/image.txt"
}
```

---

## 4. Accuracy Calculation

### Per-Frame Accuracy
```
f1_score = 2 × (precision × recall) / (precision + recall)
```

### Per-Session Accuracy
```python
# Aggregate all frames in session
frames_with_feedback = [f for f in session_frames if f.labelingStatus == 'verified']

if frames_with_feedback:
    avg_f1 = sum(f.labelingMetrics.f1_score for f in frames_with_feedback) / len(frames_with_feedback)
    
    total_detections = sum(f.labelingMetrics.original_count for f in frames_with_feedback)
    total_wrong = sum(f.labelingMetrics.deleted_count for f in frames_with_feedback)
    total_missing = sum(f.labelingMetrics.added_count for f in frames_with_feedback)
    
    detection_accuracy % = ((total_detections - total_wrong) / total_detections) * 100
    recall % = ((total_detections - total_missing) / total_detections) * 100
```

### Dashboard Overall Accuracy
```python
# Aggregate across all sessions for user
all_metrics = [f.labelingMetrics for s in user_sessions for f in s.frames if f.labelingStatus == 'verified']

overall_accuracy % = average(f1_score for all frames) * 100
detection_rate % = (1 - sum(wrong) / sum(total)) * 100
missing_rate % = (1 - sum(missing) / sum(total)) * 100
```

---

## 5. UI Display

### HistoryPage - Per-Frame Feedback
```javascript
// In frame detail view, show:
<div>
  <h3>Labeling Metrics</h3>
  <p>Precision: {metrics.precision.toFixed(2)} ({metrics.kept_count}/{metrics.original_count})</p>
  <p>Recall: {metrics.recall.toFixed(2)}</p>
  <p>F1-Score: {metrics.f1_score.toFixed(3)}</p>
  <p>Issues: {metrics.deleted_count} wrong, {metrics.added_count} missing</p>
</div>
```

### DashboardPage - Overall Stats
```javascript
// In dashboard, add new stats section:
<div>
  <h2>Detection Accuracy (Manual Verification)</h2>
  <p>Overall Accuracy: {Math.round(overallAccuracy * 100)}%</p>
  <p>Frames Verified: {verifiedCount}/{totalFrames}</p>
  <p>Sessions with Feedback: {sessionsWithFeedback}/{totalSessions}</p>
</div>
```

---

## 6. Testing Checklist

- [ ] Frontend token generation works (check localStorage)
- [ ] BboxAnnotator loads image correctly
- [ ] Can draw/delete boxes in edit mode
- [ ] Save Labels button sends POST to /impurities
- [ ] Lambda receives POST request (check CloudWatch logs)
- [ ] DynamoDB updated with labelingMetrics
- [ ] S3 label files saved correctly
- [ ] Metrics display in History view
- [ ] Accuracy % displays in Dashboard
- [ ] Multiple frames show aggregated stats

**CloudWatch Logs Location:**
```
/aws/lambda/GetImpurities-dev
```

---

## 7. Error Codes & Debugging

| Error | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | Invalid/expired token | Re-login |
| 400 Bad Request | Missing frameId/userId | Check request body |
| 404 Not Found | Frame not in DynamoDB | Verify frameId |
| 500 Server Error | S3 write failure | Check S3 bucket permissions |

**To Debug:**
1. Check browser console for exact error message
2. Check CloudWatch logs for Lambda execution
3. Verify S3 bucket and DynamoDB contents with AWS CLI
4. Check API Gateway logs in CloudWatch

---

## 8. AWS CLI Verification Commands

```bash
# Check Lambda has POST permission
aws lambda get-policy --function-name GetImpurities-dev --region ap-northeast-1

# Check API Gateway POST method
aws apigateway get-method \
  --rest-api-id 9wowpm4mm0 \
  --resource-id f65c53 \
  --http-method POST \
  --region ap-northeast-1

# Check S3 bucket exists
aws s3 ls mozuku-frames-dev-without-bbox/

# Check DynamoDB table
aws dynamodb describe-table \
  --table-name FrameDetections-dev \
  --region ap-northeast-1
```

---

## 9. Expected Workflow Example

```
1. User logs in ✓
2. Opens History page ✓
3. Clicks "View Details" on session ✓
4. Frame displays with 10 detected impurities
5. User clicks "Edit Labels"
6. BboxAnnotator opens
7. User reviews each detection:
   - Marks 9 as correct (kept)
   - Deletes 1 wrong detection
   - Adds 2 missing detections manually
8. Clicks "Save Labels"
9. POST to /impurities sent with:
   {
     "action": "updateLabels",
     "frameId": "frame-123",
     "userId": "user@example.com",
     "corrections": {
       "kept": [0,1,2,3,4,5,6,7,8],
       "deleted": [9],
       "added": [
         {"class":0,"x":0.4,"y":0.6,"w":0.05,"h":0.05},
         {"class":0,"x":0.7,"y":0.3,"w":0.08,"h":0.08}
       ]
     }
   }
10. Lambda processes:
    - Calculates precision = 9/10 = 0.9
    - Calculates recall = 9/(9+2) = 0.82
    - Calculates f1_score = 0.855
11. Updates DynamoDB with metrics
12. Saves labels to S3
13. Frontend shows success alert
14. Dashboard updates to show accuracy = 85.5%
```

---

## 10. Next Implementation Steps

1. **Add accuracy aggregation to DashboardPage.js**
   - Query all sessions for current user
   - Calculate overall metrics
   - Display in UI

2. **Add per-session stats to HistoryPage.js**
   - Calculate session-level metrics
   - Show trend over time

3. **Add visual feedback in BboxAnnotator**
   - Highlight what's being marked as wrong/missing
   - Show summary before save

4. **Archive verified labels**
   - Move old verified labels to archive S3 bucket
   - Keep only active frames for editing

5. **Generate accuracy reports**
   - Export CSV of per-session metrics
   - Track accuracy trends over time

---

## File Reference

| File | Purpose | Key Changes |
|------|---------|-------------|
| `src/components/BboxAnnotator.js` | Draw/edit boxes | Handle corrections format |
| `src/pages/HistoryPage.js` | Save labels | Enhanced error handling ✓ |
| `src/pages/DashboardPage.js` | Show accuracy | Add metrics display (TODO) |
| `lambda_function/GetImpurities-dev/lambda_function.py` | Process feedback | Already implemented |
| `.env` | Config | API URL and Cognito settings |
| `AWS_API_ISSUES_AND_FIXES.md` | This docs | Configuration reference |

---

## Summary

✅ **COMPLETED:**
- Lambda POST permission added
- Frontend error handling improved
- Backend feedback processing ready
- AWS infrastructure verified

📝 **IN PROGRESS:**
- You are here: Reviewing implementation

🚀 **NEXT:**
- Test the flow end-to-end
- Add accuracy display to UI
- Aggregate metrics across frames
