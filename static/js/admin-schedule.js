/* ================================================================
   admin-schedule.js — Admin Scheduling Management
   ================================================================ */

const DAYS_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MONTHS_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let adminCurrentYear, adminCurrentMonth;
let allBookings = [];
let adminAvailability = [];
let adminConfig = {};
let selectedAdminDate = null;
let blockedDatesSet = new Set();
let blockedDatesList = [];

// ---- Auth ----
async function checkAuth() {
    const res = await fetch('/api/check-session');
    if (res.status === 401) window.location.href = '/login';
}

document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/logout', {method:'POST'});
    window.location.href = '/login';
});

// ---- Init ----
async function checkGoogleStatus() {
    try {
        const res = await fetch('/api/google/status');
        const data = await res.json();
        if (data.connected && data.email) {
            document.getElementById('google-connected-email').textContent = data.email;
            document.getElementById('google-connected-email').style.display = 'block';
            document.querySelector('#google-connect-btn span').textContent = 'Reconnect';
        }
    } catch(e) {
        console.error('Failed to fetch google status', e);
    }
}

async function init() {
    await checkAuth();
    const now = new Date();
    adminCurrentYear = now.getFullYear();
    adminCurrentMonth = now.getMonth();
    await checkGoogleStatus();
    await loadConfig();
    await loadAvailability();
    await loadBlockedDates();
    await loadAllBookings();
    renderAvailabilityGrid();
    renderAdminCalendar();
}

// ================================================================
// Config (Form Active + Slot Duration)
// ================================================================
async function loadConfig() {
    try {
        adminConfig = await fetch('/api/schedule/config').then(r => r.json());
        const toggle = document.getElementById('form-active-toggle');
        toggle.checked = !!adminConfig.form_active;
        updateStatusBadge(!!adminConfig.form_active);

        // Set slot duration dropdown
        const select = document.getElementById('slot-duration-select');
        const knownValues = ['15','30','45','60','90'];
        const durVal = String(adminConfig.slot_duration);
        if (knownValues.includes(durVal)) {
            select.value = durVal;
            document.getElementById('custom-slot-wrapper').style.display = 'none';
        } else {
            select.value = '0';
            document.getElementById('custom-slot-wrapper').style.display = 'block';
            document.getElementById('custom-slot-input').value = adminConfig.custom_slot_minutes || adminConfig.slot_duration || 30;
        }

        // Daily Break UI load
        document.getElementById('break-active-toggle').checked = !!adminConfig.break_enabled;
        document.getElementById('break-start-input').value = adminConfig.break_start || '13:00';
        document.getElementById('break-end-input').value = adminConfig.break_end || '14:00';
    } catch(e) { console.error('Config load failed', e); }
}

function updateStatusBadge(active) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    dot.className = 'status-dot ' + (active ? 'active' : 'inactive');
    label.textContent = active ? 'Booking Form is ACTIVE — accepting new bookings' : 'Booking Form is INACTIVE — no new bookings allowed';
}

function onSlotDurationChange() {
    const val = document.getElementById('slot-duration-select').value;
    document.getElementById('custom-slot-wrapper').style.display = val === '0' ? 'block' : 'none';
}

async function updateConfig() {
    const formActive = document.getElementById('form-active-toggle').checked;
    const slotVal = parseInt(document.getElementById('slot-duration-select').value);
    let slotDuration = slotVal;
    let customSlot = null;

    if (slotVal === 0) {
        customSlot = parseInt(document.getElementById('custom-slot-input').value) || 30;
        slotDuration = 0;
    }

    const breakEnabled = document.getElementById('break-active-toggle').checked;
    const breakStart = document.getElementById('break-start-input').value;
    const breakEnd = document.getElementById('break-end-input').value;

    updateStatusBadge(formActive);

    try {
        const res = await fetch('/api/schedule/config', {
            method: 'PUT',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                form_active: formActive,
                slot_duration: slotDuration,
                custom_slot_minutes: customSlot,
                break_enabled: breakEnabled,
                break_start: breakStart,
                break_end: breakEnd
            })
        });
        if (!res.ok) throw new Error('Failed to update config');
        showToast('Settings saved successfully!');
        adminConfig.form_active = formActive;
        adminConfig.slot_duration = slotDuration;
        adminConfig.custom_slot_minutes = customSlot;
        adminConfig.break_enabled = breakEnabled;
        adminConfig.break_start = breakStart;
        adminConfig.break_end = breakEnd;
    } catch(e) {
        showToast(e.message, true);
    }
}

async function updateBreakConfig(showSuccess = false) {
    const breakStart = document.getElementById('break-start-input').value;
    const breakEnd = document.getElementById('break-end-input').value;
    if (breakStart >= breakEnd) {
        showToast('Daily break end time must be after start time.', true);
        return;
    }
    await updateConfig();
    if (showSuccess) {
        showToast('Daily break settings saved!');
        renderAdminCalendar();
    }
}

// ================================================================
// Availability Grid
// ================================================================
async function loadAvailability() {
    try {
        adminAvailability = await fetch('/api/schedule/availability').then(r => r.json());
    } catch(e) { console.error('Availability load failed', e); }
}

function renderAvailabilityGrid() {
    const grid = document.getElementById('availability-grid');
    grid.innerHTML = '';

    // Days: Mon=0, Tue=1, ... Sun=6 (DB day_of_week)
    const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

    for (let i = 0; i < 7; i++) {
        const existing = adminAvailability.find(a => a.day_of_week === i);
        const isActive = existing ? !!existing.is_active : false;
        const startTime = existing ? existing.start_time : '09:00';
        const endTime = existing ? existing.end_time : '18:00';

        const row = document.createElement('div');
        row.classList.add('avail-row');
        if (!isActive) row.classList.add('inactive-row');
        row.id = `avail-row-${i}`;

        row.innerHTML = `
            <div class="avail-day-label">${dayNames[i]}</div>
            <label class="toggle-switch" title="${isActive ? 'Click to disable' : 'Click to enable'}">
                <input type="checkbox" id="avail-active-${i}" ${isActive ? 'checked' : ''} onchange="toggleAvailRow(${i})">
                <span class="toggle-slider"></span>
            </label>
            <div>
                <label style="font-size:.75rem;color:var(--text-muted);font-weight:600;display:block;margin-bottom:.2rem;">From</label>
                <input type="time" id="avail-start-${i}" class="avail-time-input" value="${startTime}" ${!isActive ? 'disabled' : ''}>
            </div>
            <div>
                <label style="font-size:.75rem;color:var(--text-muted);font-weight:600;display:block;margin-bottom:.2rem;">To</label>
                <input type="time" id="avail-end-${i}" class="avail-time-input" value="${endTime}" ${!isActive ? 'disabled' : ''}>
            </div>
            <div class="avail-toggle-label" id="avail-status-${i}" style="color:${isActive ? 'var(--primary)' : 'var(--text-muted)'}">
                ${isActive ? '✓ Active' : '✗ Off'}
            </div>
        `;

        grid.appendChild(row);
    }
}

function toggleAvailRow(dayIndex) {
    const isActive = document.getElementById(`avail-active-${dayIndex}`).checked;
    const row = document.getElementById(`avail-row-${dayIndex}`);
    const startInput = document.getElementById(`avail-start-${dayIndex}`);
    const endInput = document.getElementById(`avail-end-${dayIndex}`);
    const statusLabel = document.getElementById(`avail-status-${dayIndex}`);

    if (isActive) {
        row.classList.remove('inactive-row');
        startInput.disabled = false;
        endInput.disabled = false;
        statusLabel.textContent = '✓ Active';
        statusLabel.style.color = 'var(--primary)';
    } else {
        row.classList.add('inactive-row');
        startInput.disabled = true;
        endInput.disabled = true;
        statusLabel.textContent = '✗ Off';
        statusLabel.style.color = 'var(--text-muted)';
    }
}

async function saveAvailability() {
    const slots = [];
    for (let i = 0; i < 7; i++) {
        const isActive = document.getElementById(`avail-active-${i}`).checked;
        const start = document.getElementById(`avail-start-${i}`).value;
        const end = document.getElementById(`avail-end-${i}`).value;
        if (isActive && start >= end) {
            showToast(`Invalid time range for ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}: end must be after start.`, true);
            return;
        }
        slots.push({ day_of_week: i, start_time: start || '09:00', end_time: end || '18:00', is_active: isActive });
    }

    try {
        const res = await fetch('/api/schedule/availability', {
            method: 'PUT',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ slots })
        });
        if (!res.ok) throw new Error('Failed to save availability');
        adminAvailability = await fetch('/api/schedule/availability').then(r => r.json());
        showToast('Availability saved! Calendar updated.');
        renderAdminCalendar();
    } catch(e) {
        showToast(e.message, true);
    }
}

// ================================================================
// Admin Calendar
// ================================================================
function renderAdminCalendar() {
    const label = document.getElementById('admin-cal-month-label');
    label.textContent = `${MONTHS_NAMES[adminCurrentMonth]} ${adminCurrentYear}`;

    const grid = document.getElementById('admin-cal-grid');
    // Remove existing day cells
    grid.querySelectorAll('.admin-cal-day, .admin-empty-cell').forEach(el => el.remove());

    const firstDay = new Date(adminCurrentYear, adminCurrentMonth, 1).getDay();
    const daysInMonth = new Date(adminCurrentYear, adminCurrentMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0,0,0,0);

    // Build bookings map for this month
    const bookingsByDate = {};
    allBookings.forEach(b => {
        if (!bookingsByDate[b.booked_date]) bookingsByDate[b.booked_date] = [];
        bookingsByDate[b.booked_date].push(b);
    });

    for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement('div');
        blank.classList.add('admin-empty-cell');
        blank.style.cssText = 'background:none;border:1px solid transparent;border-radius:12px;min-height:72px;';
        grid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const thisDate = new Date(adminCurrentYear, adminCurrentMonth, d);
        const dateStr = formatDate(adminCurrentYear, adminCurrentMonth + 1, d);
        // JS weekday → DB day_of_week (Mon=0,...,Sun=6)
        const jsDay = thisDate.getDay();
        const dbDay = jsDay === 0 ? 6 : jsDay - 1;
        const avail = adminAvailability.find(a => a.day_of_week === dbDay && a.is_active === 1);
        const isBlocked = blockedDatesSet.has(dateStr);

        const dayEl = document.createElement('div');
        dayEl.classList.add('admin-cal-day');
        if (!avail) dayEl.classList.add('unavailable-day');
        if (isBlocked) dayEl.classList.add('blocked-day');
        if (thisDate.toDateString() === today.toDateString()) dayEl.classList.add('today');
        if (dateStr === selectedAdminDate) dayEl.classList.add('selected-admin');

        const bookingsHere = bookingsByDate[dateStr] || [];
        if (bookingsHere.length > 0) dayEl.classList.add('has-bookings');

        dayEl.innerHTML = `<div class="admin-day-num">${d}</div><div class="admin-booking-chips" id="chips-${dateStr}"></div>`;

        const chipsContainer = dayEl.querySelector(`#chips-${dateStr}`);
        bookingsHere.slice(0, 3).forEach(b => {
            const chip = document.createElement('div');
            chip.classList.add('admin-booking-chip', b.status);
            chip.textContent = `${b.booked_time} ${b.client_name.split(' ')[0]}`;
            chipsContainer.appendChild(chip);
        });
        if (bookingsHere.length > 3) {
            const more = document.createElement('div');
            more.classList.add('admin-booking-chip');
            more.textContent = `+${bookingsHere.length - 3} more`;
            chipsContainer.appendChild(more);
        }

        if (!dayEl.classList.contains('unavailable-day') || bookingsHere.length > 0 || isBlocked) {
            dayEl.style.cursor = 'pointer';
            dayEl.addEventListener('click', () => showAdminDayDetail(dateStr, bookingsHere, dayEl));
        }

        grid.appendChild(dayEl);
    }
}

async function showAdminDayDetail(dateStr, bookingsForDay, dayEl) {
    selectedAdminDate = dateStr;
    document.querySelectorAll('.admin-cal-day').forEach(d => d.classList.remove('selected-admin'));
    dayEl.classList.add('selected-admin');

    const [y, m, d] = dateStr.split('-');
    const jsDate = new Date(+y, +m-1, +d);
    const heading = `${DAYS_FULL[jsDate.getDay()]}, ${MONTHS_NAMES[+m-1]} ${+d}, ${+y}`;

    // Show block/unblock button for this date
    const isBlocked = blockedDatesSet.has(dateStr);
    let blockBtnHtml = '';
    const jsDateCheck = new Date(+y, +m-1, +d);
    const todayCheck = new Date(); todayCheck.setHours(0,0,0,0);
    if (jsDateCheck >= todayCheck) {
        if (isBlocked) {
            blockBtnHtml = `<button class="btn" onclick="unblockDate('${dateStr}')" style="padding:.5rem 1rem;font-size:.85rem;border-radius:10px;background:var(--secondary-gradient);width:auto;margin-right:.5rem;">✓ Unblock This Date</button>`;
        } else {
            blockBtnHtml = `<button class="btn" onclick="blockDate('${dateStr}')" style="padding:.5rem 1rem;font-size:.85rem;border-radius:10px;background:var(--accent-gradient);width:auto;margin-right:.5rem;">✗ Block This Date</button>`;
        }
    }
    document.getElementById('admin-day-heading').innerHTML = `Bookings for ${heading} ${isBlocked ? '<span style="color:#d63031;font-size:.85rem;">(BLOCKED)</span>' : ''}`;
    document.getElementById('admin-day-actions').innerHTML = blockBtnHtml + '<button class="btn btn-secondary" onclick="closeAdminDayDetail()" style="padding:.4rem .9rem;font-size:.85rem;border-radius:8px;width:auto;">Close</button>';

    const tbody = document.getElementById('admin-bookings-tbody');
    tbody.innerHTML = '';

    if (bookingsForDay.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">No bookings for this day.</td></tr>`;
    } else {
        bookingsForDay.sort((a,b) => a.booked_time.localeCompare(b.booked_time));
        bookingsForDay.forEach(b => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.innerHTML = `
                <td style="font-weight:700;">${formatTime12(b.booked_time)}</td>
                <td>${b.client_name}</td>
                <td>${b.client_email}</td>
                <td>${b.client_phone || '—'}</td>
                <td style="max-width:180px;white-space:normal;font-size:.85rem;">${b.notes || '—'}</td>
                <td><span class="status-pill ${b.status}">${b.status}</span></td>
                <td>
                    <div class="action-btns">
                        ${b.status !== 'completed' ? `<button class="action-btn success" onclick="updateBookingStatus(${b.id},'completed')">Done</button>` : ''}
                        ${b.status !== 'cancelled' ? `<button class="action-btn danger" onclick="updateBookingStatus(${b.id},'cancelled')">Cancel</button>` : ''}
                        ${b.status === 'cancelled' ? `<button class="action-btn" onclick="updateBookingStatus(${b.id},'confirmed')">Restore</button>` : ''}
                    </div>
                </td>
            `;
            
            tr.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                openBookingDrawer(b);
            });
            
            tbody.appendChild(tr);
        });
    }

    // Load custom date breaks
    await renderDateBreaks(dateStr);

    document.getElementById('admin-day-detail').style.display = 'block';
    document.getElementById('admin-day-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderDateBreaks(dateStr) {
    const listDiv = document.getElementById('date-breaks-list');
    listDiv.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);">Loading custom blocks...</div>';
    try {
        const breaks = await fetch(`/api/schedule/date-breaks/${dateStr}`).then(r => r.json());
        listDiv.innerHTML = '';
        if (breaks.length === 0) {
            listDiv.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);font-style:italic;padding:.5rem 0;">No custom blocks/breaks for this date.</div>';
            return;
        }
        breaks.forEach(b => {
            const item = document.createElement('div');
            item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:rgba(255,118,117,.06); border:1px solid rgba(255,118,117,.15); padding:.4rem .7rem; border-radius:10px; font-size:.8rem;';
            
            const infoSpan = document.createElement('span');
            infoSpan.style.fontWeight = '600';
            infoSpan.style.color = '#d63031';
            infoSpan.innerHTML = `⏰ ${formatTime12(b.start_time)} – ${formatTime12(b.end_time)} ${b.reason ? `<br><span style="font-size:.7rem;font-weight:normal;color:var(--text-muted);">${b.reason}</span>` : ''}`;
            
            const delBtn = document.createElement('button');
            delBtn.style.cssText = 'border:none; background:none; color:#d63031; cursor:pointer; font-weight:700; font-size:1.1rem; padding:0 .2rem;';
            delBtn.innerHTML = '×';
            delBtn.title = 'Remove Block';
            delBtn.addEventListener('click', () => removeDateBreak(b.id));

            item.appendChild(infoSpan);
            item.appendChild(delBtn);
            listDiv.appendChild(item);
        });
    } catch(e) {
        listDiv.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);">Error loading blocks.</div>';
    }
}

async function addDateBreak() {
    if (!selectedAdminDate) {
        showToast('Please select a date first.', true);
        return;
    }
    const start = document.getElementById('add-break-start').value;
    const end = document.getElementById('add-break-end').value;
    const reason = document.getElementById('add-break-reason').value.trim();

    if (!start || !end) {
        showToast('Please specify start and end times.', true);
        return;
    }
    if (start >= end) {
        showToast('End time must be after start time.', true);
        return;
    }

    try {
        const res = await fetch('/api/schedule/date-breaks', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                break_date: selectedAdminDate,
                start_time: start,
                end_time: end,
                reason: reason || 'Blocked'
            })
        });
        if (!res.ok) throw new Error('Failed to add block/break');
        showToast('Custom block/break added successfully!');
        document.getElementById('add-break-reason').value = '';
        await renderDateBreaks(selectedAdminDate);
        renderAdminCalendar();
    } catch(e) {
        showToast(e.message, true);
    }
}

async function removeDateBreak(breakId) {
    if (!confirm('Are you sure you want to remove this block/break?')) return;
    try {
        const res = await fetch(`/api/schedule/date-breaks/${breakId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to remove block/break');
        showToast('Block/break removed.');
        await renderDateBreaks(selectedAdminDate);
        renderAdminCalendar();
    } catch(e) {
        showToast(e.message, true);
    }
}

function closeAdminDayDetail() {
    document.getElementById('admin-day-detail').style.display = 'none';
    selectedAdminDate = null;
    document.querySelectorAll('.admin-cal-day').forEach(d => d.classList.remove('selected-admin'));
}

function changeAdminMonth(dir) {
    adminCurrentMonth += dir;
    if (adminCurrentMonth > 11) { adminCurrentMonth = 0; adminCurrentYear++; }
    if (adminCurrentMonth < 0) { adminCurrentMonth = 11; adminCurrentYear--; }
    closeAdminDayDetail();
    renderAdminCalendar();
}

// ================================================================
// All Bookings Table
// ================================================================
async function loadAllBookings() {
    try {
        allBookings = await fetch('/api/schedule/bookings').then(r => r.json());
        currentFilteredBookings = [...allBookings];
        currentBookingsPage = 1;
        renderPaginatedBookings();
    } catch(e) { console.error('Bookings load failed', e); }
}

// Sliding Drawer for Booking Details
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerCloseBtn = document.getElementById('drawer-close-btn');
const drawerContent = document.getElementById('drawer-content');

if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);
if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

function closeDrawer() {
    if (drawer) drawer.classList.remove('open');
    if (drawerOverlay) drawerOverlay.classList.remove('active');
}

function escapeHtml(string) {
    if (!string) return '';
    return String(string)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function openBookingDrawer(b) {
    const [y, m, d] = b.booked_date.split('-');
    const dateLabel = `${MONTHS_NAMES[+m-1]} ${+d}, ${+y}`;

    drawerContent.innerHTML = `
        <div class="drawer-section" style="background: rgba(108, 92, 231, 0.05); border: 1px solid rgba(108, 92, 231, 0.15); border-radius: 14px; padding: 1.2rem; margin-bottom: 1.8rem;">
            <div class="drawer-section-title" style="color: #6c5ce7; font-weight: 800; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem;">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>
                Consultation Scheduled Time
            </div>
            <div style="font-weight: 700; color: var(--text-primary); font-size: 1.05rem;">
                📅 ${dateLabel} &nbsp;&middot;&nbsp; ⏰ ${formatTime12(b.booked_time)}
            </div>
            ${b.meet_link ? `
            <a href="${escapeHtml(b.meet_link)}" target="_blank" class="btn" style="margin-top: 1rem; width: 100%; padding: 0.7rem; font-size: 0.9rem; border-radius: 10px; background: var(--accent-gradient); text-decoration: none; color: white; display: flex; align-items: center; justify-content: center; gap: 0.4rem; box-shadow: 0 4px 15px rgba(0, 206, 201, 0.2); width: auto;">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>
                Join Google Meet
            </a>` : ''}
        </div>

        <div class="drawer-section">
            <div class="drawer-section-title">Client Name</div>
            <div class="drawer-section-value" style="font-size: 1.15rem; font-weight: 700;">${escapeHtml(b.client_name)}</div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-title">Client Email</div>
            <div class="drawer-section-value">${escapeHtml(b.client_email)}</div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-title">Client Phone</div>
            <div class="drawer-section-value">${escapeHtml(b.client_phone || 'None provided')}</div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-title">Booking Status</div>
            <div class="drawer-section-value">
                <span class="status-pill ${b.status}" style="font-size: 0.85rem; padding: 0.35rem 0.8rem; font-weight: 700; text-transform: uppercase;">
                    ${b.status}
                </span>
            </div>
        </div>

        <div class="drawer-section" style="border-top: 1px solid var(--border-color); padding-top: 1.5rem;">
            <div class="drawer-section-title">Client Notes / Request Comments</div>
            <div class="drawer-section-value" style="font-style: italic; color: var(--text-secondary); line-height: 1.5; white-space: pre-line;">
                ${b.notes ? `"${escapeHtml(b.notes)}"` : '<span style="color: var(--text-muted);">No notes provided.</span>'}
            </div>
        </div>

        <div class="drawer-section" style="border-top: 1px solid var(--border-color); padding-top: 1.5rem;">
            <div class="drawer-section-title">Created On</div>
            <div class="drawer-section-value" style="font-size: 0.85rem; color: var(--text-muted);">
                ${b.created_at || 'N/A'}
            </div>
        </div>
    `;

    drawerOverlay.classList.add('active');
    drawer.classList.add('open');
}

function renderAllBookingsTable(bookings) {
    const tbody = document.getElementById('all-bookings-tbody');
    tbody.innerHTML = '';

    if (bookings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:3rem;color:var(--text-muted);">No bookings match the filters.</td></tr>`;
        return;
    }

    bookings.forEach(b => {
        const tr = document.createElement('tr');
        const [y, m, d] = b.booked_date.split('-');
        const dateLabel = `${MONTHS_NAMES[+m-1]} ${+d}, ${+y}`;

        const meetLinkHtml = b.meet_link ? `
            <a href="${escapeHtml(b.meet_link)}" target="_blank" class="btn" style="padding: 0.35rem 0.7rem; font-size: 0.75rem; border-radius: 6px; background: var(--accent-gradient); text-decoration: none; color: white; display: inline-flex; align-items: center; gap: 0.25rem; box-shadow: none; width: auto; font-family: inherit;">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>
                Join
            </a>
        ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">No Link</span>';

        tr.innerHTML = `
            <td style="font-weight:700;">${dateLabel}<br><span style="color:var(--text-muted);font-size:.82rem;">${formatTime12(b.booked_time)}</span></td>
            <td>${b.client_name}</td>
            <td>${b.client_email}</td>
            <td>${b.client_phone || '—'}</td>
            <td>${meetLinkHtml}</td>
            <td><span class="status-pill ${b.status}">${b.status}</span></td>
            <td>
                <div class="action-btns">
                    ${b.status !== 'completed' ? `<button class="action-btn success" onclick="updateBookingStatus(${b.id},'completed')">Done</button>` : ''}
                    ${b.status !== 'cancelled' ? `<button class="action-btn danger" onclick="updateBookingStatus(${b.id},'cancelled')">Cancel</button>` : ''}
                    ${b.status === 'cancelled' ? `<button class="action-btn" onclick="updateBookingStatus(${b.id},'confirmed')">Restore</button>` : ''}
                </div>
            </td>
        `;

        // Click row (except links or buttons) to open details drawer
        tr.addEventListener('click', (e) => {
            if (e.target.closest('a') || e.target.closest('button')) return;
            openBookingDrawer(b);
        });

        tbody.appendChild(tr);
    });
}

// Combined Search, Status dropdown, Meeting Date, and Created Date filtering with Pagination
const bookingsSearch = document.getElementById('bookings-search');
const bookingsStatusFilter = document.getElementById('bookings-status-filter');
const bookingsDateFilter = document.getElementById('bookings-date-filter');
const bookingsCreatedFilter = document.getElementById('bookings-created-filter');

let currentBookingsPage = 1;
const bookingsPerPage = 15;
let currentFilteredBookings = [];

function renderPaginatedBookings() {
    const total = currentFilteredBookings.length;
    const totalPages = Math.ceil(total / bookingsPerPage) || 1;
    
    // Guard page bounds
    if (currentBookingsPage > totalPages) currentBookingsPage = totalPages;
    if (currentBookingsPage < 1) currentBookingsPage = 1;
    
    const startIdx = (currentBookingsPage - 1) * bookingsPerPage;
    const endIdx = Math.min(startIdx + bookingsPerPage, total);
    
    const pageSlice = currentFilteredBookings.slice(startIdx, endIdx);
    renderAllBookingsTable(pageSlice);
    
    // Update pagination UI
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
        if (total === 0) {
            infoEl.textContent = 'Showing 0 of 0 bookings';
        } else {
            infoEl.textContent = `Showing ${startIdx + 1}-${endIdx} of ${total} bookings`;
        }
    }
    
    const prevBtn = document.getElementById('btn-prev-page');
    const nextBtn = document.getElementById('btn-next-page');
    if (prevBtn) prevBtn.disabled = (currentBookingsPage === 1);
    if (nextBtn) nextBtn.disabled = (currentBookingsPage === totalPages);
    
    // Render page number pills
    const pagesEl = document.getElementById('pagination-pages');
    if (pagesEl) {
        pagesEl.innerHTML = '';
        
        const maxPills = 5;
        let startPage = Math.max(1, currentBookingsPage - 2);
        let endPage = Math.min(totalPages, startPage + maxPills - 1);
        
        if (endPage - startPage < maxPills - 1) {
            startPage = Math.max(1, endPage - maxPills + 1);
        }
        
        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `btn ${i === currentBookingsPage ? '' : 'btn-secondary'}`;
            btn.style.cssText = 'padding: 0.35rem 0.7rem; font-size: 0.8rem; border-radius: 6px; width: auto; margin-bottom: 0; min-width: 28px; display: inline-flex; align-items: center; justify-content: center;';
            btn.textContent = i;
            if (i === currentBookingsPage) {
                btn.style.background = 'var(--accent-gradient)';
                btn.style.color = '#fff';
                btn.style.border = 'none';
            }
            btn.addEventListener('click', () => {
                currentBookingsPage = i;
                renderPaginatedBookings();
            });
            pagesEl.appendChild(btn);
        }
    }
}

function changeBookingsPage(direction) {
    currentBookingsPage += direction;
    renderPaginatedBookings();
}

function applyBookingsFilters() {
    const q = bookingsSearch ? bookingsSearch.value.toLowerCase().trim() : '';
    const status = bookingsStatusFilter ? bookingsStatusFilter.value : '';
    const meetDateVal = bookingsDateFilter ? bookingsDateFilter.value : '';
    const createdDateVal = bookingsCreatedFilter ? bookingsCreatedFilter.value : '';

    currentFilteredBookings = allBookings.filter(b => {
        const matchesSearch = !q || (
            b.client_name.toLowerCase().includes(q) ||
            b.client_email.toLowerCase().includes(q) ||
            (b.client_phone || '').includes(q) ||
            b.booked_date.includes(q)
        );
        const matchesStatus = !status || b.status === status;
        const matchesMeetDate = !meetDateVal || b.booked_date === meetDateVal;
        const matchesCreatedDate = !createdDateVal || (b.created_at && b.created_at.startsWith(createdDateVal));

        return matchesSearch && matchesStatus && matchesMeetDate && matchesCreatedDate;
    });
    
    currentBookingsPage = 1;
    renderPaginatedBookings();
}

if (bookingsSearch) bookingsSearch.addEventListener('input', applyBookingsFilters);
if (bookingsStatusFilter) bookingsStatusFilter.addEventListener('change', applyBookingsFilters);
if (bookingsDateFilter) bookingsDateFilter.addEventListener('change', applyBookingsFilters);
if (bookingsCreatedFilter) bookingsCreatedFilter.addEventListener('change', applyBookingsFilters);

function resetBookingsFilters() {
    if (bookingsSearch) bookingsSearch.value = '';
    if (bookingsStatusFilter) bookingsStatusFilter.value = '';
    if (bookingsDateFilter) bookingsDateFilter.value = '';
    if (bookingsCreatedFilter) bookingsCreatedFilter.value = '';
    applyBookingsFilters();
}

async function updateBookingStatus(bookingId, newStatus) {
    try {
        const res = await fetch(`/api/schedule/bookings/${bookingId}/status`, {
            method: 'PATCH',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error('Status update failed');
        showToast(`Booking marked as "${newStatus}"`);
        await loadAllBookings();
        renderAdminCalendar();
        if (selectedAdminDate) {
            const dayBookings = allBookings.filter(b => b.booked_date === selectedAdminDate);
            const dayEl = document.querySelector(`.admin-cal-day.selected-admin`);
            if (dayEl) showAdminDayDetail(selectedAdminDate, dayBookings, dayEl);
        }
    } catch(e) {
        showToast(e.message, true);
    }
}

// ================================================================
// Blocked Dates
// ================================================================
async function loadBlockedDates() {
    try {
        blockedDatesList = await fetch('/api/schedule/blocked-dates').then(r => r.json());
        blockedDatesSet = new Set(blockedDatesList.map(b => b.blocked_date));
    } catch(e) { console.error('Blocked dates load failed', e); }
}

async function blockDate(dateStr) {
    if (!confirm(`Block ${dateStr}? All confirmed bookings on this date will be cancelled and clients will be emailed.`)) return;
    try {
        const res = await fetch('/api/schedule/blocked-dates', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ date: dateStr, reason: 'Manually blocked by admin' })
        });
        if (!res.ok) throw new Error('Failed to block date');
        const data = await res.json();
        showToast(data.message);
        await loadBlockedDates();
        await loadAllBookings();
        renderAdminCalendar();
        const dayBookings = allBookings.filter(b => b.booked_date === dateStr);
        const dayEl = document.querySelector(`.admin-cal-day.selected-admin`);
        if (dayEl) showAdminDayDetail(dateStr, dayBookings, dayEl);
    } catch(e) { showToast(e.message, true); }
}

async function unblockDate(dateStr) {
    try {
        const res = await fetch(`/api/schedule/blocked-dates/${dateStr}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to unblock date');
        showToast(`Date ${dateStr} unblocked.`);
        await loadBlockedDates();
        renderAdminCalendar();
        const dayBookings = allBookings.filter(b => b.booked_date === dateStr);
        const dayEl = document.querySelector(`.admin-cal-day.selected-admin`);
        if (dayEl) showAdminDayDetail(dateStr, dayBookings, dayEl);
    } catch(e) { showToast(e.message, true); }
}

// ================================================================
// Helpers
// ================================================================
function formatDate(y, m, d) {
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function formatTime12(time24) {
    if (!time24) return '';
    const [h, m] = time24.split(':');
    const hour = parseInt(h);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour % 12 || 12;
    return `${h12}:${m} ${suffix}`;
}

function showToast(msg, isError = false) {
    const el = document.getElementById('toast-el');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' toast-error' : '');
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3500);
}

init();
