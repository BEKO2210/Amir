"use strict";

/* =========================================================
   Amirs Fahrrad-Wetter
   Standort: gespeichert → GPS (automatisch, falls erlaubt) → IP-Schätzung → manuelle Suche
   ========================================================= */

const $ = (id) => document.getElementById(id);
const el = {
  body: document.body, sky: $("sky"), hero: $("hero"),
  date: $("date"), badgeText: $("badge-text"), verdict: $("verdict"), reason: $("reason"),
  temp: $("s-temp"), feel: $("s-feel"), wind: $("s-wind"), skyText: $("s-sky"), skyIcon: $("s-sky-icon"),
  hours: $("hours"), hoursSummary: $("hours-summary"), tips: $("tips"),
  chip: $("place-chip"), placeIcon: $("place-icon"), placeName: $("place-name"),
  sheet: $("sheet"), gpsBtn: $("gps-btn"), gpsHint: $("gps-hint"), city: $("city"),
  suggestions: $("suggestions"), sheetNote: $("sheet-note"),
  updated: $("updated"), refresh: $("refresh"), toast: $("toast"),
  checks: $("checks"), progressRing: $("progress-ring"), progressText: $("progress-text"), progress: $("progress"), doneMsg: $("done-msg"),
};

const STORE_PLACE = "amir.place.v2";
const STORE_CHECKS = "amir.checks.v2";
const REFRESH_MS = 15 * 60 * 1000;

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privater Modus */ } },
};

let place = null;        // { lat, lon, name, source: "gps" | "ip" | "manual" }
let lastLoad = 0;
let loadToken = 0;

/* ---------------- Hilfen ---------------- */

const fmtDate = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
el.date.textContent = fmtDate.format(new Date());

async function getJSON(url, { timeout = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function toast(message, ms = 3200) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.toast.hidden = true; }, ms);
}

const flag = (cc) => cc && cc.length === 2
  ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)))
  : "📍";

const hourLabel = (iso) => iso.slice(11, 13) + " Uhr";

/* ---------------- Wetter-Codes ---------------- */

const CODES = {
  thunder: [95, 96, 99],
  snow: [71, 73, 75, 77, 85, 86],
  rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82],
  fog: [45, 48],
  cloud: [2, 3],
};
const is = (group, code) => CODES[group].includes(code);

function weatherInfo(code, isDay) {
  if (is("thunder", code)) return { name: "Gewitter", icon: "⛈️", sky: "storm" };
  if (is("snow", code)) return { name: "Schnee", icon: "❄️", sky: "snow" };
  if ([51, 53, 55, 56, 57].includes(code)) return { name: "Nieselregen", icon: "🌦️", sky: "rain" };
  if (is("rain", code)) return { name: "Regen", icon: "🌧️", sky: "rain" };
  if (is("fog", code)) return { name: "Nebel", icon: "🌫️", sky: "fog" };
  if (!isDay) return { name: code <= 1 ? "Nacht" : "Wolkig", icon: code <= 1 ? "🌙" : "☁️", sky: "night" };
  if (code === 0) return { name: "Sonnig", icon: "☀️", sky: "clear" };
  if (code === 1) return { name: "Fast sonnig", icon: "🌤️", sky: "clear" };
  if (code === 2) return { name: "Teils wolkig", icon: "⛅", sky: "cloudy" };
  return { name: "Bewölkt", icon: "☁️", sky: "cloudy" };
}

/* ---------------- Entscheidung ---------------- */

// Gibt { ok, title, text } zurück. `ahead` = die nächsten Stunden (für "Regen kommt bald").
function decide(w, ahead = []) {
  const code = +w.weather_code || 0;
  const temp = +w.temperature_2m;
  const wind = +w.wind_speed_10m || 0;
  const gusts = +w.wind_gusts_10m || 0;
  const wet = (+w.precipitation || 0) > 0.05 || (+w.rain || 0) > 0 || (+w.showers || 0) > 0;
  const soon = ahead.find((h) => (+h.precipitation || 0) >= 0.2 || (+h.precipitation_probability || 0) >= 60);

  if (is("thunder", code)) return { ok: false, title: "Gewitter", text: "Bei Gewitter bleibt das Fahrrad drinnen – das ist zu gefährlich." };
  if ((+w.snowfall || 0) > 0 || is("snow", code)) return { ok: false, title: "Schnee & Glätte", text: "Die Straße kann rutschig sein. Heute lieber zu Fuß oder Schlitten fahren." };
  if (wet || is("rain", code)) return { ok: false, title: "Es regnet", text: "Draußen ist es nass und die Bremsen greifen schlechter. Lieber warten." };
  if (!w.is_day) return { ok: false, title: "Es ist dunkel", text: "Im Dunkeln sehen dich Autos schlecht. Morgen früh geht's wieder los!" };
  if (wind >= 30 || gusts >= 50) return { ok: false, title: "Starker Wind", text: "Der Wind ist so stark, dass er dich vom Weg schubsen kann." };
  if (is("fog", code)) return { ok: false, title: "Nebel", text: "Bei Nebel sieht man dich schlecht. Warte lieber, bis er weg ist." };
  if (temp <= 2) return { ok: false, title: "Eiskalt", text: "Es ist so kalt, dass der Boden glatt sein kann." };
  if (temp >= 33) return { ok: false, title: "Viel zu heiß", text: "Bei dieser Hitze lieber im Schatten bleiben und viel trinken." };
  if (soon) {
    return { ok: false, title: "Regen kommt bald", text: `Gegen ${hourLabel(soon.time)} kommt wahrscheinlich Regen. Heute lieber nur eine ganz kurze Runde – oder warten.` };
  }
  return { ok: true, title: "Fahrrad-Wetter", text: "Wetter, Temperatur und Wind passen. Helm auf und los geht's!" };
}

/* ---------------- Standort ---------------- */

function permissionState() {
  if (!navigator.permissions?.query) return Promise.resolve("unknown");
  return navigator.permissions.query({ name: "geolocation" }).then((p) => p.state).catch(() => "unknown");
}

function gpsPosition(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout, maximumAge: 10 * 60 * 1000 },
    );
  });
}

async function reverseName(lat, lon) {
  try {
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    url.search = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: "de" });
    const d = await getJSON(url, { timeout: 5000 });
    return d.city || d.locality || d.principalSubdivision || "Bei dir";
  } catch {
    return "Bei dir";
  }
}

async function ipLocation() {
  // Zwei kostenlose Dienste ohne API-Schlüssel – der erste, der eine Stadt liefert, gewinnt.
  try {
    const d = await getJSON("https://ipwho.is/?fields=success,city,latitude,longitude,country_code", { timeout: 5000 });
    if (d.success && d.city && Number.isFinite(d.latitude)) return { lat: d.latitude, lon: d.longitude, name: d.city, source: "ip" };
  } catch { /* nächster Dienst */ }
  try {
    const d = await getJSON("https://get.geojs.io/v1/ip/geo.json", { timeout: 5000 });
    if (d.city && d.latitude) return { lat: +d.latitude, lon: +d.longitude, name: d.city, source: "ip" };
  } catch { /* aufgeben */ }
  return null;
}

async function useGps({ interactive = false } = {}) {
  const pos = await gpsPosition(interactive ? 15000 : 10000);
  const name = await reverseName(pos.lat, pos.lon);
  return { ...pos, name, source: "gps" };
}

function setPlace(next, { save = true } = {}) {
  place = next;
  if (save) store.set(STORE_PLACE, next);
  el.placeName.textContent = next.source === "ip" ? `≈ ${next.name}` : next.name;
  el.placeIcon.textContent = next.source === "gps" ? "📍" : next.source === "ip" ? "🌐" : "🏠";
  el.chip.title = next.source === "ip"
    ? "Ungefährer Standort (über das Internet geschätzt). Tippen zum Ändern."
    : "Tippen, um den Ort zu ändern";
  return loadWeather();
}

async function boot() {
  const saved = store.get(STORE_PLACE);
  if (saved?.lat != null) setPlace(saved, { save: false });

  // Manuell gewählter Ort bleibt, bis das Kind ihn ändert.
  if (saved?.source === "manual") return;

  const perm = await permissionState();
  if (perm !== "denied") {
    try {
      const gps = await useGps();
      // Nur neu laden, wenn sich der Ort spürbar geändert hat (> ~1 km).
      if (!saved || Math.hypot(gps.lat - saved.lat, gps.lon - saved.lon) > 0.01 || saved.source !== "gps") {
        await setPlace(gps);
      } else {
        store.set(STORE_PLACE, gps);
      }
      return;
    } catch { /* weiter mit IP */ }
  }

  if (saved) return;
  const ip = await ipLocation();
  if (ip) {
    await setPlace(ip);
    toast("Ungefährer Ort erkannt – tippe oben, wenn er nicht stimmt.", 4500);
  } else {
    showNeedsPlace("Ich konnte deinen Ort nicht finden. Tippe oben und such ihn einfach.");
    openSheet();
  }
}

function showNeedsPlace(message) {
  el.body.dataset.state = "idle";
  el.hero.setAttribute("aria-busy", "false");
  el.badgeText.textContent = "Ort fehlt";
  el.verdict.textContent = "Wo bist du?";
  el.reason.textContent = message;
  el.placeName.textContent = "Ort wählen";
}

/* ---------------- Wetter laden & anzeigen ---------------- */

async function loadWeather() {
  if (!place) return;
  const token = ++loadToken;
  el.hero.setAttribute("aria-busy", "true");
  if (!lastLoad) el.body.dataset.state = "loading";

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: place.lat.toFixed(4),
    longitude: place.lon.toFixed(4),
    current: "temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_gusts_10m,is_day,uv_index",
    hourly: "temperature_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,is_day,snowfall",
    daily: "sunset",
    forecast_days: "2",
    timezone: "auto",
  });

  try {
    const data = await getJSON(url, { timeout: 10000 });
    if (token !== loadToken) return;
    render(data);
    lastLoad = Date.now();
  } catch {
    if (token !== loadToken) return;
    if (!lastLoad) {
      el.body.dataset.state = "idle";
      el.badgeText.textContent = "Keine Verbindung";
      el.verdict.textContent = "Hoppla!";
      el.reason.textContent = "Das Wetter konnte gerade nicht geladen werden. Prüfe das Internet und tippe unten auf „Aktualisieren“.";
    } else {
      toast("Aktualisieren hat nicht geklappt – ich zeige die letzten Daten.");
    }
  } finally {
    if (token === loadToken) el.hero.setAttribute("aria-busy", "false");
  }
}

function hourlyRows(data) {
  const h = data.hourly || {};
  const nowKey = (data.current?.time || "").slice(0, 13);
  const start = Math.max(0, (h.time || []).findIndex((t) => t.slice(0, 13) === nowKey));
  return (h.time || []).map((time, i) => ({
    time,
    temperature_2m: h.temperature_2m?.[i],
    precipitation: h.precipitation?.[i],
    precipitation_probability: h.precipitation_probability?.[i],
    weather_code: h.weather_code?.[i],
    wind_speed_10m: h.wind_speed_10m?.[i],
    wind_gusts_10m: h.wind_gusts_10m?.[i],
    snowfall: h.snowfall?.[i],
    is_day: h.is_day?.[i],
  })).slice(start);
}

function render(data) {
  const cur = data.current;
  const rows = hourlyRows(data);
  const verdict = decide(cur, rows.slice(1, 3));
  const info = weatherInfo(+cur.weather_code || 0, !!cur.is_day);

  el.body.dataset.state = verdict.ok ? "good" : "bad";
  el.sky.dataset.weather = info.sky;
  el.badgeText.textContent = verdict.ok ? "Fahrrad geht" : verdict.title;
  el.verdict.textContent = verdict.ok ? "Ja, losfahren!" : "Heute lieber nicht.";
  el.reason.textContent = verdict.text;

  el.temp.textContent = Math.round(cur.temperature_2m) + " °C";
  el.feel.textContent = Math.round(cur.apparent_temperature) + " °C";
  el.wind.textContent = Math.round(cur.wind_speed_10m) + " km/h";
  el.skyText.textContent = info.name;
  el.skyIcon.textContent = info.icon;

  renderHours(rows.slice(0, 12), verdict);
  renderTips(cur, data.daily);

  const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  el.updated.textContent = `Stand ${time} Uhr · Wetter von Open-Meteo`;
  document.title = (verdict.ok ? "✅ " : "⛔ ") + "Fahrrad-Wetter – " + place.name;
}

function renderHours(rows, nowVerdict) {
  // Die erste Kachel ("Jetzt") übernimmt das Urteil der Hauptkarte, damit beide immer übereinstimmen.
  const judged = rows.map((r, i) => ({ ...r, verdict: i === 0 ? nowVerdict : decide(r) }));
  el.hours.innerHTML = "";
  judged.forEach((r, i) => {
    const info = weatherInfo(+r.weather_code || 0, !!r.is_day);
    const li = document.createElement("li");
    li.className = "hour " + (r.verdict.ok ? "good" : "bad") + (i === 0 ? " now" : "");
    li.setAttribute("aria-label", `${i === 0 ? "Jetzt" : hourLabel(r.time)}: ${info.name}, ${Math.round(r.temperature_2m)} Grad, ${r.verdict.ok ? "Fahrrad geht" : r.verdict.title}`);
    li.innerHTML = `
      <time>${i === 0 ? "Jetzt" : r.time.slice(11, 16)}</time>
      <span class="h-icon" aria-hidden="true">${info.icon}</span>
      <span class="h-temp">${Math.round(r.temperature_2m)}°</span>
      <span class="h-rain">💧 ${Math.round(r.precipitation_probability ?? 0)} %</span>
      <span class="h-ok" aria-hidden="true">${r.verdict.ok ? "🚲" : "✕"}</span>`;
    el.hours.append(li);
  });

  const nowOk = judged[0]?.verdict.ok;
  const flip = judged.findIndex((r) => r.verdict.ok !== nowOk);
  let summary;
  if (nowOk) summary = flip === -1 ? "👍 Die nächsten Stunden bleibt es gut" : `⏰ Gut bis etwa ${hourLabel(judged[flip].time)}`;
  else summary = flip === -1 ? "😴 Heute wird's leider nichts mehr" : `🚲 Ab etwa ${hourLabel(judged[flip].time)} geht's wieder`;
  el.hoursSummary.textContent = summary;
}

function renderTips(cur, daily) {
  const tips = [];
  const feel = +cur.apparent_temperature;
  if (feel < 5) tips.push(["🧤", "Warm einpacken", "Winterjacke, Mütze und Handschuhe"]);
  else if (feel < 12) tips.push(["🧥", "Jacke anziehen", "Und am besten Handschuhe dazu"]);
  else if (feel < 19) tips.push(["👕", "Pulli oder leichte Jacke", "Beim Fahren wird dir schnell warm"]);
  else tips.push(["🩳", "T-Shirt-Wetter", "Nimm eine Trinkflasche mit"]);

  if ((+cur.uv_index || 0) >= 5) tips.push(["🧴", "Sonnencreme!", `UV-Index ${Math.round(cur.uv_index)} – die Sonne ist stark`]);

  const sunset = daily?.sunset?.[0];
  if (sunset && cur.is_day) tips.push(["🌇", `Hell bis ${sunset.slice(11, 16)} Uhr`, "Dann Licht an – oder schon zu Hause sein"]);

  el.tips.innerHTML = tips.map(([icon, title, text]) =>
    `<div class="tip"><span class="tip-icon" aria-hidden="true">${icon}</span><div><b>${title}</b><small>${text}</small></div></div>`,
  ).join("");
}

/* ---------------- Ort-Dialog & Suche ---------------- */

let results = [];
let active = -1;
let searchTimer = 0;
let searchToken = 0;

function openSheet() {
  el.sheetNote.textContent = place?.source === "ip"
    ? "Der Ort wurde nur ungefähr über das Internet geschätzt. Mit GPS wird er genau."
    : "";
  if (!el.sheet.open) el.sheet.showModal();
  setTimeout(() => el.city.focus(), 50);
}

function closeSheet() {
  el.sheet.close();
  el.city.value = "";
  clearSuggestions();
}

function clearSuggestions() {
  results = [];
  active = -1;
  el.suggestions.innerHTML = "";
  el.city.setAttribute("aria-expanded", "false");
  el.city.removeAttribute("aria-activedescendant");
}

async function search(query) {
  const token = ++searchToken;
  if (query.length < 2) return clearSuggestions();
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({ name: query, count: "6", language: "de", format: "json" });
    const data = await getJSON(url, { timeout: 6000 });
    if (token !== searchToken) return;
    results = data.results || [];
    active = results.length ? 0 : -1;
    el.sheetNote.textContent = results.length ? "" : "Keinen Ort gefunden. Versuch eine andere Schreibweise.";
    drawSuggestions();
  } catch {
    if (token === searchToken) el.sheetNote.textContent = "Suche gerade nicht möglich. Prüfe das Internet.";
  }
}

function drawSuggestions() {
  el.suggestions.innerHTML = "";
  results.forEach((r, i) => {
    const li = document.createElement("li");
    li.id = "sug-" + i;
    li.className = "suggestion";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === active));
    const sub = [r.admin1, r.country].filter(Boolean).join(", ");
    li.innerHTML = `<span class="flag" aria-hidden="true">${flag(r.country_code)}</span><span><b></b><small></small></span>`;
    li.querySelector("b").textContent = r.name;
    li.querySelector("small").textContent = sub;
    li.addEventListener("click", () => pick(i));
    el.suggestions.append(li);
  });
  el.city.setAttribute("aria-expanded", String(results.length > 0));
  if (active >= 0) el.city.setAttribute("aria-activedescendant", "sug-" + active);
}

function pick(i) {
  const r = results[i];
  if (!r) return;
  closeSheet();
  lastLoad = 0;
  setPlace({ lat: r.latitude, lon: r.longitude, name: r.name, source: "manual" });
}

el.city.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(el.city.value.trim()), 220);
});

el.city.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!results.length) return;
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    drawSuggestions();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (active >= 0) pick(active);
    else search(el.city.value.trim());
  }
});

el.gpsBtn.addEventListener("click", async () => {
  el.gpsBtn.setAttribute("aria-busy", "true");
  el.gpsHint.textContent = "Suche dich …";
  try {
    const gps = await useGps({ interactive: true });
    closeSheet();
    lastLoad = 0;
    await setPlace(gps);
  } catch (err) {
    el.sheetNote.textContent = err?.code === 1
      ? "Standort ist gesperrt. Erlaube ihn in den Browser-Einstellungen – oder such deinen Ort unten."
      : "Standort konnte nicht bestimmt werden. Such deinen Ort einfach unten.";
  } finally {
    el.gpsBtn.removeAttribute("aria-busy");
    el.gpsHint.textContent = "Genau per GPS – wird nicht gespeichert oder geteilt";
  }
});

el.chip.addEventListener("click", openSheet);
el.sheet.addEventListener("close", () => { el.city.value = ""; clearSuggestions(); });
el.sheet.addEventListener("click", (e) => { if (e.target === el.sheet) closeSheet(); });

/* ---------------- Checkliste ---------------- */

function today() { return new Date().toISOString().slice(0, 10); }

function loadChecks() {
  const saved = store.get(STORE_CHECKS);
  return saved?.day === today() ? new Set(saved.ids) : new Set();
}

const checked = loadChecks();
const checkButtons = [...el.checks.querySelectorAll(".check")];

function drawChecks() {
  checkButtons.forEach((b) => b.setAttribute("aria-pressed", String(checked.has(b.dataset.id))));
  const total = checkButtons.length;
  const n = checked.size;
  el.progressText.textContent = `${n}/${total}`;
  el.progress.setAttribute("aria-label", `${n} von ${total} geprüft`);
  el.progressRing.style.strokeDashoffset = String(113.1 * (1 - n / total));
  el.doneMsg.hidden = n !== total;
}

checkButtons.forEach((b) => b.addEventListener("click", () => {
  const id = b.dataset.id;
  checked.has(id) ? checked.delete(id) : checked.add(id);
  store.set(STORE_CHECKS, { day: today(), ids: [...checked] });
  if (navigator.vibrate) navigator.vibrate(12);
  drawChecks();
}));
drawChecks();

/* ---------------- Aktualisierung ---------------- */

el.refresh.addEventListener("click", () => {
  if (place) loadWeather().then(() => toast("Wetter ist aktuell ✓"));
  else openSheet();
});

setInterval(() => { if (!document.hidden) loadWeather(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && place && Date.now() - lastLoad > 10 * 60 * 1000) loadWeather();
});

boot();
