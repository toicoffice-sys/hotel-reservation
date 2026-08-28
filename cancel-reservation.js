// DLSL Chez Rafael Hotel Reservation System — guest self-service cancellation
// page logic. Reached only via the signed link in the approval email (see
// signReservationToken_/sendStatusUpdateEmail_ in Code.gs). Loading this page
// is a read-only GET — cancellation only happens if the guest clicks Confirm,
// so an email client/security scanner prefetching the link can't cancel a
// booking on its own. Shared SCRIPT_URL/apiGet/apiPost/navigateTop helpers
// live in common.js.

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const state = document.getElementById('cancelState');
  const reservationId = typeof GAS_RESERVATION_ID !== 'undefined' ? GAS_RESERVATION_ID : '';
  const token = typeof GAS_TOKEN !== 'undefined' ? GAS_TOKEN : '';

  if (!reservationId || !token) {
    renderError(state, 'This link is missing some information and can’t be used. Please open the link from your approval email again.');
    return;
  }

  let result;
  try {
    result = await apiGet({ action: 'getGuestReservation', reservationId, token });
  } catch (err) {
    renderError(state, 'Could not reach the reservation system. Please try again later.');
    return;
  }

  if (!result.ok) {
    renderError(state, result.error);
    return;
  }
  if (result.status === 'Rejected' || result.status === 'Declined') {
    state.innerHTML = `<div class="alert alert-info">This reservation is already ${result.status.toLowerCase()} — there's nothing more to cancel.</div>`;
    return;
  }

  renderConfirm(state, result, reservationId, token);
}

function renderError(state, message) {
  state.innerHTML = `<div class="alert alert-error">${message}</div>`;
}

function renderConfirm(state, reservation, reservationId, token) {
  state.innerHTML = `
    <div class="detail-grid" style="margin-bottom: 20px;">
      <div class="k">Reservation ID</div><div class="v">${reservationId}</div>
      <div class="k">Guest</div><div class="v">${reservation.fullName}</div>
      <div class="k">Room Type</div><div class="v">${reservation.roomType}</div>
      <div class="k">Check-In</div><div class="v">${reservation.checkIn}</div>
      <div class="k">Check-Out</div><div class="v">${reservation.checkOut}</div>
    </div>
    <div id="cancelAlert"></div>
    <p>If you cancel, your room/venue will be released for other guests to book.</p>
    <div class="actions" style="display:flex; gap:12px; flex-wrap:wrap;">
      <button type="button" class="btn btn-danger" id="confirmCancelBtn">Confirm Cancellation</button>
      <a href="index.html" class="btn btn-outline" onclick="navigateTop('index.html', '?'); return false;">Actually, keep my booking</a>
    </div>
  `;

  document.getElementById('confirmCancelBtn').addEventListener('click', () => onConfirm(reservationId, token));
}

async function onConfirm(reservationId, token) {
  const alertEl = document.getElementById('cancelAlert');
  const btn = document.getElementById('confirmCancelBtn');
  btn.disabled = true;
  btn.textContent = 'Cancelling...';

  try {
    const result = await apiPost({ action: 'guestCancelReservation', reservationId, token });
    if (!result.ok) {
      alertEl.innerHTML = `<div class="alert alert-error">${result.error}</div>`;
      btn.disabled = false;
      btn.textContent = 'Confirm Cancellation';
      return;
    }
    document.getElementById('cancelState').innerHTML =
      '<div class="alert alert-success">Your reservation has been cancelled. Thank you for letting us know.</div>';
  } catch (err) {
    alertEl.innerHTML = '<div class="alert alert-error">Could not reach the reservation system. Please try again later.</div>';
    btn.disabled = false;
    btn.textContent = 'Confirm Cancellation';
  }
}
