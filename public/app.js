// Nile University Schedule & Live Class Navigator Client Logic

// Day Mapping for Egyptian Universities: 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
const TIME_SLOTS = [
    '08:30', '09:30', '10:30', '11:30', '12:30',
    '13:30', '14:30', '15:30', '16:30', '17:30', '18:30'
];

let appState = {
    schedule: null,
    config: null,
    activeView: 'weekly',
    dayFilter: 'all',
    audioContext: null
};

// Instant Theme Application before rendering to avoid flicker
try {
    const earlySavedTheme = localStorage.getItem('nu_theme') || 
        (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', earlySavedTheme);
} catch (e) {}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initTimeFormat();
    registerServiceWorker();
    setupAudioContext();
    setupNavigation();
    setupMobileBottomNav();
    setupModals();
    setupRoomFinder();
    setupNotificationEvents();
    setupNetworkListeners();

    // 1. Immediate offline-first schedule load (Zero delay on phones & tablets)
    const cachedSchedule = localStorage.getItem('nu_schedule_cache');
    const deviceToken = localStorage.getItem('nu_device_token');

    if (cachedSchedule && deviceToken) {
        try {
            const parsed = JSON.parse(cachedSchedule);
            // Only use cache if it has actual courses data
            if (parsed && parsed.student && parsed.courses && parsed.courses.length > 0) {
                appState.schedule = parsed;
                appState.isAuthenticated = true;
                populateStudentHeader(appState.schedule.student);
                renderAllViews();
            }
        } catch (e) {
            console.warn('[Cache Parse Error]', e);
            localStorage.removeItem('nu_schedule_cache');
        }
    }

    // 2. Check network & session - ALWAYS fetch fresh data from server when online
    const isOnline = navigator.onLine;
    updateNetworkStatusUI(isOnline);

    if (!isOnline) {
        // Phone / Tablet is currently offline
        if (appState.schedule) {
            showOfflineBanner(true, 'No internet detected. Displaying your saved timetable, classrooms, and alarms.');
            const btnLogout = document.getElementById('btn-logout');
            if (btnLogout) btnLogout.style.display = 'inline-flex';
            const btnOpenLogin = document.getElementById('btn-open-login');
            if (btnOpenLogin) btnOpenLogin.style.display = 'none';
        } else {
            renderUnauthenticatedState();
            showOfflineBanner(true, 'No internet detected and no saved timetable found. Please connect to Wi-Fi to sign in once.');
            if (window.nuAppOpenLogin) window.nuAppOpenLogin(true);
        }
    } else {
        // Online: ALWAYS verify session and fetch fresh schedule from server
        const sessionResult = await checkUserSession();
        if (sessionResult.authenticated) {
            showOfflineBanner(false);
            // Force fresh fetch (clears any stale course-empty cache)
            await loadScheduleData();
            await loadConfigData();
        } else if (sessionResult.isNetworkError && appState.schedule) {
            // Server couldn't be reached, but we have cached data: use offline mode!
            showOfflineBanner(true, 'Cannot reach Nile timetable server. Displaying your saved schedule.');
            const btnLogout = document.getElementById('btn-logout');
            if (btnLogout) btnLogout.style.display = 'inline-flex';
        } else {
            // Explicitly logged out or no credentials
            localStorage.removeItem('nu_schedule_cache');
            localStorage.removeItem('nu_device_token');
            renderUnauthenticatedState();
            if (window.nuAppOpenLogin) window.nuAppOpenLogin(true);
        }
    }

    // 3. Start live timer loop for "Where to go now"
    updateLiveHeroWidget();
    setInterval(updateLiveHeroWidget, 1000);

    // 4. Automated 1-minute live background sync loop (always keeps timetable fresh)
    setInterval(async () => {
        if (appState.isAuthenticated && navigator.onLine) {
            try {
                await loadScheduleData(true);
                await checkScheduleChanges();
            } catch (e) {
                console.warn('[1-Min Sync Interval Error]', e);
            }
        }
    }, 60000);
});

// Update network status indicators on mobile and tablet
function updateNetworkStatusUI(isOnline) {
    const pill = document.getElementById('network-status-pill');
    const text = document.getElementById('network-status-text');
    if (!pill || !text) return;

    if (isOnline) {
        pill.className = 'network-status-pill online';
        text.textContent = 'Online';
    } else {
        pill.className = 'network-status-pill offline';
        text.textContent = 'Offline';
    }
}

// Display or hide the offline mode warning banner
function showOfflineBanner(show, customDesc) {
    const banner = document.getElementById('offline-status-banner');
    const desc = document.getElementById('offline-banner-desc');
    if (!banner) return;

    if (show) {
        if (customDesc && desc) desc.textContent = customDesc;
        banner.style.display = 'flex';
        updateNetworkStatusUI(false);
    } else {
        banner.style.display = 'none';
        updateNetworkStatusUI(true);
    }
}

// Setup network event listeners for seamless offline/online transitions
function setupNetworkListeners() {
    window.addEventListener('online', async () => {
        showToast('🟢 Internet restored! Syncing timetable...');
        updateNetworkStatusUI(true);
        showOfflineBanner(false);
        const check = await checkUserSession();
        if (check.authenticated) {
            await loadScheduleData();
            await checkScheduleChanges();
        }
    });

    window.addEventListener('offline', () => {
        showToast('📶 Internet disconnected. Switched to offline mode.');
        updateNetworkStatusUI(false);
        showOfflineBanner(true, 'No internet detected. Displaying your saved timetable, classrooms, and alarms.');
    });

    const btnRetry = document.getElementById('btn-retry-network');
    if (btnRetry) {
        btnRetry.addEventListener('click', async () => {
            showToast('🔄 Checking network connection...');
            try {
                const res = await fetch('/api/session', { cache: 'no-store' });
                if (res.ok) {
                    showToast('✅ Reconnected successfully!');
                    showOfflineBanner(false);
                    await checkUserSession();
                    await loadScheduleData();
                } else {
                    showToast('⚠️ Still unable to reach server. Using offline data.');
                }
            } catch (e) {
                showToast('⚠️ No internet connection detected yet.');
            }
        });
    }
}

// Setup Mobile Phone Fixed Bottom Navigation Bar
function setupMobileBottomNav() {
    const navItems = document.querySelectorAll('.mobile-nav-item');
    if (!navItems || navItems.length === 0) return;

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const view = item.getAttribute('data-mobview');
            if (view === 'theme') {
                toggleTheme();
                return;
            }

            navItems.forEach(n => {
                if (n.getAttribute('data-mobview') !== 'theme') {
                    n.classList.remove('active');
                }
            });
            item.classList.add('active');

            if (view === 'home') {
                const hero = document.getElementById('hero-now-card');
                if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (view === 'weekly') {
                const tab = document.querySelector('.tab-btn[data-view="weekly"]');
                if (tab) tab.click();
                const grid = document.getElementById('timetable-grid');
                if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (view === 'agenda') {
                const tab = document.querySelector('.tab-btn[data-view="agenda"]');
                if (tab) tab.click();
                const agenda = document.getElementById('agenda-container');
                if (agenda) agenda.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (view === 'courses') {
                const tab = document.querySelector('.tab-btn[data-view="courses"]');
                if (tab) tab.click();
                const courses = document.getElementById('courses-grid');
                if (courses) courses.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (view === 'campus') {
                const tab = document.querySelector('.tab-btn[data-view="campus"]');
                if (tab) tab.click();
                const campus = document.getElementById('view-campus');
                if (campus) campus.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// Helper to populate student profile header
function populateStudentHeader(student) {
    if (!student) return;
    if (student.username) {
        const elUser = document.getElementById('profile-username');
        if (elUser) elUser.textContent = student.username;
        const elAvatar = document.getElementById('profile-avatar');
        if (elAvatar) {
            const clean = student.username.replace(/[^a-zA-Z]/g, '');
            elAvatar.textContent = (clean.slice(0, 2) || 'NU').toUpperCase();
        }
    }
    if (student.program) {
        const elProg = document.getElementById('profile-program');
        if (elProg) elProg.textContent = student.program;
    }
    if (student.term) {
        const elMeta = document.getElementById('profile-meta');
        if (elMeta) {
            elMeta.innerHTML = `<span>${student.term}</span> • <span>Advisor: ${student.advisor || 'Academic Advisor'}</span>`;
        }
    }
}

// Render locked placeholder when user is not signed in
function renderUnauthenticatedState() {
    appState.schedule = null;
    const elUser = document.getElementById('profile-username');
    if (elUser) elUser.textContent = 'Please Sign In';
    const elProg = document.getElementById('profile-program');
    if (elProg) elProg.textContent = 'Required';
    const elAvatar = document.getElementById('profile-avatar');
    if (elAvatar) elAvatar.textContent = '🔒';
    const elMeta = document.getElementById('profile-meta');
    if (elMeta) elMeta.innerHTML = '<span>Sign in once to activate permanent session</span>';

    const heroStatus = document.getElementById('hero-status-text');
    if (heroStatus) heroStatus.textContent = 'Sign-In Required';
    const heroTitle = document.getElementById('hero-class-title');
    if (heroTitle) heroTitle.textContent = 'Sign in to access your live timetable & room navigator';
    const heroRoomTitle = document.getElementById('hero-room-title');
    if (heroRoomTitle) heroRoomTitle.textContent = 'Campus Room Navigator';
    const heroRoomDesc = document.getElementById('hero-room-desc');
    if (heroRoomDesc) heroRoomDesc.textContent = 'Classroom and building directions will appear here once authenticated.';
    const countdown = document.getElementById('countdown-digits');
    if (countdown) countdown.textContent = '--:--:--';
    const countTab = document.getElementById('courses-count-tab');
    if (countTab) countTab.textContent = '0';

    const grid = document.getElementById('timetable-grid');
    if (grid) {
        grid.innerHTML = `
            <div class="locked-timetable-placeholder" style="grid-column: 1 / -1;">
                <div class="locked-icon">🔐</div>
                <h3>Nile University Timetable Locked</h3>
                <p>Welcome! Please sign in with your Nile University username & password above. You only need to sign in once—your session will stay open forever on this device.</p>
                <button type="button" class="btn btn-primary" onclick="window.nuAppOpenLogin ? window.nuAppOpenLogin(true) : null">
                    <span class="btn-icon">🔑</span> Enter Student Credentials
                </button>
            </div>
        `;
    }

    const agenda = document.getElementById('agenda-list');
    if (agenda) {
        agenda.innerHTML = `
            <div class="locked-timetable-placeholder">
                <div class="locked-icon">📋</div>
                <h3>Day-by-Day Agenda Locked</h3>
                <p>Sign in with your student credentials to view your daily schedule.</p>
            </div>
        `;
    }

    const coursesGrid = document.getElementById('courses-catalog');
    if (coursesGrid) {
        coursesGrid.innerHTML = `
            <div class="locked-timetable-placeholder" style="grid-column: 1 / -1;">
                <div class="locked-icon">📚</div>
                <h3>Enrolled Courses Locked</h3>
                <p>Sign in with your Nile University account to load your enrolled courses.</p>
            </div>
        `;
    }
}

// Persistent authenticated fetch helper (attaches Bearer token and credentials)
function authFetch(url, options = {}) {
    options = options || {};
    const headers = new Headers(options.headers || {});
    const token = localStorage.getItem('nu_device_token');
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    options.headers = headers;
    options.credentials = 'same-origin';
    return fetch(url, options);
}

// Check if device already has a permanent authenticated session
async function checkUserSession() {
    try {
        const res = await authFetch('/api/session');
        const data = await res.json();
        const btnOpenLogin = document.getElementById('btn-open-login');
        const btnLogout = document.getElementById('btn-logout');
        const modal = document.getElementById('modal-portal-login');

        if (data.authenticated) {
            appState.isAuthenticated = true;
            if (data.token) localStorage.setItem('nu_device_token', data.token);
            if (btnOpenLogin) btnOpenLogin.style.display = 'none';
            if (btnLogout) btnLogout.style.display = 'inline-flex';
            if (modal) {
                modal.classList.remove('is-mandatory');
                modal.classList.remove('active');
            }
            await checkScheduleChanges();
            return { authenticated: true, isNetworkError: false };
        } else {
            appState.isAuthenticated = false;
            if (btnLogout) btnLogout.style.display = 'none';
            if (btnOpenLogin) btnOpenLogin.style.display = 'inline-flex';
            return { authenticated: false, isNetworkError: false };
        }
    } catch (e) {
        // Network error / offline
        return { authenticated: false, isNetworkError: true };
    }
}

// Check for timetable changes detected during 8:00 AM verification
async function checkScheduleChanges() {
    try {
        const res = await authFetch('/api/changes');
        const json = await res.json();
        const banner = document.getElementById('schedule-changes-banner');
        const textEl = document.getElementById('schedule-changes-text');
        if (json.changes && json.changes.length > 0) {
            appState.recentChanges = json.changes;
            if (banner && textEl) {
                textEl.textContent = `${json.changes.length} change(s) detected during 8:00 AM PowerCampus check: ${json.changes[0].message}`;
                banner.style.display = 'flex';
            }
        } else if (banner) {
            banner.style.display = 'none';
        }
    } catch (e) {}
}

// Register PWA Service Worker
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
            .catch(err => console.warn('[PWA] Service Worker registration failed:', err));
    }
}

// Web Audio API Synthesizer Chime
function setupAudioContext() {
    document.addEventListener('click', () => {
        if (!appState.audioContext) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) appState.audioContext = new AudioCtx();
        }
    }, { once: true });
}

function playClassChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = appState.audioContext || new AudioCtx();
        appState.audioContext = ctx;

        if (ctx.state === 'suspended') ctx.resume();

        const now = ctx.currentTime;
        // Two-tone bell chime (E5 -> G#5 -> B5)
        const notes = [659.25, 830.61, 987.77];
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.15);

            gain.gain.setValueAtTime(0, now + idx * 0.15);
            gain.gain.linearRampToValueAtTime(0.3, now + idx * 0.15 + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.8);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now + idx * 0.15);
            osc.stop(now + idx * 0.15 + 0.85);
        });

        if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200, 100, 300]);
        }
    } catch (e) {
        console.warn('Audio chime failed:', e);
    }
}

// Load schedule from API
async function loadScheduleData(silent = false) {
    try {
        const res = await authFetch(`/api/schedule?_t=${Date.now()}`);
        if (res.ok) {
            appState.schedule = await res.json();
            localStorage.setItem('nu_schedule_cache', JSON.stringify(appState.schedule));
            
            // Update student profile metadata in header
            const student = appState.schedule.student || {};
            if (student.username) {
                const elUser = document.getElementById('profile-username');
                if (elUser) elUser.textContent = student.username;
                const elAvatar = document.getElementById('profile-avatar');
                if (elAvatar) {
                    const clean = student.username.replace(/[^a-zA-Z]/g, '');
                    elAvatar.textContent = (clean.slice(0, 2) || 'NU').toUpperCase();
                }
            }
            if (student.program) {
                const elProg = document.getElementById('profile-program');
                if (elProg) elProg.textContent = student.program;
            }
            if (student.term) {
                const elMeta = document.getElementById('profile-meta');
                if (elMeta) {
                    elMeta.innerHTML = `<span>${student.term}</span> • <span>Advisor: ${student.advisor || 'Academic Advisor'}</span>`;
                }
            }
            const countTab = document.getElementById('courses-count-tab');
            if (countTab) countTab.textContent = appState.schedule.courses?.length || 0;

            renderAllViews();
            if (appState.schedule.lastSynced) {
                const date = new Date(appState.schedule.lastSynced);
                document.getElementById('last-sync-time').textContent = `Last synced: ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            }
        }
    } catch (err) {
        console.error('Failed to load schedule from server:', err);
    }
}

// Load configuration
async function loadConfigData() {
    try {
        const res = await authFetch('/api/config');
        if (res.ok) {
            appState.config = await res.json();
            populateConfigUI();
        }
    } catch (err) {
        console.error('Failed to load config:', err);
    }
}

function populateConfigUI() {
    if (!appState.config) return;
    const notifs = appState.config.notifications || {};
    const chkSound = document.getElementById('chk-sound');
    const chkVibrate = document.getElementById('chk-vibrate');

    if (chkSound) chkSound.checked = notifs.soundEnabled !== false;
    if (chkVibrate) chkVibrate.checked = notifs.vibrateEnabled !== false;
}

// --- RENDER VIEWS ---
function renderAllViews() {
    if (!appState.schedule) return;
    renderWeeklyGrid();
    renderDayAgenda();
    renderEnrolledCourses();
    updateLiveHeroWidget();
}

// 1. Weekly Timetable Grid
function renderWeeklyGrid() {
    const grid = document.getElementById('timetable-grid');
    if (!grid || !appState.schedule) return;

    grid.innerHTML = '';

    // Corner cell
    const corner = document.createElement('div');
    corner.className = 'grid-corner-header';
    corner.textContent = 'TIME';
    grid.appendChild(corner);

    // Day headers (Sun to Thu)
    DAYS.forEach((day, index) => {
        const header = document.createElement('div');
        header.className = 'grid-day-header';
        header.innerHTML = `
            <span class="day-header-title">${day.substring(0, 3)}</span>
            <span class="day-header-sub">${day}</span>
        `;
        grid.appendChild(header);
    });

    // Time row headers & background cells
    const startHour = 8.5; // 08:30
    for (let r = 0; r < 10; r++) {
        const timeVal = startHour + r;
        const h = Math.floor(timeVal);
        const m = (timeVal % 1) * 60;
        const timeLabel = formatTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

        const timeSlot = document.createElement('div');
        timeSlot.className = 'grid-time-slot';
        timeSlot.textContent = timeLabel;
        timeSlot.style.gridRow = `${r + 2}`;
        timeSlot.style.gridColumn = '1';
        grid.appendChild(timeSlot);
    }

    // Place Course Blocks
    (appState.schedule.courses || []).forEach(course => {
        (course.sessions || []).forEach(session => {
            if (session.dayIndex > 4) return; // Only Sun-Thu

            const col = session.dayIndex + 2; // Column 2 to 6
            const [sh, sm] = session.startTime.split(':').map(Number);
            const [eh, em] = session.endTime.split(':').map(Number);

            const startMins = sh * 60 + sm;
            const endMins = eh * 60 + em;
            const baseMins = 8 * 60 + 30; // 08:30 = row 2

            // Calculate grid row start and span
            const rowStart = 2 + Math.floor((startMins - baseMins) / 60);
            const durationHours = Math.round((endMins - startMins) / 60);
            const rowSpan = Math.max(1, durationHours);

            const block = document.createElement('div');
            block.className = `grid-cell-block ${rowSpan === 1 ? 'is-short-period' : ''}`;
            block.style.gridColumn = `${col}`;
            block.style.gridRow = `${rowStart} / span ${rowSpan}`;
            block.style.borderLeftColor = course.color || 'var(--nu-blue)';

            const badgeClass = session.type === 'Lecture' ? 'badge-lecture' :
                               session.type === 'Lab' ? 'badge-lab' : 'badge-tutorial';

            block.innerHTML = `
                <div class="grid-cell-header">
                    <span class="grid-cell-code">${course.code}</span>
                    <span class="badge ${badgeClass}">${session.type}</span>
                </div>
                <div class="grid-cell-title" title="${course.title}">${course.title}</div>
                <div class="grid-cell-details">
                    <div class="grid-detail-item grid-room-tag">
                        <span>📍 ${session.room}</span>
                        <span class="grid-floor-tag">${session.floor}</span>
                    </div>
                    <div class="grid-detail-item grid-time-tag">
                        <span>⏰ ${formatTimeRange(session.startTime, session.endTime)}</span>
                    </div>
                    <div class="grid-detail-item grid-prof-tag">
                        <span>👨‍🏫 ${session.instructor}</span>
                    </div>
                </div>
            `;

            block.addEventListener('click', () => openClassDetailModal(course, session));
            grid.appendChild(block);
        });
    });
}

// 2. Day-by-Day Agenda
function renderDayAgenda() {
    const container = document.getElementById('agenda-list');
    if (!container || !appState.schedule) return;

    container.innerHTML = '';
    const now = new Date();
    const todayIndex = now.getDay();

    DAYS.forEach((dayName, dayIndex) => {
        if (appState.dayFilter !== 'all' && parseInt(appState.dayFilter) !== dayIndex) {
            return;
        }

        // Collect sessions for this day
        const sessionsToday = [];
        (appState.schedule.courses || []).forEach(course => {
            (course.sessions || []).forEach(session => {
                if (session.dayIndex === dayIndex) {
                    sessionsToday.push({ course, session });
                }
            });
        });

        // Sort by start time
        sessionsToday.sort((a, b) => a.session.startTime.localeCompare(b.session.startTime));

        const dayCard = document.createElement('div');
        dayCard.className = `agenda-day-card ${dayIndex === todayIndex ? 'is-today' : ''}`;

        const isTodayBadge = dayIndex === todayIndex ? '<span class="badge badge-primary">TODAY</span>' : '';

        dayCard.innerHTML = `
            <div class="agenda-day-header">
                <div class="agenda-day-name">
                    <span>${dayName}</span>
                    ${isTodayBadge}
                </div>
                <span class="badge-tag" style="font-size: 0.85rem; font-weight: 600;">${sessionsToday.length} ${sessionsToday.length === 1 ? 'Class' : 'Classes'}</span>
            </div>
            <div class="agenda-sessions-list" id="agenda-sessions-${dayIndex}"></div>
        `;

        const sessionsListEl = dayCard.querySelector(`#agenda-sessions-${dayIndex}`);

        if (sessionsToday.length === 0) {
            sessionsListEl.innerHTML = `
                <div class="empty-day-box">
                    <span style="font-size: 1.5rem">🌴</span>
                    <div>
                        <strong>No classes scheduled for ${dayName}</strong>
                        <div class="text-muted" style="font-size: 0.85rem">Enjoy your free time or use the campus library!</div>
                    </div>
                </div>
            `;
        } else {
            sessionsToday.forEach(({ course, session }) => {
                const badgeClass = session.type === 'Lecture' ? 'badge-lecture' :
                                   session.type === 'Lab' ? 'badge-lab' : 'badge-tutorial';

                const item = document.createElement('div');
                item.className = 'agenda-session-item';
                item.style.borderLeft = `5px solid ${course.color || 'var(--nu-blue)'}`;
                item.innerHTML = `
                    <div class="session-card-header">
                        <div class="session-course-tag">
                            <span class="session-code">${course.code}</span>
                            <span class="badge ${badgeClass}">${session.type}</span>
                            <span class="session-section-pill">Sec ${session.section}</span>
                        </div>
                        <div class="session-time-badge">
                            <span class="time-clock-icon">⏰</span>
                            <span>${formatTimeRange(session.startTime, session.endTime)}</span>
                        </div>
                    </div>
                    
                    <div class="session-card-body">
                        <h4 class="session-full-title">${course.title}</h4>
                        
                        <div class="session-details-grid">
                            <div class="detail-row location-row">
                                <span class="detail-icon">📍</span>
                                <div class="detail-text">
                                    <strong>${session.room} (${session.floor})</strong>
                                    <span class="detail-sub">🏢 ${session.building} • ${session.directions}</span>
                                </div>
                            </div>
                            
                            <div class="detail-row instructor-row">
                                <span class="detail-icon">👨‍🏫</span>
                                <div class="detail-text">
                                    <span class="instructor-name">Prof: ${session.instructor}</span>
                                    <span class="detail-sub">🔔 Alarms active: 20m & 15m before</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;

                item.addEventListener('click', () => openClassDetailModal(course, session));
                sessionsListEl.appendChild(item);
            });
        }

        container.appendChild(dayCard);
    });
}

// 3. Enrolled Courses
function renderEnrolledCourses() {
    const container = document.getElementById('courses-catalog');
    if (!container || !appState.schedule) return;

    container.innerHTML = '';

    if (!appState.schedule.courses || appState.schedule.courses.length === 0) {
        container.innerHTML = `
            <div class="locked-timetable-placeholder" style="grid-column: 1 / -1;">
                <div class="locked-icon">📚</div>
                <h3>No Courses Found</h3>
                <p>No courses were found in your schedule. Try syncing with the portal again.</p>
            </div>
        `;
        return;
    }

    (appState.schedule.courses || []).forEach(course => {
        const card = document.createElement('div');
        card.className = 'course-card';
        card.style.borderTop = `4px solid ${course.color || 'var(--nu-blue)'}`;

        let sessionsHtml = '';
        (course.sessions || []).forEach(s => {
            const badgeClass = s.type === 'Lecture' ? 'badge-lecture' :
                               s.type === 'Lab' ? 'badge-lab' : 'badge-tutorial';
            sessionsHtml += `
                <div class="course-session-pill">
                    <div>
                        <strong>${s.day}</strong> • ${formatTimeRange(s.startTime, s.endTime)}
                        <span class="badge ${badgeClass}" style="margin-left:6px">${s.type}</span>
                    </div>
                    <div style="color:#38bdf8; font-weight:600">📍 ${s.room}</div>
                </div>
            `;
        });

        card.innerHTML = `
            <div>
                <div class="course-card-top">
                    <span class="course-card-code" style="color: ${course.color}">${course.code}</span>
                    <span class="badge badge-secondary">${course.credits} Credits</span>
                </div>
                <h4 class="course-card-title">${course.title}</h4>
                <div class="course-sessions-pill-list">
                    ${sessionsHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// 4. Live "Where to Go Now" Hero Widget
function updateLiveHeroWidget() {
    if (!appState.schedule) return;

    const now = new Date();
    const curDay = now.getDay();
    const curMins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

    let inSession = null;
    let nextUpcoming = null;
    let minDiff = Infinity;

    (appState.schedule.courses || []).forEach(course => {
        (course.sessions || []).forEach(session => {
            const [sh, sm] = session.startTime.split(':').map(Number);
            const [eh, em] = session.endTime.split(':').map(Number);
            const startMins = sh * 60 + sm;
            const endMins = eh * 60 + em;

            if (session.dayIndex === curDay) {
                // Currently in session?
                if (curMins >= startMins && curMins < endMins) {
                    inSession = { course, session, remainingMins: endMins - curMins };
                }
                // Upcoming today?
                if (startMins > curMins) {
                    const diff = startMins - curMins;
                    if (diff < minDiff) {
                        minDiff = diff;
                        nextUpcoming = { course, session, diffMins: diff, dayOffset: 0 };
                    }
                }
            }
        });
    });

    // If no more classes today, check upcoming days
    if (!inSession && !nextUpcoming) {
        for (let d = 1; d <= 7; d++) {
            const targetDay = (curDay + d) % 7;
            let earliestMins = Infinity;
            let earliestItem = null;

            (appState.schedule.courses || []).forEach(course => {
                (course.sessions || []).forEach(session => {
                    if (session.dayIndex === targetDay) {
                        const [sh, sm] = session.startTime.split(':').map(Number);
                        const sMins = sh * 60 + sm;
                        if (sMins < earliestMins) {
                            earliestMins = sMins;
                            earliestItem = { course, session };
                        }
                    }
                });
            });

            if (earliestItem) {
                const totalMins = (d * 24 * 60) - curMins + earliestMins;
                nextUpcoming = { ...earliestItem, diffMins: totalMins, dayOffset: d };
                break;
            }
        }
    }

    const heroStatusTag = document.getElementById('hero-status-tag');
    const heroStatusText = document.getElementById('hero-status-text');
    const heroClassTitle = document.getElementById('hero-class-title');
    const heroTypeBadge = document.getElementById('hero-type-badge');
    const heroTimeBadge = document.getElementById('hero-time-badge');
    const heroInstructorBadge = document.getElementById('hero-instructor-badge');
    const heroRoomTitle = document.getElementById('hero-room-title');
    const heroRoomDesc = document.getElementById('hero-room-desc');
    const countdownLabel = document.getElementById('countdown-label');
    const countdownDigits = document.getElementById('countdown-digits');
    const countdownSub = document.getElementById('countdown-sub');

    if (inSession) {
        heroStatusTag.style.color = 'var(--nu-emerald)';
        heroStatusText.textContent = 'CLASS CURRENTLY IN SESSION';
        heroClassTitle.textContent = `${inSession.course.code}: ${inSession.course.title}`;

        heroTypeBadge.textContent = inSession.session.type;
        heroTypeBadge.className = `badge ${inSession.session.type === 'Lecture' ? 'badge-lecture' : inSession.session.type === 'Lab' ? 'badge-lab' : 'badge-tutorial'}`;
        heroTimeBadge.textContent = formatTimeRange(inSession.session.startTime, inSession.session.endTime);
        heroInstructorBadge.textContent = `Prof: ${inSession.session.instructor}`;

        heroRoomTitle.textContent = `${inSession.session.building} • ${inSession.session.room} (${inSession.session.floor})`;
        heroRoomDesc.textContent = `📍 Route: ${inSession.session.directions}`;

        countdownLabel.textContent = 'CLASS ENDS IN';
        countdownDigits.textContent = formatRemaining(inSession.remainingMins);
        countdownSub.textContent = `In Session Now • Ends at ${formatTime(inSession.session.endTime)}`;
    } else if (nextUpcoming) {
        heroStatusTag.style.color = 'var(--nu-cyan)';
        heroStatusText.textContent = nextUpcoming.dayOffset === 0 ? 'NEXT CLASS TODAY' : `NEXT CLASS (${DAYS[nextUpcoming.session.dayIndex]})`;
        heroClassTitle.textContent = `${nextUpcoming.course.code}: ${nextUpcoming.course.title}`;

        heroTypeBadge.textContent = nextUpcoming.session.type;
        heroTypeBadge.className = `badge ${nextUpcoming.session.type === 'Lecture' ? 'badge-lecture' : nextUpcoming.session.type === 'Lab' ? 'badge-lab' : 'badge-tutorial'}`;
        heroTimeBadge.textContent = `${nextUpcoming.session.day} @ ${formatTimeRange(nextUpcoming.session.startTime, nextUpcoming.session.endTime)}`;
        heroInstructorBadge.textContent = `Prof: ${nextUpcoming.session.instructor}`;

        heroRoomTitle.textContent = `Head to ${nextUpcoming.session.building} • ${nextUpcoming.session.room}`;
        heroRoomDesc.textContent = `🧭 Navigation: ${nextUpcoming.session.directions} (${nextUpcoming.session.floor})`;

        countdownLabel.textContent = 'STARTS IN';
        countdownDigits.textContent = formatRemaining(nextUpcoming.diffMins);
        countdownSub.textContent = 'Dual reminders will sound 20m & 15m before';
    } else {
        heroStatusText.textContent = 'SCHEDULE ALL CLEAR';
        heroClassTitle.textContent = 'No upcoming classes scheduled this week!';
        countdownDigits.textContent = '--:--:--';
    }
}

function formatRemaining(minutesFloat) {
    if (minutesFloat <= 0) return '00:00:00';
    const totalSecs = Math.floor(minutesFloat * 60);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// --- NAVIGATION & TABS ---
function setupNavigation() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const viewId = btn.getAttribute('data-view');
            appState.activeView = viewId;

            document.querySelectorAll('.view-content').forEach(view => {
                view.classList.remove('active');
            });
            const targetView = document.getElementById(`view-${viewId}`);
            if (targetView) targetView.classList.add('active');

            const btnCards = document.getElementById('btn-view-cards');
            const btnMatrix = document.getElementById('btn-view-matrix');
            if (viewId === 'weekly') {
                if (btnMatrix) btnMatrix.classList.add('active');
                if (btnCards) btnCards.classList.remove('active');
            } else if (viewId === 'agenda') {
                if (btnCards) btnCards.classList.add('active');
                if (btnMatrix) btnMatrix.classList.remove('active');
            }
        });
    });

    // Day filter chips & Quick Day Pills
    const allDayPills = document.querySelectorAll('.filter-chip, .day-pill');
    allDayPills.forEach(pill => {
        pill.addEventListener('click', () => {
            const dayVal = pill.getAttribute('data-day');
            allDayPills.forEach(p => {
                if (p.getAttribute('data-day') === dayVal) {
                    p.classList.add('active');
                } else {
                    p.classList.remove('active');
                }
            });
            appState.dayFilter = dayVal;
            renderDayAgenda();
            renderWeeklyGrid();
        });
    });

    // Mobile View Switcher (Cards vs Matrix)
    const btnViewCards = document.getElementById('btn-view-cards');
    const btnViewMatrix = document.getElementById('btn-view-matrix');
    
    if (btnViewCards && btnViewMatrix) {
        btnViewCards.addEventListener('click', () => {
            btnViewCards.classList.add('active');
            btnViewMatrix.classList.remove('active');
            const agendaTab = document.querySelector('.tab-btn[data-view="agenda"]');
            if (agendaTab) agendaTab.click();
        });

        btnViewMatrix.addEventListener('click', () => {
            btnViewMatrix.classList.add('active');
            btnViewCards.classList.remove('active');
            const weeklyTab = document.querySelector('.tab-btn[data-view="weekly"]');
            if (weeklyTab) weeklyTab.click();
        });
    }

    // Connect Mobile Bottom Navigation items
    const mobNavItems = document.querySelectorAll('.mobile-nav-item');
    mobNavItems.forEach(item => {
        item.addEventListener('click', () => {
            const mobView = item.getAttribute('data-mobview');
            if (mobView === 'theme') return; // Handled by inline toggleTheme()

            mobNavItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            if (mobView === 'home') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (mobView === 'weekly') {
                const weeklyTab = document.querySelector('.tab-btn[data-view="weekly"]');
                if (weeklyTab) weeklyTab.click();
                if (btnViewMatrix) {
                    btnViewMatrix.classList.add('active');
                    if (btnViewCards) btnViewCards.classList.remove('active');
                }
            } else if (mobView === 'agenda') {
                const agendaTab = document.querySelector('.tab-btn[data-view="agenda"]');
                if (agendaTab) agendaTab.click();
                if (btnViewCards) {
                    btnViewCards.classList.add('active');
                    if (btnViewMatrix) btnViewMatrix.classList.remove('active');
                }
            } else if (mobView === 'courses') {
                const coursesTab = document.querySelector('.tab-btn[data-view="courses"]');
                if (coursesTab) coursesTab.click();
            } else if (mobView === 'campus') {
                const campusTab = document.querySelector('.tab-btn[data-view="campus"]');
                if (campusTab) campusTab.click();
            }
        });
    });

    // Sync button - seamlessly updates without asking for username or password
    const btnSync = document.getElementById('btn-sync');
    if (btnSync) {
        btnSync.addEventListener('click', async () => {
            btnSync.innerHTML = '<span class="btn-icon">⏳</span> Syncing...';
            btnSync.disabled = true;
            try {
                const res = await authFetch('/api/sync', { method: 'POST' });
                const json = await res.json();
                if (json.status === 'success') {
                    showToast(`✅ Synced with PowerCampus! Schedule is up to date.`);
                    await loadScheduleData();
                } else if (res.status === 401) {
                    showToast(`ℹ️ Please sign in once to sync with PowerCampus.`);
                    const loginModal = document.getElementById('modal-portal-login');
                    if (loginModal) loginModal.classList.add('active');
                } else {
                    showToast(`⚠️ Sync notice: ${json.message || 'Server busy'}. Using latest schedule.`);
                }
            } catch (err) {
                showToast(`⚠️ Sync notice. Using latest saved schedule.`);
            } finally {
                btnSync.innerHTML = '<span class="btn-icon">🔄</span> Sync Portal';
                btnSync.disabled = false;
            }
        });
    }

    // Quick Test Alert Button
    const btnTestAlert = document.getElementById('btn-test-alert');
    if (btnTestAlert) {
        btnTestAlert.addEventListener('click', () => {
            playClassChime();
            showToast('🔔 Chime tested! 20m & 15m alerts ready.');
        });
    }

    // Open guide button in hero
    const btnOpenGuide = document.getElementById('btn-open-guide');
    if (btnOpenGuide) {
        btnOpenGuide.addEventListener('click', () => {
            document.querySelector('[data-view="campus"]').click();
        });
    }
}

// --- MODALS ---
function setupModals() {
    // 1. Settings Modal
    const modalSettings = document.getElementById('modal-settings');
    const btnOpenSettings = document.getElementById('btn-notify-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const btnTestNow = document.getElementById('btn-test-now');

    if (btnOpenSettings && modalSettings) {
        btnOpenSettings.addEventListener('click', () => {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
            modalSettings.classList.add('active');
        });
    }

    if (btnCloseSettings && modalSettings) {
        btnCloseSettings.addEventListener('click', () => modalSettings.classList.remove('active'));
    }

    // 2. Student Portal Login & Sync Modal
    const modalLogin = document.getElementById('modal-portal-login');
    const btnOpenLogin = document.getElementById('btn-open-login');
    const profileCardBtn = document.getElementById('profile-card-btn');
    const btnCloseLogin = document.getElementById('btn-close-login');
    const btnCancelLogin = document.getElementById('btn-cancel-login');
    const formLogin = document.getElementById('form-portal-login');
    const btnTogglePwd = document.getElementById('btn-toggle-pwd');
    const pwdInput = document.getElementById('nu-password');

    const openLoginModal = (isMandatory = false) => {
        if (!modalLogin) return;
        const userIn = document.getElementById('nu-username');
        if (userIn) {
            userIn.value = '';
            userIn.placeholder = 'e.g. H.Mohamed****';
            userIn.setAttribute('placeholder', 'e.g. H.Mohamed****');
        }
        if (pwdInput) {
            pwdInput.value = '';
        }
        if (isMandatory) {
            modalLogin.classList.add('is-mandatory');
        } else {
            modalLogin.classList.remove('is-mandatory');
        }
        modalLogin.classList.add('active');
    };
    window.nuAppOpenLogin = openLoginModal;

    if (btnOpenLogin) btnOpenLogin.addEventListener('click', () => openLoginModal(false));

    // Clicking profile card gives account status and direct 1-click Log Out option
    if (profileCardBtn) {
        profileCardBtn.addEventListener('click', () => {
            if (appState.isAuthenticated || localStorage.getItem('nu_device_token')) {
                const username = appState.schedule?.student?.username || 'Student';
                if (confirm(`👤 Signed in as: ${username}\nDevice Session: Active Forever (Live 1-Minute Verification Active)\n\nDo you want to Log Out from this device?`)) {
                    const btnLogout = document.getElementById('btn-logout');
                    if (btnLogout) btnLogout.click();
                }
            } else {
                openLoginModal(true);
            }
        });
    }

    if (btnCloseLogin && modalLogin) {
        btnCloseLogin.addEventListener('click', () => {
            modalLogin.classList.remove('active');
        });
    }
    if (btnCancelLogin && modalLogin) {
        btnCancelLogin.addEventListener('click', () => {
            modalLogin.classList.remove('active');
        });
    }

    // Preview Demo Schedule button for instant exploration
    const btnPreviewDemo = document.getElementById('btn-preview-demo');
    if (btnPreviewDemo) {
        btnPreviewDemo.addEventListener('click', async () => {
            try {
                btnPreviewDemo.disabled = true;
                btnPreviewDemo.textContent = 'Loading Demo...';
                const res = await fetch('/api/schedule-template');
                const sample = res.ok ? await res.json() : null;
                const importRes = await fetch('/api/import-schedule', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(sample || {})
                });
                const json = await importRes.json();
                if (json.token) localStorage.setItem('nu_device_token', json.token);
                appState.isAuthenticated = true;
                await loadScheduleData();
                modalLogin.classList.remove('is-mandatory');
                modalLogin.classList.remove('active');
                const btnLogout = document.getElementById('btn-logout');
                if (btnLogout) btnLogout.style.display = 'inline-flex';
                const btnOpenLogin = document.getElementById('btn-open-login');
                if (btnOpenLogin) btnOpenLogin.style.display = 'none';
                showToast('🎉 Demo schedule loaded! Full timetable and live features are ready.');
            } catch (err) {
                showToast('⚠️ Could not load demo schedule.');
            } finally {
                btnPreviewDemo.disabled = false;
                btnPreviewDemo.innerHTML = '<span>👀 Preview Demo</span>';
            }
        });
    }

    // Toggle password visibility
    if (btnTogglePwd && pwdInput) {
        btnTogglePwd.addEventListener('click', () => {
            const isPassword = pwdInput.type === 'password';
            pwdInput.type = isPassword ? 'text' : 'password';
            btnTogglePwd.textContent = isPassword ? '🙈' : '👁️';
        });
    }

    // Tab switcher between Portal Login and Manual Import
    const loginTabBtns = document.querySelectorAll('.login-tab-btn');
    const portalFormEl = document.getElementById('form-portal-login');
    const manualImportEl = document.getElementById('form-manual-import');

    loginTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            loginTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.getAttribute('data-logintab');
            if (tab === 'portal') {
                if (portalFormEl) portalFormEl.style.display = 'block';
                if (manualImportEl) manualImportEl.style.display = 'none';
            } else {
                if (portalFormEl) portalFormEl.style.display = 'none';
                if (manualImportEl) manualImportEl.style.display = 'block';
            }
        });
    });

    // Portal Login Form Submit Handler
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const usernameInput = document.getElementById('nu-username');
            const passwordInput = document.getElementById('nu-password');
            const chkSave = document.getElementById('chk-save-locally');
            const submitBtn = document.getElementById('btn-submit-login');
            const progressBox = document.getElementById('sync-progress-box');

            const username = usernameInput?.value?.trim();
            const password = passwordInput?.value;

            if (!username || !password) {
                showToast('⚠️ Please enter both your Nile University username and password.');
                return;
            }

            // Show animated progress steps
            if (progressBox) progressBox.style.display = 'flex';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="btn-icon">⏳</span> Authenticating with Nile Portal...';
            }

            const stepConnect = document.getElementById('stage-connect');
            const stepAuth = document.getElementById('stage-auth');
            const stepFetch = document.getElementById('stage-fetch');
            const stepBuild = document.getElementById('stage-build');

            const setStage = (stageEl, text) => {
                if (!stageEl) return;
                stageEl.className = 'sync-stage-item active';
                stageEl.querySelector('.stage-spinner, .stage-bullet').textContent = '⏳';
                if (text) stageEl.querySelector('.stage-text').textContent = text;
            };

            const markDone = (stageEl) => {
                if (!stageEl) return;
                stageEl.className = 'sync-stage-item done';
                const bullet = stageEl.querySelector('.stage-spinner, .stage-bullet');
                if (bullet) bullet.textContent = '✅';
            };

            setStage(stepConnect, 'Connecting securely to register.nu.edu.eg...');
            
            setTimeout(() => {
                markDone(stepConnect);
                setStage(stepAuth, `Authenticating student ${username}...`);
            }, 500);

            try {
                const res = await fetch('/api/login-sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: username,
                        password: password,
                        saveLocally: chkSave?.checked ?? false
                    })
                });

                const data = await res.json();

                if (data.status === 'success') {
                    markDone(stepAuth);
                    setStage(stepFetch, 'Retrieved active courses & sections from PowerCampus.');
                    setTimeout(() => markDone(stepFetch), 400);

                    setStage(stepBuild, 'Generating interactive timetable & campus directions...');
                    setTimeout(() => markDone(stepBuild), 700);

                    setTimeout(async () => {
                        if (data.token) localStorage.setItem('nu_device_token', data.token);
                        appState.isAuthenticated = true;
                        const btnOpenLogin = document.getElementById('btn-open-login');
                        const btnLogout = document.getElementById('btn-logout');
                        if (btnOpenLogin) btnOpenLogin.style.display = 'none';
                        if (btnLogout) btnLogout.style.display = 'inline-flex';

                        showToast(`🎉 Welcome, ${username}! Permanent session active on this device.`);
                        await loadScheduleData();
                        await loadConfigData();
                        modalLogin.classList.remove('is-mandatory');
                        modalLogin.classList.remove('active');
                        // Reset form & wipe password
                        if (passwordInput) passwordInput.value = '';
                        if (progressBox) progressBox.style.display = 'none';
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = '<span class="btn-icon">🔄</span> Authenticate & Sync Schedule';
                        }
                    }, 1000);
                } else {
                    showToast(`❌ Login failed: ${data.message || 'Please check username & password.'}`, 6000);
                    if (progressBox) progressBox.style.display = 'none';
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<span class="btn-icon">🔄</span> Authenticate & Sync Schedule';
                    }
                }
            } catch (err) {
                showToast(`❌ Connection error: ${err.message}`, 5000);
                if (progressBox) progressBox.style.display = 'none';
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span class="btn-icon">🔄</span> Authenticate & Sync Schedule';
                }
            }
        });
    }

    // Manual Import Submit
    const btnSubmitImport = document.getElementById('btn-submit-import');
    const btnLoadSample = document.getElementById('btn-load-sample');
    const importTextarea = document.getElementById('import-json-text');

    if (btnLoadSample && importTextarea) {
        btnLoadSample.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/schedule-template');
                if (res.ok) {
                    const sample = await res.json();
                    importTextarea.value = JSON.stringify(sample, null, 2);
                    showToast('📋 Loaded sample Nile University schedule template!');
                    return;
                }
            } catch (e) {}

            // Fallback template
            const defaultSample = {
                student: { username: "demo_student", program: "Computer Science", term: "Fall 2026", advisor: "Dr. Ahmed" },
                courses: [
                    {
                        code: "CSC111",
                        title: "Introduction to Computer Science",
                        color: "#2563eb",
                        sessions: [
                            { type: "Lecture", day: "Sunday", dayIndex: 0, startTime: "08:30", endTime: "10:00", room: "GUB1-116", building: "Academic Building 1", floor: "Ground Floor", instructor: "Dr. Mohamed", section: "01", directions: "UB1 Main Entrance -> Ground Floor Room 116" },
                            { type: "Lab", day: "Tuesday", dayIndex: 2, startTime: "10:30", endTime: "12:30", room: "BUB1-053", building: "Academic Building 1", floor: "Basement", instructor: "Eng. Sara", section: "01", directions: "UB1 Stairs to Basement -> Software Lab 053" }
                        ]
                    }
                ]
            };
            importTextarea.value = JSON.stringify(defaultSample, null, 2);
            showToast('📋 Loaded default schedule sample!');
        });
    }

    if (btnSubmitImport && importTextarea) {
        btnSubmitImport.addEventListener('click', async () => {
            try {
                const text = importTextarea.value.trim();
                if (!text) {
                    showToast('⚠️ Please enter or load schedule data first.');
                    return;
                }
                const parsed = JSON.parse(text);
                const res = await fetch('/api/import-schedule', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(parsed)
                });
                const json = await res.json();
                if (json.status === 'success' || res.ok) {
                    showToast('✅ Schedule imported successfully!');
                    if (json.token) localStorage.setItem('nu_device_token', json.token);
                    appState.isAuthenticated = true;
                    await loadScheduleData();
                    if (modalLogin) {
                        modalLogin.classList.remove('is-mandatory');
                        modalLogin.classList.remove('active');
                    }
                    const btnLogout = document.getElementById('btn-logout');
                    if (btnLogout) btnLogout.style.display = 'inline-flex';
                    const btnOpenLogin = document.getElementById('btn-open-login');
                    if (btnOpenLogin) btnOpenLogin.style.display = 'none';
                } else {
                    showToast(`⚠️ Import failed: ${json.message || 'Check format'}`);
                }
            } catch (e) {
                showToast('⚠️ Invalid JSON format. Please click "Load Default Sample" first.');
            }
        });
    }

    // 3. Calendar Export Modal (.ics & WebCal)
    const modalCalExport = document.getElementById('modal-calendar-export');
    const btnCalExport = document.getElementById('btn-calendar-export');
    const btnCloseCalExport = document.getElementById('btn-close-cal-export');
    const btnCloseCalFooter = document.getElementById('btn-close-cal-footer');
    const webcalInput = document.getElementById('webcal-url-input');
    const linkDirectWebcal = document.getElementById('link-direct-webcal');
    const btnCopyWebcal = document.getElementById('btn-copy-webcal');

    if (btnCalExport && modalCalExport) {
        btnCalExport.addEventListener('click', () => {
            const host = window.location.host;
            const proto = window.location.protocol === 'https:' ? 'webcals:' : 'webcal:';
            const token = localStorage.getItem('nu_device_token');
            const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
            const webcalUrl = `${proto}//${host}/api/calendar.ics${tokenQuery}`;
            const downloadUrl = `/api/calendar.ics${tokenQuery}`;
            if (webcalInput) webcalInput.value = webcalUrl;
            if (linkDirectWebcal) linkDirectWebcal.href = webcalUrl;
            const directDownloadLink = modalCalExport.querySelector('a[download]');
            if (directDownloadLink) directDownloadLink.href = downloadUrl;
            modalCalExport.classList.add('active');
        });
    }

    if (btnCloseCalExport && modalCalExport) btnCloseCalExport.addEventListener('click', () => modalCalExport.classList.remove('active'));
    if (btnCloseCalFooter && modalCalExport) btnCloseCalFooter.addEventListener('click', () => modalCalExport.classList.remove('active'));

    if (btnCopyWebcal && webcalInput) {
        btnCopyWebcal.addEventListener('click', () => {
            navigator.clipboard.writeText(webcalInput.value).then(() => {
                showToast('📋 WebCal subscription URL copied to clipboard!');
            }).catch(() => {
                webcalInput.select();
                document.execCommand('copy');
                showToast('📋 WebCal subscription URL copied!');
            });
        });
    }

    // 4. Academic Calendar Modal
    const modalAcademic = document.getElementById('modal-academic-calendar-view');
    const btnOpenAcademic = document.getElementById('btn-academic-calendar');
    const btnCloseAcademic = document.getElementById('btn-close-academic-view');
    const btnCloseAcademicFooter = document.getElementById('btn-close-academic-footer');
    const academicEventsList = document.getElementById('academic-events-list');

    if (btnOpenAcademic && modalAcademic) {
        btnOpenAcademic.addEventListener('click', async () => {
            modalAcademic.classList.add('active');
            if (academicEventsList) {
                academicEventsList.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-muted)">Loading academic calendar...</td></tr>';
                try {
                    const res = await fetch('/api/academic-calendar');
                    const json = await res.json();
                    let html = '';
                    (json.events || []).forEach(evt => {
                        const badgeColor = evt.type === 'exam' ? 'badge-rose' :
                                           evt.type === 'holiday' ? 'badge-amber' :
                                           evt.type === 'registration' ? 'badge-emerald' : 'badge-primary';
                        html += `
                            <tr>
                                <td><strong>${evt.title}</strong></td>
                                <td style="color:#e2e8f0;">${evt.date}</td>
                                <td><span class="badge ${badgeColor}">${evt.type.toUpperCase()}</span></td>
                            </tr>
                        `;
                    });
                    academicEventsList.innerHTML = html;
                } catch (e) {
                    academicEventsList.innerHTML = '<tr><td colspan="3" style="color:var(--nu-rose); text-align:center;">Failed to load academic calendar.</td></tr>';
                }
            }
        });
    }

    if (btnCloseAcademic && modalAcademic) btnCloseAcademic.addEventListener('click', () => modalAcademic.classList.remove('active'));
    if (btnCloseAcademicFooter && modalAcademic) btnCloseAcademicFooter.addEventListener('click', () => modalAcademic.classList.remove('active'));

    // 5. Schedule Changes Review Modal
    const modalChanges = document.getElementById('modal-changes-review');
    const btnViewChanges = document.getElementById('btn-view-changes');
    const btnDismissChanges = document.getElementById('btn-dismiss-changes');
    const btnCloseChanges = document.getElementById('btn-close-changes');
    const btnCloseChangesFooter = document.getElementById('btn-close-changes-footer');
    const changesListContainer = document.getElementById('changes-list-container');

    if (btnDismissChanges) {
        btnDismissChanges.addEventListener('click', () => {
            const banner = document.getElementById('schedule-changes-banner');
            if (banner) banner.style.display = 'none';
        });
    }

    if (btnViewChanges && modalChanges) {
        btnViewChanges.addEventListener('click', () => {
            modalChanges.classList.add('active');
            if (changesListContainer) {
                const list = appState.recentChanges || [];
                if (list.length === 0) {
                    changesListContainer.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">No changes recorded. Your schedule is up to date!</div>';
                    return;
                }
                let html = '';
                list.forEach(c => {
                    const typeClass = c.type || 'room_changed';
                    const d = c.timestamp ? new Date(c.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '8:00 AM Check';
                    html += `
                        <div class="change-row-item ${typeClass}">
                            <div>
                                <strong>${c.courseCode || 'Course'}</strong>: ${c.message}
                            </div>
                            <span class="change-time-badge">${d}</span>
                        </div>
                    `;
                });
                changesListContainer.innerHTML = html;
            }
        });
    }

    if (btnCloseChanges && modalChanges) btnCloseChanges.addEventListener('click', () => modalChanges.classList.remove('active'));
    if (btnCloseChangesFooter && modalChanges) btnCloseChangesFooter.addEventListener('click', () => modalChanges.classList.remove('active'));

    // 6. Device Logout Button (Complete Wipe of Personal Data from this PC)
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (confirm('Log out and delete all personal data from this PC?\n\nThis will completely wipe your schedule, cached courses, and session from this computer. You will need to enter your credentials again to sign in.')) {
                try {
                    await authFetch('/api/logout', { method: 'POST' });
                } catch (e) {}

                // Complete wipe of client storage
                try {
                    localStorage.clear();
                    sessionStorage.clear();
                } catch (e) {}

                // Delete all service worker caches
                try {
                    if ('caches' in window) {
                        const cacheKeys = await caches.keys();
                        for (const key of cacheKeys) {
                            await caches.delete(key);
                        }
                    }
                } catch (e) {}

                // Clear document cookies
                try {
                    document.cookie.split(";").forEach((c) => {
                        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
                    });
                } catch (e) {}

                showToast('👋 Logged out. All personal data wiped from this PC.');
                setTimeout(() => {
                    window.location.replace('/');
                }, 400);
            }
        });
    }

    // Modal background click close for all modals
    [
        modalSettings,
        modalLogin,
        modalCalExport,
        modalAcademic,
        modalChanges,
        document.getElementById('modal-class-detail')
    ].forEach(modal => {
        if (!modal) return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    const btnCloseDetail = document.getElementById('btn-close-detail');
    if (btnCloseDetail) {
        btnCloseDetail.addEventListener('click', () => {
            document.getElementById('modal-class-detail').classList.remove('active');
        });
    }

    // Save Settings
    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', async () => {
            const chkSound = document.getElementById('chk-sound')?.checked ?? true;
            const chkVibrate = document.getElementById('chk-vibrate')?.checked ?? true;

            const payload = {
                notifications: {
                    enabled: true,
                    leadMinutes: [20],
                    soundEnabled: chkSound,
                    vibrateEnabled: chkVibrate
                }
            };

            try {
                const res = await authFetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    appState.config = payload;
                    showToast('✅ Web alarm settings saved successfully!');
                    modalSettings.classList.remove('active');
                } else {
                    showToast('⚠️ Error saving settings.');
                }
            } catch (err) {
                showToast('⚠️ Error saving settings.');
            }
        });
    }

    // Test Alert Now (Web Chime + 20-Min Popup)
    if (btnTestNow) {
        btnTestNow.addEventListener('click', async () => {
            playClassChime();
            showToast('🔔 Triggering live 20-minute web alarm on this screen...');

            try {
                const chkSound = document.getElementById('chk-sound')?.checked ?? true;
                const chkVibrate = document.getElementById('chk-vibrate')?.checked ?? true;

                await authFetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        notifications: {
                            enabled: true,
                            leadMinutes: [20],
                            soundEnabled: chkSound,
                            vibrateEnabled: chkVibrate
                        }
                    })
                });

                await authFetch('/api/notify-test', { method: 'POST' });
            } catch (e) {}
        });
    }
}

// Open class detail modal
function openClassDetailModal(course, session) {
    const modal = document.getElementById('modal-class-detail');
    if (!modal) return;

    document.getElementById('detail-course-title').textContent = `${course.code}: ${course.title}`;
    document.getElementById('detail-course-code').textContent = `${session.type} • Section ${session.section} • ${course.credits} Credit Hours`;

    const body = document.getElementById('detail-body');
    const badgeClass = session.type === 'Lecture' ? 'badge-lecture' :
                       session.type === 'Lab' ? 'badge-lab' : 'badge-tutorial';

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px;">
                <div style="font-size: 0.8rem; text-transform:uppercase; color: var(--text-muted); margin-bottom: 4px;">Time & Day</div>
                <div style="font-size: 1.2rem; font-weight:700; color:#fff;">
                    ${session.day}, ${formatTimeRange(session.startTime, session.endTime)}
                </div>
                <div style="margin-top: 8px;">
                    <span class="badge ${badgeClass}">${session.type}</span>
                    <span class="badge badge-secondary" style="margin-left: 8px;">Sec ${session.section}</span>
                </div>
            </div>

            <div style="background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(37, 99, 235, 0.3); border-radius: var(--radius-md); padding: 16px;">
                <div style="font-size: 0.8rem; text-transform:uppercase; color: #60a5fa; margin-bottom: 4px;">Location & Route</div>
                <div style="font-size: 1.3rem; font-weight:800; color:#38bdf8;">📍 ${session.room}</div>
                <div style="font-size: 0.95rem; font-weight:600; color:#e2e8f0; margin-top: 4px;">${session.building} • ${session.floor}</div>
                <div style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 8px; background: rgba(0,0,0,0.25); padding: 10px; border-radius: var(--radius-sm);">
                    🧭 <strong>Directions:</strong> ${session.directions}
                </div>
            </div>

            <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px;">
                <div style="font-size: 0.8rem; text-transform:uppercase; color: var(--text-muted); margin-bottom: 4px;">Instructor</div>
                <div style="font-size: 1.05rem; font-weight:700; color:#fff;">👨‍🏫 ${session.instructor}</div>
            </div>

            <div style="display:flex; gap:10px;">
                <button class="btn btn-secondary btn-block" onclick="playClassChime(); showToast('Chime tested!')">
                    🔔 Test 20m & 15m Chime
                </button>
            </div>
        </div>
    `;

    modal.classList.add('active');
}

// 5. Room Finder
function setupRoomFinder() {
    const input = document.getElementById('room-search-input');
    const resultBox = document.getElementById('room-search-result');
    if (!input || !resultBox) return;

    input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        if (!query) {
            resultBox.innerHTML = '';
            resultBox.classList.remove('active');
            return;
        }

        const matches = [];
        (appState.schedule?.courses || []).forEach(course => {
            (course.sessions || []).forEach(s => {
                if (s.room.toLowerCase().includes(query) ||
                    s.floor.toLowerCase().includes(query) ||
                    s.building.toLowerCase().includes(query) ||
                    course.code.toLowerCase().includes(query)) {
                    matches.push({ course, session: s });
                }
            });
        });

        if (matches.length === 0) {
            resultBox.innerHTML = `<div class="text-muted" style="padding:10px;">No exact room match found for "${query}". Check building directory below.</div>`;
            resultBox.classList.add('active');
            return;
        }

        let html = '<div style="display:flex; flex-direction:column; gap:8px;">';
        matches.forEach(({ course, session }) => {
            html += `
                <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid var(--border-color); padding: 10px 14px; border-radius: var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="color:#38bdf8">${session.room}</strong> • ${session.building} (${session.floor})
                        <div style="font-size:0.78rem; color:var(--text-muted)">${course.code} (${session.type}) • ${session.day} ${session.startTime}</div>
                    </div>
                    <button class="btn btn-sm btn-ghost" onclick='openClassDetailModal(${JSON.stringify(course)}, ${JSON.stringify(session)})'>View Details</button>
                </div>
            `;
        });
        html += '</div>';

        resultBox.innerHTML = html;
        resultBox.classList.add('active');
    });
}

// 6. Real-Time Notification Stream (SSE)
function setupNotificationEvents() {
    try {
        const token = localStorage.getItem('nu_device_token');
        const sseUrl = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
        const evtSource = new EventSource(sseUrl);
        evtSource.addEventListener('class-reminder', (e) => {
            const data = JSON.parse(e.data);
            handleAlarmTrigger(data);
        });

        evtSource.addEventListener('test-reminder', (e) => {
            const data = JSON.parse(e.data);
            handleAlarmTrigger(data);
        });

        evtSource.addEventListener('schedule-updated', async (e) => {
            showToast('🔄 Real-time update: Nile schedule synchronized!');
            await loadScheduleData();
        });

        evtSource.addEventListener('schedule-change-alert', async (e) => {
            playClassChime();
            showToast('⚠️ Live 1-Minute Check: Classroom / Schedule change detected!', 9000);
            await checkScheduleChanges();
            await loadScheduleData();
        });
    } catch (err) {
        console.warn('SSE not supported or connection failed:', err);
    }
}

function handleAlarmTrigger(alertData) {
    playClassChime();

    const title = `🔔 Class in ${alertData.leadMinutes} Mins: ${alertData.courseCode}`;
    const body = `${alertData.type} in ${alertData.room} (${alertData.building})\nRoute: ${alertData.directions}`;

    showToast(`${title} - ${alertData.room}`, 8000);

    // Browser Web Notification if allowed
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(title, {
                body: body,
                icon: '/icon-192.png',
                vibrate: [300, 100, 300]
            });
        } catch (e) {}
    }
}

// Toast notification helper
function showToast(message, duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// --- THEME MANAGEMENT (Dark / Light Theme Toggle) ---
let isTogglingTheme = false;

function toggleTheme() {
    if (isTogglingTheme) return;
    isTogglingTheme = true;
    setTimeout(() => { isTogglingTheme = false; }, 200);

    const htmlTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const nextTheme = htmlTheme === 'light' ? 'dark' : 'light';
    applyThemeUI(nextTheme, true);
}

// Expose globally so inline onclick="toggleTheme()" works immediately
window.toggleTheme = toggleTheme;

function initTheme() {
    let activeTheme = 'dark';
    try {
        const saved = localStorage.getItem('nu_theme');
        if (saved === 'light' || saved === 'dark') {
            activeTheme = saved;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            activeTheme = 'light';
        }
    } catch (e) {}

    applyThemeUI(activeTheme, false);
}

function applyThemeUI(theme, showFeedback = false) {
    document.documentElement.setAttribute('data-theme', theme);
    if (document.body) document.body.setAttribute('data-theme', theme);

    try {
        localStorage.setItem('nu_theme', theme);
    } catch (e) {}

    const themeIcon = document.getElementById('theme-icon');
    const themeLabel = document.getElementById('theme-label');
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');

    // Update all modal theme buttons across all dialogs
    const allThemeButtons = document.querySelectorAll('.btn-theme-toggle, #btn-theme-toggle, #btn-modal-theme-toggle');
    allThemeButtons.forEach(btn => {
        const icon = btn.querySelector('.theme-icon, .btn-icon, #theme-icon');
        const label = btn.querySelector('.theme-label, .btn-label, #theme-label');
        if (theme === 'light') {
            if (icon) icon.textContent = '🌙';
            if (label) label.textContent = 'Dark Mode';
        } else {
            if (icon) icon.textContent = '☀️';
            if (label) label.textContent = 'Light Mode';
        }
    });

    if (theme === 'light') {
        if (themeIcon) themeIcon.textContent = '🌙';
        if (themeLabel) themeLabel.textContent = 'Dark Mode';
        if (metaThemeColor) metaThemeColor.setAttribute('content', '#f8fafc');
        const mobileIcon = document.getElementById('mobile-theme-icon');
        if (mobileIcon) mobileIcon.textContent = '🌙';
        if (showFeedback) showToast('☀️ Switched to Light Theme — Easy to read');
    } else {
        if (themeIcon) themeIcon.textContent = '☀️';
        if (themeLabel) themeLabel.textContent = 'Light Mode';
        if (metaThemeColor) metaThemeColor.setAttribute('content', '#070d18');
        const mobileIcon = document.getElementById('mobile-theme-icon');
        if (mobileIcon) mobileIcon.textContent = '☀️';
        if (showFeedback) showToast('🌙 Switched to Dark Theme');
    }
}

// --- TIME FORMAT MANAGEMENT (12h vs 24h) ---
function getTimeFormat() {
    return localStorage.getItem('nu_time_format') || '12h'; // Default to 12-hour format with AM/PM
}

function setTimeFormat(fmt, showFeedback = true) {
    const is24h = fmt === '24h';
    localStorage.setItem('nu_time_format', is24h ? '24h' : '12h');
    updateTimeFormatUI();
    renderAllViews();
    if (showFeedback) {
        showToast(is24h ? '⏱️ Switched to 24-Hour Military Time' : '🕒 Switched to 12-Hour AM/PM Time');
    }
}

function toggleTimeFormat() {
    const current = getTimeFormat();
    setTimeFormat(current === '24h' ? '12h' : '24h', true);
}

function updateTimeFormatUI() {
    const is24h = getTimeFormat() === '24h';
    const btnLabel = document.getElementById('time-format-label');
    const btnIcon = document.getElementById('time-format-icon');
    const chk24 = document.getElementById('chk-24h-format');

    if (btnLabel) btnLabel.textContent = is24h ? '24-Hour' : '12-Hour';
    if (btnIcon) btnIcon.textContent = is24h ? '⏱️' : '🕒';
    if (chk24) chk24.checked = is24h;
}

function initTimeFormat() {
    updateTimeFormatUI();
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    const is24h = getTimeFormat() === '24h';
    if (is24h) return timeStr;
    try {
        const parts = timeStr.split(':');
        if (parts.length < 2) return timeStr;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = (h % 12 === 0) ? 12 : (h % 12);
        const mStr = String(m).padStart(2, '0');
        return `${h12}:${mStr} ${period}`;
    } catch (e) {
        return timeStr;
    }
}

function formatTimeRange(start, end) {
    return `${formatTime(start)} – ${formatTime(end)}`;
}

// Expose globally for inline button onclick and settings modal onchange
window.toggleTimeFormat = toggleTimeFormat;
window.setTimeFormat = setTimeFormat;
window.formatTime = formatTime;
window.formatTimeRange = formatTimeRange;

