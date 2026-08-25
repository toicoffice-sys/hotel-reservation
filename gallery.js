// DLSL Chez Rafael Hotel Reservation System — Facility Gallery page logic

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
  { src: 'images/gallery/event-hall-alt.jpg', caption: 'Event Hall — Alternate View' },
  { src: 'images/gallery/cafe-le-barako.jpg', caption: 'Café Le Barako — Dining Area' },
  { src: 'images/gallery/family-room-interior.jpg', caption: 'Family Room — Bedroom' },
  { src: 'images/gallery/standard-triple-room.jpg', caption: 'Standard Triple Room' },
  { src: 'images/gallery/standard-twin-room.jpg', caption: 'Standard Twin Room' },
  { src: 'images/gallery/standard-single-room.jpg', caption: 'Standard Single Room' },
  { src: 'images/gallery/essential-toiletries.jpg', caption: 'Essential Toiletries' },
  { src: 'images/gallery/hallway.jpg', caption: 'Guest Room Hallway' },
  { src: 'images/gallery/staircase.jpg', caption: 'Staircase & Atrium' }
];

document.addEventListener('DOMContentLoaded', init);

function init() {
  renderGallery();
}

function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  grid.innerHTML = GALLERY_PHOTOS.map(photo => `
    <div class="gallery-item">
      <img src="${photo.src}" alt="${photo.caption}" loading="lazy" />
      <div class="caption">${photo.caption}</div>
    </div>
  `).join('');
}
