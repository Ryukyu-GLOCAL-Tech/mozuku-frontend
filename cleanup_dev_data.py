#!/usr/bin/env python3
"""
Script to clean up DynamoDB tables and S3 buckets for development environment
WARNING: This will delete ALL data from the specified tables and buckets!
"""
import boto3
import os
from decimal import Decimal

# Configuration
REGION = 'ap-northeast-1'
TABLES = [
    'DetectionStats-dev',
    'FrameDetections-dev',
    'ImpurityData-dev',
    'ROS2LaunchJobs-dev',
    'SystemMetrics-dev'
]
S3_BUCKETS = [
    'mozuku-frames-dev-with-bbox',
    'mozuku-frames-dev-without-bbox',
    'mozuku-impurities-dev'
]

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb', region_name=REGION)
s3_client = boto3.client('s3', region_name=REGION)


def delete_all_items_from_table(table_name):
    """Delete all items from a DynamoDB table"""
    print(f"\n🗑️  Cleaning table: {table_name}")
    table = dynamodb.Table(table_name)
    
    try:
        # Get table key schema
        response = table.scan()
        items = response.get('Items', [])
        
        # Get key schema to know which keys to use for deletion
        table_meta = dynamodb.Table(table_name)
        key_schema = table_meta.key_schema
        key_names = [key['AttributeName'] for key in key_schema]
        
        print(f"   Found {len(items)} items")
        print(f"   Key schema: {key_names}")
        
        # Delete items in batches
        deleted_count = 0
        with table.batch_writer() as batch:
            for item in items:
                # Extract only the key attributes for deletion
                key = {k: item[k] for k in key_names if k in item}
                batch.delete_item(Key=key)
                deleted_count += 1
                if deleted_count % 25 == 0:
                    print(f"   Deleted {deleted_count} items...")
        
        # Continue scanning if there are more items
        while 'LastEvaluatedKey' in response:
            response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
            items = response.get('Items', [])
            
            with table.batch_writer() as batch:
                for item in items:
                    key = {k: item[k] for k in key_names if k in item}
                    batch.delete_item(Key=key)
                    deleted_count += 1
                    if deleted_count % 25 == 0:
                        print(f"   Deleted {deleted_count} items...")
        
        print(f"   ✅ Deleted {deleted_count} items from {table_name}")
        return deleted_count
    
    except Exception as e:
        print(f"   ❌ Error deleting from {table_name}: {str(e)}")
        return 0


def delete_all_objects_from_bucket(bucket_name):
    """Delete all objects from an S3 bucket"""
    print(f"\n🗑️  Cleaning S3 bucket: {bucket_name}")
    
    try:
        # List all objects
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name)
        
        deleted_count = 0
        for page in pages:
            if 'Contents' not in page:
                continue
            
            objects = page['Contents']
            print(f"   Found {len(objects)} objects in this page")
            
            # Delete in batches of 1000 (S3 limit)
            for i in range(0, len(objects), 1000):
                batch = objects[i:i+1000]
                delete_keys = [{'Key': obj['Key']} for obj in batch]
                
                response = s3_client.delete_objects(
                    Bucket=bucket_name,
                    Delete={'Objects': delete_keys}
                )
                
                deleted_count += len(response.get('Deleted', []))
                if deleted_count % 100 == 0:
                    print(f"   Deleted {deleted_count} objects...")
        
        print(f"   ✅ Deleted {deleted_count} objects from {bucket_name}")
        return deleted_count
    
    except Exception as e:
        print(f"   ❌ Error deleting from {bucket_name}: {str(e)}")
        return 0


def main():
    print("=" * 70)
    print("⚠️  WARNING: This will DELETE ALL DATA from development environment!")
    print("=" * 70)
    print("\nTables to clean:")
    for table in TABLES:
        print(f"  - {table}")
    print("\nS3 Buckets to clean:")
    for bucket in S3_BUCKETS:
        print(f"  - {bucket}")
    
    response = input("\n❓ Are you sure you want to continue? (yes/no): ")
    if response.lower() != 'yes':
        print("❌ Cleanup cancelled")
        return
    
    print("\n🚀 Starting cleanup...")
    
    # Clean DynamoDB tables
    print("\n" + "=" * 70)
    print("STEP 1: Cleaning DynamoDB Tables")
    print("=" * 70)
    total_items_deleted = 0
    for table in TABLES:
        deleted = delete_all_items_from_table(table)
        total_items_deleted += deleted
    
    print(f"\n✅ Total items deleted from DynamoDB: {total_items_deleted}")
    
    # Clean S3 buckets
    print("\n" + "=" * 70)
    print("STEP 2: Cleaning S3 Buckets")
    print("=" * 70)
    total_objects_deleted = 0
    for bucket in S3_BUCKETS:
        deleted = delete_all_objects_from_bucket(bucket)
        total_objects_deleted += deleted
    
    print(f"\n✅ Total objects deleted from S3: {total_objects_deleted}")
    
    print("\n" + "=" * 70)
    print("✅ Cleanup completed successfully!")
    print("=" * 70)


if __name__ == '__main__':
    main()
