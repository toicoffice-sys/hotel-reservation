// DLSL Chez Rafael Hotel Reservation System — Rooms & Venues page logic
// Shared room data/API helpers live in common.js, loaded before this file.

let rooms = [];
let activeCategory = ROOM_CATEGORY_TABS[0].id;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const grid = document.getElementById('roomGrid');
  renderRoomCardsLoading(grid);

  rooms = await fetchRooms();
  renderActiveCategory();

  document.querySelectorAll('#roomCategoryTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.getAttribute('data-category');
      document.querySelectorAll('#roomCategoryTabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderActiveCategory();
    });
  });
}

function renderActiveCategory() {
  const grid = document.getElementById('roomGrid');
  const tab = ROOM_CATEGORY_TABS.find(t => t.id === activeCategory) || ROOM_CATEGORY_TABS[0];
  const filtered = rooms.filter(r => tab.roomTypes.includes(r.roomType));
  grid.classList.add('room-grid--2col');
  renderRoomCards(grid, filtered, goBook);
}

// Room selection lives here, but the booking form lives on index.html —
// hand the chosen room off via a query param.
function goBook(roomType) {
  const room = encodeURIComponent(roomType);
  navigateTop('index.html?room=' + room, '?room=' + room);
}
