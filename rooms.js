// DLSL Chez Rafael Hotel Reservation System — Rooms & Venues page logic
// Shared room data/API helpers live in common.js, loaded before this file.

let rooms = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const grid = document.getElementById('roomGrid');
  renderRoomCardsLoading(grid);

  rooms = await fetchRooms();
  renderRoomCards(grid, rooms, goBook);
}

// Room selection lives here, but the booking form lives on index.html —
// hand the chosen room off via a query param.
function goBook(roomType) {
  const room = encodeURIComponent(roomType);
  navigateTop('index.html?room=' + room, '?room=' + room);
}
