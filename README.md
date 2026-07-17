# DLSL Chez Rafael Hotel Reservation System

Web-based hotel management and booking system for institutional accommodation, built from `DLSL_Hotel Management System-william.docx`.

- **Frontend**: `index.html` (public booking portal), `admin.html` (admin dashboard), `script.js`, `admin.js`, `styles.css`
- **Backend**: `Code.gs` — Google Apps Script web app exposing a JSON API
- **Database**: Google Sheets — `Reservations` and `Rooms` sheets (auto-created on first run)

## What changed vs. the original doc

- **Event Place rate standardized to PHP 15,000/day** — the doc flagged a mismatch between the HTML display (15,000) and the JS pricing logic (8,000). Now there is one source of truth: the `Rooms` sheet.
- **Room master data now lives in a `Rooms` sheet** instead of being hardcoded in JS/Apps Script (doc recommendation #7), which is also what fixed the rate inconsistency at the root.
- **Admin dashboard is protected by email OTP login** (doc recommendation: "Admin security"). Only `@dlsl.edu.ph` addresses can request a code; sessions last 24 hours.
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
3. Run `bash deploy.sh "Initial deploy"` — pushes `Code.gs` + `appsscript.json` and creates/updates the web app deployment. It only pushes those two files (see `.claspignore`); the frontend is not served by Apps Script.
4. Copy the printed **Web App URL** and paste it into `SCRIPT_URL` at the top of both `script.js` and `admin.js`.
5. Host `index.html`, `admin.html`, `styles.css`, `script.js`, `admin.js` on GitHub Pages, Netlify, Vercel, or an institutional server.
6. Open the site, submit a test reservation, confirm the email arrives, then sign into `admin.html` and approve/reject it.

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
