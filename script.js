// DLSL Chez Rafael Hotel Reservation System — public booking portal logic

// Fill this in after deploying the Apps Script web app (see README.md).
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbysMtfkO4-tuzx-dK_CvWqqDlf3rBk4nOSo6w60UTeak6y6Fq1AEuEymA06NuoD09aODg/exec';

// Fallback room data, used only if the live /getRooms call fails (e.g. before
// SCRIPT_URL is configured). The deployed Rooms sheet is the source of truth.
const FALLBACK_ROOMS = [
  { roomType: 'Standard Room', inventory: 8, rate: 2500, includedGuests: 2, maxGuests: 4 },
  { roomType: 'Executive Room', inventory: 8, rate: 4000, includedGuests: 2, maxGuests: 4 },
  { roomType: 'Family Suite', inventory: 8, rate: 6000, includedGuests: 4, maxGuests: 8 },
  { roomType: 'Event Place', inventory: 1, rate: 15000, includedGuests: 80, maxGuests: 80 }
];

const ROOM_ICONS = {
  'Standard Room': '🛏️',
  'Executive Room': '🏨',
  'Family Suite': '👨‍👩‍👧‍👦',
  'Event Place': '🎪'
};

const ROOM_IMAGES = {
  'Standard Room': 'images/rooms/standard-room.jpg',
  'Executive Room': 'images/rooms/executive-room.jpg'
};

const LATE_CHECKOUT_GRACE_MINUTES = 12 * 60 + 15;
const LATE_CHECKOUT_FEE_PER_HOUR = 200;
const MATTRESS_FEE_PER_UNIT = 200;
const EXTRA_GUEST_FEE = 400;

const GALLERY_PHOTOS = [
  { src: 'images/gallery/exterior-front.jpg', caption: 'DLSL Chez Rafael — Main Facade' },
  { src: 'images/gallery/entrance.jpg', caption: 'Main Entrance' },
  { src: 'images/gallery/exterior-street.jpg', caption: 'Street View & Walkway' },
  { src: 'images/gallery/lobby-lounge.jpg', caption: 'Lobby Lounge' },
  { src: 'images/gallery/outdoor-patio.jpg', caption: 'Outdoor Patio Seating' },
  { src: 'images/gallery/lounge-bar.jpg', caption: 'Lounge & Bar' },
  { src: 'images/gallery/bar-counter.jpg', caption: 'Bar Counter' },
  { src: 'images/gallery/restaurant-dining.jpg', caption: 'Restaurant Dining Area' },
  { src: 'images/gallery/table-setting.jpg', caption: 'Fine Dining Table Setting' },
  { src: 'images/gallery/conference-room.jpg', caption: 'Conference Room' },
  { src: 'images/gallery/event-hall.jpg', caption: 'Event Hall' },
  { src: 'images/gallery/event-hall-alt.jpg', caption: 'Event Hall — Alternate View' }
];

let rooms = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Render everything that doesn't depend on the backend immediately, so a
  // slow or hung Apps Script response never blocks the whole page.
  renderGallery();
  setDefaultDates();
  renderRoomCardsLoading();

  document.getElementById('roomType').addEventListener('change', onRoomChange);
  ['guests', 'checkIn', 'checkInTime', 'checkOut', 'checkOutTime', 'mattressQty']
    .forEach(id => document.getElementById(id).addEventListener('input', updateSummary));

  document.getElementById('checkAvailabilityBtn').addEventListener('click', onCheckAvailability);
  document.getElementById('bookingForm').addEventListener('submit', onSubmitReservation);
  document.getElementById('changeRoomBtn').addEventListener('click', hideBookingForm);
  document.getElementById('roomModalClose').addEventListener('click', closeRoomModal);
  document.getElementById('roomModal').addEventListener('click', e => {
    if (e.target.id === 'roomModal') closeRoomModal();
  });

  updateSummary();

  // Rooms depend on the backend and can be slow — fetch in the background
  // without blocking the rest of the page.
  rooms = await fetchRooms();
  renderRoomCards();
  populateRoomSelect();
  onRoomChange();
}

function renderRoomCardsLoading() {
  document.getElementById('roomGrid').innerHTML =
    '<div class="empty-state">Loading rooms &amp; venues...</div>';
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

async function fetchRooms() {
  try {
    const data = await apiGet({ action: 'getRooms' });
    if (data.ok && data.rooms && data.rooms.length) return data.rooms;
  } catch (err) { /* fall through to fallback */ }
  return FALLBACK_ROOMS;
}

function getRoom(roomType) {
  return rooms.find(r => r.roomType === roomType) || null;
}

function formatCurrency(n) {
  return 'PHP ' + Number(n || 0).toLocaleString('en-PH');
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

// ── Room cards & modal ───────────────────────────────────────────────────

function renderRoomCards() {
  const grid = document.getElementById('roomGrid');
  grid.innerHTML = rooms.map(room => `
    <div class="room-card">
      <div class="thumb">${ROOM_IMAGES[room.roomType]
        ? `<img src="${ROOM_IMAGES[room.roomType]}" alt="${room.roomType}" loading="lazy" />`
        : (ROOM_ICONS[room.roomType] || '🏠')}</div>
      <div class="body">
        <h4>${room.roomType}</h4>
        <div class="rate">${formatCurrency(room.rate)} <span>/ ${room.roomType === 'Event Place' ? 'day' : 'night'}</span></div>
        <div class="meta">Includes ${room.includedGuests} guests &middot; Max ${room.maxGuests} guests</div>
        <div class="meta">${room.inventory} unit${room.inventory > 1 ? 's' : ''} available</div>
        <div class="actions">
          <button class="btn btn-outline" data-details="${room.roomType}">View Details</button>
          <button class="btn btn-primary" data-select="${room.roomType}">Book Now</button>
        </div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-details]').forEach(btn =>
    btn.addEventListener('click', () => openRoomModal(btn.getAttribute('data-details'))));
  grid.querySelectorAll('[data-select]').forEach(btn =>
    btn.addEventListener('click', () => selectRoomAndScroll(btn.getAttribute('data-select'))));
}

// ── Facility gallery ──────────────────────────────────────────────────────

function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  grid.innerHTML = GALLERY_PHOTOS.map(photo => `
    <div class="gallery-item">
      <img src="${photo.src}" alt="${photo.caption}" loading="lazy" />
      <div class="caption">${photo.caption}</div>
    </div>
  `).join('');
}

function openRoomModal(roomType) {
  const room = getRoom(roomType);
  if (!room) return;
  document.getElementById('roomModalTitle').textContent = room.roomType;
  document.getElementById('roomModalBody').innerHTML = `
    <div class="detail-grid">
      <div class="k">Rate</div><div class="v">${formatCurrency(room.rate)} / ${room.roomType === 'Event Place' ? 'day' : 'night'}</div>
      <div class="k">Included Guests</div><div class="v">${room.includedGuests}</div>
      <div class="k">Maximum Guests</div><div class="v">${room.maxGuests}</div>
      <div class="k">Units Available</div><div class="v">${room.inventory}</div>
      <div class="k">Extra Guest Fee</div><div class="v">${formatCurrency(EXTRA_GUEST_FEE)} / guest beyond included</div>
    </div>
    <div style="margin-top:18px;">
      <button class="btn btn-primary" data-select="${room.roomType}">Book This Room</button>
    </div>
  `;
  document.getElementById('roomModalBody').querySelector('[data-select]')
    .addEventListener('click', () => { closeRoomModal(); selectRoomAndScroll(room.roomType); });
  document.getElementById('roomModal').classList.add('open');
}

function closeRoomModal() {
  document.getElementById('roomModal').classList.remove('open');
}

function selectRoomAndScroll(roomType) {
  document.getElementById('roomType').value = roomType;
  onRoomChange();
  showBookingForm();
  document.getElementById('bookingSection').scrollIntoView({ behavior: 'smooth' });
}

function showBookingForm() {
  document.getElementById('bookingSection').hidden = false;
}

function hideBookingForm() {
  document.getElementById('bookingSection').hidden = true;
  document.getElementById('roomGrid').scrollIntoView({ behavior: 'smooth' });
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
