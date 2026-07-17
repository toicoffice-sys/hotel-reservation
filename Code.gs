// ============================================================
//  DLSL Chez Rafael Hotel Reservation System — Backend API
//  Google Apps Script Web App · JSON over HTTP
// ============================================================

var ADMIN_EMAILS = ['toic.pm@dlsl.edu.ph'];
var OTP_TTL_SECONDS = 5 * 60;
var SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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
      case 'listReservations':
        requireSession_(e.parameter.token);
        return jsonOutput({ ok: true, reservations: getReservations() });
      case 'requestOtp':
        return jsonOutput(requestOtp(e.parameter.email));
      default:
        return jsonOutput({ ok: false, error: 'Unknown or missing action.' });
    }
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err.message || err) });
  }
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
        requireSession_(body.token);
        return jsonOutput(updateReservationStatus(
          body.reservationId, body.newStatus, body.adminRemarks, body.reviewedBy
        ));
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
  if (ADMIN_EMAILS.indexOf(email) === -1) {
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
