import json
import csv
import os

def convert_json_to_csv():
    # Paths
    dir_path = os.path.dirname(os.path.abspath(__file__))
    aw_json = os.path.join(dir_path, "activity_watch_data.json")
    export_json = os.path.join(dir_path, "export.json")
    if os.path.exists(aw_json):
        json_path = aw_json
    else:
        json_path = export_json
        
    csv_path = os.path.join(dir_path, "export.csv")
    
    print(f"Reading ActivityWatch export file from: {json_path}")
    if not os.path.exists(json_path):
        print(f"ERROR: {json_path} does not exist.")
        return
        
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    buckets = data.get("buckets", {})
    print(f"Found {len(buckets)} buckets in the export data.")
    
    # Step 1: Scan all events in all buckets to dynamically collect all unique event['data'] keys
    print("Scanning events to collect payload data keys...")
    all_event_data_keys = set()
    total_events = 0
    
    for bucket_id, bucket in buckets.items():
        events = bucket.get("events", [])
        total_events += len(events)
        for e in events:
            edata = e.get("data", {})
            if isinstance(edata, dict):
                for k in edata.keys():
                    all_event_data_keys.add(k)
                    
    sorted_event_data_keys = sorted(list(all_event_data_keys))
    print(f"Total events found across all buckets: {total_events}")
    print(f"Dynamic event data keys discovered: {sorted_event_data_keys}")
    
    # Step 2: Build CSV Headers
    headers = [
        "bucket_id",
        "bucket_type",
        "bucket_client",
        "bucket_hostname",
        "bucket_created",
        "bucket_name",
        "raw_bucket_data",
        "event_timestamp",
        "event_duration",
    ]
    
    # Add columns for each dynamic event data key
    for key in sorted_event_data_keys:
        headers.append(f"event_data_{key}")
        
    # Add raw event data column for absolute safety
    headers.append("raw_event_data")
    
    # Step 3: Collect and sort rows, then write to CSV
    rows = []
    
    for bucket_id, bucket in buckets.items():
        # Extract bucket metadata
        bucket_type = bucket.get("type", "")
        bucket_client = bucket.get("client", "")
        bucket_hostname = bucket.get("hostname", "")
        bucket_created = bucket.get("created", "")
        bucket_name = bucket.get("name", "")
        
        # Safely serialize raw bucket data
        bdata = bucket.get("data", {})
        raw_bucket_data = json.dumps(bdata) if bdata else ""
        
        events = bucket.get("events", [])
        for e in events:
            # Initialize CSV row dictionary
            row = {
                "bucket_id": bucket_id,
                "bucket_type": bucket_type,
                "bucket_client": bucket_client,
                "bucket_hostname": bucket_hostname,
                "bucket_created": bucket_created,
                "bucket_name": bucket_name,
                "raw_bucket_data": raw_bucket_data,
                "event_timestamp": e.get("timestamp", ""),
                "event_duration": e.get("duration", 0.0),
            }
            
            # Flatten the dynamic event data keys
            edata = e.get("data", {})
            for key in sorted_event_data_keys:
                row[f"event_data_{key}"] = edata.get(key, "") if isinstance(edata, dict) else ""
                
            # Serialize raw event data payload to prevent any information loss
            row["raw_event_data"] = json.dumps(edata) if edata else ""
            
            rows.append(row)
            
    # Sort rows so that latest entries (descending by event_timestamp) are first
    print("Sorting events by timestamp (latest first)...")
    rows.sort(key=lambda x: x["event_timestamp"], reverse=True)
    
    print(f"Writing to CSV file at: {csv_path}...")
    with open(csv_path, "w", encoding="utf-8", newline="") as csv_f:
        writer = csv.DictWriter(csv_f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)
        written_rows = len(rows)
                
    print(f"SUCCESS: Successfully wrote {written_rows} rows to {csv_path}.")
    print(f"Columns in export.csv: {len(headers)}")
    for h in headers:
        print(f" - {h}")

if __name__ == "__main__":
    convert_json_to_csv()
