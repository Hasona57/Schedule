# 🏛️ Nile University Smart Timetable & Live Campus Navigator

An open-source, high-performance web application, PWA, and calendar automation engine built for **Nile University (NU)** students.

Students can enter their PowerCampus credentials to instantly retrieve their real-time timetable, view classroom locations with turn-by-turn building directions, export a **full-semester repetitive calendar with smart 20-minute and 15-minute alarms**, and get live countdowns to their next class.

---

## 🔒 Security & Privacy Architecture

Handling university student credentials safely is our highest priority:

1. **Direct Encrypted Transport**:
   All portal interactions communicate directly with Nile University's official PowerCampus Self-Service (`https://register.nu.edu.eg`) over encrypted HTTPS.
2. **In-Memory Credential Processing**:
   Student passwords are used **strictly in-memory** during the sync handshake to retrieve registered courses and classroom data. Passwords are **never written to disk**, never logged to console/files, and never transmitted to any third-party server.
3. **Public GitHub Safe**:
   The repository includes strict `.gitignore` rules and sanitized configuration templates (`data/config.example.json`). No personal accounts, passwords, or session tokens are ever tracked in git.
4. **Manual Import Fallback**:
   Students who prefer not to enter their password can use the **"Manual Schedule Import"** tab to paste their schedule JSON directly.

---

## 🌟 Key Features

### 1. 🔄 Real-Time PowerCampus Synchronization
- **One-Click Live Sync**: Enter your Nile University student username and password in the **"Student Login / Sync"** modal.
- The synchronization engine securely logs into PowerCampus, identifies your active semester (e.g. *2026/Fall*), fetches all registered lectures, labs, and tutorials, and automatically builds an interactive timetable.
- If classrooms or instructors are reassigned during the semester, click **"Sync Portal"** to pull the latest changes instantly.

### 2. 📅 Repetitive Semester Calendar (.ics & Live WebCal)
- **True Semester Recurrence (RRULE)**: Classes repeat weekly on their scheduled days through the end of the semester (**September 20, 2026 – December 31, 2026**).
- **Standard Cairo Timezone (RFC 5545 `Africa/Cairo`)**: Includes standard VTIMEZONE daylight-saving definitions so Apple Calendar, Google Calendar, and Microsoft Outlook place every class accurately without time shifts.
- **Dual Embedded System Alarms**:
  - 🔔 **First Alarm (-20 Minutes)**: Notice to pack your items and walk across campus.
  - ⏰ **Second Alarm (-15 Minutes)**: Urgent notification to take your seat in the lecture hall or lab.
  - Alarms trigger natively on iOS, Android, macOS, and Windows even when your phone is locked or asleep!
- **Live Auto-Updating Subscription (WebCal)**:
  Copy the `webcal://` subscription URL into Apple Calendar or Outlook. Any classroom room changes synced to the server update automatically on your phone without needing to re-download the file.

### 3. 🧭 "Where to Go Now" Campus Navigator
- Real-time countdown widget (hours, minutes, seconds) to your next class.
- Highlights classes currently in session and displays remaining minutes.
- Step-by-step building directions (e.g. *Building 1 ➔ Ground Floor ➔ Room 116* or *Building 2 ➔ 1st Floor ➔ Room F46*).

### 4. 🏛️ Complete Nile University Academic Calendar Reference
- Built-in view of Nile University's academic milestones for the 2026/2027 academic year:
  - **First Day of Classes**: Sunday, September 20, 2026
  - **Drop & Add Period**: Sept 20 – Sept 28, 2026
  - **Midterm Examination Period**: Nov 01 – Nov 08, 2026
  - **Course Withdrawal Deadline ('W')**: Thursday, Dec 03, 2026
  - **Last Day of Classes**: Thursday, Dec 31, 2026
  - **Final Exams**: Jan 03 – Jan 17, 2027
  - **Spring 2027 Term Begins**: Sunday, Feb 07, 2027

### 5. 📱 Multi-Device PWA & Sound Notifications
- Installable on iPhone, iPad, Android, macOS, and Windows as a standalone Progressive Web App.
- High-fidelity Web Audio API acoustic chime and mobile haptic vibration alerts.
- Real-time 20-minute web alarms with live on-screen room directions, audio chime, and mobile vibration.

---

## 🚀 Quick Start & Installation

### 1-Click Launch (Windows)
Simply double-click [`start.bat`](start.bat)!
It automatically:
1. Verifies **Node.js** and **Python** installations.
2. Automatically downloads and installs any missing dependencies (`requests`, `beautifulsoup4`, `urllib3`).
3. Launches the local server and automatically opens `http://localhost:3000/` in your default web browser.

### Manual Setup (macOS / Linux / Windows)
```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Start the server
node server.js
```

3. **Open the application**:
   Navigate to:
   ```
   http://localhost:3000
   ```

4. **Access from your phone**:
   - Ensure your phone is connected to the same Wi-Fi network as your laptop.
   - Run `ipconfig` (Windows) or `ifconfig` (Mac/Linux) to find your local IP address (e.g. `192.168.1.50`).
   - Open `http://192.168.1.50:3000` in Safari or Chrome on your phone.
   - Tap **"Add to Home Screen"** to install the PWA!

---

## 🛠️ Project Structure

```
├── data/
│   ├── config.example.json   # Template configuration file (safe for git)
│   ├── schedule.json         # Active student schedule & classroom catalog
│   └── config.json           # Local runtime settings (ignored by git)
├── public/
│   ├── index.html            # Single-page interface & accessible modals
│   ├── app.css               # Modern glassmorphism UI & responsive styling
│   ├── app.js                # Timetable rendering, countdown & modal logic
│   ├── sw.js                 # PWA service worker offline caching
│   ├── manifest.json         # PWA web manifest
│   ├── icon-192.png          # App icon (192x192)
│   └── icon-512.png          # App icon (512x512)
├── sync_portal.py            # Secure Nile PowerCampus scraper & sync engine
├── server.js                 # Node.js backend, ICS calendar generator & SSE
├── package.json              # Project scripts & metadata
├── start.bat                 # 1-Click launcher for Windows
├── .gitignore                # Protection against leaking secrets or private data
└── README.md                 # Documentation & user guide
```

---

## 📄 License & Disclaimer

This project is an open-source student utility created by and for Nile University students. It is independent and not officially affiliated with Ellucian or Nile University administration. Always verify critical graduation and exam requirements on the official portal.

Distributed under the **MIT License**.
