// DLSL Chez Rafael Hotel Reservation System — admin dashboard logic

// Fill this in after deploying the Apps Script web app (see README.md).
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbysMtfkO4-tuzx-dK_CvWqqDlf3rBk4nOSo6w60UTeak6y6Fq1AEuEymA06NuoD09aODg/exec';

const TOKEN_KEY = 'dlsl_hotel_admin_token';
const EMAIL_KEY = 'dlsl_hotel_admin_email';

// See common.js's navigateTop for why this can't be a plain relative
// window.location assignment inside the Apps Script deployment.
function navigateTop(relativePath, queryString) {
  window.top.location.href = (window.top !== window.self) ? (SCRIPT_URL + queryString) : relativePath;
}

let reservations = [];
let currentReservationId = null;
let pendingEmail = '';
let admins = [];
let usersLoaded = false;
let auditLoaded = false;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindLoginEvents();
  bindDashboardEvents();
  bindTabEvents();
  bindUsersEvents();
  bindAuditEvents();

  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    const ok = await loadReservations(token);
    if (ok) {
      showDashboard(localStorage.getItem(EMAIL_KEY) || '');
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
  }
  showLogin();
}

const API_TIMEOUT_MS = 20000;

async function apiGet(params) {
  const url = new URL(SCRIPT_URL);
  Object.keys(params).forEach(k => { if (params[k] !== undefined && params[k] !== '') url.searchParams.set(k, params[k]); });
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  return res.json();
}

async function apiPost(body) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  });
  return res.json();
}

// ── Login gate ────────────────────────────────────────────────────────────

function showLogin() {
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('dashboardWrap').style.display = 'none';
}

function showDashboard(email) {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('dashboardWrap').style.display = 'block';
  document.getElementById('adminEmailLabel').textContent = email;
}

function loginAlert(message, type) {
  document.getElementById('loginAlert').innerHTML = message
    ? `<div class="alert alert-${type}">${message}</div>` : '';
}

function bindLoginEvents() {
  document.getElementById('emailForm').addEventListener('submit', async e => {
    e.preventDefault();
    loginAlert('', '');
    const email = document.getElementById('loginEmail').value.trim();
    const btn = document.getElementById('sendCodeBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const result = await apiGet({ action: 'requestOtp', email });
      if (!result.ok) {
        loginAlert(result.error, 'error');
        return;
      }
      pendingEmail = email;
      document.getElementById('codeSentTo').textContent = email;
      document.getElementById('emailForm').style.display = 'none';
      document.getElementById('codeForm').style.display = 'flex';
      document.getElementById('codeForm').style.flexDirection = 'column';
      document.getElementById('loginCode').focus();
    } catch (err) {
      loginAlert('Could not reach the reservation system. Please try again later.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Login Code';
    }
  });

  document.getElementById('codeForm').addEventListener('submit', async e => {
    e.preventDefault();
    loginAlert('', '');
    const code = document.getElementById('loginCode').value.trim();
    const btn = document.getElementById('verifyCodeBtn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    try {
      const result = await apiPost({ action: 'verifyOtp', email: pendingEmail, code });
      if (!result.ok) {
        loginAlert(result.error, 'error');
        return;
      }
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(EMAIL_KEY, result.email);
      applyReservations(result.reservations);
      showDashboard(result.email);
    } catch (err) {
      loginAlert('Could not reach the reservation system. Please try again later.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify & Sign In';
    }
  });

  document.getElementById('backToEmailBtn').addEventListener('click', () => {
    document.getElementById('codeForm').style.display = 'none';
    document.getElementById('emailForm').style.display = 'flex';
    document.getElementById('emailForm').style.flexDirection = 'column';
    loginAlert('', '');
  });
}

// ── Dashboard data ───────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function applyReservations(list) {
  reservations = list;
  populateRoomFilter();
  renderStats();
  renderTable();
  const analyticsPanel = document.getElementById('panel-analytics');
  if (analyticsPanel && !analyticsPanel.hidden) renderAnalytics();
}

async function loadReservations(token) {
  try {
    const result = await apiGet({ action: 'listReservations', token });
    if (!result.ok) {
      loginAlert(result.error || 'Session expired. Please sign in again.', 'error');
      return false;
    }
    applyReservations(result.reservations);
    return true;
  } catch (err) {
    loginAlert('Could not reach the reservation system. Please try again later.', 'error');
    return false;
  }
}

function bindDashboardEvents() {
  document.getElementById('searchInput').addEventListener('input', renderTable);
  document.getElementById('statusFilter').addEventListener('change', renderTable);
  document.getElementById('roomFilter').addEventListener('change', renderTable);
  document.getElementById('refreshBtn').addEventListener('click', () => loadReservations(getToken()));

  document.getElementById('logoutBtn').addEventListener('click', e => {
    e.preventDefault();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    document.getElementById('emailForm').style.display = 'flex';
    document.getElementById('emailForm').style.flexDirection = 'column';
    document.getElementById('codeForm').style.display = 'none';
    document.getElementById('loginEmail').value = '';
    showLogin();
  });

  document.getElementById('reviewModalClose').addEventListener('click', closeReviewModal);
  document.getElementById('reviewModal').addEventListener('click', e => {
    if (e.target.id === 'reviewModal') closeReviewModal();
  });

  document.getElementById('approveBtn').addEventListener('click', () => submitStatusUpdate('Approved'));
  document.getElementById('rejectBtn').addEventListener('click', () => submitStatusUpdate('Rejected'));
  document.getElementById('declineBtn').addEventListener('click', () => submitStatusUpdate('Declined'));
}

function populateRoomFilter() {
  const select = document.getElementById('roomFilter');
  const current = select.value;
  const roomTypes = [...new Set(reservations.map(r => r['Room Type']))].sort();
  select.innerHTML = '<option value="">All Room Types</option>' +
    roomTypes.map(rt => `<option value="${rt}">${rt}</option>`).join('');
  select.value = current;
}

function renderStats() {
  const total = reservations.length;
  const pending = reservations.filter(r => r['Status'] === 'Pending Approval').length;
  const approved = reservations.filter(r => r['Status'] === 'Approved').length;
  const rejected = reservations.filter(r => r['Status'] === 'Rejected' || r['Status'] === 'Declined').length;
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statPending').textContent = pending;
  document.getElementById('statApproved').textContent = approved;
  document.getElementById('statRejected').textContent = rejected;
}

function statusPillClass(status) {
  return {
    'Pending Approval': 'pill-pending',
    'Approved': 'pill-approved',
    'Rejected': 'pill-rejected',
    'Declined': 'pill-declined'
  }[status] || 'pill-pending';
}

function formatCurrency(n) {
  return 'PHP ' + Number(n || 0).toLocaleString('en-PH');
}

function renderTable() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const statusFilter = document.getElementById('statusFilter').value;
  const roomFilter = document.getElementById('roomFilter').value;

  const filtered = reservations.filter(r => {
    if (statusFilter && r['Status'] !== statusFilter) return false;
    if (roomFilter && r['Room Type'] !== roomFilter) return false;
    if (search) {
      const haystack = [r['Reservation ID'], r['Full Name'], r['Email']].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => String(b['Timestamp']).localeCompare(String(a['Timestamp'])));

  const tbody = document.getElementById('reservationsBody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No reservations match your filters.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td>${r['Reservation ID']}</td>
      <td>${r['Full Name']}</td>
      <td>${r['Room Type']}</td>
      <td>${r['Check-In']} ${r['Check-In Time'] || ''}</td>
      <td>${r['Check-Out']} ${r['Check-Out Time'] || ''}</td>
      <td>${formatCurrency(r['Total Expenses'])}</td>
      <td><span class="pill ${statusPillClass(r['Status'])}">${r['Status']}</span></td>
      <td><button class="row-link" data-id="${r['Reservation ID']}">Review</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-id]').forEach(btn =>
    btn.addEventListener('click', () => openReviewModal(btn.getAttribute('data-id'))));
}

// ── Review modal ─────────────────────────────────────────────────────────

function openReviewModal(reservationId) {
  const r = reservations.find(x => x['Reservation ID'] === reservationId);
  if (!r) return;
  currentReservationId = reservationId;

  document.getElementById('reviewModalTitle').textContent = reservationId;
  document.getElementById('reviewDetailGrid').innerHTML = `
    <div class="k">Guest Name</div><div class="v">${r['Full Name']}</div>
    <div class="k">Email</div><div class="v">${r['Email']}</div>
    <div class="k">Phone</div><div class="v">${r['Phone']}</div>
    <div class="k">Affiliation</div><div class="v">${r['Affiliation'] || '—'}</div>
    <div class="k">Room Type</div><div class="v">${r['Room Type']}</div>
    <div class="k">Guests</div><div class="v">${r['Guests']}</div>
    <div class="k">Check-In</div><div class="v">${r['Check-In']} ${r['Check-In Time'] || ''}</div>
    <div class="k">Check-Out</div><div class="v">${r['Check-Out']} ${r['Check-Out Time'] || ''}</div>
    <div class="k">Room Rate</div><div class="v">${formatCurrency(r['Room Rate'])}</div>
    <div class="k">Nights</div><div class="v">${r['Nights']}</div>
    <div class="k">Late Checkout Fee</div><div class="v">${formatCurrency(r['Late Checkout Fee'])}</div>
    <div class="k">Mattress Fee</div><div class="v">${formatCurrency(r['Mattress Fee'])}</div>
    <div class="k">Total Expenses</div><div class="v">${formatCurrency(r['Total Expenses'])}</div>
    <div class="k">Status</div><div class="v"><span class="pill ${statusPillClass(r['Status'])}">${r['Status']}</span></div>
    <div class="k">Special Requests</div><div class="v">${r['Special Requests'] || '—'}</div>
    <div class="k">Reviewed By</div><div class="v">${r['Reviewed By'] || '—'}</div>
    <div class="k">Reviewed At</div><div class="v">${r['Reviewed At'] || '—'}</div>
  `;
  document.getElementById('adminRemarks').value = r['Admin Remarks'] || '';
  document.getElementById('reviewModal').classList.add('open');
}

function closeReviewModal() {
  document.getElementById('reviewModal').classList.remove('open');
  currentReservationId = null;
}

async function submitStatusUpdate(newStatus) {
  if (!currentReservationId) return;
  const adminRemarks = document.getElementById('adminRemarks').value;
  const buttons = ['approveBtn', 'rejectBtn', 'declineBtn'].map(id => document.getElementById(id));
  buttons.forEach(b => b.disabled = true);
  try {
    const result = await apiPost({
      action: 'updateReservationStatus',
      token: getToken(),
      reservationId: currentReservationId,
      newStatus, adminRemarks
    });
    if (!result.ok) {
      alert(result.error || 'Could not update the reservation.');
      return;
    }
    closeReviewModal();
    await loadReservations(getToken());
  } catch (err) {
    alert('Could not reach the reservation system. Please try again later.');
  } finally {
    buttons.forEach(b => b.disabled = false);
  }
}

// ── Tabs ─────────────────────────────────────────────────────────────────

function bindTabEvents() {
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });
}

function switchTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab));
  document.querySelectorAll('.admin-panel').forEach(panel =>
    panel.hidden = panel.id !== `panel-${tab}`);

  if (tab === 'users' && !usersLoaded) loadAdmins();
  if (tab === 'auditlog' && !auditLoaded) loadAuditLog();
  if (tab === 'analytics') renderAnalytics();
}

// ── User management ─────────────────────────────────────────────────────

function bindUsersEvents() {
  document.getElementById('addAdminForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('newAdminEmail').value.trim();
    const role = document.getElementById('newAdminRole').value;
    const alertEl = document.getElementById('usersAlert');
    alertEl.innerHTML = '';
    const btn = document.getElementById('addAdminBtn');
    btn.disabled = true;
    try {
      const result = await apiPost({ action: 'addAdmin', token: getToken(), email, role });
      if (!result.ok) {
        alertEl.innerHTML = `<div class="alert alert-error">${result.error}</div>`;
        return;
      }
      document.getElementById('newAdminEmail').value = '';
      alertEl.innerHTML = '<div class="alert alert-success">Admin added.</div>';
      loadAdmins();
    } catch (err) {
      alertEl.innerHTML = '<div class="alert alert-error">Could not reach the reservation system.</div>';
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadAdmins() {
  const tbody = document.getElementById('adminsBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading admins...</td></tr>';
  try {
    const result = await apiGet({ action: 'listAdmins', token: getToken() });
    if (!result.ok) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${result.error || 'Could not load admins.'}</td></tr>`;
      return;
    }
    admins = result.admins;
    usersLoaded = true;
    renderAdmins();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Could not reach the reservation system.</td></tr>';
  }
}

function renderAdmins() {
  const tbody = document.getElementById('adminsBody');
  const myEmail = (localStorage.getItem(EMAIL_KEY) || '').toLowerCase();
  if (!admins.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No admins found.</td></tr>';
    return;
  }
  tbody.innerHTML = admins.map(a => `
    <tr>
      <td>${a.email}</td>
      <td>${a.role}</td>
      <td><span class="pill ${a.status === 'Active' ? 'pill-approved' : 'pill-rejected'}">${a.status}</span></td>
      <td>${a.addedBy || '—'}</td>
      <td>${a.addedAt || '—'}</td>
      <td>${a.status === 'Active' && a.email !== myEmail
        ? `<button class="row-link" data-remove="${a.email}">Remove</button>`
        : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-remove]').forEach(btn =>
    btn.addEventListener('click', () => removeAdminHandler(btn.getAttribute('data-remove'))));
}

async function removeAdminHandler(email) {
  if (!confirm(`Remove admin access for ${email}?`)) return;
  const alertEl = document.getElementById('usersAlert');
  alertEl.innerHTML = '';
  try {
    const result = await apiPost({ action: 'removeAdmin', token: getToken(), email });
    if (!result.ok) {
      alertEl.innerHTML = `<div class="alert alert-error">${result.error}</div>`;
      return;
    }
    loadAdmins();
  } catch (err) {
    alertEl.innerHTML = '<div class="alert alert-error">Could not reach the reservation system.</div>';
  }
}

// ── Audit log ────────────────────────────────────────────────────────────

function bindAuditEvents() {
  document.getElementById('refreshAuditBtn').addEventListener('click', loadAuditLog);
}

async function loadAuditLog() {
  const tbody = document.getElementById('auditBody');
  tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading audit log...</td></tr>';
  try {
    const result = await apiGet({ action: 'listAuditLog', token: getToken() });
    if (!result.ok) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">${result.error || 'Could not load audit log.'}</td></tr>`;
      return;
    }
    auditLoaded = true;
    renderAuditLog(result.logs);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Could not reach the reservation system.</td></tr>';
  }
}

function renderAuditLog(logs) {
  const tbody = document.getElementById('auditBody');
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No audit log entries yet.</td></tr>';
    return;
  }
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td>${l.timestamp}</td>
      <td>${l.actorEmail || '—'}</td>
      <td>${l.action}</td>
      <td>${l.details || '—'}</td>
    </tr>
  `).join('');
}

// ── Analytics (derived client-side from the already-loaded reservations) ──

function renderAnalytics() {
  const approved = reservations.filter(r => r['Status'] === 'Approved');
  const totalRevenue = approved.reduce((sum, r) => sum + Number(r['Total Expenses'] || 0), 0);
  const approvalRate = reservations.length ? Math.round((approved.length / reservations.length) * 100) : 0;
  const avgNights = approved.length
    ? (approved.reduce((sum, r) => sum + Number(r['Nights'] || 0), 0) / approved.length).toFixed(1)
    : '0';

  const byRoom = {};
  reservations.forEach(r => {
    const rt = r['Room Type'];
    if (!byRoom[rt]) byRoom[rt] = { bookings: 0, approved: 0, revenue: 0 };
    byRoom[rt].bookings++;
    if (r['Status'] === 'Approved') {
      byRoom[rt].approved++;
      byRoom[rt].revenue += Number(r['Total Expenses'] || 0);
    }
  });
  const topRoom = Object.keys(byRoom).sort((a, b) => byRoom[b].bookings - byRoom[a].bookings)[0] || '—';

  document.getElementById('anRevenue').textContent = formatCurrency(totalRevenue);
  document.getElementById('anApprovalRate').textContent = approvalRate + '%';
  document.getElementById('anAvgNights').textContent = avgNights;
  document.getElementById('anTopRoom').textContent = topRoom;

  const roomTypes = Object.keys(byRoom).sort();
  document.getElementById('anRoomBody').innerHTML = roomTypes.length ? roomTypes.map(rt => `
    <tr>
      <td>${rt}</td>
      <td>${byRoom[rt].bookings}</td>
      <td>${byRoom[rt].approved}</td>
      <td>${formatCurrency(byRoom[rt].revenue)}</td>
    </tr>
  `).join('') : '<tr><td colspan="4" class="empty-state">No reservations yet.</td></tr>';

  const byMonth = {};
  reservations.forEach(r => {
    const month = String(r['Check-In'] || '').slice(0, 7); // YYYY-MM
    if (!month) return;
    if (!byMonth[month]) byMonth[month] = { count: 0, revenue: 0 };
    byMonth[month].count++;
    if (r['Status'] === 'Approved') byMonth[month].revenue += Number(r['Total Expenses'] || 0);
  });
  const months = Object.keys(byMonth).sort();
  document.getElementById('anMonthBody').innerHTML = months.length ? months.map(m => `
    <tr>
      <td>${m}</td>
      <td>${byMonth[m].count}</td>
      <td>${formatCurrency(byMonth[m].revenue)}</td>
    </tr>
  `).join('') : '<tr><td colspan="3" class="empty-state">No reservations yet.</td></tr>';
}
