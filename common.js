// DLSL Chez Rafael Hotel Reservation System — shared across index.html and rooms.html

// Fill this in after deploying the Apps Script web app (see README.md).
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbysMtfkO4-tuzx-dK_CvWqqDlf3rBk4nOSo6w60UTeak6y6Fq1AEuEymA06NuoD09aODg/exec';

// Fallback room data, used only if the live /getRooms call fails (e.g. before
// SCRIPT_URL is configured). The deployed Rooms sheet is the source of truth.
const FALLBACK_ROOMS = [
  { roomType: 'Standard Single', inventory: 4, rate: 2000, includedGuests: 2, maxGuests: 4 },
  { roomType: 'Standard Twin', inventory: 2, rate: 2300, includedGuests: 2, maxGuests: 4 },
  { roomType: 'Standard Family', inventory: 1, rate: 2800, includedGuests: 2, maxGuests: 4 },
  { roomType: 'Standard Triple', inventory: 1, rate: 3000, includedGuests: 4, maxGuests: 8 },
  { roomType: 'Cafe Le Barako', inventory: 1, rate: 1000, includedGuests: 80, maxGuests: 80 },
  { roomType: 'Chez Rafael Function Hall', inventory: 1, rate: 500, includedGuests: 40, maxGuests: 40 }
];

// Room types billed per hour instead of per night (venues, not guest rooms).
const HOURLY_ROOM_TYPES = ['Cafe Le Barako', 'Chez Rafael Function Hall'];

// Category tabs shown on rooms.html — splits guest rooms from bookable
// facilities/venues.
const ROOM_CATEGORY_TABS = [
  { id: 'guest-rooms', label: 'Chez Rafael Guest Rooms', roomTypes: ['Standard Single', 'Standard Twin', 'Standard Family', 'Standard Triple'] },
  { id: 'facilities', label: 'Chez Rafael Facilities', roomTypes: ['Cafe Le Barako', 'Chez Rafael Function Hall'] }
];

// Static per-room-type amenity list (bed configuration first, then shared
// in-room amenities) — display-only, not sourced from the Rooms sheet.
const ROOM_AMENITIES = {
  'Standard Single': ['1 Single Bed', 'Wifi', 'Smart TV', 'Telephone', 'Personal Fridge', 'Electric Kettle', 'Air Conditioner', 'Hot Shower', 'Essential Toiletries', 'Fresh Towels'],
  'Standard Twin': ['2 Single Beds', 'Wifi', 'Smart TV', 'Telephone', 'Personal Fridge', 'Electric Kettle', 'Air Conditioner', 'Hot Shower', 'Essential Toiletries', 'Fresh Towels'],
  'Standard Family': ['1 Queen Size Bed', '1 Single Bed', 'Wifi', 'Smart TV', 'Telephone', 'Personal Fridge', 'Electric Kettle', 'Air Conditioner', 'Hot Shower', 'Essential Toiletries', 'Fresh Towels'],
  'Standard Triple': ['3 Single Beds', 'Wifi', 'Smart TV', 'Telephone', 'Personal Fridge', 'Electric Kettle', 'Air Conditioner', 'Hot Shower', 'Essential Toiletries', 'Fresh Towels'],
  'Cafe Le Barako': ['Tables and Chairs', 'Podium (via GSD)', 'Platform (via GSD)', '75" TV (via RESERVEASE)', 'Sound System with 2 Mics (via GSD)'],
  'Chez Rafael Function Hall': ['Tables', 'Tiffany Chairs', 'Podium', 'TV']
};

const ROOM_ICONS = {
  'Standard Single': '🛏️',
  'Standard Twin': '🛏️',
  'Standard Family': '👨‍👩‍👧‍👦',
  'Standard Triple': '🛏️',
  'Cafe Le Barako': '🎪',
  'Chez Rafael Function Hall': '🏛️'
};

const ROOM_IMAGES = {
  'Standard Single': 'images/rooms/standard-single.jpg',
  'Standard Twin': 'images/rooms/standard-twin.jpg',
  'Standard Family': 'images/rooms/standard-family.jpg',
  'Standard Triple': 'images/rooms/standard-triple.jpg',
  'Cafe Le Barako': 'images/rooms/cafe-le-barako.jpg',
  'Chez Rafael Function Hall': 'images/rooms/function-hall.jpg'
};

const EXTRA_GUEST_FEE = 400;
const API_TIMEOUT_MS = 20000;

async function apiGet(params) {
  const url = new URL(SCRIPT_URL);
  Object.keys(params).forEach(k => { if (params[k] !== undefined && params[k] !== '') url.searchParams.set(k, params[k]); });
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  return res.json();
}

// getRooms rarely changes and every Apps Script round trip costs a few
// seconds minimum — cache it for the tab's session so hopping between
// index/rooms/gallery doesn't re-pay that cost on every page.
const ROOMS_CACHE_KEY = 'dlsl_hotel_rooms_cache';
const ROOMS_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchRooms() {
  const cached = readRoomsCache_();
  if (cached) return cached;
  try {
    const data = await apiGet({ action: 'getRooms' });
    if (data.ok && data.rooms && data.rooms.length) {
      writeRoomsCache_(data.rooms);
      return data.rooms;
    }
  } catch (err) { /* fall through to fallback */ }
  return FALLBACK_ROOMS;
}

function readRoomsCache_() {
  try {
    const raw = sessionStorage.getItem(ROOMS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.rooms || (Date.now() - parsed.savedAt) > ROOMS_CACHE_TTL_MS) return null;
    return parsed.rooms;
  } catch (err) { return null; }
}

function writeRoomsCache_(rooms) {
  try {
    sessionStorage.setItem(ROOMS_CACHE_KEY, JSON.stringify({ rooms, savedAt: Date.now() }));
  } catch (err) { /* storage unavailable — skip caching, not fatal */ }
}

function formatCurrency(n) {
  return 'PHP ' + Number(n || 0).toLocaleString('en-PH');
}

// onBook(roomType) is called when a card's "Book Now" button is clicked —
// index.html books in place, rooms.html navigates back to index.html.
function renderRoomCards(gridEl, rooms, onBook) {
  gridEl.innerHTML = rooms.map(room => `
    <div class="room-card">
      <div class="thumb">${ROOM_IMAGES[room.roomType]
        ? `<img src="${ROOM_IMAGES[room.roomType]}" alt="${room.roomType}" loading="lazy" />`
        : (ROOM_ICONS[room.roomType] || '🏠')}</div>
      <div class="body">
        <h4>${room.roomType}</h4>
        <div class="rate">${formatCurrency(room.rate)} <span>/ ${HOURLY_ROOM_TYPES.includes(room.roomType) ? 'hour' : 'night'}</span></div>
        <div class="meta">Includes ${room.includedGuests} guests &middot; Max ${room.maxGuests} guests</div>
        <div class="meta">${room.inventory} unit${room.inventory > 1 ? 's' : ''} available</div>
        ${HOURLY_ROOM_TYPES.includes(room.roomType) ? '' : `<div class="meta">${formatCurrency(EXTRA_GUEST_FEE)} / guest beyond included</div>`}
        ${ROOM_AMENITIES[room.roomType] ? `
        <ul class="amenities">
          ${ROOM_AMENITIES[room.roomType].map(item => `<li>${item}</li>`).join('')}
        </ul>` : ''}
        <div class="actions">
          <button class="btn btn-primary" data-select="${room.roomType}">Book Now</button>
        </div>
      </div>
    </div>
  `).join('');

  gridEl.querySelectorAll('[data-select]').forEach(btn =>
    btn.addEventListener('click', () => onBook(btn.getAttribute('data-select'))));
}

function renderRoomCardsLoading(gridEl) {
  gridEl.innerHTML = '<div class="empty-state">Loading rooms &amp; venues...</div>';
}

// Navigates to another page of the site. On GitHub Pages this is a plain
// top-level navigation (window.top === window.self there, so it's the same
// as window.location). Inside Apps Script's web app, the visible content
// actually runs two iframes deep inside a sandboxed googleusercontent.com
// frame — a *relative* assignment to window.top.location resolves against
// that iframe's own address, not the real script.google.com page, and
// silently fails to navigate. Going through the absolute SCRIPT_URL avoids
// that.
function navigateTop(relativePath, queryString) {
  window.top.location.href = (window.top !== window.self) ? (SCRIPT_URL + queryString) : relativePath;
}

// ── Mobile hamburger nav (shared header on index/rooms/gallery/policy pages) ──

function initNavToggle() {
  const toggle = document.getElementById('navToggle');
  const nav = document.querySelector('.site-nav');
  if (!toggle || !nav) return;

  function closeNav() {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    const dropdown = nav.querySelector('.nav-dropdown');
    if (dropdown) dropdown.classList.remove('open');
  }

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    if (!isOpen) closeNav();
  });

  // Plain nav links close the panel; the Policy dropdown toggles open/closed
  // instead, since :hover doesn't fire on touch devices.
  nav.querySelectorAll(':scope > a').forEach(a => a.addEventListener('click', closeNav));

  const dropdown = nav.querySelector('.nav-dropdown');
  if (dropdown) {
    const dropdownToggle = dropdown.querySelector('.nav-dropdown-toggle');
    dropdownToggle.addEventListener('click', () => dropdown.classList.toggle('open'));
    dropdown.querySelectorAll('.nav-dropdown-menu a').forEach(a => a.addEventListener('click', closeNav));
  }

  document.addEventListener('click', e => {
    if (nav.classList.contains('open') && !nav.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
      closeNav();
    }
  });
}

document.addEventListener('DOMContentLoaded', initNavToggle);
