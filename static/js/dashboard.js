let submissionsData = [];
let industryChartInstance = null;
let sourceChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('leads-table-body');
    const searchInput = document.getElementById('search-input');
    const emptyState = document.getElementById('empty-state-el');
    const drawer = document.getElementById('drawer');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const drawerCloseBtn = document.getElementById('drawer-close-btn');
    const drawerContent = document.getElementById('drawer-content');
    const logoutBtn = document.getElementById('logout-btn');

    // Secure authentication check
    async function checkAuth() {
        try {
            const response = await fetch('/api/check-session');
            if (!response.ok) {
                window.location.href = '/login';
            } else {
                // Load metrics and lists if authorized
                loadDashboardData();
            }
        } catch (error) {
            window.location.href = '/login';
        }
    }

    // Fetch and render data
    async function loadDashboardData() {
        try {
            // Parallel fetches
            const [statsRes, listRes] = await Promise.all([
                fetch('/api/stats'),
                fetch('/api/submissions')
            ]);

            if (!statsRes.ok || !listRes.ok) throw new Error("Could not retrieve pipelines database.");

            const stats = await statsRes.json();
            submissionsData = await listRes.json();

            // Populate dashboard metrics
            renderMetrics(stats);
            renderCharts(stats);
            renderTable(submissionsData);

        } catch (error) {
            console.error(error);
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 3rem; color: #ff7675;">
                        Error loading dashboard metrics: ${error.message}
                    </td>
                </tr>
            `;
        }
    }

    // Populate Key Performance metrics
    function renderMetrics(stats) {
        document.getElementById('metric-total').textContent = stats.total_leads || 0;

        // Premium investment budget metric calculations
        const investmentStats = stats.investment_stats || {};
        const premiumCount = investmentStats['Above ₹ 99,999'] || 0;
        const total = stats.total_leads || 0;
        const premiumPercent = total > 0 ? Math.round((premiumCount / total) * 100) : 0;
        document.getElementById('metric-premium-budget').textContent = `${premiumPercent}%`;

        // Find top acquisition leads source
        const sourceStats = stats.source_stats || {};
        let topSource = '-';
        let maxVal = 0;
        for (const [source, count] of Object.entries(sourceStats)) {
            if (count > maxVal) {
                maxVal = count;
                topSource = source;
            }
        }
        document.getElementById('metric-top-source').textContent = topSource;
    }

    // Render beautiful Chart.js graphics
    function renderCharts(stats) {
        // Industry Chart
        const indCtx = document.getElementById('industryChart').getContext('2d');
        const indStats = stats.industry_stats || {};
        const indLabels = Object.keys(indStats);
        const indValues = Object.values(indStats);

        if (industryChartInstance) {
            industryChartInstance.destroy();
        }

        industryChartInstance = new Chart(indCtx, {
            type: 'bar',
            data: {
                labels: indLabels,
                datasets: [{
                    label: 'Leads',
                    data: indValues,
                    backgroundColor: 'rgba(108, 92, 231, 0.6)',
                    borderColor: '#6c5ce7',
                    borderWidth: 1.5,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#a0a0ab', font: { family: 'Plus Jakarta Sans' } }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#a0a0ab', stepSize: 1 }
                    }
                }
            }
        });

        // Acquisition Source Split Chart
        const srcCtx = document.getElementById('sourceChart').getContext('2d');
        const srcStats = stats.source_stats || {};
        const srcLabels = Object.keys(srcStats);
        const srcValues = Object.values(srcStats);

        if (sourceChartInstance) {
            sourceChartInstance.destroy();
        }

        sourceChartInstance = new Chart(srcCtx, {
            type: 'doughnut',
            data: {
                labels: srcLabels,
                datasets: [{
                    data: srcValues,
                    backgroundColor: [
                        'rgba(0, 206, 201, 0.65)',
                        'rgba(108, 92, 231, 0.65)',
                        'rgba(253, 150, 68, 0.65)',
                        'rgba(255, 118, 117, 0.65)',
                        'rgba(9, 132, 227, 0.65)'
                    ],
                    borderColor: 'rgba(255, 255, 255, 0.05)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#a0a0ab', font: { family: 'Plus Jakarta Sans', size: 11 } }
                    }
                }
            }
        });
    }

    // Render Prospect submissions table list
    function renderTable(data) {
        tableBody.innerHTML = '';

        if (data.length === 0) {
            const tableHeadersCount = document.querySelectorAll('table.leads-table th').length || 7;
            tableBody.innerHTML = `
                <tr>
                    <td colspan="${tableHeadersCount}" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        No prospective leads match these filters.
                    </td>
                </tr>
            `;
            emptyState.style.display = 'block';
            return;
        } else {
            emptyState.style.display = 'none';
        }

        data.forEach(item => {
            const tr = document.createElement('tr');

            // Format timestamps (e.g. 2026-05-20 10:45:33)
            const dateStr = item.created_at ? formatTimestamp(item.created_at) : 'N/A';

            const meetLinkHtml = item.meet_link ? `
                <a href="${escapeHtml(item.meet_link)}" target="_blank" class="btn" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; border-radius: 6px; background: var(--accent-gradient); text-decoration: none; color: white; display: inline-flex; align-items: center; gap: 0.25rem; box-shadow: none; width: auto; font-family: inherit;">
                    <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>
                    Join Meet
                </a>
            ` : '<span style="color: var(--text-muted); font-size: 0.85rem;">No Meeting</span>';

            tr.innerHTML = `
                <td>
                    <div style="font-weight: 700; color: var(--text-primary);">${escapeHtml(item.full_name)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(item.contact_number)} &nbsp;&middot;&nbsp; ${escapeHtml(item.email)}</div>
                </td>
                <td>
                    <div style="font-weight: 600;">${escapeHtml(item.business_name)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(item.city_state)}</div>
                </td>
                <td><span class="badge badge-industry">${escapeHtml(item.industry)}</span></td>
                <td>
                    <div style="font-size: 0.9rem; max-width: 180px; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(item.monthly_investment)}">
                        ${escapeHtml(item.monthly_investment)}
                    </div>
                </td>
                <td style="font-size: 0.85rem; color: var(--text-secondary);">${dateStr}</td>
                <td>${meetLinkHtml}</td>
                <td>
                    <button class="btn btn-secondary detail-btn" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; border-radius: 6px;" data-id="${item.id}">View Details</button>
                </td>
            `;

            // Action: open slider detail drawer when clicking the row
            tr.addEventListener('click', (e) => {
                // Avoid firing when clicking view details button or links specifically
                if (e.target.closest('a') || e.target.classList.contains('detail-btn')) return;
                openDetailDrawer(item);
            });

            // Action: button click details
            tr.querySelector('.detail-btn').addEventListener('click', () => {
                openDetailDrawer(item);
            });

            tableBody.appendChild(tr);
        });
    }

    // Format local timezone dates beautifully
    function formatTimestamp(isoString) {
        try {
            // Handles both SQLite UTC standard strings or ISO items
            // Replace space with T to handle '2026-05-20 10:45:33' correctly
            const cleanStr = isoString.includes(' ') ? isoString.replace(' ', 'T') : isoString;
            const dateObj = new Date(cleanStr);
            if (isNaN(dateObj.getTime())) return isoString;

            return dateObj.toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
                hour12: true
            });
        } catch (e) {
            return isoString;
        }
    }

    // Slide drawer details injector
    function openDetailDrawer(item) {
        const formattedDate = formatTimestamp(item.created_at);

        const consultationHtml = item.booked_date ? `
            <div class="drawer-section" style="background: rgba(108, 92, 231, 0.05); border: 1px solid rgba(108, 92, 231, 0.15); border-radius: 14px; padding: 1.2rem; margin-bottom: 1.8rem; box-shadow: 0 4px 15px rgba(108, 92, 231, 0.05);">
                <div class="drawer-section-title" style="color: #6c5ce7; font-weight: 800; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem;">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>
                    Scheduled Strategy Meet
                </div>
                <div style="font-weight: 700; color: var(--text-primary); font-size: 1.05rem; display: flex; flex-direction: column; gap: 0.2rem;">
                    <div>📅 ${formatDateFriendly(item.booked_date)}</div>
                    <div>⏰ ${formatTime12(item.booked_time)}</div>
                </div>
                ${item.meet_link ? `
                <a href="${escapeHtml(item.meet_link)}" target="_blank" class="btn" style="margin-top: 1rem; width: 100%; padding: 0.7rem; font-size: 0.9rem; border-radius: 10px; background: var(--accent-gradient); text-decoration: none; color: white; display: flex; align-items: center; justify-content: center; gap: 0.4rem; box-shadow: 0 4px 15px rgba(0, 206, 201, 0.2); width: auto;">
                    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>
                    Join Strategy Session
                </a>` : ''}
            </div>
        ` : `
            <div class="drawer-section" style="background: rgba(0, 0, 0, 0.02); border: 1px dashed var(--border-color); border-radius: 14px; padding: 1rem; margin-bottom: 1.8rem; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
                No Strategy Consultation Scheduled
            </div>
        `;

        drawerContent.innerHTML = `
            <div class="drawer-section">
                <div class="drawer-section-title">Submitted On ("kyare te aap")</div>
                <div class="drawer-section-value" style="font-weight: 700; color: #00cec9;">${formattedDate}</div>
            </div>

            ${consultationHtml}

            <div class="drawer-section">
                <div class="drawer-section-title">Full Name</div>
                <div class="drawer-section-value" style="font-size: 1.15rem; font-weight: 700;">${escapeHtml(item.full_name)}</div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Contact Number</div>
                <div class="drawer-section-value">${escapeHtml(item.contact_number)}</div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Email Address</div>
                <div class="drawer-section-value">${escapeHtml(item.email || 'None provided')}</div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Business / Firm Name</div>
                <div class="drawer-section-value" style="font-weight: 600;">${escapeHtml(item.business_name)}</div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">City, State</div>
                <div class="drawer-section-value">${escapeHtml(item.city_state)}</div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Industry</div>
                <div class="drawer-section-value">
                    <span class="badge badge-industry" style="font-size: 0.85rem; padding: 0.35rem 0.8rem;">
                        ${escapeHtml(item.industry)}
                    </span>
                </div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Monthly Investment Budget</div>
                <div class="drawer-section-value" style="color: #6c5ce7; font-weight: 700;">${escapeHtml(item.monthly_investment)}</div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Business Age</div>
                <div class="drawer-section-value">${escapeHtml(item.business_age)}</div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Team Size</div>
                <div class="drawer-section-value">${escapeHtml(item.team_size)}</div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Social Media Profile</div>
                <div class="drawer-section-value">
                    ${item.social_profile ? `<a href="${escapeHtml(item.social_profile)}" target="_blank" style="color: #00cec9; text-decoration: underline;">${escapeHtml(item.social_profile)}</a>` : '<span style="color: var(--text-muted);">None provided</span>'}
                </div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Website Address</div>
                <div class="drawer-section-value">
                    ${item.website ? `<a href="${escapeHtml(item.website)}" target="_blank" style="color: #00cec9; text-decoration: underline;">${escapeHtml(item.website)}</a>` : '<span style="color: var(--text-muted);">None provided</span>'}
                </div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Acquisition Channel</div>
                <div class="drawer-section-value"><span class="badge badge-source">${escapeHtml(item.hear_about_us)}</span></div>
            </div>

            <div class="drawer-section" style="border-top: 1px solid var(--border-color); padding-top: 1.5rem;">
                <div class="drawer-section-title">Biggest Social Media Growth Challenge</div>
                <div class="drawer-section-value" style="font-style: italic; color: var(--text-secondary); line-height: 1.5; white-space: pre-line;">
                    ${item.biggest_challenge ? `"${escapeHtml(item.biggest_challenge)}"` : '<span style="color: var(--text-muted);">No challenge comments recorded.</span>'}
                </div>
            </div>
        `;

        drawerOverlay.classList.add('active');
        drawer.classList.add('open');
    }

    // Close detail drawer
    function closeDrawer() {
        drawer.classList.remove('open');
        drawerOverlay.classList.remove('active');
    }

    drawerCloseBtn.addEventListener('click', closeDrawer);
    drawerOverlay.addEventListener('click', closeDrawer);

    // Escape HTML helpers to prevent XSS injection
    function escapeHtml(string) {
        if (!string) return '';
        return String(string)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Helper function to format date cleanly
    function formatDateFriendly(dateStr) {
        if (!dateStr) return '';
        try {
            const [y, m, d] = dateStr.split('-');
            const MONTHS_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            return `${MONTHS_NAMES[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
        } catch (e) {
            return dateStr;
        }
    }

    // Helper function to format time 12h style
    function formatTime12(time24) {
        if (!time24) return '';
        try {
            const [h, m] = time24.split(':');
            const hour = parseInt(h);
            const suffix = hour >= 12 ? 'PM' : 'AM';
            const h12 = hour % 12 || 12;
            return `${h12}:${m} ${suffix}`;
        } catch (e) {
            return time24;
        }
    }

    // Instant searching & filtering logic for all dropdowns + search query
    const filterIndustry = document.getElementById('filter-industry');
    const filterBudget = document.getElementById('filter-budget');
    const filterAge = document.getElementById('filter-age');
    const filterMeeting = document.getElementById('filter-meeting');

    function applyFilters() {
        const query = searchInput.value.toLowerCase().trim();
        const industry = filterIndustry.value;
        const budget = filterBudget.value;
        const age = filterAge.value;
        const meeting = filterMeeting.value;

        const filtered = submissionsData.filter(item => {
            // Search Query Filter
            const matchesSearch = !query || (
                item.full_name.toLowerCase().includes(query) ||
                item.business_name.toLowerCase().includes(query) ||
                item.city_state.toLowerCase().includes(query) ||
                item.industry.toLowerCase().includes(query)
            );

            // Industry Filter
            const matchesIndustry = !industry || item.industry === industry;

            // Budget Filter
            const matchesBudget = !budget || item.monthly_investment.includes(budget);

            // Business Age Filter
            const matchesAge = !age || item.business_age.includes(age);

            // Meeting Status Filter
            const hasMeeting = !!item.booked_date;
            const matchesMeeting = !meeting || (
                (meeting === 'has-meeting' && hasMeeting) ||
                (meeting === 'no-meeting' && !hasMeeting)
            );

            return matchesSearch && matchesIndustry && matchesBudget && matchesAge && matchesMeeting;
        });

        renderTable(filtered);
    }

    searchInput.addEventListener('input', applyFilters);
    if (filterIndustry) filterIndustry.addEventListener('change', applyFilters);
    if (filterBudget) filterBudget.addEventListener('change', applyFilters);
    if (filterAge) filterAge.addEventListener('change', applyFilters);
    if (filterMeeting) filterMeeting.addEventListener('change', applyFilters);

    // Handle logout button clicks
    logoutBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/logout', { method: 'POST' });
            if (response.ok) {
                window.location.href = '/login';
            }
        } catch (error) {
            console.error("Logout challenge failed:", error);
            window.location.href = '/login';
        }
    });

    // Run auth check initially
    checkAuth();
});

// CSV Exporter compiles data perfectly
function exportDataToCSV() {
    if (submissionsData.length === 0) {
        alert("No submissions are available to export.");
        return;
    }

    const headers = [
        "ID",
        "Submitted On",
        "Full Name",
        "Contact Number",
        "Email Address",
        "Business Name",
        "City, State",
        "Industry",
        "Monthly Investment",
        "Business Age",
        "Team Size",
        "Social Profile",
        "Website",
        "Hear About Us",
        "Biggest Challenge"
    ];

    const csvRows = [headers.join(",")];

    submissionsData.forEach(item => {
        const values = [
            item.id,
            item.created_at,
            item.full_name,
            item.contact_number,
            item.email || "",
            item.business_name,
            item.city_state,
            item.industry,
            item.monthly_investment,
            item.business_age,
            item.team_size,
            item.social_profile,
            item.website,
            item.hear_about_us,
            item.biggest_challenge
        ];

        // Format CSV values to handle commas, quotes and linebreaks cleanly
        const escaped = values.map(val => {
            if (val === null || val === undefined) return '""';
            let str = String(val).replace(/"/g, '""');
            return `"${str}"`;
        });

        csvRows.push(escaped.join(","));
    });

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Growlouder _Leads_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
