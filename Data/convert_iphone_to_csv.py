import json
import csv
import os

def convert_iphone_to_csv():
    # Paths
    dir_path = os.path.dirname(os.path.abspath(__file__))
    all_json = os.path.join(dir_path, "iphone_screentime_all.json")
    std_json = os.path.join(dir_path, "iphone_screentime.json")
    json_7d = os.path.join(dir_path, "iphone_screentime_7d.json")
    
    if os.path.exists(all_json):
        json_path = all_json
    elif os.path.exists(std_json):
        json_path = std_json
    else:
        json_path = json_7d
        
    csv_path = os.path.join(dir_path, "iphone_screentime.csv")
    
    print(f"Reading iPhone screentime data from: {json_path}")
    if not os.path.exists(json_path):
        print(f"ERROR: {json_path} does not exist.")
        return
        
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    if not isinstance(data, list) or len(data) == 0:
        print("ERROR: iPhone data is not a non-empty list.")
        return
        
    device_info = data[0]
    device_id = device_info.get("device_id", "")
    files_scanned = device_info.get("files_scanned", 0)
    events = device_info.get("events", [])
    
    print(f"Device ID: {device_id}")
    print(f"Files scanned: {files_scanned}")
    print(f"Found {len(events)} events in the raw screentime data.")
    
    # Step 1: Scan events to dynamically collect all unique event['data'] keys
    print("Scanning events to collect payload data keys...")
    all_event_data_keys = set()
    for e in events:
        edata = e.get("data", {})
        if isinstance(edata, dict):
            for k in edata.keys():
                all_event_data_keys.add(k)
                
    sorted_event_data_keys = sorted(list(all_event_data_keys))
    print(f"Dynamic event data keys discovered: {sorted_event_data_keys}")
    
    # Step 2: Build CSV Headers
    headers = [
        "device_id",
        "files_scanned",
        "event_timestamp",
        "event_duration_seconds",
    ]
    
    # Add columns for each dynamic event data key
    for key in sorted_event_data_keys:
        headers.append(f"event_data_{key}")
        
    # Add raw event data column for absolute safety
    headers.append("raw_event_data")
    
    # Step 3: Collect and sort rows
    rows = []
    for e in events:
        row = {
            "device_id": device_id,
            "files_scanned": files_scanned,
            "event_timestamp": e.get("timestamp", ""),
            "event_duration_seconds": e.get("duration_seconds", 0.0),
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
    
    # Step 4: Write rows to CSV
    print(f"Writing to CSV file at: {csv_path}...")
    with open(csv_path, "w", encoding="utf-8", newline="") as csv_f:
        writer = csv.DictWriter(csv_f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)
        written_rows = len(rows)
        
    print(f"SUCCESS: Successfully wrote {written_rows} rows to {csv_path}.")
    print(f"Columns in iphone_screentime.csv: {len(headers)}")
    for h in headers:
        print(f" - {h}")

if __name__ == "__main__":
    convert_iphone_to_csv()
