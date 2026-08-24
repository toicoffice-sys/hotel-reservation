// DLSL Chez Rafael Hotel Reservation System — shared across index.html and rooms.html

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
  'Executive Room': 'images/rooms/executive-room.jpg',
  'Family Suite': 'images/rooms/family-suite.jpg',
  'Event Place': 'images/rooms/event-place.jpg'
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
        <div class="rate">${formatCurrency(room.rate)} <span>/ ${room.roomType === 'Event Place' ? 'day' : 'night'}</span></div>
        <div class="meta">Includes ${room.includedGuests} guests &middot; Max ${room.maxGuests} guests</div>
        <div class="meta">${room.inventory} unit${room.inventory > 1 ? 's' : ''} available</div>
        <div class="meta">${formatCurrency(EXTRA_GUEST_FEE)} / guest beyond included</div>
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
