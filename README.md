# Amir – Fahrrad-Wetter

Kinderfreundliche Fahrrad-Wetter-Webseite für Tablet und Handy. Ein Blick genügt:

- 🚲 **Fahrrad fährt:** Wetter passt – los geht's.
- 🚫 **Fahrrad mit Verbotsschild:** Heute lieber nicht (mit kindgerechtem Grund).

## Funktionen

- **Automatische Standorterkennung** in dieser Reihenfolge:
  1. Zuletzt benutzter Ort (sofort sichtbar, lokal gespeichert)
  2. GPS, falls erlaubt – mit echtem Ortsnamen statt „Bei dir“
  3. Ungefährer Ort über die IP-Adresse (als „≈ Ort“ gekennzeichnet), wenn GPS gesperrt ist
  4. Ortssuche mit Vorschlägen beim Tippen (Pfeiltasten + Enter)
- **„Wann kann ich fahren?“** – Stunden-Vorschau für die nächsten 12 Stunden mit Hinweis, ab wann es wieder geht
- Kleidungs-, Sonnencreme- und Sonnenuntergangs-Tipps
- Interaktiver Fahrrad-Check mit Fortschrittsring (wird pro Tag gespeichert)
- Hell- und Dunkelmodus, Wetter-Himmel (Sonne, Wolken, Regen, Schnee, Nacht)
- Automatische Aktualisierung alle 15 Minuten
- Installierbar als Web-App (Manifest), keine API-Schlüssel nötig

## Entscheidungsregeln

„Lieber nicht“ bei: Gewitter, Schnee, Regen (jetzt oder in den nächsten 2 Stunden), Dunkelheit,
Wind ≥ 30 km/h bzw. Böen ≥ 50 km/h, Nebel, ≤ 2 °C oder ≥ 33 °C.

## Dienste

| Zweck | Dienst |
| --- | --- |
| Wetter & Ortssuche | [Open-Meteo](https://open-meteo.com) |
| Ortsname aus GPS | BigDataCloud (Reverse Geocoding, clientseitig) |
| IP-Standort (Fallback) | ipwho.is, GeoJS |

## Dateien

`index.html` (Struktur) · `styles.css` (Design) · `app.js` (Logik) · `manifest.webmanifest` · `icon.svg`

## GitHub Pages

Rein statisch – wird per Workflow bei jedem Push auf `main` veröffentlicht.
