const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const security = require('./security');
const portManager = require('./port-manager');

// Catch any unhandled errors to keep server running permanently
process.on('uncaughtException', (err) => {
    console.error('[Server UncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[Server UnhandledRejection]', reason);
});

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure base directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// --- ANTI-BRUTE-FORCE & RATE LIMITER (BLOCK HACKER ATTACKS) ---
const failedLoginAttempts = new Map(); // IP -> { count, firstAttempt }

function isIpRateLimited(ip) {
    const record = failedLoginAttempts.get(ip);
    if (!record) return false;
    const now = Date.now();
    // Reset counter after 15 minutes
    if (now - record.firstAttempt > 15 * 60 * 1000) {
        failedLoginAttempts.delete(ip);
        return false;
    }
    return record.count >= 5;
}

function recordFailedLogin(ip) {
    const now = Date.now();
    const record = failedLoginAttempts.get(ip) || { count: 0, firstAttempt: now };
    record.count += 1;
    failedLoginAttempts.set(ip, record);
}

function clearFailedLogin(ip) {
    failedLoginAttempts.delete(ip);
}

// --- SESSION STORAGE (MAP: token -> { username, createdAt, lastUsed }) ---
function getSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[Error reading sessions]', e);
    }
    return {};
}

function saveSessions(sessions) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

function createSession(username) {
    const sessions = getSessions();
    const token = security.generateSessionToken();
    const cleanUser = security.sanitizeUsername(username);
    sessions[token] = {
        username: cleanUser,
        originalUsername: username,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString()
    };
    saveSessions(sessions);
    return token;
}

function destroySession(token) {
    if (!token) return;
    const sessions = getSessions();
    if (sessions[token]) {
        delete sessions[token];
        saveSessions(sessions);
    }
}

// --- PER-STUDENT USER DATA STORAGE ---
function getUserDir(username) {
    const clean = security.sanitizeUsername(username);
    const userDir = path.join(USERS_DIR, clean);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    return userDir;
}

function getStudentProfile(username) {
    const userDir = getUserDir(username);
    const profileFile = path.join(userDir, 'profile.json');
    if (fs.existsSync(profileFile)) {
        try {
            return JSON.parse(fs.readFileSync(profileFile, 'utf8'));
        } catch (e) {}
    }
    return {
        username: username,
        notifications: {
            enabled: true,
            leadMinutes: [20],
            soundEnabled: true,
            vibrateEnabled: true
        },
        registeredAt: new Date().toISOString()
    };
}

function saveStudentProfile(username, profile) {
    const userDir = getUserDir(username);
    const profileFile = path.join(userDir, 'profile.json');
    fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2), 'utf8');
}

function getStudentSchedule(username) {
    if (!username || username === 'default') {
        return {
            student: null,
            courses: []
        };
    }
    const userDir = getUserDir(username);
    const schedFile = path.join(userDir, 'schedule.json');
    if (fs.existsSync(schedFile)) {
        try {
            return JSON.parse(fs.readFileSync(schedFile, 'utf8'));
        } catch (e) {}
    }
    return {
        student: {
            username: username || 'Student',
            program: 'Engineering - Undergraduate',
            advisor: 'Academic Advisor',
            term: 'Fall 2026',
            termDates: '09/20/2026 - 12/31/2026',
            startDate: '09/20/2026',
            endDate: '12/31/2026'
        },
        courses: []
    };
}

function saveStudentSchedule(username, schedule) {
    const userDir = getUserDir(username);
    const schedFile = path.join(userDir, 'schedule.json');
    fs.writeFileSync(schedFile, JSON.stringify(schedule, null, 2), 'utf8');
}

function getStudentChanges(username) {
    const userDir = getUserDir(username);
    const changesFile = path.join(userDir, 'changes.json');
    if (fs.existsSync(changesFile)) {
        try {
            return JSON.parse(fs.readFileSync(changesFile, 'utf8'));
        } catch (e) {}
    }
    return [];
}

function recordStudentChange(username, changeItem) {
    const userDir = getUserDir(username);
    const changesFile = path.join(userDir, 'changes.json');
    const existing = getStudentChanges(username);

    // Never record duplicate change messages
    const isDuplicate = existing.some(e => e.message === changeItem.message);
    if (isDuplicate) return;

    existing.unshift({
        ...changeItem,
        timestamp: new Date().toISOString()
    });
    const trimmed = existing.slice(0, 50);
    fs.writeFileSync(changesFile, JSON.stringify(trimmed, null, 2), 'utf8');
}

// Extract authenticated student from request cookies, Authorization header, or URL token
function getAuthenticatedStudent(req) {
    const sessions = getSessions();
    let token = null;

    // 1. From Cookie: nu_session=...
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        const matches = cookieHeader.match(/nu_session=([a-f0-9]{64})/i);
        if (matches) token = matches[1];
    }

    // 2. From Authorization header: Bearer <token>
    if (!token && req.headers.authorization) {
        const authParts = req.headers.authorization.split(' ');
        if (authParts.length === 2 && authParts[0].toLowerCase() === 'bearer') {
            token = authParts[1].trim();
        }
    }

    // 3. From URL query parameter: ?token=... (For calendar feeds)
    if (!token && req.url) {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const qToken = urlObj.searchParams.get('token');
        if (qToken && qToken.length === 64) token = qToken;
    }

    if (token && sessions[token]) {
        sessions[token].lastUsed = new Date().toISOString();
        saveSessions(sessions);
        const username = sessions[token].username;
        return {
            token,
            username: sessions[token].originalUsername || username,
            cleanUsername: username,
            profile: getStudentProfile(username),
            schedule: getStudentSchedule(username)
        };
    }

    return null;
}

// Sent alert cache: key = "student:YYYY-MM-DD:session_id:leadMinutes"
const sentAlerts = new Set();
const sseClients = new Set();

function broadcastSSE(type, payload, targetUsername = null) {
    const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
        if (!targetUsername || client.username === targetUsername) {
            try {
                client.res.write(data);
            } catch (e) {
                sseClients.delete(client);
            }
        }
    }
}

// Background scheduler tick for web class alarms (20m before class)
async function checkUpcomingClasses() {
    if (!fs.existsSync(USERS_DIR)) return;
    const userDirs = fs.readdirSync(USERS_DIR);

    const now = new Date();
    const dayOfWeek = now.getDay();
    const dateStr = now.toISOString().split('T')[0];
    const currentMinsFromMidnight = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

    for (const u of userDirs) {
        const profile = getStudentProfile(u);
        const config = profile.notifications || {};
        if (config.enabled === false) continue;

        const schedule = getStudentSchedule(u);
        const leadMinutesList = config.leadMinutes || [20];

        for (const course of schedule.courses || []) {
            for (const session of course.sessions || []) {
                if (session.dayIndex === dayOfWeek) {
                    const [startH, startM] = session.startTime.split(':').map(Number);
                    const classStartMins = startH * 60 + startM;
                    const diffMins = classStartMins - currentMinsFromMidnight;

                    for (const lead of leadMinutesList) {
                        const alertKey = `${u}:${dateStr}:${session.id}:${lead}`;
                        if (diffMins <= lead && diffMins > lead - 1.2 && !sentAlerts.has(alertKey)) {
                            sentAlerts.add(alertKey);

                            const alertPayload = {
                                courseCode: course.code,
                                courseTitle: course.title,
                                type: session.type,
                                section: session.section,
                                room: session.room,
                                floor: session.floor,
                                building: session.building,
                                instructor: session.instructor,
                                startTime: session.startTime,
                                endTime: session.endTime,
                                leadMinutes: lead,
                                directions: session.directions,
                                timestamp: new Date().toISOString()
                            };

                            console.log(`[WEB ALERT] ${lead} min web reminder for ${course.code} to student ${u}`);

                            broadcastSSE('class-reminder', alertPayload, u);
                        }
                    }
                }
            }
        }
    }
}

setInterval(checkUpcomingClasses, 25000);

/**
 * Execute Python sync worker safely via stdin piping.
 * Credentials are NEVER exposed as command-line arguments.
 */
function executeSyncWorker(username, password) {
    return new Promise((resolve) => {
        const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
        let worker;
        try {
            worker = spawn(pythonBin, ['sync_portal.py'], { cwd: __dirname });
        } catch (spawnErr) {
            console.error('[Sync Worker Spawn Error]', spawnErr.message);
            return resolve({ status: 'error', message: spawnErr.message });
        }

        let stdoutData = '';
        let stderrData = '';

        worker.on('error', (err) => {
            console.error('[Sync Worker Process Error]', err.message);
            resolve({ status: 'error', message: err.message });
        });

        worker.stdout.on('data', chunk => { stdoutData += chunk; });
        worker.stderr.on('data', chunk => { stderrData += chunk; });

        worker.on('close', code => {
            if (code !== 0) {
                console.error('[Sync Worker Error]', stderrData);
                return resolve({ status: 'error', message: stderrData || `Sync worker exited with code ${code}` });
            }
            try {
                const lines = stdoutData.trim().split('\n');
                const lastLine = lines[lines.length - 1];
                const parsed = JSON.parse(lastLine);
                resolve(parsed);
            } catch (err) {
                console.error('[Sync Worker Parse Error]', stdoutData);
                resolve({ status: 'success', raw: stdoutData });
            }
        });

        try {
            // Send credentials safely via stdin
            worker.stdin.write(JSON.stringify({ username, password }));
            worker.stdin.end();
        } catch (writeErr) {
            console.error('[Sync Worker Stdin Error]', writeErr.message);
        }
    });
}

function detectScheduleChanges(oldSched, newSched) {
    const changes = [];
    if (!oldSched || !newSched || !oldSched.courses || !newSched.courses) return changes;

    // Courses like ENGL002 have multiple legitimate lectures each week on different days,
    // at different times, in different rooms. Each day's lecture is distinct and must not
    // be compared against a different day's lecture.
    const buildSessionList = (sched) => {
        const list = [];
        const counters = {};
        for (const c of sched.courses || []) {
            for (const s of c.sessions || []) {
                const day = s.dayIndex !== undefined ? s.dayIndex : (s.day || '0');
                const sec = s.section || '0';
                const baseKey = `${c.code}_${s.type}_day${day}_sec${sec}`;
                counters[baseKey] = (counters[baseKey] || 0) + 1;
                const uniqueKey = `${baseKey}_slot${counters[baseKey]}`;
                list.push({ key: uniqueKey, session: s, course: c });
            }
        }
        return list;
    };

    const oldList = buildSessionList(oldSched);
    const newList = buildSessionList(newSched);

    const oldMap = {};
    for (const item of oldList) {
        oldMap[item.key] = item;
    }

    for (const item of newList) {
        const old = oldMap[item.key];
        if (old) {
            const s = item.session;
            const os = old.session;
            const c = item.course;
            const dayName = s.day || `Day ${s.dayIndex}`;

            if (os.room && s.room && os.room.trim() !== s.room.trim()) {
                changes.push({
                    type: 'room_changed',
                    courseCode: c.code,
                    sessionType: s.type,
                    day: dayName,
                    message: `${c.code} (${s.type} on ${dayName}) moved from ${os.room} to ${s.room} (${s.building || ''})`
                });
            }
            if (os.startTime && s.startTime && (os.startTime !== s.startTime || os.endTime !== s.endTime)) {
                changes.push({
                    type: 'time_changed',
                    courseCode: c.code,
                    sessionType: s.type,
                    day: dayName,
                    message: `${c.code} (${s.type} on ${dayName}) time rescheduled from ${os.startTime} to ${s.startTime}`
                });
            }
        }
    }
    return changes;
}

/**
 * 1-MINUTE LIVE AUTOMATED VERIFICATION ENGINE
 * Checks Nile University schedule and system status every 1 minute
 * to guarantee timetable accuracy and prompt change detection.
 */
let isCheckingNow = false;

async function performMinuteVerificationCheck() {
    if (isCheckingNow) return;
    isCheckingNow = true;

    try {
        if (!fs.existsSync(USERS_DIR)) return;
        const userDirs = fs.readdirSync(USERS_DIR);

        for (const u of userDirs) {
            try {
                const profile = getStudentProfile(u);
                if (!profile.encryptedPassword) {
                    continue;
                }

                const decryptedPassword = security.decrypt(profile.encryptedPassword);
                if (!decryptedPassword) continue;

                const existingSchedule = getStudentSchedule(u);
                const syncResult = await executeSyncWorker(profile.username || u, decryptedPassword);

                if (syncResult.status === 'success' && syncResult.data) {
                    const newSchedule = syncResult.data;
                    const diffs = detectScheduleChanges(existingSchedule, newSchedule);

                    profile.lastCheckedAt = new Date().toISOString();
                    profile.lastSyncedAt = syncResult.lastSynced || profile.lastCheckedAt;
                    saveStudentProfile(u, profile);
                    saveStudentSchedule(u, newSchedule);

                    if (diffs.length > 0) {
                        console.log(`[1-Min Check] ⚠️ Changes detected for student ${u}:`, diffs);
                        for (const diff of diffs) {
                            recordStudentChange(u, diff);
                        }

                        broadcastSSE('schedule-change-alert', {
                            changes: diffs,
                            timestamp: new Date().toISOString()
                        }, u);
                    } else {
                        // verified successfully
                    }
                }
            } catch (err) {
                console.error(`[1-Min Check] Error checking student ${u}:`, err.message);
            }
        }
    } finally {
        isCheckingNow = false;
    }
}

// Start 1-minute automated schedule verification loop
console.log(`⚡ Live 1-minute automated schedule verification active`);
setInterval(performMinuteVerificationCheck, 60 * 1000);
setTimeout(performMinuteVerificationCheck, 5000);

// Generate RFC 5545 iCalendar with full-semester repetition and dual 20m & 15m alarms
function generateICS(schedule) {
    const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    let semStart = new Date('2026-09-20T00:00:00Z');
    let semEnd = new Date('2026-12-31T23:59:59Z');

    const studentInfo = schedule.student || {};
    if (studentInfo.startDate) {
        const parsedStart = new Date(studentInfo.startDate);
        if (!isNaN(parsedStart.getTime())) semStart = parsedStart;
    }
    if (studentInfo.endDate) {
        const parsedEnd = new Date(studentInfo.endDate);
        if (!isNaN(parsedEnd.getTime())) {
            parsedEnd.setUTCHours(23, 59, 59, 0);
            semEnd = parsedEnd;
        }
    }

    const untilStr = `${semEnd.getUTCFullYear()}${String(semEnd.getUTCMonth() + 1).padStart(2, '0')}${String(semEnd.getUTCDate()).padStart(2, '0')}T235959Z`;

    let ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Nile University//Student Schedule Visualizer//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:NU Schedule - ${studentInfo.term || 'Fall 2026'}`,
        'X-WR-TIMEZONE:Africa/Cairo',
        'BEGIN:VTIMEZONE',
        'TZID:Africa/Cairo',
        'X-LIC-LOCATION:Africa/Cairo',
        'BEGIN:STANDARD',
        'TZOFFSETFROM:+0300',
        'TZOFFSETTO:+0200',
        'TZNAME:EET',
        'DTSTART:19701030T000000',
        'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1TH',
        'END:STANDARD',
        'BEGIN:DAYLIGHT',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0300',
        'TZNAME:EEST',
        'DTSTART:19700424T000000',
        'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=-1FR',
        'END:DAYLIGHT',
        'END:VTIMEZONE'
    ];

    for (const course of schedule.courses || []) {
        for (const session of course.sessions || []) {
            const targetDay = session.dayIndex;
            const firstEventDate = new Date(semStart);
            const currentDay = firstEventDate.getUTCDay();
            const dayDiff = (targetDay - currentDay + 7) % 7;
            firstEventDate.setUTCDate(firstEventDate.getUTCDate() + dayDiff);

            const [sh, sm] = session.startTime.split(':').map(Number);
            const [eh, em] = session.endTime.split(':').map(Number);

            const yStr = firstEventDate.getUTCFullYear();
            const mStr = String(firstEventDate.getUTCMonth() + 1).padStart(2, '0');
            const dStr = String(firstEventDate.getUTCDate()).padStart(2, '0');

            const dtStartStr = `${yStr}${mStr}${dStr}T${String(sh).padStart(2, '0')}${String(sm).padStart(2, '0')}00`;
            const dtEndStr = `${yStr}${mStr}${dStr}T${String(eh).padStart(2, '0')}${String(em).padStart(2, '0')}00`;

            const sessionUid = `${(session.id || course.code).replace(/[^a-zA-Z0-9-]/g, '')}-${targetDay}-nu2026@nileuniversity.edu.eg`;

            ics.push(
                'BEGIN:VEVENT',
                `UID:${sessionUid}`,
                `SUMMARY:${course.code} - ${session.type} (${session.room})`,
                `DESCRIPTION:${course.title}\\nSection: ${session.section}\\nInstructor: ${session.instructor}\\nDirections: ${session.directions}`,
                `LOCATION:${session.building}\\, ${session.floor}\\, ${session.room}`,
                `DTSTART;TZID=Africa/Cairo:${dtStartStr}`,
                `DTEND;TZID=Africa/Cairo:${dtEndStr}`,
                `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=${dayNames[targetDay]}`,
                'STATUS:CONFIRMED',
                'TRANSP:OPAQUE',
                'BEGIN:VALARM',
                'ACTION:DISPLAY',
                `DESCRIPTION:Class in 20 mins: ${course.code} in ${session.room}`,
                'TRIGGER:-PT20M',
                'END:VALARM',
                'END:VEVENT'
            );
        }
    }

    ics.push('END:VCALENDAR');
    return ics.join('\r\n');
}

// Calculate the next immediate class or current in-session class
function getNextClass(schedule) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const curMins = now.getHours() * 60 + now.getMinutes();

    let currentClass = null;
    let nextUpcoming = null;
    let minDiff = Infinity;

    for (const course of schedule.courses || []) {
        for (const session of course.sessions || []) {
            const [sh, sm] = session.startTime.split(':').map(Number);
            const [eh, em] = session.endTime.split(':').map(Number);
            const startMins = sh * 60 + sm;
            const endMins = eh * 60 + em;

            if (session.dayIndex === dayOfWeek) {
                if (curMins >= startMins && curMins < endMins) {
                    currentClass = {
                        ...session,
                        courseCode: course.code,
                        courseTitle: course.title,
                        color: course.color,
                        remainingMins: endMins - curMins
                    };
                }
                if (startMins > curMins) {
                    const diff = startMins - curMins;
                    if (diff < minDiff) {
                        minDiff = diff;
                        nextUpcoming = {
                            ...session,
                            courseCode: course.code,
                            courseTitle: course.title,
                            color: course.color,
                            daysUntil: 0,
                            minutesUntil: diff
                        };
                    }
                }
            }
        }
    }

    if (!nextUpcoming) {
        for (let d = 1; d <= 7; d++) {
            const targetDay = (dayOfWeek + d) % 7;
            let earliestMins = Infinity;
            let earliestSession = null;
            let earliestCourse = null;

            for (const course of schedule.courses || []) {
                for (const session of course.sessions || []) {
                    if (session.dayIndex === targetDay) {
                        const [sh, sm] = session.startTime.split(':').map(Number);
                        const startMins = sh * 60 + sm;
                        if (startMins < earliestMins) {
                            earliestMins = startMins;
                            earliestSession = session;
                            earliestCourse = course;
                        }
                    }
                }
            }

            if (earliestSession) {
                const totalMinutes = (d * 24 * 60) - curMins + earliestMins;
                nextUpcoming = {
                    ...earliestSession,
                    courseCode: earliestCourse.code,
                    courseTitle: earliestCourse.title,
                    color: earliestCourse.color,
                    daysUntil: d,
                    minutesUntil: totalMinutes
                };
                break;
            }
        }
    }

    return { currentClass, nextUpcoming, serverTime: now.toISOString() };
}

// HTTP Server
const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const clientIp = req.socket.remoteAddress || '127.0.0.1';

    // 1. Strict Security Headers (Blocks clickjacking, MIME-sniffing, XSS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // 2. Strict Directory Traversal Protection (Blocks hackers from reading data or .env)
    const cleanPath = path.normalize(decodeURIComponent(pathname)).replace(/^[\\\/]+/, '');
    if (cleanPath.includes('..') || cleanPath.startsWith('data') || cleanPath.includes('.key') || cleanPath.includes('.git') || cleanPath.includes('.env')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('403 Forbidden: Access Denied');
    }

    // Resolve authenticated student session
    const auth = getAuthenticatedStudent(req);

    // --- API ROUTES ---

    // 1. GET /api/session (Check persistent device session status)
    if (pathname === '/api/session' && req.method === 'GET') {
        if (auth) {
            return sendJson(res, 200, {
                authenticated: true,
                token: auth.token,
                student: auth.schedule?.student || { username: auth.username }
            });
        }
        return sendJson(res, 200, { authenticated: false });
    }

    // 2. POST /api/login-sync (Student PowerCampus Authentication with Anti-Brute-Force)
    if (pathname === '/api/login-sync' && req.method === 'POST') {
        // Check rate limiter
        if (isIpRateLimited(clientIp)) {
            return sendJson(res, 429, {
                status: 'error',
                message: 'Too many login attempts. Please wait 15 minutes before trying again.'
            });
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                if (!username || !password) {
                    return sendJson(res, 400, { status: 'error', message: 'Username and password are required.' });
                }

                // 1. Authenticate with PowerCampus and fetch real-time timetable
                const syncResult = await executeSyncWorker(username, password);

                if (syncResult.status !== 'success') {
                    recordFailedLogin(clientIp);
                    return sendJson(res, 401, {
                        status: 'error',
                        message: syncResult.message || 'Invalid PowerCampus credentials.'
                    });
                }

                clearFailedLogin(clientIp);

                // 2. Encrypt password with AES-256 for the 8:00 AM daily check
                const clean = security.sanitizeUsername(username);
                const encryptedPassword = security.encrypt(password);

                const profile = getStudentProfile(clean);
                profile.username = username;
                profile.personId = syncResult.student?.personId;
                profile.encryptedPassword = encryptedPassword;
                profile.lastSyncedAt = syncResult.lastSynced || new Date().toISOString();
                profile.lastCheckedAt = profile.lastSyncedAt;
                saveStudentProfile(clean, profile);

                // 3. Save student schedule
                if (syncResult.data) {
                    saveStudentSchedule(clean, syncResult.data);
                }

                // 4. Create persistent device session (kept open forever on this device)
                const deviceToken = createSession(username);

                // 10-year cookie for device persistence
                const tenYearsSeconds = 10 * 365 * 24 * 60 * 60;
                res.setHeader('Set-Cookie', `nu_session=${deviceToken}; Path=/; Max-Age=${tenYearsSeconds}; SameSite=Lax; HttpOnly`);

                return sendJson(res, 200, {
                    status: 'success',
                    token: deviceToken,
                    student: syncResult.student,
                    coursesCount: syncResult.coursesCount,
                    message: `Welcome, ${username}! Schedule synchronized.`
                });
            } catch (err) {
                console.error('[Login-Sync Error]', err);
                return sendJson(res, 500, { status: 'error', message: err.message });
            }
        });
        return;
    }

    // 3. POST /api/logout (Revoke device session and completely delete all student data from this PC)
    if (pathname === '/api/logout' && req.method === 'POST') {
        if (auth) {
            if (auth.token) {
                destroySession(auth.token);
            }
            if (auth.cleanUsername) {
                const userDir = path.join(USERS_DIR, auth.cleanUsername);
                try {
                    if (fs.existsSync(userDir)) {
                        fs.rmSync(userDir, { recursive: true, force: true });
                        console.log(`[Wipe] Deleted student data folder: ${userDir}`);
                    }
                } catch (e) {
                    console.error('[Error deleting user directory]', e);
                }
            }
        }
        // Delete all lingering legacy data files from this PC
        try {
            const legacySched = path.join(DATA_DIR, 'schedule.json');
            if (fs.existsSync(legacySched)) {
                fs.unlinkSync(legacySched);
            }
            const configPath = path.join(DATA_DIR, 'config.json');
            if (fs.existsSync(configPath)) {
                const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (cfg.credentials) {
                    delete cfg.credentials;
                    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
                }
            }
        } catch (e) {
            console.error('[Error wiping legacy data on logout]', e);
        }
        res.setHeader('Set-Cookie', 'nu_session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly');
        return sendJson(res, 200, { status: 'success', message: 'Logged out successfully. All student data deleted from this PC.' });
    }

    // 4. GET /api/schedule (Current student's timetable)
    if (pathname === '/api/schedule' && req.method === 'GET') {
        if (!auth || !auth.schedule || !auth.schedule.student) {
            return sendJson(res, 401, {
                authenticated: false,
                message: 'Authentication required. Please sign in with your Nile University student account.',
                student: null,
                courses: []
            });
        }
        return sendJson(res, 200, auth.schedule);
    }

    // 5. GET /api/next-class (Next immediate class for student)
    if (pathname === '/api/next-class' && req.method === 'GET') {
        if (!auth || !auth.schedule) {
            return sendJson(res, 200, { currentClass: null, nextUpcoming: null, serverTime: new Date().toISOString() });
        }
        const nextInfo = getNextClass(auth.schedule);
        return sendJson(res, 200, nextInfo);
    }

    // 6. POST /api/sync (Manual sync without re-entering credentials)
    if (pathname === '/api/sync' && req.method === 'POST') {
        if (!auth) {
            return sendJson(res, 401, { status: 'error', message: 'Please sign in to sync.' });
        }
        const profile = auth.profile;
        if (!profile.encryptedPassword) {
            return sendJson(res, 400, { status: 'error', message: 'No stored credentials found.' });
        }
        const pwd = security.decrypt(profile.encryptedPassword);
        executeSyncWorker(auth.username, pwd)
            .then(result => {
                if (result.status === 'success' && result.data) {
                    saveStudentSchedule(auth.cleanUsername, result.data);
                    profile.lastSyncedAt = result.lastSynced;
                    saveStudentProfile(auth.cleanUsername, profile);
                    broadcastSSE('schedule-updated', { timestamp: result.lastSynced }, auth.cleanUsername);
                }
                return sendJson(res, 200, result);
            })
            .catch(err => sendJson(res, 500, { status: 'error', message: err.message }));
        return;
    }

    // 7. GET /api/changes (Change notices detected by 8 AM checks)
    if (pathname === '/api/changes' && req.method === 'GET') {
        const changes = auth ? getStudentChanges(auth.cleanUsername) : [];
        return sendJson(res, 200, { changes });
    }

    // 8. POST /api/check-changes (Instant manual check against PowerCampus)
    if (pathname === '/api/check-changes' && req.method === 'POST') {
        if (!auth) {
            return sendJson(res, 401, { status: 'error', message: 'Unauthorized' });
        }
        const profile = auth.profile;
        const pwd = security.decrypt(profile.encryptedPassword);
        executeSyncWorker(auth.username, pwd)
            .then(result => {
                if (result.status === 'success' && result.data) {
                    const diffs = detectScheduleChanges(auth.schedule, result.data);
                    saveStudentSchedule(auth.cleanUsername, result.data);
                    for (const d of diffs) {
                        recordStudentChange(auth.cleanUsername, d);
                    }
                    return sendJson(res, 200, {
                        status: 'success',
                        changesCount: diffs.length,
                        changes: diffs,
                        message: diffs.length > 0 ? `Found ${diffs.length} schedule change(s)!` : 'Your schedule is 100% up to date!'
                    });
                }
                return sendJson(res, 200, result);
            })
            .catch(err => sendJson(res, 500, { status: 'error', message: err.message }));
        return;
    }

    // 9. GET /api/calendar.ics (Student-specific repetitive iCalendar)
    if (pathname === '/api/calendar.ics') {
        if (!auth || !auth.schedule || !auth.schedule.courses || auth.schedule.courses.length === 0) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            return res.end('401 Unauthorized: Please sign in first to export your schedule.');
        }
        const icsContent = generateICS(auth.schedule);
        res.writeHead(200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'attachment; filename="nu_schedule_fall2026.ics"',
            'Cache-Control': 'no-cache'
        });
        return res.end(icsContent);
    }


    // 9C. GET /api/schedule-template (Default sample schedule template)
    if (pathname === '/api/schedule-template' && req.method === 'GET') {
        const sampleData = {
            student: {
                username: "demo_student",
                program: "School of Information Technology and Computer Science",
                term: "Fall 2026",
                advisor: "Prof. Dr. Ahmed Hassan"
            },
            lastSynced: new Date().toISOString(),
            courses: [
                {
                    code: "CSC111",
                    title: "Introduction to Computer Science & Programming",
                    color: "#2563eb",
                    sessions: [
                        { type: "Lecture", day: "Sunday", dayIndex: 0, startTime: "08:30", endTime: "10:00", room: "GUB1-116", building: "Academic Building 1", floor: "Ground Floor", instructor: "Dr. Mohamed El-Sayed", section: "01", directions: "UB1 Main Entrance -> Ground Floor Room 116" },
                        { type: "Lab", day: "Tuesday", dayIndex: 2, startTime: "10:30", endTime: "12:30", room: "BUB1-053", building: "Academic Building 1", floor: "Basement", instructor: "Eng. Sara Adel", section: "01", directions: "UB1 Stairs to Basement -> Software Engineering Lab 053" }
                    ]
                },
                {
                    code: "MTH111",
                    title: "Calculus & Analytical Geometry I",
                    color: "#10b981",
                    sessions: [
                        { type: "Lecture", day: "Monday", dayIndex: 1, startTime: "10:30", endTime: "12:00", room: "GUB1-118", building: "Academic Building 1", floor: "Ground Floor", instructor: "Dr. Khaled Ibrahim", section: "02", directions: "UB1 Main Entrance -> Ground Floor Room 118" },
                        { type: "Tutorial", day: "Wednesday", dayIndex: 3, startTime: "12:30", endTime: "14:00", room: "FUB1-221", building: "Academic Building 1", floor: "1st Floor", instructor: "Eng. Omar Tarek", section: "02", directions: "UB1 Elevators to 1st Floor -> Hall 221" }
                    ]
                },
                {
                    code: "PHY111",
                    title: "Physics for Engineers I",
                    color: "#f59e0b",
                    sessions: [
                        { type: "Lecture", day: "Thursday", dayIndex: 4, startTime: "08:30", endTime: "10:00", room: "GUB1-116", building: "Academic Building 1", floor: "Ground Floor", instructor: "Dr. Mahmoud Fawzy", section: "01", directions: "UB1 Main Entrance -> Ground Floor Room 116" }
                    ]
                }
            ]
        };
        return sendJson(res, 200, sampleData);
    }

    // 9D. POST /api/import-schedule (Manual schedule import without Nile PowerCampus password)
    if (pathname === '/api/import-schedule' && req.method === 'POST') {
        let bodyStr = '';
        req.on('data', chunk => { bodyStr += chunk; });
        req.on('end', () => {
            try {
                const body = JSON.parse(bodyStr);
                if (!body || (!body.courses && !Array.isArray(body))) {
                    return sendJson(res, 400, { status: 'error', message: 'Invalid schedule format. Must include courses.' });
                }

                const username = (body.student && body.student.username) ? body.student.username.replace(/[^a-zA-Z0-9_-]/g, '') : 'imported_student';
                const cleanUsername = cleanStudentUsername(username);

                const scheduleData = {
                    student: body.student || {
                        username: username,
                        program: "Undergraduate",
                        term: "Fall 2026",
                        advisor: "Academic Advisor"
                    },
                    courses: Array.isArray(body) ? body : (body.courses || []),
                    lastSynced: new Date().toISOString()
                };

                // Save imported schedule to student folder
                saveStudentSchedule(cleanUsername, scheduleData);

                const profile = getStudentProfile(cleanUsername);
                profile.username = username;
                profile.lastSyncedAt = scheduleData.lastSynced;
                saveStudentProfile(cleanUsername, profile);

                // Generate permanent session
                const sessionToken = crypto.randomBytes(32).toString('hex');
                const sessions = loadSessions();
                sessions[sessionToken] = {
                    username: cleanUsername,
                    originalUsername: username,
                    createdAt: new Date().toISOString(),
                    lastUsed: new Date().toISOString()
                };
                saveSessions(sessions);

                res.setHeader('Set-Cookie', `nu_session=${sessionToken}; Path=/; Max-Age=315360000; SameSite=Lax; HttpOnly`);
                return sendJson(res, 200, {
                    status: 'success',
                    token: sessionToken,
                    message: 'Schedule imported and saved permanently on this device!',
                    student: scheduleData.student
                });
            } catch (err) {
                return sendJson(res, 400, { status: 'error', message: 'Invalid JSON payload' });
            }
        });
        return;
    }

    // 10. GET /api/academic-calendar (Official academic milestones)
    if (pathname === '/api/academic-calendar' && req.method === 'GET') {
        const calendarInfo = {
            academicYear: "2026/2027",
            currentTerm: "Fall 2026",
            events: [
                { title: "First Day of Classes", date: "Sunday, September 20, 2026", type: "academic" },
                { title: "Course Drop & Add Period", date: "Sept 20 - Sept 28, 2026", type: "registration" },
                { title: "Armed Forces Day Holiday", date: "Tuesday, October 6, 2026", type: "holiday" },
                { title: "Fall 2026 Midterm Exams", date: "Nov 01 - Nov 08, 2026", type: "exam" },
                { title: "Last Day for Course Withdrawal ('W')", date: "Thursday, December 3, 2026", type: "academic" },
                { title: "Last Day of Classes", date: "Thursday, December 31, 2026", type: "academic" },
                { title: "Final Exams Period", date: "Jan 03 - Jan 17, 2027", type: "exam" },
                { title: "Spring 2027 Classes Begin", date: "Sunday, February 7, 2027", type: "academic" }
            ]
        };
        return sendJson(res, 200, calendarInfo);
    }

    // 11. GET & POST /api/config (Notification preferences - NEVER exposes passwords)
    if (pathname === '/api/config' && req.method === 'GET') {
        const profile = auth ? auth.profile : { notifications: {} };
        return sendJson(res, 200, {
            notifications: profile.notifications,
            username: auth ? auth.username : '',
            lastCheckedAt: profile.lastCheckedAt
        });
    }

    if (pathname === '/api/config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const updated = JSON.parse(body);
                if (auth) {
                    const profile = auth.profile;
                    profile.notifications = {
                        ...profile.notifications,
                        ...updated.notifications
                    };
                    saveStudentProfile(auth.cleanUsername, profile);
                }
                return sendJson(res, 200, { status: 'success', message: 'Settings saved.' });
            } catch (err) {
                return sendJson(res, 400, { status: 'error', message: err.message });
            }
        });
        return;
    }

    // 12. POST /api/notify-test
    if (pathname === '/api/notify-test' && req.method === 'POST') {
        const samplePayload = {
            courseCode: 'PHY111',
            courseTitle: 'Physics I',
            type: 'Lecture',
            section: '08',
            room: 'Room F46',
            floor: 'FUB2 (First Floor)',
            building: 'Building 2 (UB2)',
            instructor: 'Yasser Mohamed Elbatawy',
            startTime: '10:30',
            endTime: '12:29',
            leadMinutes: 20,
            directions: 'Building 2 -> 1st Floor -> Room F46',
            timestamp: new Date().toISOString(),
            isTest: true
        };

        const u = auth ? auth.cleanUsername : null;
        broadcastSSE('test-reminder', samplePayload, u);

        return sendJson(res, 200, {
            status: 'success',
            message: 'Live 20-minute web alarm triggered on your screen!'
        });
    }

    // 13. GET /api/events (SSE stream scoped to student)
    if (pathname === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.write('event: connected\ndata: {"status":"connected"}\n\n');
        const clientObj = { res, username: auth ? auth.cleanUsername : null };
        sseClients.add(clientObj);
        req.on('close', () => {
            sseClients.delete(clientObj);
        });
        return;
    }

    // --- STATIC FILES (WITH STRICT PATH TRAVERSAL GUARDS) ---
    let filePath = path.join(PUBLIC_DIR, cleanPath === '' ? 'index.html' : cleanPath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('403 Forbidden: Access Denied');
    }

    const extname = path.extname(filePath).toLowerCase();

    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.ics': 'text/calendar; charset=utf-8'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e, fallback) => {
                    if (e) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('404 Not Found');
                    } else {
                        res.writeHead(200, {
                            'Content-Type': 'text/html; charset=utf-8',
                            'Cache-Control': 'no-cache, no-store, must-revalidate'
                        });
                        res.end(fallback);
                    }
                });
            } else {
                res.writeHead(500);
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            const headers = { 'Content-Type': contentType };
            if (extname === '.html' || extname === '.js' || extname === '.css') {
                headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            }
            res.writeHead(200, headers);
            res.end(content);
        }
    });
});

function sendJson(res, code, obj) {
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.end(JSON.stringify(obj));
}

function openBrowser(url) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` :
                process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
}

async function startServer() {
    const chosenPort = await portManager.resolveAvailablePort(DEFAULT_PORT);
    
    server.on('error', async (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[Warning] Port ${chosenPort} is in use. Searching for next available port...`);
            const fallbackPort = await portManager.resolveAvailablePort(chosenPort + 1);
            server.listen(fallbackPort, () => onListening(fallbackPort));
        } else {
            console.error('[Server Error]', err);
        }
    });

    server.listen(chosenPort, () => onListening(chosenPort));
}

function onListening(port) {
    console.log(`\n======================================================`);
    console.log(`🎓 Nile University Multi-Student Timetable & Alert Service`);
    console.log(`🌐 Server running at: http://localhost:${port}`);
    console.log(`🔒 AES-256 encrypted credential protection active`);
    console.log(`🛡️ Anti-Brute-Force Rate Limiting Active`);
    console.log(`🚫 Path Traversal Defense Active`);
    console.log(`📱 Persistent device session active`);
    console.log(`⚡ Live 1-minute automated schedule verification active`);
    console.log(`======================================================\n`);

    if (process.env.NO_BROWSER !== 'true') {
        openBrowser(`http://localhost:${port}/`);
    }
}

startServer();
