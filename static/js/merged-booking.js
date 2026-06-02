/* ================================================================
   merged-booking.js — Combined Form + Booking Flow
   Step 1: Business details → Step 2: Date/Time → Step 3: Success
   ================================================================ */

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let currentYear, currentMonth;
let selectedDate = null;
let selectedTime = null;
let selectedTimeDisplay = null;
let availability = [];
let blockedDates = new Set();
let slotDurationMinutes = 30;
let formActive = true;

// Collected business data from step 1
let businessData = {};
let consultationPrice = { original: 499, current: 0, currency: '₹' };

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

        // Update pricing details in the left panel
        consultationPrice.currency = cfg.currency || '₹';
        consultationPrice.original = cfg.original_price !== undefined ? cfg.original_price : 499;
        consultationPrice.current = cfg.current_price !== undefined ? cfg.current_price : 0;

        const originalLabel = document.getElementById('price-original-label');
        const currentLabel = document.getElementById('price-current-label');
        const percentLabel = document.getElementById('price-discount-percent');

        if (consultationPrice.original > 0) {
            originalLabel.textContent = `${consultationPrice.currency}${consultationPrice.original}`;
            originalLabel.style.display = 'inline';
        } else {
            originalLabel.style.display = 'none';
        }

        if (consultationPrice.current > 0) {
            currentLabel.textContent = `${consultationPrice.currency}${consultationPrice.current}`;
        } else {
            currentLabel.textContent = 'Free';
        }

        if (consultationPrice.original > consultationPrice.current && consultationPrice.original > 0) {
            const pct = Math.round(((consultationPrice.original - consultationPrice.current) / consultationPrice.original) * 100);
            percentLabel.textContent = `${pct}% Off`;
            percentLabel.style.display = 'inline-block';
        } else {
            percentLabel.style.display = 'none';
        }
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

    updateProgress(1);
}

// ================================================================
// Progress Bar
// ================================================================
function updateProgress(step) {
    const totalSteps = 4;
    const pct = ((step - 1) / (totalSteps - 1)) * 100;
    document.getElementById('progress-bar').style.width = `${pct}%`;
    const labels = ['Business Details', 'Schedule Meeting', 'Confirm Details', 'Confirmed!'];
    document.getElementById('step-indicator-text').textContent = `Step ${step} of ${totalSteps}: ${labels[step-1]}`;
}

// ================================================================
// Step 1: Business Form Submission
// ================================================================
document.getElementById('business-form').addEventListener('submit', async function(e) {
    e.preventDefault();

    // Validate required fields
    const name = document.getElementById('full_name').value.trim();
    const phone = document.getElementById('contact_number').value.trim();
    const email = document.getElementById('email').value.trim();
    const biz = document.getElementById('business_name').value.trim();
    const city = document.getElementById('city_state').value.trim();
    const industry = document.getElementById('industry').value;
    const hearAbout = document.getElementById('hear_about_us').value;

    if (!name || !phone || !email || !biz || !city) {
        showToast('Please fill in all required fields.', true);
        // Highlight empty fields
        ['full_name','contact_number','email','business_name','city_state'].forEach(id => {
            const el = document.getElementById(id);
            if (!el.value.trim()) el.style.borderColor = '#ff7675';
        });
        return;
    }
    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast('Please enter a valid email address.', true);
        document.getElementById('email').style.borderColor = '#ff7675';
        return;
    }
    if (!industry) { showToast('Please select your industry.', true); return; }
    if (!hearAbout) { showToast('Please select how you heard about us.', true); return; }

    // Checkboxes
    const investments = Array.from(document.querySelectorAll('input[name="monthly_investment"]:checked')).map(c => c.value);
    if (investments.length === 0) { showToast('Please select at least one investment option.', true); return; }

    const businessAge = document.querySelector('input[name="business_age"]:checked');
    if (!businessAge) { showToast('Please select your business age.', true); return; }

    const teamSize = document.querySelector('input[name="team_size"]:checked');

    // Store business data
    businessData = {
        full_name: name,
        contact_number: phone,
        email: email,
        business_name: biz,
        city_state: city,
        industry: industry,
        monthly_investment: investments,
        business_age: [businessAge.value],
        team_size: teamSize ? teamSize.value : 'Solo Founder',
        hear_about_us: hearAbout,
        biggest_challenge: document.getElementById('biggest_challenge').value.trim() || '',
        social_profile: '',
        website: ''
    };

    // Move to step 2
    document.getElementById('step-business').classList.remove('active');
    document.getElementById('step-date').classList.add('active');
    updateProgress(2);
    renderCalendar();
});

// Reset red borders on input
document.querySelectorAll('.input-control').forEach(input => {
    input.addEventListener('input', () => { input.style.borderColor = 'var(--border-color)'; });
    input.addEventListener('change', () => { input.style.borderColor = 'var(--border-color)'; });
});

function goBackToBusiness() {
    document.getElementById('step-date').classList.remove('active');
    document.getElementById('step-business').classList.add('active');
    updateProgress(1);
}

// ================================================================
// Step 2: Calendar & Slot Selection
// ================================================================
function renderCalendar() {
    const label = document.getElementById('cal-month-label');
    label.textContent = `${MONTHS[currentMonth]} ${currentYear}`;

    const grid = document.querySelector('.cal-grid');
    const oldDays = grid.querySelectorAll('.cal-day');
    oldDays.forEach(d => d.remove());

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0,0,0,0);

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

        const weekday = thisDate.getDay();
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
    selectedTimeDisplay = null;
    document.querySelectorAll('.cal-day').forEach(d => d.classList.remove('selected'));
    el.classList.add('selected');

    const slotsGrid = document.getElementById('slots-grid');
    const slotDateLabel = document.getElementById('slots-date-label');
    const placeholder = document.getElementById('slots-placeholder');
    const slotsContent = document.getElementById('slots-content');

    placeholder.style.display = 'none';
    slotsContent.style.display = 'block';
    slotsGrid.innerHTML = '<div class="slot-skeleton"></div>'.repeat(6);
    // Hide Continue button since time is reset
    const continueBtn = document.getElementById('continue-to-confirm-btn');
    if (continueBtn) continueBtn.style.display = 'none';

    const [y, m, day] = dateStr.split('-');
    slotDateLabel.textContent = `${DAYS[new Date(+y,+m-1,+day).getDay()]}, ${MONTHS[+m-1]} ${+day}`;

    try {
        const data = await fetch(`/api/schedule/slots/${dateStr}`).then(r => r.json());
        slotsGrid.innerHTML = '';
        if (!data.slots || data.slots.length === 0) {
            const msg = data.blocked ? 'This date is unavailable.' : 'No available slots for this day.';
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
    selectedTimeDisplay = display;
    document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    // Show the Continue button
    const continueBtn = document.getElementById('continue-to-confirm-btn');
    if (continueBtn) continueBtn.style.display = 'flex';
}

function goToConfirmStep() {
    if (!selectedDate || !selectedTime) { showToast('Please select a date and time.', true); return; }

    document.getElementById('step-date').classList.remove('active');
    document.getElementById('step-confirm').classList.add('active');
    updateProgress(3);

    const [y, m, d] = selectedDate.split('-');
    const dateLabel = `${DAYS[new Date(+y,+m-1,+d).getDay()]}, ${MONTHS[+m-1]} ${+d}, ${y}`;
    
    let priceText = '';
    if (consultationPrice.original > consultationPrice.current && consultationPrice.original > 0) {
        const pct = Math.round(((consultationPrice.original - consultationPrice.current) / consultationPrice.original) * 100);
        const currentDisplay = consultationPrice.current > 0 ? `${consultationPrice.currency}${consultationPrice.current}` : 'Free';
        const color = consultationPrice.current > 0 ? '#6c5ce7' : '#00b894';
        priceText = `<span style="text-decoration:line-through;opacity:0.6;margin-right:0.3rem;">${consultationPrice.currency}${consultationPrice.original}</span> <span style="color:${color};font-weight:700;">${currentDisplay}</span> <span style="background:rgba(0,184,148,0.12);color:#00b894;padding:0.1rem 0.45rem;border-radius:4px;font-size:0.72rem;font-weight:700;margin-left:0.3rem;">${pct}% Off</span>`;
    } else {
        const currentDisplay = consultationPrice.current > 0 ? `${consultationPrice.currency}${consultationPrice.current}` : 'Free';
        priceText = `<span style="font-weight:700;color:#6c5ce7;">${currentDisplay}</span>`;
    }

    document.getElementById('confirm-details-card').innerHTML = `
        <strong>📅 Date:</strong> ${dateLabel}<br>
        <strong>⏰ Time:</strong> ${selectedTimeDisplay} IST<br>
        <strong>👤 Name:</strong> ${businessData.full_name}<br>
        <strong>📧 Email:</strong> ${businessData.email}<br>
        <strong>🏢 Business:</strong> ${businessData.business_name}<br>
        <strong>📞 Phone:</strong> ${businessData.contact_number}<br>
        <strong>💵 Price:</strong> ${priceText}
    `;
}

function goBackToDate() {
    document.getElementById('step-confirm').classList.remove('active');
    document.getElementById('step-date').classList.add('active');
    updateProgress(2);
}

async function submitFinalBooking() {
    const confirmBtn = document.getElementById('confirm-booking-btn');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = 'Booking...';

    try {
        // 1. Submit form data
        const submitRes = await fetch('/api/submit', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify(businessData)
        });
        if (!submitRes.ok) {
            const err = await submitRes.json();
            throw new Error(err.detail || 'Failed to save form data');
        }

        // 2. Create booking
        const bookingRes = await fetch('/api/schedule/book', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                booked_date: selectedDate,
                booked_time: selectedTime,
                client_name: businessData.full_name,
                client_email: businessData.email,
                client_phone: businessData.contact_number,
                notes: `Business: ${businessData.business_name} | Industry: ${businessData.industry} | Challenge: ${businessData.biggest_challenge || 'N/A'}`
            })
        });
        const bookData = await bookingRes.json();
        if (!bookingRes.ok) throw new Error(bookData.detail || 'Booking failed');

        // Success!
        document.getElementById('step-confirm').classList.remove('active');
        document.getElementById('step-success').classList.add('active');
        updateProgress(4);

        const [y, m, d] = selectedDate.split('-');
        const dateLabel = `${DAYS[new Date(+y,+m-1,+d).getDay()]}, ${MONTHS[+m-1]} ${+d}, ${y}`;
        
        let successMsg = `Your strategy session is confirmed! A confirmation email has been sent to ${businessData.email}.`;
        if (bookData.calendar_generated) {
            successMsg += " A Google Calendar event has been successfully generated.";
        } else {
            successMsg += " Could not generate a Google Calendar event. However, your booking is confirmed.";
        }

        document.getElementById('success-msg').textContent = successMsg;
        document.getElementById('success-details-card').innerHTML = `
            <strong>📅 Date:</strong> ${dateLabel}<br>
            <strong>⏰ Time:</strong> ${selectedTimeDisplay} IST<br>
            <strong>👤 Name:</strong> ${businessData.full_name}<br>
            <strong>📧 Email:</strong> ${businessData.email}<br>
            <strong>🔗 Meet Link:</strong> <a href="${bookData.meet_link || '#'}" target="_blank" style="color:#6c5ce7; font-weight:600;">${bookData.meet_link || 'N/A'}</a>
        `;
    } catch(err) {
        showToast(err.message, true);
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `
            Confirm & Book
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
        `;
    }
}

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
