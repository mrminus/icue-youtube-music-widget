"use strict";

// ---- Settings (mirrors the x-icue-property defaults in index.html) ----
var settings = {
  serverUrl: "http://127.0.0.1:13091",
  showAlbumArt: true,
  blurredBackground: true,
  showControls: true,
  useDynamicAccent: true,
  accentColor: "#ff0033",
  textColor: "#ffffff",
  backgroundColor: "#0a0a0a"
};

// ---- Runtime state ----
var el = {};
var lastTrackId = null;   // last id we fetched full metadata for
var lastArtUrl = null;
var trackAccent = null;   // accent color reported by the current track
var pollTimer = null;
var offline = true;

document.addEventListener("DOMContentLoaded", cacheEls);
function cacheEls() {
  el.body = document.body;
  el.bg = document.getElementById("bg");
  el.artWrap = document.getElementById("art-wrap");
  el.art = document.getElementById("art");
  el.title = document.getElementById("title");
  el.artist = document.getElementById("artist");
  el.barFill = document.getElementById("bar-fill");
  el.cur = document.getElementById("cur");
  el.dur = document.getElementById("dur");
  el.controls = document.getElementById("controls");
  el.iconPlay = document.getElementById("icon-play");
  el.iconPause = document.getElementById("icon-pause");

  bindControls();
  applyAppearance();
}

// ---- iCUE settings hook (called from index.html) ----
function onSettings(incoming) {
  if (incoming && typeof incoming === "object") {
    for (var k in settings) {
      if (Object.prototype.hasOwnProperty.call(incoming, k) && incoming[k] !== undefined && incoming[k] !== null) {
        settings[k] = incoming[k];
      }
    }
  }
  if (el.body) applyAppearance();
}

function applyAppearance() {
  var root = document.documentElement.style;
  root.setProperty("--text-color", settings.textColor);
  root.setProperty("--background-color", settings.backgroundColor);
  root.setProperty("--accent-color", currentAccent());

  el.artWrap.classList.toggle("hidden", !settings.showAlbumArt);
  el.controls.classList.toggle("hidden", !settings.showControls);
  if (!settings.blurredBackground) el.bg.classList.remove("on");
  else if (lastArtUrl) el.bg.classList.add("on");
}

function currentAccent() {
  return (settings.useDynamicAccent && trackAccent) ? trackAccent : settings.accentColor;
}

// ---- Polling ----
function startPolling() {
  if (pollTimer) return;
  tick();
  pollTimer = setInterval(tick, 1000);
}

function base() {
  return String(settings.serverUrl || "").replace(/\/+$/, "");
}

function tick() {
  fetchJson("/track/state")
    .then(function (state) {
      setOffline(false);
      renderState(state);
      if (state && state.id && state.id !== lastTrackId) {
        lastTrackId = state.id;
        return fetchJson("/track").then(renderMeta);
      }
    })
    .catch(function () { setOffline(true); });
}

function fetchJson(path) {
  return fetch(base() + path, { method: "GET", cache: "no-store" }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}

// ---- Rendering ----
// SVG elements don't reflect the .hidden DOM property to the [hidden]
// attribute, so toggle the attribute directly for the play/pause glyphs.
function showPlaying(playing) {
  setHidden(el.iconPlay, playing);
  setHidden(el.iconPause, !playing);
}
function setHidden(node, hide) {
  if (hide) node.setAttribute("hidden", "hidden");
  else node.removeAttribute("hidden");
}

function renderState(s) {
  if (!s) return;
  showPlaying(!!s.playing);

  var dur = Number(s.duration) || 0;
  var cur = Math.min(Number(s.progress) || 0, dur || Infinity);
  var pct = typeof s.percentage === "number" ? s.percentage : (dur ? (cur / dur) * 100 : 0);
  el.barFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  el.cur.textContent = fmt(cur);
  el.dur.textContent = fmt(dur);

  if (s.accent && s.accent !== trackAccent) {
    trackAccent = s.accent;
    if (settings.useDynamicAccent) document.documentElement.style.setProperty("--accent-color", currentAccent());
  }
}

function renderMeta(t) {
  if (!t) return;
  var v = t.video || {};
  var title = v.title || "Unknown title";
  var artist = v.author || (t.context && t.context.description) || "";
  var album = t.music && t.music.album;

  el.title.textContent = title;
  el.artist.textContent = album ? artist + " • " + album : artist;

  var art = (t.meta && t.meta.thumbnail) || bestThumb(v.thumbnail);
  if (art && art !== lastArtUrl) {
    lastArtUrl = art;
    loadArt(art);
  }
}

function loadArt(url) {
  var probe = new Image();
  probe.onload = function () {
    el.art.src = url;
    el.art.classList.add("on");
    if (settings.blurredBackground) {
      el.bg.style.backgroundImage = 'url("' + url + '")';
      el.bg.classList.add("on");
    }
  };
  probe.onerror = function () {
    el.art.classList.remove("on"); // falls back to the music-note placeholder
    el.bg.classList.remove("on");
  };
  probe.src = url;
}

function bestThumb(thumb) {
  if (!thumb || !thumb.thumbnails || !thumb.thumbnails.length) return null;
  return thumb.thumbnails.reduce(function (a, b) {
    return (b.width || 0) > (a.width || 0) ? b : a;
  }).url;
}

function setOffline(v) {
  if (v === offline) return;
  offline = v;
  el.body.classList.toggle("offline", v);
  if (v) el.artist.textContent = "Waiting for player…";
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

// ---- Controls ----
function bindControls() {
  wire("prev", "/track/prev");
  wire("next", "/track/next");
  wire("toggle", "/track/toggle-play-state");
}

function wire(id, path) {
  var node = document.getElementById(id);
  if (!node) return;
  node.addEventListener("click", function () {
    if (id === "toggle") {
      // Optimistic toggle so the icon reacts instantly.
      var willPlay = el.iconPlay.hasAttribute("hidden") ? false : true;
      showPlaying(willPlay);
    }
    command(path);
  });
}

function command(path) {
  fetch(base() + path, { method: "POST", cache: "no-store" })
    .then(function () { setTimeout(tick, 150); })
    .catch(function () { setOffline(true); });
}
