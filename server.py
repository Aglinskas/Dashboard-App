import os
import json
import sys
import time
import subprocess
import shutil
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import base64

# Configuration
PORT = 8000
DATA_FILE = os.path.join(os.path.dirname(__file__), 'Data', 'export.json')
IPHONE_DATA_FILE = os.path.join(os.path.dirname(__file__), 'Data', 'iphone_screentime_7d.json')
TIMELINE_DIR = os.path.join(os.path.dirname(__file__), 'Data', 'data_timeline')

# Categories config with colors and mapping keywords
CATEGORIES = {
    "Coding / Dev": {
        "apps": ["terminal", "iterm", "vs code", "visual studio code", "xcode", "sublime text", "macvim", "dia", "jupyterlab", "cursor", "openai", "chatgpt"],
        "urls": ["github.com", "stackoverflow.com", "localhost:5600", "localhost:5679", "w3schools.com", "developer.apple.com"],
        "color": "#a78bfa" # Violet
    },
    "Work / Writing / Office": {
        "apps": ["microsoft excel", "excel", "microsoft powerpoint", "powerpoint", "microsoft word", "word", "keynote", "numbers", "pages", "preview", "acrobat", "slack", "teams", "microsoft teams", "zoom", "zoom.us", "finder", "gmail", "notes", "translate", "messages", "mobiletimer", "wallet", "incallservice"],
        "urls": ["docs.google.com", "drive.google.com", "meet.google.com", "basecamp.com", "3.basecamp.com", "gssc.lt", "nature.com", "jneurosci.org"],
        "color": "#34d399" # Emerald
    },
    "Browsing / Research": {
        "apps": ["google chrome", "chrome", "safari", "firefox", "arc", "brave", "mobilesafari"],
        "urls": [],
        "color": "#22d3ee" # Cyan
    },
    "Design / Media": {
        "apps": ["figma", "photoshop", "illustrator", "dia", "inkscape", "canva", "premiere", "camera", "photos", "slideshow", "mobileslideshow"],
        "urls": ["figma.com"],
        "color": "#f43f5e" # Rose
    },
    "Entertainment / Social": {
        "apps": ["spotify", "music", "netflix", "youtube", "facebook", "linkedin", "twitter", "x", "whatsapp", "reddit", "strava", "podcasts", "tiktok", "instagram", "messenger"],
        "urls": ["youtube.com", "facebook.com", "linkedin.com", "twitter.com", "x.com", "instagram.com", "reddit.com", "strava.com"],
        "color": "#fbbf24" # Amber
    },
    "System / Idle": {
        "apps": ["loginwindow", "usernotificationcenter", "dock", "system settings", "system preferences", "preferences", "springboard", "lockscreen", "clockangel", "control-center", "headphone", "sleeplockscreen"],
        "urls": [],
        "color": "#64748b" # Slate
    }
}

# In-memory storage for processed data
daily_summary = {} # date -> stats
daily_details = {} # date -> details (timeline, top apps, etc.)
latest_date = None

# Helper to determine category
def get_category(app, url, title):
    app_lower = app.lower() if app else ""
    url_lower = url.lower() if url else ""
    title_lower = title.lower() if title else ""
    
    # Check URLs first for web browsing categories
    for cat_name, conf in CATEGORIES.items():
        for pattern in conf["urls"]:
            if pattern in url_lower or pattern in title_lower:
                return cat_name
                
    # Check Apps
    for cat_name, conf in CATEGORIES.items():
        for app_name in conf["apps"]:
            if app_name in app_lower:
                return cat_name
                
    # Fallback default web browsing check
    if "chrome" in app_lower or "safari" in app_lower or "firefox" in app_lower:
        return "Browsing / Research"
        
    return "Browsing / Research" if (url or "http" in title_lower) else "Work / Writing / Office"

# Parse ISO timestamp
def parse_iso(ts_str):
    ts_str = ts_str.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(ts_str)
    except ValueError:
        if "." in ts_str:
            base, rest = ts_str.split(".")
            tz_split = rest.split("+")
            if len(tz_split) == 2:
                micro, tz = tz_split
                tz = "+" + tz
            else:
                tz_split = rest.split("-")
                micro, tz = tz_split
                tz = "-" + tz
            micro = micro[:6].ljust(6, "0")
            ts_str = f"{base}.{micro}{tz}"
        return datetime.fromisoformat(ts_str)

# Clean domain name from URL
def clean_domain(url):
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc
        if domain.startswith("www."):
            domain = domain[4:]
        return domain if domain else parsed.path.split('/')[0]
    except Exception:
        return url

# --- REFRESH AND SPLIT DATA PIPELINE HELPERS ---

def pull_activity_watch_data():
    url = "http://localhost:5600/api/0/export"
    dest_path = os.path.join(os.path.dirname(__file__), "Data", "activity_watch_data.json")
    print(f"Fetching ActivityWatch data from {url}...")
    try:
        import urllib.request
        with urllib.request.urlopen(url, timeout=10) as response:
            with open(dest_path, "wb") as f_out:
                f_out.write(response.read())
        print(f"Successfully downloaded ActivityWatch data to {dest_path}")
        return True
    except Exception as e:
        print(f"Python download failed: {e}. Trying wget...")
        try:
            subprocess.run(["wget", url, "-O", dest_path], check=True)
            print(f"Successfully downloaded ActivityWatch data via wget to {dest_path}")
            return True
        except Exception as e2:
            print(f"wget failed: {e2}")
            return False

def pull_iphone_data():
    aw_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "aw-import-screentime"))
    if not os.path.exists(aw_dir):
        print(f"Error: Directory {aw_dir} does not exist.")
        return False
        
    print("Running uv sync in aw-import-screentime...")
    try:
        subprocess.run(["uv", "sync"], cwd=aw_dir, check=True)
    except Exception as e:
        print(f"uv sync failed (continuing anyway): {e}")
    
    print("Exporting iPhone screentime events...")
    exe_path = os.path.join(aw_dir, ".venv", "bin", "aw-import-screentime")
    if not os.path.exists(exe_path):
        exe_path = "aw-import-screentime"
        
    output_file = os.path.join(aw_dir, "iphone_screentime_all.json")
    try:
        with open(output_file, "w") as f_out:
            subprocess.run([exe_path, "events", "preview", "--limit", "0"], cwd=aw_dir, stdout=f_out, check=True)
            
        dest_path = os.path.join(os.path.dirname(__file__), "Data", "iphone_screentime.json")
        shutil.copy(output_file, dest_path)
        print(f"Copied iPhone screentime to {dest_path}")
        return True
    except Exception as e:
        print(f"iPhone export failed: {e}")
        return False

def split_aw_csv():
    import csv
    dir_path = os.path.join(os.path.dirname(__file__), "Data")
    csv_path = os.path.join(dir_path, "export.csv")
    timeline_dir = os.path.join(dir_path, "data_timeline")
    
    if not os.path.exists(csv_path):
        print(f"Error: {csv_path} does not exist.")
        return
        
    print(f"Splitting ActivityWatch CSV: {csv_path}...")
    local_tz = datetime.now().astimezone().tzinfo
    
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        rows = list(reader)
        
    grouped_rows = {}
    for row in rows:
        ts_str = row.get("event_timestamp", "")
        if not ts_str:
            continue
        try:
            dt_utc = parse_iso(ts_str)
            dt_local = dt_utc.astimezone(local_tz)
            date_folder = dt_local.strftime("%Y-%b-%d").upper()
            
            if date_folder not in grouped_rows:
                grouped_rows[date_folder] = []
            grouped_rows[date_folder].append(row)
        except Exception as ex:
            pass
            
    for date_folder, day_rows in grouped_rows.items():
        day_dir = os.path.join(timeline_dir, date_folder)
        os.makedirs(day_dir, exist_ok=True)
        
        out_path1 = os.path.join(day_dir, f"{date_folder}-acitivty_watch_data.csv")
        out_path2 = os.path.join(day_dir, f"{date_folder}-activity_watch_data.csv")
        
        for out_path in [out_path1, out_path2]:
            with open(out_path, "w", encoding="utf-8", newline="") as f_out:
                writer = csv.DictWriter(f_out, fieldnames=headers)
                writer.writeheader()
                writer.writerows(day_rows)
                
    print(f"Successfully split ActivityWatch CSV into {len(grouped_rows)} days.")

def split_iphone_csv():
    import csv
    dir_path = os.path.join(os.path.dirname(__file__), "Data")
    csv_path = os.path.join(dir_path, "iphone_screentime.csv")
    timeline_dir = os.path.join(dir_path, "data_timeline")
    
    if not os.path.exists(csv_path):
        print(f"Error: {csv_path} does not exist.")
        return
        
    print(f"Splitting iPhone Screentime CSV: {csv_path}...")
    local_tz = datetime.now().astimezone().tzinfo
    
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        rows = list(reader)
        
    grouped_rows = {}
    for row in rows:
        ts_str = row.get("event_timestamp", "")
        if not ts_str:
            continue
        try:
            dt_utc = parse_iso(ts_str)
            dt_local = dt_utc.astimezone(local_tz)
            date_folder = dt_local.strftime("%Y-%b-%d").upper()
            
            if date_folder not in grouped_rows:
                grouped_rows[date_folder] = []
            grouped_rows[date_folder].append(row)
        except Exception as ex:
            pass
            
    for date_folder, day_rows in grouped_rows.items():
        day_dir = os.path.join(timeline_dir, date_folder)
        os.makedirs(day_dir, exist_ok=True)
        
        out_path = os.path.join(day_dir, f"{date_folder}-iphone_usage_data.csv")
        with open(out_path, "w", encoding="utf-8", newline="") as f_out:
            writer = csv.DictWriter(f_out, fieldnames=headers)
            writer.writeheader()
            writer.writerows(day_rows)
            
    print(f"Successfully split iPhone Screentime CSV into {len(grouped_rows)} days.")

def bootstrap_data_timeline():
    dir_path = os.path.join(os.path.dirname(__file__), 'Data')
    
    aw_json = os.path.join(dir_path, 'activity_watch_data.json')
    export_json = os.path.join(dir_path, 'export.json')
    if os.path.exists(aw_json) or os.path.exists(export_json):
        print("Bootstrapping AW data...")
        try:
            subprocess.run([sys.executable, os.path.join(dir_path, "convert_AW_to_csv.py")], check=True)
            split_aw_csv()
        except Exception as e:
            print(f"Error bootstrapping AW CSV: {e}")
            
    iphone_json = os.path.join(dir_path, 'iphone_screentime.json')
    iphone_json_7d = os.path.join(dir_path, 'iphone_screentime_7d.json')
    iphone_all = os.path.join(dir_path, 'iphone_screentime_all.json')
    if os.path.exists(iphone_json) or os.path.exists(iphone_json_7d) or os.path.exists(iphone_all):
        print("Bootstrapping iPhone data...")
        try:
            subprocess.run([sys.executable, os.path.join(dir_path, "convert_iphone_to_csv.py")], check=True)
            split_iphone_csv()
        except Exception as e:
            print(f"Error bootstrapping iPhone CSV: {e}")

def refresh_data_pipeline(refresh_computer=True, refresh_iphone=True):
    print(f"--- STARTING REFRESH DATA PIPELINE (Computer: {refresh_computer}, iPhone: {refresh_iphone}) ---")
    results = {}
    dir_path = os.path.join(os.path.dirname(__file__), 'Data')
    
    # 1. Computer Refresh
    if refresh_computer:
        print("Pulling ActivityWatch data...")
        success_aw = pull_activity_watch_data()
        if success_aw:
            print("Converting and splitting ActivityWatch data...")
            try:
                subprocess.run([sys.executable, os.path.join(dir_path, "convert_AW_to_csv.py")], check=True)
                split_aw_csv()
                results["computer"] = {"status": "done", "message": "Computer use data refreshed successfully."}
            except Exception as e:
                print(f"Error converting/splitting AW data: {e}")
                results["computer"] = {"status": "error", "message": f"Conversion/split error: {e}"}
        else:
            results["computer"] = {"status": "error", "message": "Failed to pull ActivityWatch data dump."}
    else:
        results["computer"] = {"status": "skipped", "message": "Skipped."}
        
    # 2. iPhone Refresh
    if refresh_iphone:
        print("Pulling iPhone screentime data...")
        success_iphone = pull_iphone_data()
        if success_iphone:
            print("Converting and splitting iPhone screentime data...")
            try:
                subprocess.run([sys.executable, os.path.join(dir_path, "convert_iphone_to_csv.py")], check=True)
                split_iphone_csv()
                results["iphone"] = {"status": "done", "message": "iPhone usage data refreshed successfully."}
            except Exception as e:
                print(f"Error converting/splitting iPhone data: {e}")
                results["iphone"] = {"status": "error", "message": f"Conversion/split error: {e}"}
        else:
            results["iphone"] = {"status": "error", "message": "Failed to sync iPhone database file."}
    else:
        results["iphone"] = {"status": "skipped", "message": "Skipped."}
        
    # Reload server data if at least one was done and succeeded
    if (refresh_computer and results["computer"]["status"] == "done") or \
       (refresh_iphone and results["iphone"]["status"] == "done"):
        print("Reloading in-memory server data cache...")
        load_and_process_data()
        
    print("--- REFRESH DATA PIPELINE COMPLETED ---")
    return results

# Load and process data
def load_and_process_data():
    global daily_summary, daily_details, latest_date
    
    # Reset in-memory storage
    daily_summary = {}
    daily_details = {}
    latest_date = None
    
    # Check if data_timeline is empty, and bootstrap if so
    if not os.path.exists(TIMELINE_DIR) or not os.listdir(TIMELINE_DIR):
        print("data_timeline is empty. Attempting to bootstrap from export.json and iphone_screentime.json...")
        bootstrap_data_timeline()
        
    if not os.path.exists(TIMELINE_DIR):
        print("ERROR: data_timeline directory not found.")
        return
        
    print(f"Scanning data_timeline: {TIMELINE_DIR}...")
    start_time = time.time()
    
    # Find all day folders
    day_folders = []
    for name in os.listdir(TIMELINE_DIR):
        path = os.path.join(TIMELINE_DIR, name)
        if os.path.isdir(path):
            day_folders.append((name, path))
            
    # Sort folders chronologically
    def parse_folder_name(name):
        try:
            return datetime.strptime(name, "%Y-%b-%d")
        except ValueError:
            return datetime.min
            
    day_folders.sort(key=lambda x: parse_folder_name(x[0]))
    
    local_tz = datetime.now().astimezone().tzinfo
    
    for folder_name, folder_path in day_folders:
        try:
            dt = datetime.strptime(folder_name, "%Y-%b-%d")
            date_str = dt.strftime("%Y-%m-%d")
        except ValueError:
            print(f"Skipping folder with invalid format: {folder_name}")
            continue
            
        print(f"Processing day: {folder_name} ({date_str})...")
        
        # Load ActivityWatch CSV for this day
        aw_events = []
        aw_csv_path1 = os.path.join(folder_path, f"{folder_name}-acitivty_watch_data.csv")
        aw_csv_path2 = os.path.join(folder_path, f"{folder_name}-activity_watch_data.csv")
        aw_csv_path = aw_csv_path1 if os.path.exists(aw_csv_path1) else aw_csv_path2
        
        if os.path.exists(aw_csv_path):
            import csv
            with open(aw_csv_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    raw_event = row.get("raw_event_data")
                    data_dict = json.loads(raw_event) if raw_event else {}
                    aw_events.append({
                        "bucket_id": row.get("bucket_id", ""),
                        "bucket_type": row.get("bucket_type", ""),
                        "bucket_hostname": row.get("bucket_hostname", ""),
                        "timestamp": row.get("event_timestamp", ""),
                        "duration": float(row.get("event_duration", 0.0)),
                        "data": data_dict
                    })
                    
        # Group by host and bucket type, just like in original code
        hosts = {}
        for e in aw_events:
            hostname = e.get("bucket_hostname", "unknown")
            if hostname not in hosts:
                hosts[hostname] = {"afk": [], "window": [], "web": []}
            
            btype = e.get("bucket_type")
            event_obj = {
                "timestamp": e["timestamp"],
                "duration": e["duration"],
                "data": e["data"]
            }
            if btype == "afkstatus":
                hosts[hostname]["afk"].append(event_obj)
            elif btype == "currentwindow":
                hosts[hostname]["window"].append(event_obj)
            elif btype == "web.tab.current":
                hosts[hostname]["web"].append(event_obj)
                
        # Now run the same intersection algorithm for this day's hosts
        timeline_events = []
        for host, data_store in hosts.items():
            afk_events = sorted(data_store["afk"], key=lambda x: x["timestamp"])
            window_events = sorted(data_store["window"], key=lambda x: x["timestamp"])
            web_events = sorted(data_store["web"], key=lambda x: x["timestamp"])
            
            # Pre-parse AFK events into local time active spans
            not_afk_spans = []
            for e in afk_events:
                if e.get("data", {}).get("status") == "not-afk":
                    s_utc = parse_iso(e["timestamp"])
                    s_local = s_utc.astimezone(local_tz)
                    d = e.get("duration", 0)
                    not_afk_spans.append((s_local, s_local + timedelta(seconds=d)))
                    
            if not afk_events:
                # Fallback: treat window events as active
                for w in window_events:
                    s_utc = parse_iso(w["timestamp"])
                    s_local = s_utc.astimezone(local_tz)
                    d = w.get("duration", 0)
                    not_afk_spans.append((s_local, s_local + timedelta(seconds=d)))
                    
            # Pre-parse web events
            parsed_web = []
            for wb in web_events:
                s_utc = parse_iso(wb["timestamp"])
                s_local = s_utc.astimezone(local_tz)
                d = wb.get("duration", 0)
                parsed_web.append((s_local, s_local + timedelta(seconds=d), wb.get("data", {})))
                
            # Pre-parse window events
            parsed_windows = []
            for w in window_events:
                s_utc = parse_iso(w["timestamp"])
                s_local = s_utc.astimezone(local_tz)
                d = w.get("duration", 0)
                parsed_windows.append((s_local, s_local + timedelta(seconds=d), w.get("data", {})))
                
            # Two-pointer sweep for intersections
            i = 0 # window index
            j = 0 # afk span index
            web_idx = 0 # web index (sliding window)
            
            while i < len(parsed_windows) and j < len(not_afk_spans):
                w_start, w_end, w_data = parsed_windows[i]
                a_start, a_end = not_afk_spans[j]
                
                overlap_start = max(w_start, a_start)
                overlap_end = min(w_end, a_end)
                
                if overlap_start < overlap_end:
                    overlap_dur = (overlap_end - overlap_start).total_seconds()
                    if overlap_dur > 0.5:
                        url = ""
                        web_title = ""
                        
                        while web_idx < len(parsed_web) and parsed_web[web_idx][1] <= overlap_start:
                            web_idx += 1
                            
                        k = web_idx
                        while k < len(parsed_web) and parsed_web[k][0] < overlap_end:
                            wb_start, wb_end, wb_data = parsed_web[k]
                            if max(overlap_start, wb_start) < min(overlap_end, wb_end):
                                url = wb_data.get("url", "")
                                web_title = wb_data.get("title", "")
                                break
                            k += 1
                            
                        app = w_data.get("app", "Unknown")
                        title = w_data.get("title", "")
                        cat = get_category(app, url, title or web_title)
                        
                        timeline_events.append({
                            "start": overlap_start.isoformat(),
                            "end": overlap_end.isoformat(),
                            "duration": overlap_dur,
                            "app": app,
                            "title": title,
                            "url": url,
                            "web_title": web_title,
                            "category": cat,
                            "color": CATEGORIES.get(cat, {}).get("color", "#64748b"),
                            "host": host
                        })
                
                if w_end < a_end:
                    i += 1
                else:
                    j += 1
                    
        # Sort all events chronologically
        timeline_events.sort(key=lambda x: x["start"])
        
        # Load iPhone CSV for this day
        iphone_timeline_events = []
        iphone_csv_path = os.path.join(folder_path, f"{folder_name}-iphone_usage_data.csv")
        if os.path.exists(iphone_csv_path):
            import csv
            with open(iphone_csv_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    raw_event = row.get("raw_event_data")
                    data_dict = json.loads(raw_event) if raw_event else {}
                    
                    ts_utc = parse_iso(row.get("event_timestamp", ""))
                    ts_local = ts_utc.astimezone(local_tz)
                    dur = float(row.get("event_duration_seconds", 0.0))
                    
                    app_id = data_dict.get("app", "Unknown")
                    app_title = data_dict.get("title")
                    if not app_title:
                        parts = app_id.split('.')
                        app_title = parts[-1] if parts else app_id
                        
                    cat = get_category(app_title, "", app_title)
                    
                    iphone_timeline_events.append({
                        "start": ts_local.isoformat(),
                        "end": (ts_local + timedelta(seconds=dur)).isoformat(),
                        "duration": dur,
                        "app": app_title,
                        "title": app_title,
                        "url": "",
                        "web_title": "",
                        "category": cat,
                        "color": CATEGORIES.get(cat, {}).get("color", "#64748b"),
                        "host": "iPhone"
                    })
                    
        iphone_timeline_events.sort(key=lambda x: x["start"])
        
        # Aggregate totals for this day
        total_dur = sum(e["duration"] for e in timeline_events)
        total_iphone_dur = sum(e["duration"] for e in iphone_timeline_events)
        
        # Combined Category totals
        cat_totals = {}
        for cat_name, conf in CATEGORIES.items():
            cat_totals[cat_name] = {"seconds": 0.0, "color": conf["color"]}
            
        for e in timeline_events:
            cat = e["category"]
            if cat not in cat_totals:
                cat_totals[cat] = {"seconds": 0.0, "color": "#64748b"}
            cat_totals[cat]["seconds"] += e["duration"]
            
        for e in iphone_timeline_events:
            cat = e["category"]
            if cat not in cat_totals:
                cat_totals[cat] = {"seconds": 0.0, "color": "#64748b"}
            cat_totals[cat]["seconds"] += e["duration"]
            
        # Top Apps (Desktop)
        app_durations = {}
        for e in timeline_events:
            app = e["app"]
            cat = e["category"]
            app_durations[app] = app_durations.get(app, {"seconds": 0.0, "category": cat, "color": CATEGORIES.get(cat, {}).get("color", "#64748b")})
            app_durations[app]["seconds"] += e["duration"]
            
        top_apps = sorted(
            [{"app": k, "seconds": v["seconds"], "category": v["category"], "color": v["color"]} for k, v in app_durations.items()],
            key=lambda x: x["seconds"],
            reverse=True
        )[:10]
        
        # Top iOS Apps (iPhone)
        ios_app_durations = {}
        for e in iphone_timeline_events:
            app = e["app"]
            cat = e["category"]
            ios_app_durations[app] = ios_app_durations.get(app, {"seconds": 0.0, "category": cat, "color": CATEGORIES.get(cat, {}).get("color", "#64748b")})
            ios_app_durations[app]["seconds"] += e["duration"]
            
        top_ios_apps = sorted(
            [{"app": k, "seconds": v["seconds"], "category": v["category"], "color": v["color"]} for k, v in ios_app_durations.items()],
            key=lambda x: x["seconds"],
            reverse=True
        )[:10]
        
        # Top Domains (Desktop Web)
        domain_durations = {}
        for e in timeline_events:
            if e["url"]:
                dom = clean_domain(e["url"])
                if dom:
                    domain_durations[dom] = domain_durations.get(dom, 0.0) + e["duration"]
                    
        top_domains = sorted(
            [{"domain": k, "seconds": v} for k, v in domain_durations.items()],
            key=lambda x: x["seconds"],
            reverse=True
        )[:10]
        
        # Summarize summary
        daily_summary[date_str] = {
            "active_seconds": total_dur,
            "iphone_active_seconds": total_iphone_dur,
            "events_count": len(timeline_events) + len(iphone_timeline_events),
            "categories": {k: v["seconds"] for k, v in cat_totals.items()}
        }
        
        # Summarize details
        daily_details[date_str] = {
            "date": date_str,
            "active_seconds": total_dur,
            "iphone_active_seconds": total_iphone_dur,
            "timeline": timeline_events,
            "iphone_timeline": iphone_timeline_events,
            "categories": cat_totals,
            "top_apps": top_apps,
            "top_ios_apps": top_ios_apps,
            "top_domains": top_domains
        }
        
    if daily_summary:
        latest_date = sorted(daily_summary.keys())[-1]
        print(f"Data loading complete! Processed {len(daily_summary)} days.")
        print(f"Latest day: {latest_date} ({daily_summary[latest_date]['active_seconds']/3600.0:.2f}h active / {daily_summary[latest_date].get('iphone_active_seconds', 0)/3600.0:.2f}h iOS)")
    else:
        print("WARNING: No activity data processed from timeline.")
        
    print(f"Total processing time: {time.time() - start_time:.4f}s")


# Custom HTTP Request Handler
class DashboardHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Override to serve files from the 'public' directory
        parsed = urlparse(path)
        path_str = parsed.path
        if path_str == "/":
            path_str = "/index.html"
            
        # Ignore API calls in translation path (they are intercepted in do_GET)
        if path_str.startswith("/api"):
            return super().translate_path(path_str)
            
        public_dir = os.path.join(os.path.dirname(__file__), 'public')
        relative_path = path_str.lstrip('/')
        return os.path.join(public_dir, relative_path)
        
    def do_GET(self):
        parsed_url = urlparse(self.path)
        
        # API: Get Summary list of all days
        if parsed_url.path == "/api/summary":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            response_data = {
                "days": daily_summary,
                "latest_date": latest_date,
                "categories_meta": {k: v["color"] for k, v in CATEGORIES.items()}
            }
            self.wfile.write(json.dumps(response_data).encode("utf-8"))
            return
            
        # API: Get Detailed info for a specific day
        elif parsed_url.path == "/api/day":
            query_params = parse_qs(parsed_url.query)
            date_param = query_params.get("date", [None])[0]
            
            # Default to latest date if not specified
            if not date_param or date_param not in daily_details:
                date_param = latest_date
                
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            if date_param in daily_details:
                self.wfile.write(json.dumps(daily_details[date_param]).encode("utf-8"))
            else:
                self.wfile.write(json.dumps({"error": "No data found for this date", "date": date_param}).encode("utf-8"))
            return
            
        # Fall back to serving static files
        return super().do_GET()

    def do_POST(self):
        parsed_url = urlparse(self.path)
        if parsed_url.path == "/api/refresh":
            print("Received API data refresh request...")
            
            # Read POST body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
            try:
                options = json.loads(post_data.decode('utf-8'))
            except Exception:
                options = {}
                
            refresh_computer = options.get("computer", True)
            refresh_iphone = options.get("iphone", True)
            
            results = refresh_data_pipeline(refresh_computer, refresh_iphone)
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            # Determine overall success
            any_success = False
            requested_any = False
            
            if refresh_computer:
                requested_any = True
                if results.get("computer", {}).get("status") == "done":
                    any_success = True
            if refresh_iphone:
                requested_any = True
                if results.get("iphone", {}).get("status") == "done":
                    any_success = True
                    
            status_str = "success" if (not requested_any or any_success) else "error"
            
            response_data = {
                "status": status_str,
                "results": results
            }
            self.wfile.write(json.dumps(response_data).encode("utf-8"))
            return

        elif parsed_url.path == "/api/save-screenshot":
            print("Received API save screenshot request...")
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
                data = json.loads(post_data.decode('utf-8'))
                image_data_url = data.get("image")
                
                if not image_data_url or not image_data_url.startswith("data:image/"):
                    raise ValueError("Invalid image data URL")
                
                header, encoded = image_data_url.split(",", 1)
                image_bytes = base64.b64decode(encoded)
                
                save_path = os.path.join(os.path.dirname(__file__), 'dashboard_capture.jpg')
                with open(save_path, "wb") as f:
                    f.write(image_bytes)
                
                print(f"Successfully saved dashboard screenshot to {save_path}")
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "path": "dashboard_capture.jpg"}).encode("utf-8"))
                return
            except Exception as e:
                print(f"Error saving screenshot: {e}")
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode("utf-8"))
                return
            
        self.send_error(404, "Not Found")

def run_server():
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, DashboardHandler)
    print(f"\n==============================================")
    print(f"Productivity Dashboard running at:")
    print(f"http://localhost:{PORT}")
    print(f"==============================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()
        sys.exit(0)

if __name__ == "__main__":
    # Pre-process data
    load_and_process_data()
    # Run server
    run_server()
