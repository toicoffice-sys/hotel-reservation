# DLSL Chez Rafael Hotel Reservation System

Web-based hotel management and booking system for institutional accommodation, built from `DLSL_Hotel Management System-william.docx`.

**Live at:** https://script.google.com/macros/s/AKfycbysMtfkO4-tuzx-dK_CvWqqDlf3rBk4nOSo6w60UTeak6y6Fq1AEuEymA06NuoD09aODg/exec (booking portal) and `?page=admin` (admin dashboard)

- **Frontend + Backend**: served together as one Apps Script web app. `Code.gs`'s `doGet` renders `Index.html`/`Admin.html` (built from the canonical `index.html`/`admin.html`/`styles.css`/`script.js`/`admin.js`) when there's no `action` param, and returns the JSON API when there is.
- **Source of truth**: `index.html`, `admin.html`, `styles.css`, `script.js`, `admin.js`, `Code.gs` at the repo root — edit these, never the generated `gas-build/` files.
- **Images**: still served from GitHub Pages (`https://toicoffice-sys.github.io/hotel-reservation/images/...`) since Apps Script's HtmlService has no static-file hosting — keep GitHub Pages enabled on this repo even though its `index.html`/`admin.html` are no longer the canonical entry point.
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
3. Run `bash deploy.sh "Initial deploy"`. This regenerates `gas-build/` from the source files (wrapping `styles.css`/`script.js`/`admin.js` into includable `.html` files, rewriting `script.js`'s `images/...` paths to absolute GitHub Pages URLs, and swapping `index.html`↔`admin.html` nav links for `?`/`?page=admin`), then pushes and deploys that bundle — one Apps Script web app now serves both the HTML site and the JSON API at the same `.../exec` URL.
4. Make sure GitHub Pages stays enabled on this repo (Settings → Pages) so `https://toicoffice-sys.github.io/hotel-reservation/images/...` keeps serving the room/gallery photos the deployed site links to.
5. Open the printed **Site** URL, submit a test reservation, confirm the email arrives, then open **Admin** (`?page=admin`) and approve/reject it.

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
