#!/usr/bin/env python3
"""
Recalculate statistics for existing sessions based on actual frame data
"""
import boto3
from decimal import Decimal
from datetime import datetime

dynamodb = boto3.resource('dynamodb', region_name='ap-northeast-1')
frame_table = dynamodb.Table('FrameDetections-dev')
stats_table = dynamodb.Table('DetectionStats-dev')

def recalculate_all_sessions():
    """Recalculate stats for all sessions"""
    # Get all sessions
    response = stats_table.scan(
        FilterExpression='periodType = :ptype',
        ExpressionAttributeValues={':ptype': 'session'}
    )
    
    sessions = response.get('Items', [])
    print(f"Found {len(sessions)} sessions to process")
    
    for session in sessions:
        user_id = session['userId']
        session_id = session['sessionId']
        time_period = session['timePeriod']
        
        # Parse start and end times
        start_time = int(session.get('startTime', 0))
        end_time = int(session.get('endTime', 0))
        
        if end_time == 0:
            end_time = int(datetime.now().timestamp() * 1000)
        
        print(f"\nProcessing session: {session_id}")
        print(f"  User: {user_id}")
        print(f"  Time range: {start_time} - {end_time}")
        
        # Query frames for this session
        frame_response = frame_table.scan(
            FilterExpression='#ts BETWEEN :start AND :end AND userId = :uid',
            ExpressionAttributeNames={'#ts': 'timestamp'},
            ExpressionAttributeValues={
                ':start': start_time,
                ':end': end_time,
                ':uid': user_id
            }
        )
        
        frames = frame_response.get('Items', [])
        
        # Calculate statistics
        total_frames = len(frames)
        total_detections = sum(int(f.get('detectionCount', 0)) for f in frames)
        impurities_found = total_detections  # All detections are impurities
        
        detection_rate = (total_detections / total_frames * 100) if total_frames > 0 else 0
        avg_detections_per_frame = (total_detections / total_frames) if total_frames > 0 else 0
        
        # Calculate accuracy metrics from verified frames
        verified_frames = [f for f in frames if f.get('labelingStatus') == 'verified' and f.get('labelingMetrics')]
        
        if verified_frames:
            total_TP = sum(int(f.get('labelingMetrics', {}).get('TP', 0)) for f in verified_frames)
            total_FP = sum(int(f.get('labelingMetrics', {}).get('FP', 0)) for f in verified_frames)
            total_FN = sum(int(f.get('labelingMetrics', {}).get('FN', 0)) for f in verified_frames)
            
            precision = total_TP / (total_TP + total_FP) if (total_TP + total_FP) > 0 else 0
            recall = total_TP / (total_TP + total_FN) if (total_TP + total_FN) > 0 else 0
            accuracy = total_TP / (total_TP + total_FP + total_FN) if (total_TP + total_FP + total_FN) > 0 else 0
            f1_score = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
            
            print(f"  Calculated: {total_frames} frames, {total_detections} detections")
            print(f"  Verified: {len(verified_frames)} frames with accuracy metrics")
            print(f"  Accuracy: TP={total_TP}, FP={total_FP}, FN={total_FN}")
            print(f"  Metrics: Precision={precision:.1%}, Recall={recall:.1%}, Accuracy={accuracy:.1%}, F1={f1_score:.1%}")
        else:
            total_TP = total_FP = total_FN = 0
            precision = recall = accuracy = f1_score = 0
            print(f"  Calculated: {total_frames} frames, {total_detections} detections")
            print(f"  No verified frames with accuracy metrics")
        
        # Update session
        try:
            update_expression = ('SET totalFrames = :frames, totalDetections = :detections, '
                               'impuritiesFound = :impurities, detectionRate = :rate, '
                               'avgDetectionsPerFrame = :avg, updatedAt = :updated')
            
            expression_values = {
                ':frames': total_frames,
                ':detections': total_detections,
                ':impurities': impurities_found,
                ':rate': Decimal(str(round(detection_rate, 2))),
                ':avg': Decimal(str(round(avg_detections_per_frame, 2))),
                ':updated': datetime.now().isoformat()
            }
            
            # Add accuracy metrics if available
            if verified_frames:
                update_expression += (', sessionAccuracy = :accuracy')
                expression_values[':accuracy'] = {
                    'totalTP': total_TP,
                    'totalFP': total_FP,
                    'totalFN': total_FN,
                    'totalActual': total_TP + total_FN,
                    'verifiedFrames': len(verified_frames),
                    'precision': Decimal(str(round(precision, 3))),
                    'recall': Decimal(str(round(recall, 3))),
                    'accuracy': Decimal(str(round(accuracy, 3))),
                    'f1_score': Decimal(str(round(f1_score, 3))),
                    'calculatedAt': int(datetime.now().timestamp() * 1000)
                }
            
            stats_table.update_item(
                Key={
                    'userId': user_id,
                    'timePeriod': time_period
                },
                UpdateExpression=update_expression,
                ExpressionAttributeValues=expression_values
            )
            print(f"  ✓ Updated session {session_id}")
        except Exception as e:
            print(f"  ✗ Error updating session: {e}")

if __name__ == '__main__':
    print("=" * 60)
    print("Recalculating Session Statistics")
    print("=" * 60)
    recalculate_all_sessions()
    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)
