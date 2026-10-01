// DLSL Chez Rafael Hotel Reservation System — admin dashboard logic

// Fill this in after deploying the Apps Script web app (see README.md).
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbysMtfkO4-tuzx-dK_CvWqqDlf3rBk4nOSo6w60UTeak6y6Fq1AEuEymA06NuoD09aODg/exec';

const TOKEN_KEY = 'dlsl_hotel_admin_token';
// sessionStorage, not localStorage: the token dies with the tab and is
// never left behind on a shared/kiosk browser. It is only ever sent in
// POST bodies, never in a URL.
const tokenStore = window.sessionStorage;
const EMAIL_KEY = 'dlsl_hotel_admin_email';
const SUPER_ADMIN_ROLE = 'Super Admin';

// Every value that came from the API (guest input, admin input, sheet data)
// goes through esc() before being placed into an innerHTML template.
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Proof-of-payment links are only rendered as links when they point at
// Google Drive; anything else (e.g. the "Emailed to admin" note) is text.
function safeDriveUrl(url) {
  return /^https:\/\/(drive|docs)\.google\.com\//.test(String(url || '')) ? String(url) : '';
}

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
let currentRole = '';

const RESERVATIONS_PAGE_SIZE = 10;
let reservationsPage = 1;

const CAL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
let adminCalYear, adminCalMonth; // adminCalMonth is 0-indexed

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const today = new Date();
  adminCalYear = today.getFullYear();
  adminCalMonth = today.getMonth();

  bindLoginEvents();
  bindDashboardEvents();
  bindTabEvents();
  bindUsersEvents();
  bindAuditEvents();
  bindCalendarEvents();

  // Tokens from before the move to sessionStorage are no longer valid
  // server-side either; just clear them.
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EMAIL_KEY); } catch (err) {}

  const token = tokenStore.getItem(TOKEN_KEY);
  if (token) {
    const ok = await loadReservations(token);
    if (ok) {
      showDashboard(tokenStore.getItem(EMAIL_KEY) || '');
      return;
    }
    clearSession();
  }
  showLogin();
}

const API_TIMEOUT_MS = 20000;

// Every admin call is a POST so the session token travels in the body only.
async function apiPost(body) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  });
  const result = await res.json();
  // Server-side expiry (8 h absolute / 30 min idle) or revocation.
  if (body.token && !result.ok && result.error === 'Not authenticated.') endSession('Your session has ended. Please sign in again.');
  return result;
}

function clearSession() {
  tokenStore.removeItem(TOKEN_KEY);
  tokenStore.removeItem(EMAIL_KEY);
}

function endSession(message) {
  clearSession();
  usersLoaded = false;
  auditLoaded = false;
  document.getElementById('emailForm').style.display = 'flex';
  document.getElementById('emailForm').style.flexDirection = 'column';
  document.getElementById('codeForm').style.display = 'none';
  document.getElementById('loginEmail').value = '';
  showLogin();
  loginAlert(message || '', message ? 'error' : '');
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
    ? `<div class="alert alert-${esc(type)}">${esc(message)}</div>` : '';
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
      const result = await apiPost({ action: 'requestOtp', email });
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
      tokenStore.setItem(TOKEN_KEY, result.token);
      tokenStore.setItem(EMAIL_KEY, result.email);
      applyRole(result.role);
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
  return tokenStore.getItem(TOKEN_KEY);
}

// Cosmetic only — the server enforces Super Admin on every user-management
// and audit-log call. This just hides tabs a regular Admin can't use.
function applyRole(role) {
  currentRole = role || '';
  const isSuper = currentRole === SUPER_ADMIN_ROLE;
  ['users', 'auditlog'].forEach(tab => {
    const btn = document.querySelector(`.admin-tab-btn[data-tab="${tab}"]`);
    if (btn) btn.hidden = !isSuper;
  });
  const activeBtn = document.querySelector('.admin-tab-btn.active');
  if (!isSuper && activeBtn && activeBtn.hidden) switchTab('reservations');
}

function applyReservations(list) {
  reservations = list;
  reservationsPage = 1;
  populateRoomFilter();
  renderStats();
  renderTable();
  const analyticsPanel = document.getElementById('panel-analytics');
  if (analyticsPanel && !analyticsPanel.hidden) renderAnalytics();
  const calendarPanel = document.getElementById('panel-calendar');
  if (calendarPanel && !calendarPanel.hidden) renderAdminCalendar();
}

async function loadReservations(token) {
  try {
    const result = await apiPost({ action: 'listReservations', token });
    if (!result.ok) {
      if (result.error !== 'Not authenticated.') loginAlert(result.error || 'Session expired. Please sign in again.', 'error');
      return false;
    }
    applyRole(result.role);
    applyReservations(result.reservations);
    return true;
  } catch (err) {
    loginAlert('Could not reach the reservation system. Please try again later.', 'error');
    return false;
  }
}

function bindDashboardEvents() {
  document.getElementById('searchInput').addEventListener('input', () => { reservationsPage = 1; renderTable(); });
  document.getElementById('statusFilter').addEventListener('change', () => { reservationsPage = 1; renderTable(); });
  document.getElementById('roomFilter').addEventListener('change', () => { reservationsPage = 1; renderTable(); });
  document.getElementById('refreshBtn').addEventListener('click', () => loadReservations(getToken()));

  document.getElementById('logoutBtn').addEventListener('click', async e => {
    e.preventDefault();
    const token = getToken();
    endSession('');
    // Revoke server-side so any other copy of the token stops working too.
    if (token) {
      try { await apiPost({ action: 'logout', token }); } catch (err) { /* already signed out locally */ }
    }
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
    roomTypes.map(rt => `<option value="${esc(rt)}">${esc(rt)}</option>`).join('');
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
    renderPagination(0, 0, 0, 1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / RESERVATIONS_PAGE_SIZE));
  reservationsPage = Math.min(Math.max(1, reservationsPage), totalPages);
  const start = (reservationsPage - 1) * RESERVATIONS_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + RESERVATIONS_PAGE_SIZE);

  tbody.innerHTML = pageItems.map(r => `
    <tr>
      <td>${esc(r['Reservation ID'])}</td>
      <td>${esc(r['Full Name'])}</td>
      <td>${esc(r['Room Type'])}</td>
      <td>${esc(r['Check-In'])} ${esc(r['Check-In Time'] || '')}</td>
      <td>${esc(r['Check-Out'])} ${esc(r['Check-Out Time'] || '')}</td>
      <td>${formatCurrency(r['Total Expenses'])}</td>
      <td><span class="pill ${statusPillClass(r['Status'])}">${esc(r['Status'])}</span></td>
      <td><button class="row-link" data-id="${esc(r['Reservation ID'])}">Review</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-id]').forEach(btn =>
    btn.addEventListener('click', () => openReviewModal(btn.getAttribute('data-id'))));

  renderPagination(start + 1, Math.min(start + RESERVATIONS_PAGE_SIZE, filtered.length), filtered.length, totalPages);
}

// Shared by any paginated table below — pass the container id, current
// page/totalPages/totalCount, the visible range, and callbacks for Prev/Next.
function renderPaginationControls(containerId, page, totalPages, totalCount, rangeStart, rangeEnd, onPrev, onNext) {
  const el = document.getElementById(containerId);
  if (!totalCount) {
    el.innerHTML = '';
    return;
  }
  const prevId = `${containerId}PrevBtn`;
  const nextId = `${containerId}NextBtn`;
  el.innerHTML = `
    <span>Showing ${rangeStart}&ndash;${rangeEnd} of ${totalCount}</span>
    <div class="pagination-controls">
      <button type="button" class="btn btn-outline" id="${prevId}"${page <= 1 ? ' disabled' : ''}>&larr; Prev</button>
      <span class="pagination-page">Page ${page} of ${totalPages}</span>
      <button type="button" class="btn btn-outline" id="${nextId}"${page >= totalPages ? ' disabled' : ''}>Next &rarr;</button>
    </div>
  `;
  document.getElementById(prevId).addEventListener('click', onPrev);
  document.getElementById(nextId).addEventListener('click', onNext);
}

function renderPagination(rangeStart, rangeEnd, totalCount, totalPages) {
  renderPaginationControls(
    'reservationsPagination', reservationsPage, totalPages, totalCount, rangeStart, rangeEnd,
    () => { reservationsPage--; renderTable(); },
    () => { reservationsPage++; renderTable(); }
  );
}

// ── Review modal ─────────────────────────────────────────────────────────

function openReviewModal(reservationId) {
  const r = reservations.find(x => x['Reservation ID'] === reservationId);
  if (!r) return;
  currentReservationId = reservationId;

  document.getElementById('reviewModalTitle').textContent = reservationId;
  document.getElementById('reviewDetailGrid').innerHTML = `
    <div class="k">Guest Name</div><div class="v">${esc(r['Full Name'])}</div>
    <div class="k">Email</div><div class="v">${esc(r['Email'])}</div>
    <div class="k">Phone</div><div class="v">${esc(r['Phone'])}</div>
    <div class="k">Affiliation</div><div class="v">${esc(r['Affiliation'] || '—')}</div>
    <div class="k">Guests Name</div><div class="v">${esc(r['Guests Name'] || '—')}</div>
    <div class="k">Guests Company / Address</div><div class="v">${esc(r['Guests Company / Address'] || '—')}</div>
    <div class="k">Room Type</div><div class="v">${esc(r['Room Type'])}</div>
    <div class="k">Guests</div><div class="v">${esc(r['Guests'])}</div>
    <div class="k">Check-In</div><div class="v">${esc(r['Check-In'])} ${esc(r['Check-In Time'] || '')}</div>
    <div class="k">Check-Out</div><div class="v">${esc(r['Check-Out'])} ${esc(r['Check-Out Time'] || '')}</div>
    <div class="k">Room Rate</div><div class="v">${formatCurrency(r['Room Rate'])}</div>
    <div class="k">Nights</div><div class="v">${esc(r['Nights'])}</div>
    <div class="k">Late Checkout Fee</div><div class="v">${formatCurrency(r['Late Checkout Fee'])}</div>
    <div class="k">Mattress Fee</div><div class="v">${formatCurrency(r['Mattress Fee'])}</div>
    <div class="k">Total Expenses</div><div class="v">${formatCurrency(r['Total Expenses'])}</div>
    <div class="k">Status</div><div class="v"><span class="pill ${statusPillClass(r['Status'])}">${esc(r['Status'])}</span></div>
    <div class="k">Special Requests</div><div class="v">${esc(r['Special Requests'] || '—')}</div>
    <div class="k">Proof of Payment</div><div class="v">${safeDriveUrl(r['Proof of Payment'])
      ? `<a href="${esc(safeDriveUrl(r['Proof of Payment']))}" target="_blank" rel="noopener noreferrer">Open attachment &rarr;</a>`
      : esc(r['Proof of Payment'] || '—')}</div>
    <div class="k">Reviewed By</div><div class="v">${esc(r['Reviewed By'] || '—')}</div>
    <div class="k">Reviewed At</div><div class="v">${esc(r['Reviewed At'] || '—')}</div>
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
  if (tab === 'calendar') renderAdminCalendar();
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
        alertEl.innerHTML = `<div class="alert alert-error">${esc(result.error)}</div>`;
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
    const result = await apiPost({ action: 'listAdmins', token: getToken() });
    if (!result.ok) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${esc(result.error || 'Could not load admins.')}</td></tr>`;
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
  const myEmail = (tokenStore.getItem(EMAIL_KEY) || '').toLowerCase();
  if (!admins.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No admins found.</td></tr>';
    return;
  }
  tbody.innerHTML = admins.map(a => `
    <tr>
      <td>${esc(a.email)}</td>
      <td>${esc(a.role)}</td>
      <td><span class="pill ${a.status === 'Active' ? 'pill-approved' : 'pill-rejected'}">${esc(a.status)}</span></td>
      <td>${esc(a.addedBy || '—')}</td>
      <td>${esc(a.addedAt || '—')}</td>
      <td>${a.loginLocked
          ? `<button class="row-link" data-unlock="${esc(a.email)}">Unlock login</button> `
          : ''}${a.status === 'Active' && a.email !== myEmail
        ? `<button class="row-link" data-remove="${esc(a.email)}">Remove</button>`
        : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-remove]').forEach(btn =>
    btn.addEventListener('click', () => removeAdminHandler(btn.getAttribute('data-remove'))));
  tbody.querySelectorAll('[data-unlock]').forEach(btn =>
    btn.addEventListener('click', () => unlockAdminHandler(btn.getAttribute('data-unlock'))));
}

async function unlockAdminHandler(email) {
  if (!confirm(`Clear the login lock for ${email}? Only do this once the account owner confirms the failed attempts were theirs or the cause is understood.`)) return;
  const alertEl = document.getElementById('usersAlert');
  alertEl.innerHTML = '';
  try {
    const result = await apiPost({ action: 'unlockAdminLogin', token: getToken(), email });
    if (!result.ok) {
      alertEl.innerHTML = `<div class="alert alert-error">${esc(result.error)}</div>`;
      return;
    }
    alertEl.innerHTML = '<div class="alert alert-success">Login unlocked.</div>';
    loadAdmins();
  } catch (err) {
    alertEl.innerHTML = '<div class="alert alert-error">Could not reach the reservation system.</div>';
  }
}

async function removeAdminHandler(email) {
  if (!confirm(`Remove admin access for ${email}?`)) return;
  const alertEl = document.getElementById('usersAlert');
  alertEl.innerHTML = '';
  try {
    const result = await apiPost({ action: 'removeAdmin', token: getToken(), email });
    if (!result.ok) {
      alertEl.innerHTML = `<div class="alert alert-error">${esc(result.error)}</div>`;
      return;
    }
    loadAdmins();
  } catch (err) {
    alertEl.innerHTML = '<div class="alert alert-error">Could not reach the reservation system.</div>';
  }
}

// ── Audit log ────────────────────────────────────────────────────────────

const AUDIT_PAGE_SIZE = 10;
let auditLogs = [];
let auditPage = 1;

function bindAuditEvents() {
  document.getElementById('refreshAuditBtn').addEventListener('click', loadAuditLog);
}

async function loadAuditLog() {
  const tbody = document.getElementById('auditBody');
  tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading audit log...</td></tr>';
  document.getElementById('auditPagination').innerHTML = '';
  try {
    const result = await apiPost({ action: 'listAuditLog', token: getToken() });
    if (!result.ok) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">${esc(result.error || 'Could not load audit log.')}</td></tr>`;
      return;
    }
    auditLoaded = true;
    auditLogs = result.logs;
    auditPage = 1;
    renderAuditLog();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Could not reach the reservation system.</td></tr>';
  }
}

function renderAuditLog() {
  const tbody = document.getElementById('auditBody');
  if (!auditLogs.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No audit log entries yet.</td></tr>';
    renderAuditPagination(0, 0, 0, 1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(auditLogs.length / AUDIT_PAGE_SIZE));
  auditPage = Math.min(Math.max(1, auditPage), totalPages);
  const start = (auditPage - 1) * AUDIT_PAGE_SIZE;
  const pageItems = auditLogs.slice(start, start + AUDIT_PAGE_SIZE);

  tbody.innerHTML = pageItems.map(l => `
    <tr>
      <td>${esc(l.timestamp)}</td>
      <td>${esc(l.actorEmail || '—')}</td>
      <td>${esc(l.action)}</td>
      <td>${esc(l.details || '—')}</td>
    </tr>
  `).join('');

  renderAuditPagination(start + 1, Math.min(start + AUDIT_PAGE_SIZE, auditLogs.length), auditLogs.length, totalPages);
}

function renderAuditPagination(rangeStart, rangeEnd, totalCount, totalPages) {
  renderPaginationControls(
    'auditPagination', auditPage, totalPages, totalCount, rangeStart, rangeEnd,
    () => { auditPage--; renderAuditLog(); },
    () => { auditPage++; renderAuditLog(); }
  );
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
      <td>${esc(rt)}</td>
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
      <td>${esc(m)}</td>
      <td>${byMonth[m].count}</td>
      <td>${formatCurrency(byMonth[m].revenue)}</td>
    </tr>
  `).join('') : '<tr><td colspan="3" class="empty-state">No reservations yet.</td></tr>';
}

// ── Reservation calendar (verify guest status per day) ─────────────────────

function bindCalendarEvents() {
  document.getElementById('adminCalPrevBtn').addEventListener('click', () => shiftAdminCalMonth(-1));
  document.getElementById('adminCalNextBtn').addEventListener('click', () => shiftAdminCalMonth(1));
  document.getElementById('dayDetailClose').addEventListener('click', closeDayDetailModal);
  document.getElementById('dayDetailModal').addEventListener('click', e => {
    if (e.target.id === 'dayDetailModal') closeDayDetailModal();
  });
}

function shiftAdminCalMonth(delta) {
  adminCalMonth += delta;
  if (adminCalMonth < 0) { adminCalMonth = 11; adminCalYear--; }
  if (adminCalMonth > 11) { adminCalMonth = 0; adminCalYear++; }
  renderAdminCalendar();
}

function calPad2(n) { return String(n).padStart(2, '0'); }

// Reservations occupying calendar day `dateStr` (yyyy-MM-dd) — every status
// included (not just active ones) so the admin can see the full picture,
// including past rejections/declines.
function reservationsOnDate(dateStr) {
  return reservations.filter(r => {
    const ci = r['Check-In'], co = r['Check-Out'];
    if (!ci || !co) return false;
    if (ci === co) return dateStr === ci;
    return dateStr >= ci && dateStr < co;
  });
}

function renderAdminCalendar() {
  document.getElementById('adminCalMonthLabel').textContent = `${CAL_MONTH_NAMES[adminCalMonth]} ${adminCalYear}`;

  const grid = document.getElementById('adminCalGrid');
  const daysInMonth = new Date(adminCalYear, adminCalMonth + 1, 0).getDate();
  const firstWeekday = new Date(adminCalYear, adminCalMonth, 1).getDay();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${calPad2(today.getMonth() + 1)}-${calPad2(today.getDate())}`;

  let html = '';
  for (let i = 0; i < firstWeekday; i++) html += '<button type="button" class="cal-day cal-empty" disabled></button>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${adminCalYear}-${calPad2(adminCalMonth + 1)}-${calPad2(d)}`;
    const dayReservations = reservationsOnDate(dateStr);
    const statuses = new Set(dayReservations.map(r => r['Status']));

    const classes = ['cal-day'];
    if (statuses.has('Pending Approval')) classes.push('cal-day-pending');
    else if (statuses.has('Approved')) classes.push('cal-day-approved');
    else if (dayReservations.length) classes.push('cal-day-inactive');
    if (dateStr === todayStr) classes.push('cal-today');

    const title = dayReservations.length
      ? `${dayReservations.length} reservation${dayReservations.length > 1 ? 's' : ''}`
      : 'No reservations';

    html += `<button type="button" class="${classes.join(' ')}" data-date="${dateStr}" title="${title}">${d}</button>`;
  }

  grid.innerHTML = html;
  grid.querySelectorAll('.cal-day[data-date]').forEach(btn =>
    btn.addEventListener('click', () => openDayDetail(btn.getAttribute('data-date'))));
}

function openDayDetail(dateStr) {
  const dayReservations = reservationsOnDate(dateStr)
    .sort((a, b) => String(a['Room Type']).localeCompare(String(b['Room Type'])));

  const dateObj = new Date(`${dateStr}T00:00:00`);
  document.getElementById('dayDetailTitle').textContent = dateObj.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const body = document.getElementById('dayDetailBody');
  if (!dayReservations.length) {
    body.innerHTML = '<p class="empty-state">No reservations on this date.</p>';
  } else {
    body.innerHTML = dayReservations.map(r => `
      <div class="day-detail-row">
        <div>
          <strong>${esc(r['Full Name'])}</strong>
          <div class="day-detail-meta">${esc(r['Room Type'])} &middot; ${esc(r['Check-In'])} ${esc(r['Check-In Time'] || '')} &rarr; ${esc(r['Check-Out'])} ${esc(r['Check-Out Time'] || '')}</div>
        </div>
        <div class="day-detail-actions">
          <span class="pill ${statusPillClass(r['Status'])}">${esc(r['Status'])}</span>
          <button type="button" class="row-link" data-review="${esc(r['Reservation ID'])}">Review</button>
        </div>
      </div>
    `).join('');
    body.querySelectorAll('[data-review]').forEach(btn => btn.addEventListener('click', () => {
      closeDayDetailModal();
      openReviewModal(btn.getAttribute('data-review'));
    }));
  }

  document.getElementById('dayDetailModal').classList.add('open');
}

function closeDayDetailModal() {
  document.getElementById('dayDetailModal').classList.remove('open');
}
