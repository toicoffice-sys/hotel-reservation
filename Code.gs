// ============================================================
//  DLSL Chez Rafael Hotel Reservation System — Backend API
//  Google Apps Script Web App · JSON over HTTP
// ============================================================

// Seed only — once the Admins sheet exists it is the source of truth (see
// getActiveAdminEmails_). Kept here just to seed that sheet on first run.
var ADMIN_EMAILS = ['toic.pm@dlsl.edu.ph'];
var OTP_TTL_SECONDS = 5 * 60;
var SESSION_TTL_MS = 24 * 60 * 60 * 1000;

var ADMIN_HEADERS = ['Email', 'Role', 'Added By', 'Added At', 'Status'];
var DEFAULT_ADMINS = ADMIN_EMAILS.map(function (e) {
  return [e, 'Super Admin', 'System', new Date(), 'Active'];
});

var AUDIT_HEADERS = ['Timestamp', 'Actor Email', 'Action', 'Details'];

var RESERVATION_HEADERS = [
  'Reservation ID', 'Timestamp', 'Full Name', 'Email', 'Phone', 'Affiliation',
  'Check-In', 'Check-In Time', 'Check-Out', 'Check-Out Time', 'Guests',
  'Room Type', 'Room Rate', 'Nights', 'Late Checkout Fee', 'Mattress Fee',
  'Total Expenses', 'Special Requests', 'Status', 'Admin Remarks',
  'Reviewed By', 'Reviewed At'
];

var ROOM_HEADERS = ['Room Type', 'Inventory', 'Rate', 'Included Guests', 'Max Guests'];

// Single source of truth for room rates/capacity — the Rooms sheet.
// Seeded on first run; edit values directly in the sheet afterward.
var DEFAULT_ROOMS = [
  ['Standard Room', 8, 2500, 2, 4],
  ['Executive Room', 8, 4000, 2, 4],
  ['Family Suite', 8, 6000, 4, 8],
  ['Event Place', 1, 15000, 80, 80]
];

var LATE_CHECKOUT_GRACE_HOUR = 12;
var LATE_CHECKOUT_GRACE_MINUTE = 15;
var LATE_CHECKOUT_FEE_PER_HOUR = 200;
var MATTRESS_FEE_PER_UNIT = 200;
var EXTRA_GUEST_FEE = 400;
var STANDARD_CHECKIN_TIME = '14:00:00';

// ── HTTP entry points ───────────────────────────────────────────────────────

function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : null;
  if (!action) return renderPage_(e);
  try {
    switch (action) {
      case 'ping':
        return jsonOutput({ ok: true, status: 'online', time: new Date().toISOString() });
      case 'getRooms':
        return jsonOutput({ ok: true, rooms: getRooms() });
      case 'checkAvailability':
        return jsonOutput(checkAvailability(
          e.parameter.roomType, e.parameter.checkIn, e.parameter.checkInTime,
          e.parameter.checkOut, e.parameter.checkOutTime
        ));
      case 'getAvailabilityCalendar':
        return jsonOutput(getAvailabilityCalendar(e.parameter.roomType, e.parameter.month));
      case 'listReservations':
        requireSession_(e.parameter.token);
        return jsonOutput({ ok: true, reservations: getReservations() });
      case 'listAdmins':
        requireSession_(e.parameter.token);
        return jsonOutput({ ok: true, admins: getAdmins_() });
      case 'listAuditLog':
        requireSession_(e.parameter.token);
        return jsonOutput({ ok: true, logs: getAuditLog_() });
      case 'requestOtp':
        return jsonOutput(requestOtp(e.parameter.email));
      default:
        return jsonOutput({ ok: false, error: 'Unknown or missing action.' });
    }
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err.message || err) });
  }
}

// Maps ?page= to a template file. Only reached when no `action` param is
// present, so it never shadows the JSON API above.
var PAGE_TEMPLATES_ = {
  admin: 'Admin',
  rooms: 'Rooms',
  gallery: 'Gallery',
  'safety-security': 'SafetySecurity',
  sustainability: 'Sustainability',
  'house-rules': 'HouseRules',
  'facilities-rules': 'FacilitiesRules'
};

function renderPage_(e) {
  var param = e && e.parameter ? e.parameter.page : null;
  var page = PAGE_TEMPLATES_[param] || 'Index';
  var template = HtmlService.createTemplateFromFile(page);
  // The visible content actually runs inside a sandboxed iframe whose own
  // location never reflects the original request's query string, so
  // Index.html can't just read ?room=/?book= off window.location — the
  // Apps Script build embeds these values server-side instead (see
  // deploy.sh).
  template.preselectRoom = (e && e.parameter && e.parameter.room) ? e.parameter.room : '';
  template.showBooking = !!(e && e.parameter && e.parameter.book);
  return template.evaluate()
    .setTitle('DLSL Chez Rafael')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Used by Index.html/Rooms.html/Admin.html templates to inline Styles.html/*Script.html.
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ ok: false, error: 'Invalid JSON body.' });
  }
  try {
    switch (body.action) {
      case 'submitReservation':
        return jsonOutput(submitReservation(body));
      case 'verifyOtp':
        return jsonOutput(verifyOtp(body.email, body.code));
      case 'updateReservationStatus':
        var statusSession = requireSession_(body.token);
        return jsonOutput(updateReservationStatus(
          body.reservationId, body.newStatus, body.adminRemarks, statusSession.email
        ));
      case 'addAdmin':
        var addSession = requireSession_(body.token);
        return jsonOutput(addAdmin(body.email, body.role, addSession.email));
      case 'removeAdmin':
        var removeSession = requireSession_(body.token);
        return jsonOutput(removeAdmin(body.email, removeSession.email));
      default:
        return jsonOutput({ ok: false, error: 'Unknown or missing action.' });
    }
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err.message || err) });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheets / spreadsheet access ─────────────────────────────────────────────

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet_(name, headers, seedRows) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    if (seedRows && seedRows.length) {
      sheet.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
    }
  }
  return sheet;
}

function getReservationsSheet_() {
  return getOrCreateSheet_('Reservations', RESERVATION_HEADERS);
}

function getRoomsSheet_() {
  return getOrCreateSheet_('Rooms', ROOM_HEADERS, DEFAULT_ROOMS);
}

function getAdminsSheet_() {
  return getOrCreateSheet_('Admins', ADMIN_HEADERS, DEFAULT_ADMINS);
}

function getAuditLogSheet_() {
  return getOrCreateSheet_('AuditLog', AUDIT_HEADERS);
}

// ── Admin user management ───────────────────────────────────────────────────

function getAdmins_() {
  var sheet = getAdminsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var tz = Session.getScriptTimeZone();
  var values = sheet.getRange(2, 1, lastRow - 1, ADMIN_HEADERS.length).getValues();
  return values
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(function (row) {
      return {
        email: String(row[0]).trim().toLowerCase(),
        role: row[1] || 'Admin',
        addedBy: row[2] || '',
        addedAt: row[3] instanceof Date ? Utilities.formatDate(row[3], tz, 'yyyy-MM-dd HH:mm') : row[3],
        status: row[4] || 'Active'
      };
    });
}

// Source of truth for who can request an OTP — the Admins sheet, seeded from
// ADMIN_EMAILS on first run and editable afterward via addAdmin/removeAdmin.
function getActiveAdminEmails_() {
  return getAdmins_()
    .filter(function (a) { return a.status === 'Active'; })
    .map(function (a) { return a.email; });
}

function addAdmin(email, role, actorEmail) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  var sheet = getAdminsSheet_();
  var admins = getAdmins_();
  var existingIndex = -1;
  for (var i = 0; i < admins.length; i++) {
    if (admins[i].email === email) { existingIndex = i; break; }
  }
  if (existingIndex !== -1 && admins[existingIndex].status === 'Active') {
    return { ok: false, error: 'This email is already an active admin.' };
  }
  if (existingIndex !== -1) {
    // Reactivate a previously removed admin instead of duplicating the row.
    var rowNum = existingIndex + 2;
    sheet.getRange(rowNum, 2, 1, 4).setValues([[role || 'Admin', actorEmail || '', new Date(), 'Active']]);
  } else {
    sheet.appendRow([email, role || 'Admin', actorEmail || '', new Date(), 'Active']);
  }
  logAudit_(actorEmail, 'Admin Added', email);
  return { ok: true };
}

function removeAdmin(email, actorEmail) {
  email = String(email || '').trim().toLowerCase();
  actorEmail = String(actorEmail || '').trim().toLowerCase();
  if (email === actorEmail) {
    return { ok: false, error: 'You cannot remove your own admin access.' };
  }
  var admins = getAdmins_();
  var activeCount = admins.filter(function (a) { return a.status === 'Active'; }).length;
  var targetIndex = -1;
  for (var i = 0; i < admins.length; i++) {
    if (admins[i].email === email) { targetIndex = i; break; }
  }
  if (targetIndex === -1 || admins[targetIndex].status !== 'Active') {
    return { ok: false, error: 'Admin not found.' };
  }
  if (activeCount <= 1) {
    return { ok: false, error: 'At least one active admin is required.' };
  }
  var sheet = getAdminsSheet_();
  sheet.getRange(targetIndex + 2, 5).setValue('Inactive');
  logAudit_(actorEmail, 'Admin Removed', email);
  return { ok: true };
}

// ── Audit log ────────────────────────────────────────────────────────────────

function logAudit_(actorEmail, action, details) {
  getAuditLogSheet_().appendRow([new Date(), actorEmail || '', action, details || '']);
}

function getAuditLog_() {
  var sheet = getAuditLogSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var tz = Session.getScriptTimeZone();
  var startRow = Math.max(2, lastRow - 499); // most recent 500 entries
  var values = sheet.getRange(startRow, 1, lastRow - startRow + 1, AUDIT_HEADERS.length).getValues();
  return values
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(function (row) {
      return {
        timestamp: row[0] instanceof Date ? Utilities.formatDate(row[0], tz, 'yyyy-MM-dd HH:mm:ss') : row[0],
        actorEmail: row[1],
        action: row[2],
        details: row[3]
      };
    })
    .reverse();
}

// ── Rooms (master data) ─────────────────────────────────────────────────────

function getRooms() {
  var sheet = getRoomsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, ROOM_HEADERS.length).getValues();
  return values
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(function (row) {
      return {
        roomType: row[0],
        inventory: Number(row[1]),
        rate: Number(row[2]),
        includedGuests: Number(row[3]),
        maxGuests: Number(row[4])
      };
    });
}

function getRoomByType_(roomType) {
  var rooms = getRooms();
  for (var i = 0; i < rooms.length; i++) {
    if (rooms[i].roomType === roomType) return rooms[i];
  }
  return null;
}

// ── Reservations: read ──────────────────────────────────────────────────────

function getReservations() {
  var sheet = getReservationsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var tz = Session.getScriptTimeZone();
  var values = sheet.getRange(2, 1, lastRow - 1, RESERVATION_HEADERS.length).getValues();
  return values
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(function (row) {
      var obj = {};
      RESERVATION_HEADERS.forEach(function (h, i) {
        var v = row[i];
        if (v instanceof Date) {
          v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        }
        obj[h] = v;
      });
      return obj;
    });
}

// ── Reservations: availability & submission ─────────────────────────────────

function checkAvailability(roomType, checkIn, checkInTime, checkOut, checkOutTime) {
  if (!roomType || !checkIn || !checkOut) {
    return { ok: false, error: 'Please complete room type, check-in, and check-out schedule.' };
  }
  var room = getRoomByType_(roomType);
  if (!room) return { ok: false, error: 'Unknown room type.' };

  var reqStart = parseDateTime(checkIn, checkInTime || STANDARD_CHECKIN_TIME);
  var reqEnd = parseDateTime(checkOut, checkOutTime || STANDARD_CHECKIN_TIME);
  if (!(reqEnd > reqStart)) {
    return { ok: false, error: 'Check-out date/time must be later than check-in date/time.' };
  }

  var overlapping = countOverlappingBookings_(roomType, reqStart, reqEnd, null);
  var availableCount = room.inventory - overlapping;
  var available = availableCount > 0;
  return {
    ok: true,
    available: available,
    availableCount: Math.max(0, availableCount),
    inventory: room.inventory,
    message: available
      ? (availableCount + ' of ' + room.inventory + ' ' + roomType + '(s) available for the selected schedule.')
      : (roomType + ' is fully booked for the selected date and time.')
  };
}

function countOverlappingBookings_(roomType, reqStart, reqEnd, excludeReservationId) {
  var sheet = getReservationsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var idx = headerIndex_();
  var values = sheet.getRange(2, 1, lastRow - 1, RESERVATION_HEADERS.length).getValues();
  var count = 0;
  values.forEach(function (row) {
    var id = row[idx['Reservation ID']];
    if (!id) return;
    if (excludeReservationId && id === excludeReservationId) return;
    if (row[idx['Room Type']] !== roomType) return;
    var status = row[idx['Status']];
    if (status === 'Rejected' || status === 'Declined') return;

    var existStart = parseSheetDateTime(row[idx['Check-In']], row[idx['Check-In Time']]);
    var existEnd = parseSheetDateTime(row[idx['Check-Out']], row[idx['Check-Out Time']]);
    if (existStart < reqEnd && existEnd > reqStart) count++;
  });
  return count;
}

function headerIndex_() {
  var idx = {};
  RESERVATION_HEADERS.forEach(function (h, i) { idx[h] = i; });
  return idx;
}

// Per-day availability for one room type over one calendar month, so the
// booking form can render a small calendar of open/limited/full days before
// the guest picks specific dates. monthStr is 'yyyy-MM'; defaults to the
// current month. Public (no session) — same trust level as checkAvailability.
function getAvailabilityCalendar(roomType, monthStr) {
  var room = getRoomByType_(roomType);
  if (!room) return { ok: false, error: 'Unknown room type.' };

  var year, month; // month is 0-indexed
  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    var parts = monthStr.split('-');
    year = Number(parts[0]);
    month = Number(parts[1]) - 1;
  } else {
    var now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
  }

  var tz = Session.getScriptTimeZone();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var days = [];
  for (var d = 1; d <= daysInMonth; d++) {
    days.push({
      date: Utilities.formatDate(new Date(year, month, d), tz, 'yyyy-MM-dd'),
      start: new Date(year, month, d, 0, 0, 0),
      end: new Date(year, month, d + 1, 0, 0, 0),
      bookedCount: 0
    });
  }

  var sheet = getReservationsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var idx = headerIndex_();
    var values = sheet.getRange(2, 1, lastRow - 1, RESERVATION_HEADERS.length).getValues();
    values.forEach(function (row) {
      if (!row[idx['Reservation ID']]) return;
      if (row[idx['Room Type']] !== roomType) return;
      var status = row[idx['Status']];
      if (status === 'Rejected' || status === 'Declined') return;

      var existStart = parseSheetDateTime(row[idx['Check-In']], row[idx['Check-In Time']]);
      var existEnd = parseSheetDateTime(row[idx['Check-Out']], row[idx['Check-Out Time']]);
      days.forEach(function (day) {
        if (existStart < day.end && existEnd > day.start) day.bookedCount++;
      });
    });
  }

  var result = days.map(function (day) {
    var availableCount = Math.max(0, room.inventory - day.bookedCount);
    return {
      date: day.date,
      bookedCount: day.bookedCount,
      availableCount: availableCount,
      status: availableCount <= 0 ? 'full' : (day.bookedCount > 0 ? 'partial' : 'available')
    };
  });

  return { ok: true, roomType: roomType, inventory: room.inventory, year: year, month: month + 1, days: result };
}

function submitReservation(body) {
  var required = ['fullName', 'email', 'phone', 'checkIn', 'checkOut', 'roomType', 'guests'];
  for (var i = 0; i < required.length; i++) {
    if (!body[required[i]]) {
      return { ok: false, error: 'Please complete room type, check-in, and check-out schedule.' };
    }
  }

  var room = getRoomByType_(body.roomType);
  if (!room) return { ok: false, error: 'Unknown room type.' };

  var guests = Number(body.guests);
  if (!guests || guests < 1) return { ok: false, error: 'Please enter a valid number of guests.' };
  if (guests > room.maxGuests) {
    return { ok: false, error: room.roomType + ' allows a maximum of ' + room.maxGuests + ' guests.' };
  }

  var checkInTime = body.checkInTime || STANDARD_CHECKIN_TIME;
  var checkOutTime = body.checkOutTime || STANDARD_CHECKIN_TIME;
  var start = parseDateTime(body.checkIn, checkInTime);
  var end = parseDateTime(body.checkOut, checkOutTime);
  if (!(end > start)) {
    return { ok: false, error: 'Check-out date/time must be later than check-in date/time.' };
  }

  // Re-validate the slot server-side right before writing, to close the race
  // between the guest's earlier availability check and this submission.
  var overlapping = countOverlappingBookings_(body.roomType, start, end, null);
  if (overlapping >= room.inventory) {
    return { ok: false, error: room.roomType + ' is fully booked for the selected date and time.' };
  }

  var pricing = computePricing_(room, start, end, checkOutTime, guests, Number(body.mattressQty || 0));

  var reservationId = 'RES-' + Math.floor(Date.now() / 1000);
  var sheet = getReservationsSheet_();
  sheet.appendRow([
    reservationId,
    new Date(),
    body.fullName,
    body.email,
    body.phone,
    body.affiliation || '',
    body.checkIn,
    checkInTime,
    body.checkOut,
    checkOutTime,
    guests,
    room.roomType,
    room.rate,
    pricing.nights,
    pricing.lateCheckoutFee,
    pricing.mattressFee,
    pricing.totalExpenses,
    body.specialRequests || '',
    'Pending Approval',
    '',
    '',
    ''
  ]);

  sendReservationEmail(body.email, {
    reservationId: reservationId,
    fullName: body.fullName,
    roomType: room.roomType,
    checkIn: body.checkIn,
    checkInTime: checkInTime,
    checkOut: body.checkOut,
    checkOutTime: checkOutTime,
    totalExpenses: pricing.totalExpenses,
    status: 'Pending Approval'
  });

  return {
    ok: true,
    reservationId: reservationId,
    status: 'Pending Approval',
    pricing: pricing
  };
}

// Mirrors the pricing logic used client-side for the live cost summary, kept
// server-authoritative here since submission always recomputes before writing.
function computePricing_(room, start, end, checkOutTime, guests, mattressQty) {
  var nights = Math.max(1, Math.round((stripTime_(end) - stripTime_(start)) / 86400000));

  var lateCheckoutFee = 0;
  var coTime = normalizeTimeValue(checkOutTime);
  var parts = coTime.split(':').map(Number);
  var coMinutes = parts[0] * 60 + parts[1];
  var graceMinutes = LATE_CHECKOUT_GRACE_HOUR * 60 + LATE_CHECKOUT_GRACE_MINUTE;
  if (coMinutes > graceMinutes) {
    var extraHours = Math.ceil((coMinutes - graceMinutes) / 60);
    lateCheckoutFee = extraHours * LATE_CHECKOUT_FEE_PER_HOUR;
  }

  var mattressFee = Math.max(0, mattressQty) * MATTRESS_FEE_PER_UNIT;

  var extraGuests = Math.max(0, guests - room.includedGuests);
  var extraGuestFee = extraGuests * EXTRA_GUEST_FEE;

  var roomCost = room.rate * nights;
  var totalExpenses = roomCost + lateCheckoutFee + mattressFee + extraGuestFee;

  return {
    nights: nights,
    roomRate: room.rate,
    roomCost: roomCost,
    lateCheckoutFee: lateCheckoutFee,
    mattressFee: mattressFee,
    extraGuestFee: extraGuestFee,
    totalExpenses: totalExpenses
  };
}

function stripTime_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// ── Admin: status updates ───────────────────────────────────────────────────

function updateReservationStatus(reservationId, newStatus, adminRemarks, reviewedBy) {
  if (!reservationId || !newStatus) {
    return { ok: false, error: 'Reservation ID and new status are required.' };
  }
  var validStatuses = ['Pending Approval', 'Approved', 'Rejected', 'Declined'];
  if (validStatuses.indexOf(newStatus) === -1) {
    return { ok: false, error: 'Invalid status.' };
  }

  var sheet = getReservationsSheet_();
  var idx = headerIndex_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'Reservation not found.' };

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === reservationId) {
      var rowNum = i + 2;
      sheet.getRange(rowNum, idx['Status'] + 1).setValue(newStatus);
      sheet.getRange(rowNum, idx['Admin Remarks'] + 1).setValue(adminRemarks || '');
      sheet.getRange(rowNum, idx['Reviewed By'] + 1).setValue(reviewedBy || '');
      sheet.getRange(rowNum, idx['Reviewed At'] + 1).setValue(new Date());

      var email = sheet.getRange(rowNum, idx['Email'] + 1).getValue();
      var fullName = sheet.getRange(rowNum, idx['Full Name'] + 1).getValue();
      var roomType = sheet.getRange(rowNum, idx['Room Type'] + 1).getValue();
      logAudit_(reviewedBy, 'Reservation ' + newStatus, reservationId + ' (' + fullName + ', ' + roomType + ')');
      if (newStatus === 'Approved' || newStatus === 'Rejected' || newStatus === 'Declined') {
        sendStatusUpdateEmail_(email, {
          reservationId: reservationId, fullName: fullName, roomType: roomType,
          status: newStatus, adminRemarks: adminRemarks || ''
        });
      }
      return { ok: true, reservationId: reservationId, status: newStatus };
    }
  }
  return { ok: false, error: 'Reservation not found.' };
}

// ── Date/time utilities ──────────────────────────────────────────────────────

function parseDateTime(dateStr, timeStr) {
  var time = normalizeTimeValue(timeStr);
  return new Date(dateStr + 'T' + time);
}

function parseSheetDateTime(dateVal, timeVal) {
  var tz = Session.getScriptTimeZone();
  var dateStr = dateVal instanceof Date
    ? Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd')
    : String(dateVal);
  var timeStr = normalizeTimeValue(timeVal);
  return new Date(dateStr + 'T' + timeStr);
}

function normalizeTimeValue(timeVal) {
  if (!timeVal) return STANDARD_CHECKIN_TIME;
  if (timeVal instanceof Date) {
    return Utilities.formatDate(timeVal, Session.getScriptTimeZone(), 'HH:mm:ss');
  }
  var s = String(timeVal).trim();
  var parts = s.split(':');
  var h = (parts[0] || '00').padStart(2, '0');
  var m = (parts[1] || '00').padStart(2, '0');
  var sec = (parts[2] || '00').padStart(2, '0');
  return h + ':' + m + ':' + sec;
}

// ── Email notifications ─────────────────────────────────────────────────────

function sendReservationEmail(email, info) {
  if (!email) return;
  var subject = 'DLSL Guest House Reservation Received';
  var body = [
    'Dear ' + info.fullName + ',',
    '',
    'We have received your reservation request at DLSL Chez Rafael.',
    '',
    'Reservation ID: ' + info.reservationId,
    'Room Type: ' + info.roomType,
    'Check-In: ' + info.checkIn + ' ' + info.checkInTime,
    'Check-Out: ' + info.checkOut + ' ' + info.checkOutTime,
    'Total Expenses: PHP ' + Number(info.totalExpenses).toLocaleString(),
    'Status: ' + info.status,
    '',
    'You will receive another email once your reservation has been reviewed.',
    '',
    'DLSL Guest House Administration'
  ].join('\n');
  MailApp.sendEmail({ to: email, subject: subject, body: body });
}

function sendStatusUpdateEmail_(email, info) {
  if (!email) return;
  var subject = 'DLSL Guest House Reservation ' + info.status + ' — ' + info.reservationId;
  var body = [
    'Dear ' + info.fullName + ',',
    '',
    'Your reservation request has been reviewed.',
    '',
    'Reservation ID: ' + info.reservationId,
    'Room Type: ' + info.roomType,
    'Status: ' + info.status,
    info.adminRemarks ? ('Remarks: ' + info.adminRemarks) : '',
    '',
    'DLSL Guest House Administration'
  ].filter(function (l) { return l !== ''; }).join('\n');
  MailApp.sendEmail({ to: email, subject: subject, body: body });
}

// ── Admin auth: email OTP + session tokens ──────────────────────────────────

function requestOtp(email) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (getActiveAdminEmails_().indexOf(email) === -1) {
    return { ok: false, error: 'This email is not authorized for admin access.' };
  }
  var code = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put('otp_' + email, code, OTP_TTL_SECONDS);
  MailApp.sendEmail({
    to: email,
    subject: 'Your DLSL Guest House admin login code',
    body: 'Your verification code is ' + code + '.\n\nIt expires in 5 minutes. If you did not request this, you can ignore this email.'
  });
  return { ok: true };
}

function verifyOtp(email, code) {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim();
  var cache = CacheService.getScriptCache();
  var key = 'otp_' + email;
  var stored = cache.get(key);
  if (!stored || stored !== code) {
    return { ok: false, error: 'Invalid or expired code.' };
  }
  cache.remove(key);

  var token = Utilities.getUuid();
  var sessions = loadSessions_();
  sessions[token] = { email: email, expiresAt: Date.now() + SESSION_TTL_MS };
  saveSessions_(sessions);
  logAudit_(email, 'Login', 'Admin logged in');
  // Bundled with the reservations list so the dashboard can render immediately
  // after login instead of waiting on a second round trip.
  return { ok: true, token: token, email: email, reservations: getReservations() };
}

function validateSession_(token) {
  if (!token) return { ok: false };
  var sessions = loadSessions_();
  var s = sessions[token];
  if (!s || s.expiresAt < Date.now()) return { ok: false };
  return { ok: true, email: s.email };
}

function requireSession_(token) {
  var v = validateSession_(token);
  if (!v.ok) throw new Error('Not authenticated.');
  return v;
}

function loadSessions_() {
  var raw = PropertiesService.getScriptProperties().getProperty('SESSIONS');
  var sessions = raw ? JSON.parse(raw) : {};
  var now = Date.now();
  Object.keys(sessions).forEach(function (t) {
    if (sessions[t].expiresAt < now) delete sessions[t];
  });
  return sessions;
}

function saveSessions_(sessions) {
  PropertiesService.getScriptProperties().setProperty('SESSIONS', JSON.stringify(sessions));
}
