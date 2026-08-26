#!/usr/bin/env bash
# ============================================================
#  DLSL Chez Rafael Hotel Reservation System — Deploy
#  Generates gas-build/ (an Apps-Script-ready bundle) from the
#  canonical frontend/backend source files, then pushes it so the
#  pinned deployment's /exec URL serves both the HTML site and the
#  JSON API. gas-build/ is regenerated every run — never edit it by
#  hand, edit the source files instead.
#  Usage: bash deploy.sh "commit message"
# ============================================================

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

MSG="${1:-Update hotel reservation system}"
SCRIPT_ID=$(grep -o '"scriptId": *"[^"]*"' .clasp.json | sed -E 's/.*"scriptId": *"([^"]*)".*/\1/')
DEPLOY_ID_FILE="$DIR/.deployment_id"
BUILD_DIR="$DIR/gas-build"
IMAGE_BASE="https://toicoffice-sys.github.io/hotel-reservation/"

if [[ -z "$SCRIPT_ID" ]]; then
  echo "❌  .clasp.json has no scriptId yet."
  echo "    Run 'clasp login' under the target Google account, then"
  echo "    'clasp create --type webapp --title \"DLSL Chez Rafael Reservation System\"'"
  echo "    inside this folder to generate one."
  exit 1
fi

echo "======================================================"
echo "  DLSL Chez Rafael — Deploy"
echo "======================================================"

echo ""
echo "🏗️   Building gas-build/ from source files..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

cp Code.gs "$BUILD_DIR/Code.gs"
cp appsscript.json "$BUILD_DIR/appsscript.json"
cp .clasp.json "$BUILD_DIR/.clasp.json"

{
  echo "<style>"
  sed "s|url('images/|url('${IMAGE_BASE}images/|g" styles.css
  echo "</style>"
} > "$BUILD_DIR/Styles.html"

{
  echo "<script>"
  sed "s|'images/|'${IMAGE_BASE}images/|g" common.js
  echo "</script>"
} > "$BUILD_DIR/CommonScript.html"

{
  echo "<script>"
  sed "s|'images/|'${IMAGE_BASE}images/|g" script.js
  echo "</script>"
} > "$BUILD_DIR/IndexScript.html"

{ echo "<script>"; cat rooms.js; echo "</script>"; } > "$BUILD_DIR/RoomsScript.html"

{
  echo "<script>"
  sed "s|'images/|'${IMAGE_BASE}images/|g" gallery.js
  echo "</script>"
} > "$BUILD_DIR/GalleryScript.html"

{ echo "<script>"; cat admin.js; echo "</script>"; } > "$BUILD_DIR/AdminScript.html"

# Shared by every page's footer, which links out to all four policy pages.
POLICY_HREF_RULES=(
  -e 's|href="safety-security.html"|href="?page=safety-security"|'
  -e 's|href="sustainability.html"|href="?page=sustainability"|'
  -e 's|href="house-rules.html"|href="?page=house-rules"|'
  -e 's|href="facilities-rules.html"|href="?page=facilities-rules"|'
)

sed \
  -e "s|<link rel=\"stylesheet\" href=\"styles.css\" />|<?!= include('Styles'); ?>|" \
  -e "s|<script src=\"common.js\"></script>|<?!= include('CommonScript'); ?>|" \
  -e "s|<script src=\"script.js\"></script>|<?!= include('IndexScript'); ?>|" \
  -e 's|href="index.html"|href="?"|' \
  -e 's|href="admin.html"|href="?page=admin"|' \
  -e 's|href="rooms.html"|href="?page=rooms"|' \
  -e 's|href="gallery.html"|href="?page=gallery"|' \
  "${POLICY_HREF_RULES[@]}" \
  -e "s|src=\"images/|src=\"${IMAGE_BASE}images/|g" \
  -e "s|<body>|<body><script>var GAS_PRESELECT_ROOM = <?!= JSON.stringify(preselectRoom); ?>; var GAS_SHOW_BOOKING = <?!= JSON.stringify(showBooking); ?>;</script>|" \
  index.html > "$BUILD_DIR/Index.html"

sed \
  -e "s|<link rel=\"stylesheet\" href=\"styles.css\" />|<?!= include('Styles'); ?>|" \
  -e "s|<script src=\"common.js\"></script>|<?!= include('CommonScript'); ?>|" \
  -e "s|<script src=\"rooms.js\"></script>|<?!= include('RoomsScript'); ?>|" \
  -e 's|href="admin.html"|href="?page=admin"|' \
  -e 's|href="gallery.html"|href="?page=gallery"|' \
  -e 's|href="index.html?book=1"|href="?book=1"|' \
  -e 's|href="index.html"|href="?"|' \
  "${POLICY_HREF_RULES[@]}" \
  -e "s|src=\"images/|src=\"${IMAGE_BASE}images/|g" \
  rooms.html > "$BUILD_DIR/Rooms.html"

sed \
  -e "s|<link rel=\"stylesheet\" href=\"styles.css\" />|<?!= include('Styles'); ?>|" \
  -e "s|<script src=\"common.js\"></script>|<?!= include('CommonScript'); ?>|" \
  -e "s|<script src=\"gallery.js\"></script>|<?!= include('GalleryScript'); ?>|" \
  -e 's|href="admin.html"|href="?page=admin"|' \
  -e 's|href="rooms.html"|href="?page=rooms"|' \
  -e 's|href="index.html?book=1"|href="?book=1"|' \
  -e 's|href="index.html"|href="?"|' \
  "${POLICY_HREF_RULES[@]}" \
  -e "s|src=\"images/|src=\"${IMAGE_BASE}images/|g" \
  gallery.html > "$BUILD_DIR/Gallery.html"

sed \
  -e "s|<link rel=\"stylesheet\" href=\"styles.css\" />|<?!= include('Styles'); ?>|" \
  -e "s|<script src=\"admin.js\"></script>|<?!= include('AdminScript'); ?>|" \
  -e 's|href="index.html"|href="?"|' \
  "${POLICY_HREF_RULES[@]}" \
  -e "s|src=\"images/|src=\"${IMAGE_BASE}images/|g" \
  admin.html > "$BUILD_DIR/Admin.html"

# Four policy pages share an identical build recipe (chrome + footer only,
# no page-specific script beyond common.js's navigateTop).
for pair in safety-security:SafetySecurity sustainability:Sustainability house-rules:HouseRules facilities-rules:FacilitiesRules; do
  slug="${pair%%:*}"
  name="${pair##*:}"
  sed \
    -e "s|<link rel=\"stylesheet\" href=\"styles.css\" />|<?!= include('Styles'); ?>|" \
    -e "s|<script src=\"common.js\"></script>|<?!= include('CommonScript'); ?>|" \
    -e 's|href="admin.html"|href="?page=admin"|' \
    -e 's|href="rooms.html"|href="?page=rooms"|' \
    -e 's|href="gallery.html"|href="?page=gallery"|' \
    -e 's|href="index.html?book=1"|href="?book=1"|' \
    -e 's|href="index.html"|href="?"|' \
    "${POLICY_HREF_RULES[@]}" \
    -e "s|src=\"images/|src=\"${IMAGE_BASE}images/|g" \
    "${slug}.html" > "$BUILD_DIR/${name}.html"
done

echo "✅  gas-build/ ready (16 files: Code.gs + appsscript.json + Styles/CommonScript/IndexScript/RoomsScript/GalleryScript/AdminScript includes + Index/Rooms/Gallery/Admin/SafetySecurity/Sustainability/HouseRules/FacilitiesRules pages)"

echo ""
echo "📤  Pushing gas-build/ to Apps Script..."
( cd "$BUILD_DIR" && clasp push --force )

echo ""
if [[ -f "$DEPLOY_ID_FILE" ]]; then
  DEPLOY_ID=$(cat "$DEPLOY_ID_FILE")
  echo "📌  Updating existing deployment..."
  ( cd "$BUILD_DIR" && clasp deploy --deploymentId "$DEPLOY_ID" --description "$MSG" )
else
  echo "📌  Creating first deployment..."
  ( cd "$BUILD_DIR" && clasp deploy --description "$MSG" | tee /tmp/clasp_deploy_out.txt )
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
  echo "  Site     : https://script.google.com/macros/s/${DEPLOY_ID}/exec"
  echo "  Admin    : https://script.google.com/macros/s/${DEPLOY_ID}/exec?page=admin"
fi
echo "======================================================"
