// DLSL Chez Rafael Hotel Reservation System — public booking portal logic
// Shared room data/API helpers (SCRIPT_URL, ROOM_IMAGES, fetchRooms, etc.) live
// in common.js, loaded before this file.

const LATE_CHECKOUT_GRACE_MINUTES = 12 * 60 + 15;
const LATE_CHECKOUT_FEE_PER_HOUR = 200;
const MATTRESS_FEE_PER_UNIT = 200;

let rooms = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Render everything that doesn't depend on the backend immediately, so a
  // slow or hung Apps Script response never blocks the whole page.
  setDefaultDates();

  document.getElementById('roomType').addEventListener('change', onRoomChange);
  ['guests', 'checkIn', 'checkInTime', 'checkOut', 'checkOutTime', 'mattressQty']
    .forEach(id => document.getElementById(id).addEventListener('input', updateSummary));

  document.getElementById('checkAvailabilityBtn').addEventListener('click', onCheckAvailability);
  document.getElementById('bookingForm').addEventListener('submit', onSubmitReservation);
  document.getElementById('changeRoomBtn').addEventListener('click', hideBookingForm);

  updateSummary();

  // Rooms depend on the backend and can be slow — fetch in the background
  // without blocking the rest of the page.
  rooms = await fetchRooms();
  populateRoomSelect();
  onRoomChange();

  // Arriving from a "Book Now" click elsewhere: a room card on rooms.html
  // preselects that room (?room=), while the header's own Book Now button
  // (on any page) just wants the form shown with nothing preselected
  // (?book=1). On the Apps Script deployment the visible content runs
  // inside a sandboxed iframe whose own location never reflects the
  // request's query string, so the GAS_* globals (injected server-side by
  // Code.gs, see deploy.sh) take priority when present; GitHub Pages has no
  // such iframe and just uses the real query string.
  const preselect = (typeof GAS_PRESELECT_ROOM !== 'undefined' && GAS_PRESELECT_ROOM)
    ? GAS_PRESELECT_ROOM
    : new URLSearchParams(location.search).get('room');
  const showBookingFlag = (typeof GAS_SHOW_BOOKING !== 'undefined')
    ? GAS_SHOW_BOOKING
    : new URLSearchParams(location.search).has('book');
  if (preselect && getRoom(preselect)) {
    selectRoomAndScroll(preselect);
  } else if (showBookingFlag) {
    showBookingFormAndScroll();
  }
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

function getRoom(roomType) {
  return rooms.find(r => r.roomType === roomType) || null;
}

function setDefaultDates() {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  document.getElementById('checkIn').value = toDateInputValue(today);
  document.getElementById('checkOut').value = toDateInputValue(tomorrow);
}

function toDateInputValue(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function selectRoomAndScroll(roomType) {
  document.getElementById('roomType').value = roomType;
  onRoomChange();
  showBookingFormAndScroll();
}

function showBookingForm() {
  document.getElementById('bookingSection').hidden = false;
}

function showBookingFormAndScroll() {
  showBookingForm();
  document.getElementById('bookingSection').scrollIntoView({ behavior: 'smooth' });
}

function hideBookingForm() {
  // Room selection now lives on rooms.html — send the guest back there.
  navigateTop('rooms.html', '?page=rooms');
}

function populateRoomSelect() {
  const select = document.getElementById('roomType');
  rooms.forEach(room => {
    const opt = document.createElement('option');
    opt.value = room.roomType;
    opt.textContent = `${room.roomType} — ${formatCurrency(room.rate)}`;
    select.appendChild(opt);
  });
}

function onRoomChange() {
  const room = getRoom(document.getElementById('roomType').value);
  const hint = document.getElementById('guestsHint');
  const guestsInput = document.getElementById('guests');
  if (room) {
    hint.textContent = `Includes ${room.includedGuests} guests. Max ${room.maxGuests}. PHP ${EXTRA_GUEST_FEE} per extra guest.`;
    guestsInput.max = room.maxGuests;
    if (!guestsInput.value) guestsInput.value = room.includedGuests;
  } else {
    hint.textContent = '';
    guestsInput.removeAttribute('max');
  }
  updateSummary();
}

// ── Pricing (mirrors backend computePricing_) ───────────────────────────

function computePricing(room, checkIn, checkInTime, checkOut, checkOutTime, guests, mattressQty) {
  if (!room || !checkIn || !checkOut) return null;
  const start = new Date(`${checkIn}T${checkInTime || '14:00'}:00`);
  const end = new Date(`${checkOut}T${checkOutTime || '12:00'}:00`);
  if (!(end > start)) return null;

  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const nights = Math.max(1, Math.round((endDay - startDay) / 86400000));

  let lateCheckoutFee = 0;
  const [coH, coM] = (checkOutTime || '12:00').split(':').map(Number);
  const coMinutes = coH * 60 + coM;
  if (coMinutes > LATE_CHECKOUT_GRACE_MINUTES) {
    const extraHours = Math.ceil((coMinutes - LATE_CHECKOUT_GRACE_MINUTES) / 60);
    lateCheckoutFee = extraHours * LATE_CHECKOUT_FEE_PER_HOUR;
  }

  const mattressFee = Math.max(0, Number(mattressQty) || 0) * MATTRESS_FEE_PER_UNIT;
  const extraGuests = Math.max(0, (Number(guests) || 0) - room.includedGuests);
  const extraGuestFee = extraGuests * EXTRA_GUEST_FEE;
  const roomCost = room.rate * nights;
  const totalExpenses = roomCost + lateCheckoutFee + mattressFee + extraGuestFee;

  return { nights, roomRate: room.rate, roomCost, lateCheckoutFee, mattressFee, extraGuestFee, totalExpenses };
}

function updateSummary() {
  const room = getRoom(document.getElementById('roomType').value);
  const checkIn = document.getElementById('checkIn').value;
  const checkInTime = document.getElementById('checkInTime').value;
  const checkOut = document.getElementById('checkOut').value;
  const checkOutTime = document.getElementById('checkOutTime').value;
  const guests = document.getElementById('guests').value;
  const mattressQty = document.getElementById('mattressQty').value;

  const pricing = computePricing(room, checkIn, checkInTime, checkOut, checkOutTime, guests, mattressQty);

  document.getElementById('sumRoomRate').textContent = room ? formatCurrency(room.rate) : '—';
  document.getElementById('sumNights').textContent = pricing ? pricing.nights : '—';
  document.getElementById('sumRoomCost').textContent = pricing ? formatCurrency(pricing.roomCost) : '—';
  document.getElementById('sumLateFee').textContent = pricing ? formatCurrency(pricing.lateCheckoutFee) : '—';
  document.getElementById('sumMattressFee').textContent = pricing ? formatCurrency(pricing.mattressFee) : '—';
  document.getElementById('sumGuestFee').textContent = pricing ? formatCurrency(pricing.extraGuestFee) : '—';
  document.getElementById('sumTotal').textContent = pricing ? formatCurrency(pricing.totalExpenses) : 'PHP 0';
}

// ── Availability & submission ────────────────────────────────────────────

function showAlert(message, type) {
  document.getElementById('formAlert').innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function clearAlert() {
  document.getElementById('formAlert').innerHTML = '';
}

function readForm() {
  return {
    roomType: document.getElementById('roomType').value,
    guests: document.getElementById('guests').value,
    checkIn: document.getElementById('checkIn').value,
    checkInTime: document.getElementById('checkInTime').value,
    checkOut: document.getElementById('checkOut').value,
    checkOutTime: document.getElementById('checkOutTime').value,
    mattressQty: document.getElementById('mattressQty').value,
    fullName: document.getElementById('fullName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    affiliation: document.getElementById('affiliation').value,
    specialRequests: document.getElementById('specialRequests').value
  };
}

async function onCheckAvailability() {
  const f = readForm();
  if (!f.roomType || !f.checkIn || !f.checkInTime || !f.checkOut || !f.checkOutTime) {
    showAlert('Please complete room type, check-in, and check-out schedule.', 'error');
    return;
  }
  const btn = document.getElementById('checkAvailabilityBtn');
  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const result = await apiGet({
      action: 'checkAvailability',
      roomType: f.roomType, checkIn: f.checkIn, checkInTime: f.checkInTime,
      checkOut: f.checkOut, checkOutTime: f.checkOutTime
    });
    if (!result.ok) {
      showAlert(result.error, 'error');
    } else if (result.available) {
      showAlert(result.message, 'success');
    } else {
      showAlert(result.message, 'error');
    }
  } catch (err) {
    showAlert('Could not reach the reservation system. Please try again later.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check Availability';
  }
}

async function onSubmitReservation(e) {
  e.preventDefault();
  clearAlert();
  const f = readForm();
  const room = getRoom(f.roomType);

  if (!f.roomType || !f.checkIn || !f.checkInTime || !f.checkOut || !f.checkOutTime) {
    showAlert('Please complete room type, check-in, and check-out schedule.', 'error');
    return;
  }
  if (!f.fullName || !f.email || !f.phone) {
    showAlert('Please complete your guest information.', 'error');
    return;
  }
  if (room && Number(f.guests) > room.maxGuests) {
    showAlert(`${room.roomType} allows a maximum of ${room.maxGuests} guests.`, 'error');
    return;
  }

  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  try {
    const result = await apiPost({ action: 'submitReservation', ...f });
    if (!result.ok) {
      showAlert(result.error, 'error');
      return;
    }
    showAlert(
      `Reservation submitted. Reservation ID: <strong>${result.reservationId}</strong> — Status: ${result.status}. ` +
      `A confirmation email has been sent to ${f.email}.`,
      'success'
    );
    document.getElementById('bookingForm').reset();
    setDefaultDates();
    updateSummary();
  } catch (err) {
    showAlert('Could not reach the reservation system. Please try again later.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Reservation';
  }
}
