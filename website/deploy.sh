#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
test -f index.html
TMP=$(mktemp -d)
cp -R index.html style.css script.js public README.md "$TMP/"
git -C "$TMP" init -q
git -C "$TMP" add .
git -C "$TMP" -c user.email="deploy@local" -c user.name="pi-web" commit -q -m "Deploy Pi Web website"
git -C "$TMP" branch -M gh-pages
git -C "$TMP" remote add origin https://github.com/t479842598/pi-web-QT.git
git -C "$TMP" push -f origin gh-pages
rm -rf "$TMP"
echo "https://t479842598.github.io/pi-web-QT/"
