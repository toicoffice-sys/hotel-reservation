// DLSL Chez Rafael Hotel Reservation System — guest proof-of-payment upload
// page logic. Reached only via the signed link in the approval email (see
// signReservationToken_/sendStatusUpdateEmail_ in Code.gs). Shared
// SCRIPT_URL/apiGet/apiPost/navigateTop helpers live in common.js.

const MAX_PROOF_OF_PAYMENT_BYTES = 5 * 1024 * 1024;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const state = document.getElementById('upState');
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
  if (result.status !== 'Approved') {
    renderError(state, 'This reservation is currently "' + result.status + '", so there is nothing to upload yet.');
    return;
  }

  renderForm(state, result, reservationId, token);
}

function renderError(state, message) {
  state.innerHTML = `<div class="alert alert-error">${message}</div>`;
}

function renderForm(state, reservation, reservationId, token) {
  state.innerHTML = `
    <div class="detail-grid" style="margin-bottom: 20px;">
      <div class="k">Reservation ID</div><div class="v">${reservationId}</div>
      <div class="k">Guest</div><div class="v">${reservation.fullName}</div>
      <div class="k">Room Type</div><div class="v">${reservation.roomType}</div>
      <div class="k">Check-In</div><div class="v">${reservation.checkIn}</div>
      <div class="k">Check-Out</div><div class="v">${reservation.checkOut}</div>
      <div class="k">Total Expenses</div><div class="v">PHP ${Number(reservation.totalExpenses || 0).toLocaleString('en-PH')}</div>
    </div>
    ${reservation.hasProofOfPayment
      ? '<div class="alert alert-info">We already have a proof of payment on file for this reservation. Uploading a new file below will replace it.</div>'
      : ''}
    <div id="upAlert"></div>
    <form class="form-card" id="proofForm" autocomplete="off">
      <div class="field field-full">
        <label for="proofFile">Proof of Payment <span class="required-badge">Required</span></label>
        <input type="file" id="proofFile" name="proofFile" accept="image/png,image/jpeg,image/webp,application/pdf" required />
        <span class="hint">Screenshot or PDF of your payment/deposit receipt (max 5 MB).</span>
      </div>
      <button type="submit" class="btn btn-primary" id="proofSubmitBtn">Upload Proof of Payment</button>
    </form>
  `;

  document.getElementById('proofForm').addEventListener('submit', (e) => onSubmit(e, reservationId, token));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function onSubmit(e, reservationId, token) {
  e.preventDefault();
  const alertEl = document.getElementById('upAlert');
  alertEl.innerHTML = '';

  const file = document.getElementById('proofFile').files[0];
  if (!file) {
    alertEl.innerHTML = '<div class="alert alert-error">Please choose a file to upload.</div>';
    return;
  }
  if (file.size > MAX_PROOF_OF_PAYMENT_BYTES) {
    alertEl.innerHTML = '<div class="alert alert-error">File is too large (max 5 MB).</div>';
    return;
  }

  const btn = document.getElementById('proofSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';

  try {
    const proofOfPaymentData = await fileToBase64(file);
    const result = await apiPost({
      action: 'submitProofOfPayment',
      reservationId, token,
      proofOfPaymentData, proofOfPaymentName: file.name, proofOfPaymentType: file.type
    });
    if (!result.ok) {
      alertEl.innerHTML = `<div class="alert alert-error">${result.error}</div>`;
      btn.disabled = false;
      btn.textContent = 'Upload Proof of Payment';
      return;
    }
    document.getElementById('upState').innerHTML =
      '<div class="alert alert-success">Thank you! We’ve received your proof of payment. Our team will follow up if anything else is needed. ' +
      'Redirecting you to the booking form in 20 seconds…</div>';
    setTimeout(() => navigateTop('index.html?book=1', '?book=1'), 20000);
  } catch (err) {
    alertEl.innerHTML = '<div class="alert alert-error">Could not reach the reservation system. Please try again later.</div>';
    btn.disabled = false;
    btn.textContent = 'Upload Proof of Payment';
  }
}
