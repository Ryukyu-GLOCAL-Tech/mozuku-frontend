# This is mozuku detection sender script runs on local machine
#!/usr/bin/env python3
"""
Mozuku Detection Sender - Integrates ROS2 with AWS via existing API Gateway
Subscribes to ROS2 topics and sends detection data to: https://9wowpm4mm0.execute-api.ap-northeast-1.amazonaws.com/dev

FEATURES:
1. Monitors ROS2LaunchJobs-dev DynamoDB table for start/stop commands
2. Automatically starts/stops ROS2 launch files
3. Sends camera frames to AWS in background (non-blocking)
4. Updates job status in DynamoDB
"""

import os
import json
import base64
import requests
import cv2
import numpy as np
from datetime import datetime
from decimal import Decimal
from dotenv import load_dotenv
import time
import threading
import subprocess
import signal
import boto3
import uuid

# ROS2 imports
try:
    import rclpy
    from rclpy.node import Node
    from rclpy.executors import MultiThreadedExecutor
    from sensor_msgs.msg import Image
    from detection_msgs.msg import Detection2D
    from cv_bridge import CvBridge
    ROS2_AVAILABLE = True
except ImportError:
    ROS2_AVAILABLE = False
    print("⚠️ ROS2 not available - running in demo mode only")

# Load environment variables
load_dotenv()

API_BASE_URL = os.getenv('REACT_APP_API_BASE_URL', 'https://9wowpm4mm0.execute-api.ap-northeast-1.amazonaws.com/dev')
COGNITO_USER_POOL_ID = os.getenv('REACT_APP_COGNITO_USER_POOL_ID', 'ap-northeast-1_N0LUX9VXD')
COGNITO_CLIENT_ID = os.getenv('REACT_APP_COGNITO_CLIENT_ID', 'hga8jtohtcv20lop0djlauqsv')
COGNITO_REGION = os.getenv('REACT_APP_COGNITO_REGION', 'ap-northeast-1')
TEST_USERNAME = os.getenv('TEST_USERNAME', '77b4da68-d041-70b5-7930-13abada8a41d')
TEST_PASSWORD = os.getenv('TEST_PASSWORD', 'Rgk20231201@')

# ROS2 Topics
CAMERA_TOPIC = '/camera/camera/color/image_raw'
DETECTIONS_TOPIC = '/yolov8/detections'

# DynamoDB for Job Control
dynamodb = boto3.resource('dynamodb', region_name=COGNITO_REGION)
launch_jobs_table = dynamodb.Table('ROS2LaunchJobs-dev')
impurity_table = dynamodb.Table('ImpurityData-dev')
frame_table = dynamodb.Table('FrameDetections-dev')

# S3 for Image Storage - using existing buckets with timeout
from botocore.config import Config
s3_config = Config(
    connect_timeout=10,
    read_timeout=10,
    retries={'max_attempts': 2, 'mode': 'standard'}
)
s3_client = boto3.client('s3', region_name=COGNITO_REGION, config=s3_config)
FRAMES_WITH_BBOX_BUCKET = 'mozuku-frames-dev-with-bbox'
FRAMES_WITHOUT_BBOX_BUCKET = 'mozuku-frames-dev-without-bbox'
IMPURITIES_BUCKET = 'mozuku-impurities-dev'
S3_REGION = COGNITO_REGION

# Model cache directory
MODEL_CACHE_DIR = os.path.expanduser('~/.mozuku_models')
os.makedirs(MODEL_CACHE_DIR, exist_ok=True)

# ROS2 Launch Commands (model path will be injected dynamically)
ROS2_LAUNCH_COMMANDS = {
    'camera_bringup': 'ros2 launch camera_bringup detection_bringup.launch.py yolo_model:={model_path} confidence_threshold:=0.35 roi_mode:=rect roi_xmin:=0 roi_ymin:=0 roi_xmax:=1279 roi_ymax:=719 mm_per_px_x:=0.3 mm_per_px_y:=0.30 use_fp16:=true save_raw_frames_debug:=false',
    'sdm_bridge': 'ros2 launch sdm_bridge_ros2 sdm.launch.py'
}

# Global state
ros2_processes = {}
sending_enabled = False
current_job_id = None
downloaded_model_path = None  # Cache the model path


def download_model_from_s3(s3_url, force_download=False):
    """
    Download YOLOv8 model from S3 URL
    Caches locally to avoid re-downloading
    
    Args:
        s3_url: S3 URL (s3://bucket/key or https://presigned-url)
        force_download: Force re-download even if cached
    
    Returns:
        Local file path to the model
    """
    global downloaded_model_path
    
    if not s3_url:
        print("⚠️ No model URL provided, using default 'best.pt'")
        return 'best.pt'
    
    try:
        # Generate cache filename from S3 URL
        if s3_url.startswith('s3://'):
            # Parse S3 URL: s3://bucket/key
            parts = s3_url.replace('s3://', '').split('/', 1)
            model_filename = os.path.basename(parts[1]) if len(parts) > 1 else 'best.pt'
        else:
            # Presigned HTTPS URL
            model_filename = 'best.pt'
        
        local_model_path = os.path.join(MODEL_CACHE_DIR, model_filename)
        
        # If already cached and not forcing download, use cached version
        if os.path.exists(local_model_path) and not force_download:
            print(f"✅ Using cached model: {local_model_path}")
            downloaded_model_path = local_model_path
            return local_model_path
        
        print(f"📥 Downloading model from S3...")
        print(f"   URL: {s3_url[:60]}...")
        
        if s3_url.startswith('s3://'):
            # Download from S3 using boto3
            parts = s3_url.replace('s3://', '').split('/', 1)
            bucket = parts[0]
            key = parts[1] if len(parts) > 1 else ''
            
            print(f"   Bucket: {bucket}")
            print(f"   Key: {key}")
            
            # Get file size first
            response = s3_client.head_object(Bucket=bucket, Key=key)
            file_size_mb = response['ContentLength'] / (1024 * 1024)
            print(f"   Size: {file_size_mb:.1f} MB")
            
            # Download with progress
            s3_client.download_file(bucket, key, local_model_path)
            
        else:
            # Download from presigned HTTPS URL
            import urllib.request
            print(f"   Downloading from presigned URL...")
            urllib.request.urlretrieve(s3_url, local_model_path)
        
        print(f"✅ Model downloaded to: {local_model_path}")
        downloaded_model_path = local_model_path
        return local_model_path
        
    except Exception as e:
        print(f"❌ Failed to download model: {str(e)}")
        print(f"⚠️ Falling back to default 'best.pt'")
        return 'best.pt'


class DetectionSender:
    """Handles AWS integration for detections - S3 uploads and DynamoDB storage"""
    
    def __init__(self):
        self.api_url = API_BASE_URL
        self.auth_token = None
        self.session = requests.Session()
        self.user_id = 'web-user'
        
    def authenticate(self):
        """Get ID token from Cognito - using browser token or skip if not available"""
        print("🔐 Checking for browser Cognito token...")
        try:
            # Try to read token from ~/.mozuku_auth_token if saved
            token_file = os.path.expanduser('~/.mozuku_auth_token')
            if os.path.exists(token_file):
                with open(token_file, 'r') as f:
                    self.auth_token = f.read().strip()
                print("✅ Using saved Cognito token!")
                return True
        except Exception as e:
            pass
        
        print("⚠️ No saved Cognito token found")
        print("   Continuing with direct S3/DynamoDB uploads\n")
        return True
    
    def upload_to_s3(self, frame, bucket, key):
        """Upload image to S3 and return the S3 URL"""
        try:
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            print(f"   📤 Encoding frame: {len(buffer.tobytes())} bytes")
            
            response = s3_client.put_object(
                Bucket=bucket,
                Key=key,
                Body=buffer.tobytes(),
                ContentType='image/jpeg',
                Metadata={'timestamp': datetime.utcnow().isoformat()}
            )
            print(f"   ✅ S3 upload response: {response.get('ResponseMetadata', {}).get('HTTPStatusCode')}")
            
            s3_url = f"s3://{bucket}/{key}"
            return s3_url
        except Exception as e:
            print(f"   ❌ S3 Upload Error: {type(e).__name__}: {str(e)}")
            import traceback
            print(f"   Traceback: {traceback.format_exc()}")
            return None

    def _to_decimal(self, obj):
        if isinstance(obj, float):
            return Decimal(str(obj))
        if isinstance(obj, dict):
            return {k: self._to_decimal(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [self._to_decimal(v) for v in obj]
        return obj

    def normalize_detections(self, detections, frame_width, frame_height):
        """Convert pixel bbox to YOLO normalized format"""
        normalized = []
        for det in detections:
            bbox = det.get('bbox', {})
            x = float(bbox.get('x', 0))
            y = float(bbox.get('y', 0))
            w = float(bbox.get('width', 0))
            h = float(bbox.get('height', 0))
            if frame_width <= 0 or frame_height <= 0:
                continue
            x_center = (x + (w / 2.0)) / frame_width
            y_center = (y + (h / 2.0)) / frame_height
            w_norm = w / frame_width
            h_norm = h / frame_height
            normalized.append({
                'class': 0,
                'x': x_center,
                'y': y_center,
                'w': w_norm,
                'h': h_norm,
                'label': det.get('label', 'unknown'),
                'confidence': float(det.get('confidence', 0.0))
            })
        return normalized
    
    def save_impurity_to_dynamodb(self, impurity_id, timestamp, s3_url, detection):
        """Save impurity metadata to DynamoDB"""
        try:
            impurity_table.put_item(
                Item={
                    'impurityId': impurity_id,
                    'userId': self.user_id,
                    'timestamp': timestamp,
                    's3Url': s3_url,
                    'label': detection.get('label', 'unknown'),
                    'confidence': Decimal(str(detection.get('confidence', 0.0))),
                    'bbox': json.dumps(detection.get('bbox', {})),
                    'ttl': int(datetime.utcnow().timestamp()) + (30 * 24 * 60 * 60)  # 30 days
                }
            )
            return True
        except Exception as e:
            print(f"❌ DynamoDB Impurity Save Error: {str(e)}")
            return False
    
    def save_frame_to_dynamodb(self, frame_id, timestamp, frame_with_bbox_url, frame_without_bbox_url, detection_count, detections):
        """Save frame detection metadata to DynamoDB"""
        try:
            s3_labels_path = ''
            if frame_without_bbox_url and frame_without_bbox_url.startswith('s3://'):
                s3_labels_path = frame_without_bbox_url.replace('.jpg', '.txt').replace('.png', '.txt')
            frame_table.put_item(
                Item={
                    'frameId': frame_id,
                    'userId': self.user_id,
                    'timestamp': timestamp,
                    'detectionCount': detection_count,
                    's3UrlWithBbox': frame_with_bbox_url,
                    's3UrlWithoutBbox': frame_without_bbox_url,
                    's3LabelsPath': s3_labels_path,
                    'labelingStatus': 'auto',
                    'detections': self._to_decimal(detections),
                    'modelUsed': 'yolov8-best',
                    'motorSpeed': 0,
                    'cameraSettings': json.dumps({'resolution': '1280x720', 'fps': 30})
                }
            )
            return True
        except Exception as e:
            print(f"❌ DynamoDB Frame Save Error: {str(e)}")
            return False
    
    def extract_and_upload_cropped_images(self, frame, detections, timestamp):
        """Extract cropped regions and upload them to S3"""
        cropped_images = []
        frame_height, frame_width = frame.shape[:2]
        
        for idx, detection in enumerate(detections):
            try:
                bbox = detection.get('bbox', {})
                x = int(bbox.get('x', 0))
                y = int(bbox.get('y', 0))
                w = int(bbox.get('width', 0))
                h = int(bbox.get('height', 0))
                
                print(f"   📊 Crop {idx}: bbox=({x},{y},{w}x{h}) from frame {frame_width}x{frame_height}")
                print(f"        Frame dtype: {frame.dtype}, shape: {frame.shape}, min/max pixel values: {frame.min()}/{frame.max()}")
                
                # Add padding around the detection
                padding = 20
                x1 = max(0, x - padding)
                y1 = max(0, y - padding)
                x2 = min(frame_width, x + w + padding)
                y2 = min(frame_height, y + h + padding)
                
                cropped = frame[y1:y2, x1:x2]
                cropped_h, cropped_w = cropped.shape[:2]
                print(f"        -> Cropping region: x1={x1} y1={y1} x2={x2} y2={y2} = {cropped_w}x{cropped_h} pixels")
                print(f"        Cropped region pixel values: min={cropped.min()}, max={cropped.max()}, mean={cropped.mean():.1f}")
                
                if cropped_w < 10 or cropped_h < 10:
                    print(f"        ⚠️ Cropped region too small, skipping")
                    continue
                
                # Upload to impurities bucket
                impurity_id = str(uuid.uuid4())
                impurity_key = f"{self.user_id}/{timestamp}/cropped_impurity_{idx}.jpg"
                s3_url = self.upload_to_s3(cropped, IMPURITIES_BUCKET, impurity_key)
                
                if s3_url:
                    # Save metadata to DynamoDB
                    self.save_impurity_to_dynamodb(impurity_id, timestamp, s3_url, detection)
                    cropped_images.append({
                        'impurityId': impurity_id,
                        'url': s3_url,
                        'label': detection.get('label', 'unknown'),
                        'confidence': detection.get('confidence', 0.0)
                    })
                    print(f"   📍 Cropped impurity {idx + 1}: {detection.get('label')} ({detection.get('confidence', 0):.1%})")
            except Exception as e:
                print(f"⚠️ Error cropping detection {idx}: {str(e)}")
                continue
        
        return cropped_images
    
    def send_detection(self, frame_with_bbox, frame_raw, detections):
        """Upload annotated frame (with bboxes from yolov8_node) and raw frame to S3"""
        if not detections or len(detections) == 0:
            return False
        
        try:
            frame_id = str(uuid.uuid4())
            timestamp = int(datetime.utcnow().timestamp() * 1000)
            
            # Upload raw frame without bbox
            frame_without_key = f"{self.user_id}/{timestamp}/frame-no-bbox.jpg"
            frame_without_url = self.upload_to_s3(frame_raw, FRAMES_WITHOUT_BBOX_BUCKET, frame_without_key)
            
            # Use the frame stored with the detection (synchronized), or fall back to passed frame_with_bbox
            detection_frame = detections[0].get('frame_with_bbox') if detections else None
            frame_to_use = detection_frame if detection_frame is not None else frame_with_bbox
            
            # Upload annotated frame from yolov8_node (already has correct bboxes drawn)
            frame_with_key = f"{self.user_id}/{timestamp}/frame-with-bbox.jpg"
            frame_with_url = self.upload_to_s3(frame_to_use, FRAMES_WITH_BBOX_BUCKET, frame_with_key)
            
            if not (frame_without_url and frame_with_url):
                return False
            
            # Extract and upload cropped impurities from RAW frame (without bboxes drawn)
            # This ensures cropped images don't have bounding boxes on them
            cropped_images = self.extract_and_upload_cropped_images(frame_raw, detections, timestamp)

            # Normalize detections for YOLO label generation
            frame_h, frame_w = frame_raw.shape[:2]
            normalized_detections = self.normalize_detections(detections, frame_w, frame_h)
            
            # Save frame metadata to DynamoDB
            success = self.save_frame_to_dynamodb(
                frame_id,
                timestamp,
                frame_with_url,
                frame_without_url,
                len(detections),
                normalized_detections
            )
            
            if success:
                print(f"✅ Frame saved: {frame_id} with {len(cropped_images)} impurities\n")
                return True
            else:
                return False
                
        except Exception as e:
            print(f"❌ Error in send_detection: {str(e)}")
            import traceback
            print(traceback.format_exc())
            return False


if ROS2_AVAILABLE:
    class ROS2DetectionBridge(Node):
        """ROS2 Node that captures camera frames and detections, sends to AWS"""
        
        def __init__(self, sender):
            super().__init__('mozuku_detection_bridge')
            self.sender = sender
            self.bridge = CvBridge()
            self.last_frame = None
            self.last_annotated_frame = None  # Frame with bboxes from yolov8_node
            self.detections_buffer = []
            self.send_interval = 2.0
            self.is_sending = False  # Flag to prevent concurrent sends
            
            # Subscriptions
            self.camera_sub = self.create_subscription(
                Image, CAMERA_TOPIC, self.camera_callback, 10
            )
            # Subscribe to yolov8_node's annotated image (already has correct bboxes)
            self.annotated_image_sub = self.create_subscription(
                Image, '/yolov8/detections_image', self.annotated_image_callback, 10
            )
            self.detection_sub = self.create_subscription(
                Detection2D, DETECTIONS_TOPIC, self.detection_callback, 10
            )
            
            # Timer to send every 2 seconds
            self.send_timer = self.create_timer(self.send_interval, self.send_buffered)
            
            self.get_logger().info(f"✅ Listening to {CAMERA_TOPIC}, /yolov8/detections_image, and {DETECTIONS_TOPIC}")
        
        def camera_callback(self, msg):
            """Capture camera frame"""
            try:
                self.last_frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
            except Exception as e:
                self.get_logger().error(f"Frame conversion error: {str(e)}")
        
        def annotated_image_callback(self, msg):
            """Capture annotated image from yolov8_node (already has correct bboxes)"""
            try:
                self.last_annotated_frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
            except Exception as e:
                self.get_logger().error(f"Annotated image conversion error: {str(e)}")
        
        def detection_callback(self, msg):
            """Buffer detection data from yolov8_node"""
            try:
                # Detection2D message from yolov8_node contains:
                # msg.class_name, msg.score (confidence)
                # msg.center_x, msg.center_y (pixel coords of center)
                # msg.width, msg.height (width/height in pixels)
                
                label = getattr(msg, 'class_name', 'unknown')
                confidence = float(getattr(msg, 'confidence', 0.0))
                
                # Calculate bbox from center + width/height
                center_x = float(getattr(msg, 'center_x', 0.0))
                center_y = float(getattr(msg, 'center_y', 0.0))
                width = float(getattr(msg, 'width', 0.0))
                height = float(getattr(msg, 'height', 0.0))
                
                # Convert center-based bbox to top-left corner (x1, y1)
                x1 = int(center_x - width / 2.0)
                y1 = int(center_y - height / 2.0)
                
                bbox_data = {
                    'x': x1,
                    'y': y1,
                    'width': int(width),
                    'height': int(height)
                }
                
                # Store frame timestamp with detection to group by frame later
                frame_timestamp = time.time()
                
                detection = {
                    'label': label,
                    'confidence': confidence,
                    'bbox': bbox_data,
                    'frame_with_bbox': self.last_annotated_frame.copy() if self.last_annotated_frame is not None else None,
                    'frame_raw': self.last_frame.copy() if self.last_frame is not None else None,  # Store raw frame synchronized with detection
                    'frame_timestamp': frame_timestamp
                }
                
                self.detections_buffer.append(detection)
                self.get_logger().info(f"🎯 Buffered: {label} ({confidence:.1%}) bbox=({x1},{y1},{int(width)}x{int(height)})")
            except Exception as e:
                self.get_logger().error(f"Detection processing error: {str(e)}")
                import traceback
                self.get_logger().error(f"   Details: {traceback.format_exc()}")
        
        def send_buffered(self):
            """Send buffered detections to AWS in background thread"""
            global sending_enabled
            
            # Prevent concurrent sends - only send if not already sending
            if self.is_sending:
                self.get_logger().debug(f"⏳ Already sending, skipping...")
                return
            
            if sending_enabled and self.last_annotated_frame is not None and len(self.detections_buffer) > 0:
                # Group detections by frame timestamp (detections from same frame should be sent together)
                # Use 0.1 second window to group detections from same frame
                if len(self.detections_buffer) > 0:
                    first_detection = self.detections_buffer[0]
                    first_timestamp = first_detection.get('frame_timestamp', time.time())
                    
                    # Collect all detections within 0.1 seconds of the first detection
                    frame_detections = []
                    remaining_detections = []
                    
                    for detection in self.detections_buffer:
                        det_timestamp = detection.get('frame_timestamp', first_timestamp)
                        if abs(det_timestamp - first_timestamp) < 0.1:  # Within 100ms
                            frame_detections.append(detection)
                        else:
                            remaining_detections.append(detection)
                    
                    # Update buffer to only keep detections not being sent
                    self.detections_buffer = remaining_detections
                    
                    self.get_logger().info(f"📤 send_buffered triggered: {len(frame_detections)} detections from same frame")
                    
                    # Mark as sending
                    self.is_sending = True
                    
                    def send_with_cleanup():
                        try:
                            self.get_logger().info(f"🚀 Uploading frame with {len(frame_detections)} detection(s) to S3...")
                            
                            # Use synchronized frames stored with the first detection
                            first_detection = frame_detections[0]
                            frame_with_bbox = first_detection.get('frame_with_bbox')
                            frame_raw = first_detection.get('frame_raw')
                            
                            # Fallback to last known frames if synchronized frames not available
                            if frame_with_bbox is None:
                                self.get_logger().warn("⚠️ No synchronized frame_with_bbox, using last_annotated_frame")
                                frame_with_bbox = self.last_annotated_frame.copy()
                            if frame_raw is None:
                                self.get_logger().warn("⚠️ No synchronized frame_raw, using last_frame")
                                frame_raw = self.last_frame.copy() if self.last_frame is not None else None
                            
                            # Validate we have both frames
                            if frame_with_bbox is None or frame_raw is None:
                                self.get_logger().error("❌ Missing synchronized frames, skipping upload")
                                return
                            
                            self.sender.send_detection(
                                frame_with_bbox, 
                                frame_raw, 
                                frame_detections  # Send all detections from this frame
                            )
                            self.get_logger().info(f"✅ Upload complete")
                        except Exception as e:
                            self.get_logger().error(f"❌ Error in send_detection: {str(e)}")
                            import traceback
                            self.get_logger().error(f"   Traceback: {traceback.format_exc()}")
                        finally:
                            # Always mark as done, even if error
                            self.is_sending = False
                            self.get_logger().debug(f"🔓 Sending flag reset")
                    
                    thread = threading.Thread(target=send_with_cleanup)
                    thread.daemon = True
                    thread.start()


def start_ros2_launch(job_id, command_key, user_id='web-user', model_url=None):
    """Start ROS2 launch process with dynamic model download"""
    global ros2_processes, current_job_id
    
    current_job_id = job_id
    command_template = ROS2_LAUNCH_COMMANDS.get(command_key)
    
    if not command_template:
        print(f"❌ Unknown command: {command_key}")
        update_job_status(job_id, 'failed', 'Unknown command', user_id)
        return
    
    try:
        # Prevent duplicate launches
        existing = ros2_processes.get(command_key)
        if existing:
            if existing.poll() is None:
                print(f"⚠️  {command_key} already running (PID: {existing.pid}) - skipping start")
                update_job_status(job_id, 'running', f'{command_key} already running', user_id)
                return
            else:
                del ros2_processes[command_key]

        # Download model from S3 if URL provided
        if command_key == 'camera_bringup' and model_url:
            print(f"🔄 Preparing model...")
            model_path = download_model_from_s3(model_url)
        else:
            # Fall back to cached local model if available
            cache_candidate = os.path.join(MODEL_CACHE_DIR, 'best.pt')
            if downloaded_model_path and os.path.exists(downloaded_model_path):
                model_path = downloaded_model_path
            elif os.path.exists(cache_candidate):
                model_path = cache_candidate
            else:
                model_path = 'best.pt'  # Default fallback
        
        # Inject model path into command
        command = command_template.format(model_path=model_path)
        
        print(f"🚀 Starting: {command}")
        print(f"📋 ROS2 Launch Logs:")
        print("=" * 80)
        
        # Start process with output visible in real-time
        process = subprocess.Popen(
            command,
            shell=True,
            stdout=None,           # Show output directly to console
            stderr=subprocess.STDOUT,  # Combine stderr with stdout
            preexec_fn=os.setsid
        )
        ros2_processes[command_key] = process
        update_job_status(job_id, 'running', f'Started {command_key}', user_id)
        print("=" * 80)
        print(f"✅ {command_key} started (PID: {process.pid})")
        print(f"   • Model: {model_path}")
        print(f"   • Check logs above for any errors")
        print(f"   • Use 'ros2 topic list' to verify topics are publishing\n")
    except Exception as e:
        print(f"❌ Failed to start {command_key}: {str(e)}")
        update_job_status(job_id, 'failed', str(e), user_id)


def stop_ros2_launch(job_id, command_key, user_id='web-user'):
    """Stop ROS2 launch process"""
    global ros2_processes
    
    try:
        if command_key in ros2_processes:
            process = ros2_processes[command_key]
            print(f"\n⏹️  Stopping {command_key} (PID: {process.pid})...")
            
            # Send SIGTERM to the entire process group
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            try:
                process.wait(timeout=5)
                print(f"✅ {command_key} stopped gracefully")
            except subprocess.TimeoutExpired:
                print(f"⚠️  {command_key} did not stop, forcing kill...")
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                print(f"✅ {command_key} killed forcefully")
            
            del ros2_processes[command_key]
            update_job_status(job_id, 'stopped', f'Stopped {command_key}', user_id)
            print(f"✅ {command_key} stopped\n")
        else:
            print(f"ℹ️  {command_key} not running")
            update_job_status(job_id, 'stopped', f'{command_key} was not running', user_id)
    except Exception as e:
        print(f"❌ Error stopping {command_key}: {str(e)}")
        update_job_status(job_id, 'error', str(e), user_id)


def update_job_status(job_id, status, message, user_id='web-user'):
    """Update job status in DynamoDB"""
    try:
        launch_jobs_table.update_item(
            Key={'jobId': job_id, 'userId': user_id},
            UpdateExpression='SET #s = :status, #m = :msg, #ts = :timestamp',
            ExpressionAttributeNames={
                '#s': 'status',
                '#m': 'message',
                '#ts': 'timestamp'
            },
            ExpressionAttributeValues={
                ':status': status,
                ':msg': message,
                ':timestamp': int(datetime.now().timestamp() * 1000)
            }
        )
        print(f"📝 Job {job_id}: {status} - {message}")
    except Exception as e:
        print(f"❌ Failed to update job status: {str(e)}")


def check_jobs():
    """Monitor DynamoDB for job commands"""
    global sending_enabled
    
    print("\n📊 Job Monitor Started - Checking DynamoDB every 5 seconds...")
    print("=" * 60)
    
    processed_jobs = set()  # Track which jobs we've already processed
    
    while True:
        try:
            response = launch_jobs_table.scan(
                FilterExpression='#s = :pending',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':pending': 'pending'}
            )
            
            items = response.get('Items', [])
            
            if items:
                print(f"\n⏰ [{datetime.now().strftime('%H:%M:%S')}] Found {len(items)} pending job(s)")
            
            for item in items:
                job_id = item.get('jobId')
                user_id = item.get('userId', 'web-user')
                command = item.get('command')
                model_url = item.get('modelUrl')  # Extract model URL from job record
                
                # Skip if already processed
                if job_id in processed_jobs:
                    continue
                    
                processed_jobs.add(job_id)
                
                print(f"\n🎯 Processing job {job_id}")
                print(f"   Command: {command}")
                print(f"   User: {user_id}")
                if model_url:
                    print(f"   Model URL: {model_url}")
                
                if command == 'start_camera_bringup':
                    start_ros2_launch(job_id, 'camera_bringup', user_id, model_url)
                    sending_enabled = True
                    
                elif command == 'start_sdm_bridge':
                    start_ros2_launch(job_id, 'sdm_bridge', user_id, model_url)
                    
                elif command == 'stop_camera_bringup':
                    stop_ros2_launch(job_id, 'camera_bringup', user_id)
                    sending_enabled = False
                    
                elif command == 'stop_sdm_bridge':
                    stop_ros2_launch(job_id, 'sdm_bridge', user_id)
                    
                elif command == 'start_all':
                    start_ros2_launch(job_id, 'camera_bringup', user_id, model_url)
                    time.sleep(2)
                    start_ros2_launch(job_id, 'sdm_bridge', user_id, model_url)
                    sending_enabled = True
                    update_job_status(job_id, 'running', 'All ROS2 nodes started', user_id)
                    
                elif command == 'stop_all':
                    stop_ros2_launch(job_id, 'camera_bringup', user_id)
                    stop_ros2_launch(job_id, 'sdm_bridge', user_id)
                    sending_enabled = False
                    update_job_status(job_id, 'stopped', 'All ROS2 nodes stopped', user_id)
            
            time.sleep(5)  # Check every 5 seconds
            
        except Exception as e:
            print(f"⚠️ Job monitor error: {str(e)}")
            time.sleep(10)


def run_ros2():
    """Run ROS2 with job monitoring (temp: demo mode for now)"""
    print("\n🎬 ROS2 MODE - Monitoring DynamoDB for commands\n")
    
    # Initialize ROS2
    rclpy.init()
    
    # Create sender instance
    sender = DetectionSender()
    
    # Create and spin ROS2 detection bridge node in background thread
    def spin_ros2_node():
        try:
            bridge_node = ROS2DetectionBridge(sender)
            executor = MultiThreadedExecutor()
            executor.add_node(bridge_node)
            print("✅ ROS2 Detection Bridge initialized - listening for detections\n")
            executor.spin()
        except Exception as e:
            print(f"❌ ROS2 Node Error: {str(e)}")
        finally:
            try:
                bridge_node.destroy_node()
            except:
                pass
    
    ros2_thread = threading.Thread(target=spin_ros2_node, daemon=True)
    ros2_thread.start()
    
    # Start job monitor (this is the important part!)
    monitor_thread = threading.Thread(target=check_jobs, daemon=True)
    monitor_thread.start()
    
    print("✅ Job monitor started - waiting for commands from dashboard...")
    print("   Click buttons on website to start/stop ROS2 processes\n")
    
    # Keep script running and listening
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n⏹️ Shutting down...")
        for key in list(ros2_processes.keys()):
            try:
                os.killpg(os.getpgid(ros2_processes[key].pid), signal.SIGTERM)
            except:
                pass
        rclpy.shutdown()


def run_demo():
    """Demo mode - test without ROS2"""
    print("\n🎬 DEMO MODE - Monitoring DynamoDB for commands\n")
    
    # Start job monitor (this is the important part!)
    monitor_thread = threading.Thread(target=check_jobs, daemon=True)
    monitor_thread.start()
    
    print("✅ Waiting for DynamoDB commands from dashboard...")
    print("   Click 'Start Camera' button on website to test\n")
    
    # Keep script running and listening
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n⏹️ Shutting down...")
        for key in list(ros2_processes.keys()):
            try:
                os.killpg(os.getpgid(ros2_processes[key].pid), signal.SIGTERM)
            except:
                pass


if __name__ == '__main__':
    if ROS2_AVAILABLE:
        run_ros2()
    else:
        run_demo()
