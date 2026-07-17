#!/usr/bin/env bash
# ============================================================
#  DLSL Chez Rafael Hotel Reservation System — Backend Deploy
#  Pushes Code.gs + appsscript.json to Google Apps Script.
#  (Frontend files are hosted separately — see README.md.)
#  Usage: bash deploy.sh "commit message"
# ============================================================

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

MSG="${1:-Update hotel reservation backend}"
SCRIPT_ID=$(grep -o '"scriptId": *"[^"]*"' .clasp.json | sed -E 's/.*"scriptId": *"([^"]*)".*/\1/')
DEPLOY_ID_FILE="$DIR/.deployment_id"

if [[ -z "$SCRIPT_ID" ]]; then
  echo "❌  .clasp.json has no scriptId yet."
  echo "    Run 'clasp login' under the target Google account, then"
  echo "    'clasp create --type webapp --title \"DLSL Chez Rafael Reservation System\"'"
  echo "    inside this folder to generate one."
  exit 1
fi

echo "======================================================"
echo "  DLSL Chez Rafael — Backend Deploy"
echo "======================================================"

echo ""
echo "📤  Pushing Code.gs + appsscript.json to Apps Script..."
clasp push --force

echo ""
if [[ -f "$DEPLOY_ID_FILE" ]]; then
  DEPLOY_ID=$(cat "$DEPLOY_ID_FILE")
  echo "📌  Updating existing deployment..."
  clasp deploy --deploymentId "$DEPLOY_ID" --description "$MSG"
else
  echo "📌  Creating first deployment..."
  clasp deploy --description "$MSG" | tee /tmp/clasp_deploy_out.txt
  DEPLOY_ID=$(grep -o 'AKfycb[A-Za-z0-9_-]*' /tmp/clasp_deploy_out.txt | head -1)
  if [[ -n "$DEPLOY_ID" ]]; then
    echo "$DEPLOY_ID" > "$DEPLOY_ID_FILE"
    echo "✅  Saved deployment ID to .deployment_id for future updates."
  fi
fi

echo ""
echo "======================================================"
echo "  ✅  Deploy complete!"
echo ""
echo "  Editor   : https://script.google.com/d/${SCRIPT_ID}/edit"
if [[ -n "$DEPLOY_ID" ]]; then
  echo "  Web App  : https://script.google.com/macros/s/${DEPLOY_ID}/exec"
fi
echo ""
echo "  Reminder: paste the Web App URL into SCRIPT_URL in script.js and"
echo "  admin.js, then host index.html/admin.html/styles.css/script.js/admin.js"
echo "  on GitHub Pages, Netlify, Vercel, or an institutional server."
echo "======================================================"
