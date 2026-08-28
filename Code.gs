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
  'Reviewed By', 'Reviewed At', 'Proof of Payment',
  'Guests Name', 'Guests Company / Address'
];

var ROOM_HEADERS = ['Room Type', 'Inventory', 'Rate', 'Included Guests', 'Max Guests'];

// Single source of truth for room rates/capacity — the Rooms sheet.
// Seeded on first run; edit values directly in the sheet afterward.
// Standard Twin's rate/guest capacity is a placeholder (no prior entry to
// inherit from, unlike the other three which kept their original rate/
// capacity through the rename) — adjust directly in the Rooms sheet.
var DEFAULT_ROOMS = [
  ['Standard Single', 4, 2000, 1, 2],
  ['Standard Twin', 2, 2300, 2, 4],
  ['Standard Family', 1, 2800, 3, 4],
  ['Standard Triple', 1, 3000, 3, 6],
  ['Cafe Le Barako', 1, 1000, 80, 80],
  ['Chez Rafael Function Hall', 1, 500, 40, 40]
];

var MATTRESS_FEE_PER_UNIT = 500;
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
      case 'getGuestReservation':
        return jsonOutput(getGuestReservation(e.parameter.reservationId, e.parameter.token));
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
  'facilities-rules': 'FacilitiesRules',
  'upload-proof': 'UploadProof',
  'cancel-reservation': 'CancelReservation'
};

function renderPage_(e) {
  var param = e && e.parameter ? e.parameter.page : null;
  var page = PAGE_TEMPLATES_[param] || 'Index';
  var template = HtmlService.createTemplateFromFile(page);
  // The visible content actually runs inside a sandboxed iframe whose own
  // location never reflects the original request's query string, so
  // Index.html can't just read ?room=/?book= off window.location — the
  // Apps Script build embeds these values server-side instead (see
  // deploy.sh). UploadProof/CancelReservation lean on the same trick for
  // the ?res=/?token= pair from the guest's emailed link.
  template.preselectRoom = (e && e.parameter && e.parameter.room) ? e.parameter.room : '';
  template.showBooking = !!(e && e.parameter && e.parameter.book);
  template.guestReservationId = (e && e.parameter && e.parameter.res) ? e.parameter.res : '';
  template.guestToken = (e && e.parameter && e.parameter.token) ? e.parameter.token : '';
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
      case 'submitContactInquiry':
        return jsonOutput(submitContactInquiry(body));
      case 'submitProofOfPayment':
        return jsonOutput(submitProofOfPayment(body));
      case 'guestCancelReservation':
        return jsonOutput(guestCancelReservation(body.reservationId, body.token));
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

// Appends any header RESERVATION_HEADERS has that the live sheet doesn't yet
// (e.g. 'Proof of Payment' added after the sheet already existed in
// production) — additive only, so existing columns/data are never disturbed.
function ensureTrailingHeaders_(sheet, headers) {
  var lastCol = sheet.getLastColumn();
  if (lastCol >= headers.length) return;
  var missing = headers.slice(lastCol);
  sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
}

function getReservationsSheet_() {
  var sheet = getOrCreateSheet_('Reservations', RESERVATION_HEADERS);
  ensureTrailingHeaders_(sheet, RESERVATION_HEADERS);
  return sheet;
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

  var proofOfPaymentUrl = '';
  if (body.proofOfPaymentData) {
    proofOfPaymentUrl = saveProofOfPayment_(
      body.proofOfPaymentData, body.proofOfPaymentName, body.proofOfPaymentType, reservationId
    );
  }

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
    '',
    proofOfPaymentUrl,
    body.guestsName || '',
    body.guestsCompany || ''
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

// Uploads a guest's proof-of-payment attachment to a dedicated Drive folder
// (created once, reused via Script Properties) and returns a link an admin
// can open from the reservation review modal.
function saveProofOfPayment_(base64Data, fileName, mimeType, reservationId) {
  var decoded = Utilities.base64Decode(base64Data);
  var safeName = String(fileName || 'proof-of-payment').replace(/[\/\\]/g, '_');
  var blob = Utilities.newBlob(decoded, mimeType || 'application/octet-stream', reservationId + ' — ' + safeName);
  var folder = getProofOfPaymentFolder_();
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// Drive access needs a one-time manual authorization (DriveApp.createFolder
// fails with "Wala kang pahintulot..." until that's done — see the Apps
// Script editor's Run button). Guests shouldn't be blocked by that: if Drive
// isn't available yet, email the receipt straight to the admins instead, so
// the upload still succeeds. Once Drive is authorized this goes back to
// giving a real link automatically — no further code change needed.
function saveOrEmailProofOfPayment_(base64Data, fileName, mimeType, reservationId, fullName, roomType) {
  try {
    return saveProofOfPayment_(base64Data, fileName, mimeType, reservationId);
  } catch (err) {
    var safeName = String(fileName || 'proof-of-payment').replace(/[\/\\]/g, '_');
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType || 'application/octet-stream', safeName);
    MailApp.sendEmail({
      to: getActiveAdminEmails_().join(','),
      subject: 'Proof of Payment (emailed) — ' + reservationId,
      body: [
        'Drive storage isn\'t authorized yet, so this guest\'s proof of payment is attached directly to this email.',
        '',
        'Reservation ID: ' + reservationId,
        'Guest: ' + fullName,
        'Room Type: ' + roomType
      ].join('\n'),
      attachments: [blob]
    });
    return 'Emailed to admin (Drive not yet authorized) — ' + new Date().toLocaleString();
  }
}

function getProofOfPaymentFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('PROOF_OF_PAYMENT_FOLDER_ID');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (err) {
      // Folder was deleted/moved out from under us — fall through and remake it.
    }
  }
  var folder = DriveApp.createFolder('DLSL Chez Rafael — Proof of Payment');
  props.setProperty('PROOF_OF_PAYMENT_FOLDER_ID', folder.getId());
  return folder;
}

// Mirrors the pricing logic used client-side for the live cost summary, kept
// server-authoritative here since submission always recomputes before writing.
function computePricing_(room, start, end, checkOutTime, guests, mattressQty) {
  var nights = Math.max(1, Math.round((stripTime_(end) - stripTime_(start)) / 86400000));

  var mattressFee = Math.max(0, mattressQty) * MATTRESS_FEE_PER_UNIT;

  var extraGuests = Math.max(0, guests - room.includedGuests);
  var extraGuestFee = extraGuests * EXTRA_GUEST_FEE;

  var roomCost = room.rate * nights;
  var totalExpenses = roomCost + mattressFee + extraGuestFee;

  return {
    nights: nights,
    roomRate: room.rate,
    roomCost: roomCost,
    lateCheckoutFee: 0,
    mattressFee: mattressFee,
    extraGuestFee: extraGuestFee,
    totalExpenses: totalExpenses
  };
}

function stripTime_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// ── Admin: status updates ───────────────────────────────────────────────────

// Shared by updateReservationStatus/submitProofOfPayment/guestCancelReservation
// so they don't each re-implement the "scan column A for this ID" scan.
function findReservationRowNum_(sheet, reservationId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || !reservationId) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === reservationId) return i + 2;
  }
  return -1;
}

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
  var rowNum = findReservationRowNum_(sheet, reservationId);
  if (rowNum === -1) return { ok: false, error: 'Reservation not found.' };

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

// ── Guest self-service (proof of payment upload / cancellation) ─────────────
// Reached only via the signed links in the approval email — see
// signReservationToken_ and sendStatusUpdateEmail_. The token stands in for
// a login: it proves the requester actually received that specific email,
// so a guessed/enumerated Reservation ID alone can't touch someone else's
// booking.

function getEmailActionSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('EMAIL_ACTION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('EMAIL_ACTION_SECRET', secret);
  }
  return secret;
}

function signReservationToken_(reservationId) {
  var bytes = Utilities.computeHmacSha256Signature(String(reservationId), getEmailActionSecret_());
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function verifyReservationToken_(reservationId, token) {
  return !!reservationId && !!token && signReservationToken_(reservationId) === token;
}

// Limited, token-gated view of a reservation for the guest-facing
// upload-proof/cancel-reservation pages — deliberately returns far less
// than the admin's getReservations() (no phone, remarks, etc.).
function getGuestReservation(reservationId, token) {
  if (!verifyReservationToken_(reservationId, token)) {
    return { ok: false, error: 'This link is invalid or has expired.' };
  }
  var sheet = getReservationsSheet_();
  var idx = headerIndex_();
  var rowNum = findReservationRowNum_(sheet, reservationId);
  if (rowNum === -1) return { ok: false, error: 'Reservation not found.' };

  var row = sheet.getRange(rowNum, 1, 1, RESERVATION_HEADERS.length).getValues()[0];
  return {
    ok: true,
    reservationId: reservationId,
    fullName: row[idx['Full Name']],
    roomType: row[idx['Room Type']],
    checkIn: row[idx['Check-In']],
    checkOut: row[idx['Check-Out']],
    totalExpenses: row[idx['Total Expenses']],
    status: row[idx['Status']],
    hasProofOfPayment: !!row[idx['Proof of Payment']]
  };
}

function submitProofOfPayment(body) {
  var reservationId = body && body.reservationId;
  var token = body && body.token;
  if (!verifyReservationToken_(reservationId, token)) {
    return { ok: false, error: 'This link is invalid or has expired.' };
  }
  if (!body.proofOfPaymentData) {
    return { ok: false, error: 'Please attach a screenshot or PDF of your payment receipt.' };
  }

  var sheet = getReservationsSheet_();
  var idx = headerIndex_();
  var rowNum = findReservationRowNum_(sheet, reservationId);
  if (rowNum === -1) return { ok: false, error: 'Reservation not found.' };

  var status = sheet.getRange(rowNum, idx['Status'] + 1).getValue();
  if (status !== 'Approved') {
    return { ok: false, error: 'Proof of payment can only be uploaded for an approved reservation.' };
  }

  var fullName = sheet.getRange(rowNum, idx['Full Name'] + 1).getValue();
  var roomType = sheet.getRange(rowNum, idx['Room Type'] + 1).getValue();
  var reference = saveOrEmailProofOfPayment_(
    body.proofOfPaymentData, body.proofOfPaymentName, body.proofOfPaymentType, reservationId, fullName, roomType
  );
  sheet.getRange(rowNum, idx['Proof of Payment'] + 1).setValue(reference);

  logAudit_('Guest', 'Proof of payment uploaded', reservationId + ' (' + fullName + ', ' + roomType + ')');
  return { ok: true, reservationId: reservationId };
}

function guestCancelReservation(reservationId, token) {
  if (!verifyReservationToken_(reservationId, token)) {
    return { ok: false, error: 'This link is invalid or has expired.' };
  }
  var sheet = getReservationsSheet_();
  var idx = headerIndex_();
  var rowNum = findReservationRowNum_(sheet, reservationId);
  if (rowNum === -1) return { ok: false, error: 'Reservation not found.' };

  var status = sheet.getRange(rowNum, idx['Status'] + 1).getValue();
  if (status === 'Rejected' || status === 'Declined') {
    return { ok: false, error: 'This reservation is already ' + status.toLowerCase() + '.' };
  }

  sheet.getRange(rowNum, idx['Status'] + 1).setValue('Declined');
  sheet.getRange(rowNum, idx['Admin Remarks'] + 1).setValue('Cancelled by guest via email link.');
  sheet.getRange(rowNum, idx['Reviewed By'] + 1).setValue('Guest (self-service)');
  sheet.getRange(rowNum, idx['Reviewed At'] + 1).setValue(new Date());

  var fullName = sheet.getRange(rowNum, idx['Full Name'] + 1).getValue();
  var roomType = sheet.getRange(rowNum, idx['Room Type'] + 1).getValue();
  logAudit_('Guest', 'Reservation cancelled by guest', reservationId + ' (' + fullName + ', ' + roomType + ')');
  return { ok: true, reservationId: reservationId };
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
    'Thank you for your interest in booking Chez Rafael. We have received your reservation request with the following details:',
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
    'Sincerely,',
    'Chez Rafael'
  ].join('\n');
  MailApp.sendEmail({ to: email, subject: subject, body: body });
}

function sendStatusUpdateEmail_(email, info) {
  if (!email) return;
  var subject = 'DLSL Guest House Reservation ' + info.status + ' — ' + info.reservationId;
  var lines = [
    'Dear ' + info.fullName + ',',
    '',
    'Your reservation request has been reviewed.',
    '',
    'Reservation ID: ' + info.reservationId,
    'Room Type: ' + info.roomType,
    'Status: ' + info.status,
    info.adminRemarks ? ('Remarks: ' + info.adminRemarks) : ''
  ];

  // Approved is the only status with follow-up actions — real, permanent
  // links (token-signed so a guessed Reservation ID can't touch someone
  // else's booking), not Gmail's own auto-suggested Smart Reply chips,
  // which this app has no way to set.
  var htmlActions = '';
  if (info.status === 'Approved') {
    var baseUrl = ScriptApp.getService().getUrl();
    var token = signReservationToken_(info.reservationId);
    var uploadUrl = baseUrl + '?page=upload-proof&res=' + encodeURIComponent(info.reservationId) + '&token=' + token;
    var cancelUrl = baseUrl + '?page=cancel-reservation&res=' + encodeURIComponent(info.reservationId) + '&token=' + token;

    lines.push('', 'Upload your proof of payment: ' + uploadUrl);
    lines.push('No longer interested? Cancel your reservation: ' + cancelUrl);

    htmlActions =
      '<div style="margin:24px 0;">' +
        '<a href="' + uploadUrl + '" style="display:inline-block;background:#0e6b3f;color:#ffffff;text-decoration:none;' +
          'font-weight:600;padding:12px 22px;border-radius:8px;margin:0 12px 12px 0;">Upload Proof of Payment</a>' +
        '<a href="' + cancelUrl + '" style="display:inline-block;background:#c0392b;color:#ffffff;text-decoration:none;' +
          'font-weight:600;padding:12px 22px;border-radius:8px;margin:0 0 12px 0;">No Longer Interested</a>' +
      '</div>';
  }

  lines.push('', 'Sincerely,', 'Chez Rafael');
  var plainBody = lines.filter(function (l) { return l !== ''; }).join('\n');

  var htmlBody =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c231f;font-size:14px;line-height:1.6;">' +
      '<p>Dear ' + info.fullName + ',</p>' +
      '<p>Your reservation request has been reviewed.</p>' +
      '<p>' +
        'Reservation ID: ' + info.reservationId + '<br>' +
        'Room Type: ' + info.roomType + '<br>' +
        'Status: <strong>' + info.status + '</strong>' +
        (info.adminRemarks ? ('<br>Remarks: ' + info.adminRemarks) : '') +
      '</p>' +
      htmlActions +
      '<p>Sincerely,<br>Chez Rafael</p>' +
    '</div>';

  MailApp.sendEmail({ to: email, subject: subject, body: plainBody, htmlBody: htmlBody });
}

// ── Contact Us inquiries ────────────────────────────────────────────────────

function submitContactInquiry(body) {
  var name = String((body && body.name) || '').trim();
  var email = String((body && body.email) || '').trim();
  var phone = String((body && body.phone) || '').trim();
  var message = String((body && body.message) || '').trim();

  if (!name) return { ok: false, error: 'Please enter your name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!message) return { ok: false, error: 'Please enter a message.' };

  var recipients = getActiveAdminEmails_();
  if (!recipients.length) recipients = ADMIN_EMAILS;

  var subject = 'DLSL Chez Rafael — Contact Us inquiry from ' + name;
  var bodyText = [
    'A new Contact Us inquiry was submitted on the Chez Rafael booking portal.',
    '',
    'Name: ' + name,
    'Email: ' + email,
    phone ? ('Phone: ' + phone) : '',
    '',
    'Message:',
    message
  ].filter(function (l) { return l !== ''; }).join('\n');

  MailApp.sendEmail({ to: recipients.join(','), replyTo: email, subject: subject, body: bodyText });

  MailApp.sendEmail({
    to: email,
    subject: 'We received your message — DLSL Chez Rafael',
    body: [
      'Dear ' + name + ',',
      '',
      'Thank you for reaching out to DLSL Chez Rafael. We have received your message and will get back to you as soon as possible.',
      '',
      'Your message:',
      message,
      '',
      'Sincerely,',
      'Chez Rafael'
    ].join('\n')
  });

  return { ok: true };
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
