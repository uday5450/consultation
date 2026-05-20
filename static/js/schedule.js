/* ================================================================
   schedule.js — Public Booking Page Logic
   ================================================================ */

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let currentYear, currentMonth;
let selectedDate = null;
let selectedTime = null;
let availability = [];
let blockedDates = new Set();
let slotDurationMinutes = 30;
let formActive = true;

async function init() {
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();

    // Fetch config
    try {
        const cfg = await fetch('/api/schedule/config').then(r => r.json());
        formActive = !!cfg.form_active;
        slotDurationMinutes = cfg.slot_duration === 0 && cfg.custom_slot_minutes
            ? cfg.custom_slot_minutes
            : cfg.slot_duration || 30;

        const durationMap = {15:'15 minutes', 30:'30 minutes', 45:'45 minutes', 60:'1 hour', 90:'1.5 hours'};
        document.getElementById('slot-duration-label').textContent =
            durationMap[slotDurationMinutes] || `${slotDurationMinutes} minutes`;
    } catch(e) { console.error(e); }

    if (!formActive) {
        document.getElementById('inactive-banner').style.display = 'flex';
        document.getElementById('booking-layout').style.opacity = '.5';
        document.getElementById('booking-layout').style.pointerEvents = 'none';
        return;
    }

    // Fetch availability
    try {
        availability = await fetch('/api/schedule/availability').then(r => r.json());
    } catch(e) { console.error(e); }

    // Fetch blocked dates
    try {
        const blocked = await fetch('/api/schedule/blocked-dates').then(r => r.json());
        blockedDates = new Set(blocked.map(b => b.blocked_date));
    } catch(e) { console.error(e); }

    renderCalendar();
}

function renderCalendar() {
    const label = document.getElementById('cal-month-label');
    label.textContent = `${MONTHS[currentMonth]} ${currentYear}`;

    const grid = document.querySelector('.cal-grid');
    // Remove old day cells (keep weekday headers)
    const oldDays = grid.querySelectorAll('.cal-day');
    oldDays.forEach(d => d.remove());

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0,0,0,0);

    // Blank cells before first day
    for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement('div');
        blank.classList.add('cal-day','empty');
        grid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dayEl = document.createElement('div');
        dayEl.classList.add('cal-day');
        dayEl.textContent = d;

        const thisDate = new Date(currentYear, currentMonth, d);
        const dateStr = formatDate(currentYear, currentMonth+1, d);

        // Is this day available?
        const weekday = thisDate.getDay(); // 0=Sun, 6=Sat; our DB uses 0=Mon... let's map
        // DB: 0=Mon,1=Tue,...,6=Sun → JS: Mon=1,Tue=2,...,Sun=0
        const dbDay = weekday === 0 ? 6 : weekday - 1;
        const avail = availability.find(a => a.day_of_week === dbDay && a.is_active === 1);

        if (thisDate <= today) {
            dayEl.classList.add('past');
        } else if (!avail || blockedDates.has(dateStr)) {
            dayEl.classList.add('unavailable');
        } else {
            dayEl.classList.add('available');
            if (thisDate.toDateString() === today.toDateString()) dayEl.classList.add('today');
            if (selectedDate === dateStr) dayEl.classList.add('selected');
            dayEl.addEventListener('click', () => selectDate(dateStr, dayEl));
        }

        grid.appendChild(dayEl);
    }
}

async function selectDate(dateStr, el) {
    selectedDate = dateStr;
    selectedTime = null;
    document.querySelectorAll('.cal-day').forEach(d => d.classList.remove('selected'));
    el.classList.add('selected');

    const slotsGrid = document.getElementById('slots-grid');
    const slotDateLabel = document.getElementById('slots-date-label');
    const placeholder = document.getElementById('slots-placeholder');
    const slotsContent = document.getElementById('slots-content');

    placeholder.style.display = 'none';
    slotsContent.style.display = 'block';
    slotsGrid.innerHTML = '<div class="slot-skeleton"></div>'.repeat(6);

    const [y, m, day] = dateStr.split('-');
    slotDateLabel.textContent = `${DAYS[new Date(+y,+m-1,+day).getDay()]}, ${MONTHS[+m-1]} ${+day}`;

    try {
        const data = await fetch(`/api/schedule/slots/${dateStr}`).then(r => r.json());
        slotsGrid.innerHTML = '';
        if (!data.slots || data.slots.length === 0) {
            const msg = data.blocked ? 'This date is unavailable (blocked by admin).' : 'No available slots for this day.';
            slotsGrid.innerHTML = `<div class="no-slots-msg">${msg}</div>`;
            return;
        }
        data.slots.forEach(slot => {
            if (!slot.available) return; // Skip unavailable slots
            const btn = document.createElement('button');
            btn.classList.add('slot-btn');
            btn.textContent = slot.display;
            btn.dataset.time = slot.time;
            btn.addEventListener('click', () => selectSlot(slot.time, slot.display, btn));
            slotsGrid.appendChild(btn);
        });
        
        if (slotsGrid.children.length === 0) {
            slotsGrid.innerHTML = `<div class="no-slots-msg">No available slots for this day.</div>`;
        }
    } catch(e) {
        slotsGrid.innerHTML = '<div class="no-slots-msg">Failed to load slots. Please try again.</div>';
    }
}

function selectSlot(time, display, btn) {
    selectedTime = time;
    document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    // Animate to step 2
    setTimeout(() => goToDetails(display), 200);
}

function goToDetails(displayTime) {
    document.getElementById('step-date').classList.remove('active');
    document.getElementById('step-details').classList.add('active');

    const [y, m, d] = selectedDate.split('-');
    const dateLabel = `${DAYS[new Date(+y,+m-1,+d).getDay()]}, ${MONTHS[+m-1]} ${+d}, ${y}`;
    document.getElementById('selected-slot-badge').innerHTML = `
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5"/></svg>
        ${dateLabel} &nbsp;·&nbsp; ${displayTime}
    `;
}

function goBackToDate() {
    document.getElementById('step-details').classList.remove('active');
    document.getElementById('step-date').classList.add('active');
}

// Booking Form Submit
document.getElementById('booking-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('b-name').value.trim();
    const email = document.getElementById('b-email').value.trim();
    const phone = document.getElementById('b-phone').value.trim();
    const notes = document.getElementById('b-notes').value.trim();

    if (!name || !email) { showToast('Please fill in your name and email.', true); return; }
    if (!selectedDate || !selectedTime) { showToast('Please select a date and time slot.', true); return; }

    const confirmBtn = document.getElementById('confirm-btn');
    confirmBtn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;border-color:rgba(255,255,255,.3);border-top-color:#fff;"></div> Confirming...';
    confirmBtn.disabled = true;

    try {
        const res = await fetch('/api/schedule/book', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ booked_date: selectedDate, booked_time: selectedTime, client_name: name, client_email: email, client_phone: phone, notes: notes })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Booking failed');

        // Show success
        document.getElementById('step-details').classList.remove('active');
        document.getElementById('step-success').classList.add('active');

        const [y, m, d] = selectedDate.split('-');
        const dateLabel = `${DAYS[new Date(+y,+m-1,+d).getDay()]}, ${MONTHS[+m-1]} ${+d}, ${y}`;
        document.getElementById('success-msg').textContent = `Your session is confirmed for ${dateLabel}. A confirmation will be sent to ${email}.`;
        document.getElementById('success-details-card').innerHTML = `
            <strong>📅 Date:</strong> ${dateLabel}<br>
            <strong>⏰ Time:</strong> ${selectedTime} IST<br>
            <strong>👤 Name:</strong> ${name}<br>
            <strong>📧 Email:</strong> ${email}
        `;
    } catch(err) {
        showToast(err.message, true);
        confirmBtn.innerHTML = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Confirm Booking';
        confirmBtn.disabled = false;
    }
});

function changeMonth(dir) {
    currentMonth += dir;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    selectedDate = null;
    selectedTime = null;
    document.getElementById('slots-placeholder').style.display = 'flex';
    document.getElementById('slots-content').style.display = 'none';
    renderCalendar();
}

function formatDate(y, m, d) {
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// Toast
function showToast(msg, isError = false) {
    const el = document.getElementById('toast-el');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' toast-error' : '');
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3500);
}

init();
