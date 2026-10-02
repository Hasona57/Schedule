#!/usr/bin/env python3
"""
Nile University PowerCampus Real-Time Schedule Synchronization Engine
Securely authenticates with Nile University PowerCampus Self-Service portal,
fetches the student's enrolled courses, and builds an interactive timetable model.
"""

import sys
import json
import os
import re
import urllib3
import requests
from bs4 import BeautifulSoup
from datetime import datetime

urllib3.disable_warnings()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")
SCHEDULE_PATH = os.path.join(DATA_DIR, "schedule.json")

PORTAL_BASE = "https://register.nu.edu.eg/PowerCampusSelfService"

# Modern, accessible color palette for timetable courses
COURSE_COLORS = [
    "#3b82f6",  # Blue
    "#8b5cf6",  # Purple
    "#10b981",  # Emerald
    "#f59e0b",  # Amber
    "#ec4899",  # Pink
    "#06b6d4",  # Cyan
    "#6366f1",  # Indigo
    "#14b8a6",  # Teal
    "#f97316",  # Orange
    "#84cc16"   # Lime
]

def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"credentials": {}, "notifications": {"leadMinutes": [20]}}

def get_building_name(bldg_raw, floor_id=""):
    raw = str(bldg_raw or "").strip()
    f = str(floor_id or "").upper()
    if "2" in raw or "UB2" in raw or "UB2" in f:
        return "Building 2 (UB2)"
    if "1" in raw or "UB1" in raw or "UB1" in f:
        return "Building 1 (UB1)"
    return raw or "Main Campus"

def get_floor_name(floor_id):
    f = str(floor_id or "").upper().strip()
    if f.startswith("BUB"):
        return f"{f} (Basement)"
    if f.startswith("GUB"):
        return f"{f} (Ground Floor)"
    if f.startswith("FUB"):
        return f"{f} (First Floor)"
    if f.startswith("SUB"):
        return f"{f} (Second Floor)"
    return f or "Ground Floor"

def get_directions(building, floor, room):
    b_short = "Building 2" if "2" in building else "Building 1"
    f_short = floor.split(" (")[0] if " (" in floor else floor
    return f"{b_short} -> {f_short} -> {room}"

def format_time_24h(time_components, fallback_str=""):
    """
    time_components is typically [hour, minute, second] e.g. [12, 30, 0]
    """
    if time_components and len(time_components) >= 2:
        return f"{int(time_components[0]):02d}:{int(time_components[1]):02d}"
    
    # Try parsing fallback string like "10:30 AM" or "2:29 PM"
    if fallback_str:
        try:
            dt = datetime.strptime(fallback_str.strip(), "%I:%M %p")
            return dt.strftime("%H:%M")
        except Exception:
            pass
    return fallback_str or "00:00"

def sync_portal(username=None, password=None, save_to_file=True):
    """
    Authenticates with Nile University PowerCampus and extracts live schedule.
    Credentials are passed in-memory.
    """
    config = load_config()
    creds = config.get("credentials", {})
    
    user = username or creds.get("username")
    pwd = password or creds.get("password")

    if not user or not pwd:
        # If no credentials passed and schedule.json already exists, return current cached data
        if os.path.exists(SCHEDULE_PATH):
            with open(SCHEDULE_PATH, "r", encoding="utf-8") as f:
                cached = json.load(f)
            return {
                "status": "success",
                "message": "Loaded cached schedule (no credentials provided)",
                "data": cached
            }
        return {
            "status": "error",
            "message": "Nile University username and password are required to fetch schedule."
        }

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9"
    })

    try:
        # Step 1: Initialize session on PowerCampus Login page
        login_page_url = f"{PORTAL_BASE}/Home/LogIn"
        init_res = session.get(login_page_url, verify=False, timeout=15)
        if init_res.status_code != 200:
            return {"status": "error", "message": f"Could not reach Nile portal (Status {init_res.status_code})"}

        # Step 2: Check auth mode
        auth_mode_url = f"{PORTAL_BASE}/SignIn/GetAuthenticationMode"
        session.post(auth_mode_url, json={"username": user}, headers={"Content-Type": "application/json"}, verify=False, timeout=10)

        # Step 3: Authenticate student credentials
        auth_url = f"{PORTAL_BASE}/SignIn/Authenticate"
        auth_payload = {"username": user, "password": pwd}
        auth_res = session.post(
            auth_url,
            json=auth_payload,
            headers={
                "Content-Type": "application/json",
                "Referer": login_page_url
            },
            verify=False,
            timeout=15
        )

        auth_json = {}
        try:
            auth_json = json.loads(auth_res.text)
            if isinstance(auth_json, str):
                auth_json = json.loads(auth_json)
        except Exception:
            pass

        auth_data = auth_json.get("data", {})
        if not auth_data.get("success"):
            return {
                "status": "error",
                "message": "Invalid Nile University username or password. Please verify your credentials."
            }

        # Step 4: Access Schedule Page to extract personId
        sched_url = f"{PORTAL_BASE}/Registration/Schedule"
        sched_page = session.get(sched_url, verify=False, timeout=15)
        soup = BeautifulSoup(sched_page.text, "html.parser")
        
        person_id_el = soup.find("input", id="hdnPersonId")
        if not person_id_el or not person_id_el.get("value"):
            return {
                "status": "error",
                "message": "Could not locate student profile ID from PowerCampus portal."
            }
        person_id = person_id_el.get("value").strip()

        # Step 5: Query Periods to identify active term (e.g. 2026/FALL)
        periods_url = f"{PORTAL_BASE}/Periods/StudentSchedule/{person_id}"
        periods_res = session.get(
            periods_url,
            headers={
                "Content-Type": "application/json",
                "Referer": sched_url
            },
            verify=False,
            timeout=15
        )

        target_year = "2026"
        target_term = "FALL"
        target_session = ""
        term_desc = "Fall 2026"

        try:
            pjson = json.loads(periods_res.text)
            if isinstance(pjson, str):
                pjson = json.loads(pjson)
            period_list = pjson.get("data", []) if isinstance(pjson, dict) else pjson
            if period_list and len(period_list) > 0:
                p_item = period_list[0]
                pval = p_item.get("value", "")
                term_desc = p_item.get("description", term_desc)
                parts = pval.split("/")
                if len(parts) >= 1: target_year = parts[0]
                if len(parts) >= 2: target_term = parts[1]
                if len(parts) >= 3: target_session = parts[2]
        except Exception:
            pass

        # Step 6: Fetch Live Schedule via POST /Schedule/Student
        student_sched_url = f"{PORTAL_BASE}/Schedule/Student"
        sched_post_payload = {
            "personId": person_id,
            "yearTermSession": {
                "year": target_year,
                "term": target_term,
                "session": target_session
            }
        }

        sched_data_res = session.post(
            student_sched_url,
            json=sched_post_payload,
            headers={
                "Content-Type": "application/json",
                "Referer": sched_url
            },
            verify=False,
            timeout=20
        )

        sched_json = json.loads(sched_data_res.text)
        if isinstance(sched_json, str):
            sched_json = json.loads(sched_json)

        data = sched_json.get("data", {})
        schedule_blocks = data.get("schedule", [])
        if not schedule_blocks:
            return {"status": "error", "message": "No registered courses found for current term."}

        # Step 7: Parse courses and timetable sessions
        sections_groups = schedule_blocks[0].get("sections", [])
        # Group 3 is typically registered courses, but let's inspect all non-empty groups
        all_sections = []
        for grp in sections_groups:
            if isinstance(grp, list):
                all_sections.extend(grp)

        courses_map = {}
        day_names_map = {0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday"}

        min_start_date = "09/20/2026"
        max_end_date = "12/31/2026"

        color_index = 0
        for sec in all_sections:
            event_id = sec.get("eventId") or sec.get("id") or "CLASS"
            event_name = sec.get("eventName") or sec.get("description") or event_id
            event_type = sec.get("eventSubType") or sec.get("eventType") or "Class"
            section_num = sec.get("section") or "01"
            credits_val = 0
            try:
                credits_val = int(float(sec.get("credits", 0)))
            except Exception:
                pass

            # Nile University PowerCampus portal API often returns 0 credits.
            # Use a known credit-hour table as fallback for standard NU courses.
            KNOWN_CREDITS = {
                "CSC111": 3, "CSC112": 3, "CSC211": 3, "CSC212": 3,
                "ECE151": 3, "ECE152": 3, "ECE251": 3,
                "MTH111": 3, "MTH112": 3, "MTH211": 3, "MTH212": 3,
                "PHY111": 3, "PHY112": 3,
                "MEC111": 3, "MEC112": 3,
                "INT111": 3, "INT112": 3,
                "ENGL001": 0, "ENGL002": 0, "ENGL003": 0,
                "CHM111": 3, "BIO111": 3,
                "CEN111": 3, "CEN112": 3,
                "EEE111": 3, "EEE112": 3,
                "CIV111": 3, "CIV112": 3,
                "MEE111": 3, "MEE112": 3,
                "ARC111": 3, "ARC112": 3,
            }
            if credits_val == 0:
                credits_val = KNOWN_CREDITS.get(event_id, 3)

            if sec.get("startDate"):
                min_start_date = sec.get("startDate")
            if sec.get("endDate"):
                max_end_date = sec.get("endDate")

            # Extract instructor full name
            instructor_name = "Unassigned"
            instructors_list = sec.get("instructors", [])
            if instructors_list and len(instructors_list) > 0:
                instructor_name = instructors_list[0].get("fullName") or instructor_name

            if event_id not in courses_map:
                courses_map[event_id] = {
                    "code": event_id,
                    "title": event_name,
                    "credits": credits_val,
                    "color": COURSE_COLORS[color_index % len(COURSE_COLORS)],
                    "sessions": []
                }
                color_index += 1

            schedules_list = sec.get("schedules", [])
            for sch in schedules_list:
                scheduled_days = sch.get("scheduledDays", [])
                start_24 = format_time_24h(sch.get("scheduledStartTime"), sch.get("startTime", ""))
                end_24 = format_time_24h(sch.get("scheduledEndTime"), sch.get("endTime", ""))
                
                raw_room = sch.get("roomId", "TBA")
                room_display = f"Room {raw_room}" if not raw_room.lower().startswith("room") else raw_room
                floor_id = sch.get("floorId", "")
                floor_display = get_floor_name(floor_id)
                bldg_display = get_building_name(sch.get("bldgName"), floor_id)
                directions = get_directions(bldg_display, floor_display, room_display)

                for day_idx in scheduled_days:
                    session_obj = {
                        "id": f"{event_id}-{event_type[:3].upper()}-{section_num}",
                        "type": event_type,
                        "section": section_num,
                        "day": day_names_map.get(day_idx, "Sunday"),
                        "dayIndex": day_idx,
                        "startTime": start_24,
                        "endTime": end_24,
                        "room": room_display,
                        "floor": floor_display,
                        "building": bldg_display,
                        "instructor": instructor_name,
                        "directions": directions
                    }
                    courses_map[event_id]["sessions"].append(session_obj)

        courses_list = list(courses_map.values())
        courses_list.sort(key=lambda c: c["code"])

        # Retain student profile metadata or enrich it
        existing_profile = {}
        if os.path.exists(SCHEDULE_PATH):
            try:
                with open(SCHEDULE_PATH, "r", encoding="utf-8") as f:
                    old_data = json.load(f)
                    existing_profile = old_data.get("student", {})
            except Exception:
                pass

        program = existing_profile.get("program", "Undergraduate Studies")
        advisor = existing_profile.get("advisor", "Academic Advisor")

        term_dates_str = f"{min_start_date} - {max_end_date}"

        final_schedule = {
            "student": {
                "username": user,
                "personId": person_id,
                "program": program,
                "advisor": advisor,
                "term": term_desc,
                "termDates": term_dates_str,
                "startDate": min_start_date,
                "endDate": max_end_date
            },
            "courses": courses_list,
            "lastSynced": datetime.now().isoformat()
        }

        if save_to_file:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(SCHEDULE_PATH, "w", encoding="utf-8") as f:
                json.dump(final_schedule, f, indent=2)

        return {
            "status": "success",
            "message": f"Successfully synchronized {len(courses_list)} courses from Nile University PowerCampus!",
            "lastSynced": final_schedule["lastSynced"],
            "student": final_schedule["student"],
            "coursesCount": len(courses_list),
            "data": final_schedule
        }

    except Exception as err:
        return {
            "status": "error",
            "message": f"Synchronization error: {str(err)}"
        }

if __name__ == "__main__":
    # Support credentials passed via CLI flags or stdin JSON
    username = None
    password = None

    if len(sys.argv) >= 3:
        username = sys.argv[1]
        password = sys.argv[2]
    elif not sys.stdin.isatty():
        try:
            stdin_data = sys.stdin.read().strip()
            if stdin_data:
                payload = json.loads(stdin_data)
                username = payload.get("username")
                password = payload.get("password")
        except Exception:
            pass

    result = sync_portal(username=username, password=password)
    # Output solely the JSON response
    print(json.dumps(result))
