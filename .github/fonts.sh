#!/bin/sh
# шрифты Google Fonts (лицензия OFL) для карточек
set -e
mkdir -p bot/fonts
cd bot/fonts
base=https://raw.githubusercontent.com/google/fonts/main/ofl
[ -f Playfair.ttf ] || curl -sfL -o Playfair.ttf "$base/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf"
[ -f Playfair-Italic.ttf ] || curl -sfL -o Playfair-Italic.ttf "$base/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf"
[ -f Manrope.ttf ] || curl -sfL -o Manrope.ttf "$base/manrope/Manrope%5Bwght%5D.ttf"
