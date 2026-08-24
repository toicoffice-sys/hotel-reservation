# DLSL Chez Rafael Hotel Reservation System

Web-based hotel management and booking system for institutional accommodation, built from `DLSL_Hotel Management System-william.docx`.

**Live at:** https://script.google.com/macros/s/AKfycbysMtfkO4-tuzx-dK_CvWqqDlf3rBk4nOSo6w60UTeak6y6Fq1AEuEymA06NuoD09aODg/exec (booking portal), `?page=rooms` (Rooms & Venues), `?page=gallery` (Facility Gallery), `?page=admin` (admin dashboard), and four footer policy pages (`?page=safety-security`, `?page=sustainability`, `?page=house-rules`, `?page=facilities-rules`)

- **Frontend + Backend**: served together as one Apps Script web app. `Code.gs`'s `doGet`/`renderPage_` looks `?page=` up in the `PAGE_TEMPLATES_` map and renders the matching `.html` template (built from the canonical `index.html`/`rooms.html`/`gallery.html`/`admin.html`/`safety-security.html`/`sustainability.html`/`house-rules.html`/`facilities-rules.html` + `styles.css`/`common.js`/`script.js`/`rooms.js`/`gallery.js`/`admin.js`) when there's no `action` param, and returns the JSON API when there is.
- **Source of truth**: all the `.html`/`.js` files above plus `Code.gs` at the repo root — edit these, never the generated `gas-build/` files. `common.js` holds room data/API helpers and `navigateTop` (see below), shared by every guest-facing page; `admin.js` keeps its own small copy.
- **Adding a new page** follows a fixed recipe (see the four policy pages, or `rooms.html`/`gallery.html`): clone the header/hero/footer chrome into `<page>.html`; cross-page `<a>`s get `onclick="navigateTop('X.html', '?page=X'); return false;"`; add a `param === 'X'` (or a `PAGE_TEMPLATES_` entry) in `Code.gs`; add a `sed`-built block in `deploy.sh` covering every cross-page `href` on that page, including links pointing *at* it from other pages.
- **Footer**: every guest-facing page shares one footer with the contact line (tel/email — moved here from a now-removed top bar) and links to the four policy pages (Safety and Security Policy, Sustainability Measures, House Rules, Facilities Rules and Regulations). Those four pages currently hold clearly-marked **placeholder text** (`.placeholder-note`) — the real policy copy from hotel administration still needs to be pasted in before this is public-ready.
- **The header's "Book Now" pill always jumps straight to the booking form** on `index.html` with nothing preselected (`?book=1` → `showBookingFormAndScroll()`), from whichever page it's clicked on. A room card's own "Book Now" on the Rooms page is different — it preselects that specific room (`?room=X` → `selectRoomAndScroll()`).
- **Images**: still served from GitHub Pages (`https://toicoffice-sys.github.io/hotel-reservation/images/...`) since Apps Script's HtmlService has no static-file hosting — keep GitHub Pages enabled on this repo even though its own HTML pages are no longer the canonical entry point. Room/gallery photos are pre-resized (max ~900px, hero image ~1600px) and re-compressed (JPEG q78) at commit time via `sips` — don't drop full-resolution originals back in without re-optimizing.
- **Room data is cached client-side** (`common.js`'s `fetchRooms`, `sessionStorage`, 5-minute TTL) since every Apps Script round trip costs a few seconds minimum — hopping between index/rooms/gallery within one visit reuses the cached list instead of re-fetching. Confirmed the sandboxed content iframe's origin (and therefore its `sessionStorage`) is stable across in-session page navigations, not randomized per request.
- **Cross-page navigation on Apps Script**: the actual visible content runs two iframes deep inside a sandboxed `googleusercontent.com` frame whose own `window.location` never reflects the real request URL or query string. A plain `<a href>`/`window.location` navigation there just hangs forever (the inner iframe never repaints). Every internal link calls `navigateTop()` (in `common.js`, duplicated in `admin.js`) instead, which does `window.top.location.href = SCRIPT_URL + queryString` when nested (detected via `window.top !== window.self`) and a normal relative path otherwise — safe to call unconditionally since GitHub Pages never nests, so it degrades to a plain navigation there. The `?room=`/`?book=` handoffs have the same problem in reverse — `location.search` is always empty in that inner frame — so `Code.gs` reads `e.parameter.room`/`e.parameter.book` server-side and injects them as `GAS_PRESELECT_ROOM`/`GAS_SHOW_BOOKING` via a small inline script `deploy.sh` adds right after `<body>` in `Index.html`; `script.js` prefers those over `location.search` when present.
- **Database**: Google Sheets — `Reservations` and `Rooms` sheets (auto-created on first run)

## What changed vs. the original doc

- **Event Place rate standardized to PHP 15,000/day** — the doc flagged a mismatch between the HTML display (15,000) and the JS pricing logic (8,000). Now there is one source of truth: the `Rooms` sheet.
- **Room master data now lives in a `Rooms` sheet** instead of being hardcoded in JS/Apps Script (doc recommendation #7), which is also what fixed the rate inconsistency at the root.
- **Admin dashboard is protected by email OTP login** (doc recommendation: "Admin security"). Only emails in `ADMIN_EMAILS` in `Code.gs` (currently just `toic.pm@dlsl.edu.ph`) can request a code; sessions last 24 hours. Add more admins by appending to that array.
- **Approval/decline emails added** — the doc's recommendation "send approval or decline emails when the admin updates status" is implemented in `sendStatusUpdateEmail_`.

Everything else (room categories, pricing rules, reservation fields, workflow) matches the doc as written.

## Deployment

1. **Create the Google Sheet** that will hold reservation data (or open an existing one) under the Google account this should run as.
2. In that sheet: **Extensions → Apps Script**, then either paste in `Code.gs`/`appsscript.json` manually, or use `clasp`:
   ```bash
   clasp login                     # under the target Google account
   clasp create --type webapp --title "DLSL Chez Rafael Reservation System" --parentId <SHEET_ID>
   ```
   This fills in `scriptId` in `.clasp.json`.
3. Run `bash deploy.sh "Initial deploy"`. This regenerates `gas-build/` from the source files (wrapping `styles.css`/`common.js`/`script.js`/`rooms.js`/`gallery.js`/`admin.js` into includable `.html` files, rewriting `images/...` paths to absolute GitHub Pages URLs, swapping cross-page `href`s for `?`/`?page=admin`/`?page=rooms`/`?page=gallery`/`?book=1`, and injecting the `GAS_PRESELECT_ROOM`/`GAS_SHOW_BOOKING` scriptlet into `Index.html`), then pushes and deploys that bundle — one Apps Script web app now serves the HTML site (all four pages) and the JSON API at the same `.../exec` URL.
4. Make sure GitHub Pages stays enabled on this repo (Settings → Pages) so `https://toicoffice-sys.github.io/hotel-reservation/images/...` keeps serving the room/gallery photos the deployed site links to.
5. Open the printed **Site** URL, click through to Rooms, Gallery, and the header Book Now, submit a test reservation, confirm the email arrives, then open **Admin** (`?page=admin`) and approve/reject it.

The `Reservations` and `Rooms` sheets are created automatically (with seeded room data) the first time the API is called — no manual sheet setup needed beyond step 1.

## Business rules

| Rule | Value |
|---|---|
| Standard check-in | 2:00 PM |
| Late checkout grace period | until 12:15 PM |
| Late checkout fee | PHP 200 / hour after grace period |
| Extra mattress fee | PHP 200 / mattress |
| Extra guest fee | PHP 400 / guest beyond room's included-guest count |
| Rejected/Declined bookings | excluded from overlap/availability checks |

## Rooms (seeded in the `Rooms` sheet)

| Room Type | Inventory | Rate | Included Guests | Max Guests |
|---|---|---|---|---|
| Standard Room | 8 | PHP 2,500/night | 2 | 4 |
| Executive Room | 8 | PHP 4,000/night | 2 | 4 |
| Family Suite | 8 | PHP 6,000/night | 4 | 8 |
| Event Place | 1 | PHP 15,000/day | 80 | 80 |

Edit rates/inventory directly in the `Rooms` sheet — no code changes needed.

## Not yet implemented (per doc scope)

User logins for guests, online payment, printable receipts, monthly occupancy/revenue reports, and a status-change audit log sheet.
