const $ = (id) => document.getElementById(id);
const CODE_KEY = "scrapbook-owner-code";
const AUTHOR_KEY = "scrapbook-author";
const PER_PAGE = 3;
const MAX_FILES = 12;
const MAX_AUDIO_MB = 15;
// Browsers label the same file differently, so the extension decides the type.
const AUDIO_TYPES = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav",
  ogg: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", flac: "audio/flac",
};
const FLIP_MS = 1150;
const OPEN_MS = 1500;
const narrow = matchMedia("(max-width: 760px)");
const calm = matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  store: null,
  title: "",
  entries: [],
  pages: [],
  cur: 0,
  flipping: false,
  opened: false,
  popupShown: false,
  signature: "",
  viewing: null,
  autoplay: null,
  insertAt: null,
};

/* Small helpers */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function storageGet(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* remembered for this visit only */ }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* nothing stored */ }
}

function isoDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function parseDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function prettyDay(day) {
  return parseDay(day).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function showError(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}

/* Cut-paper title */

const LETTER_FONTS = ["'Abril Fatface'", "'Alfa Slab One'", "'Special Elite'", "'Playfair Display'", "'Caveat'"];
const LETTER_PAPERS = ["thistle", "vanilla", "cream", "rose-vanilla", "thistle", "vanilla", "ebony-vanilla", "cream"];

function renderTitle(text) {
  paintLetters($("title"), text);
  paintLetters($("coverTitle"), text);
  $("title").setAttribute("aria-label", text);
  $("cover").setAttribute("aria-label", `Open ${text}`);
}

function paintLetters(title, text) {
  title.replaceChildren();
  const clean = text.trim();
  // Connected scripts such as Arabic must stay joined, so they are cut by word.
  const joined = /[֐-ࣿ]/.test(clean);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const scale = clean.length <= 14 ? 1 : clean.length <= 24 ? 0.76 : 0.56;
  title.style.setProperty("--title-scale", scale);

  let index = 0;
  for (const word of clean.split(/\s+/)) {
    const wordEl = el("span", "word");
    wordEl.setAttribute("aria-hidden", "true");
    const pieces = joined ? [word] : [...segmenter.segment(word)].map((s) => s.segment);
    for (const piece of pieces) {
      const seed = hash(piece + index);
      const cut = el("span", `cut ${LETTER_PAPERS[seed % LETTER_PAPERS.length]} shape${seed % 5}`, piece);
      cut.style.fontFamily = joined ? "inherit" : LETTER_FONTS[(seed >>> 3) % LETTER_FONTS.length];
      cut.style.setProperty("--r", `${((seed >>> 6) % 13) - 6}deg`);
      cut.style.setProperty("--y", `${((seed >>> 10) % 7) - 3}px`);
      wordEl.append(cut);
      index += 1;
    }
    title.append(wordEl);
  }
}

async function startTitleEdit() {
  if (!$("titleForm").hidden || !(await ownerCode())) return;
  $("titleInput").value = state.title;
  $("titleForm").hidden = false;
  $("mastheadActions").hidden = true;
  $("titleInput").focus();
  $("titleInput").select();
}

function endTitleEdit() {
  $("titleForm").hidden = true;
  $("mastheadActions").hidden = false;
  renderTitle(state.title);
}

async function saveTitle(event) {
  event.preventDefault();
  const next = $("titleInput").value.trim();
  if (!next) return;
  const code = await ownerCode();
  if (!code) return;
  try {
    await state.store.setTitle(next, code);
    state.title = next;
    document.title = next;
    endTitleEdit();
    showToast("Title saved");
  } catch (error) {
    forgetCodeIfRejected(error);
    showToast(`Couldn't save the title. ${error.message}`);
  }
}

/* Owner code */

function ownerCode() {
  if (!state.store.needsCode) return Promise.resolve("local");
  const saved = storageGet(CODE_KEY);
  if (saved) return Promise.resolve(saved);

  return new Promise((resolve) => {
    const dialog = $("codeDialog");
    const form = $("codeForm");
    $("codeInput").value = "";
    showError("codeError", "");

    const finish = (value) => {
      form.removeEventListener("submit", submit);
      $("codeCancel").removeEventListener("click", cancel);
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
      resolve(value);
    };
    const cancel = (event) => { event.preventDefault(); finish(null); };
    const submit = async (event) => {
      event.preventDefault();
      const code = $("codeInput").value;
      $("codeSubmit").disabled = true;
      try {
        if (await state.store.verifyCode(code)) {
          storageSet(CODE_KEY, code);
          finish(code);
        } else {
          showError("codeError", "That code isn't right.");
        }
      } catch (error) {
        showError("codeError", error.message);
      } finally {
        $("codeSubmit").disabled = false;
      }
    };
    form.addEventListener("submit", submit);
    $("codeCancel").addEventListener("click", cancel);
    dialog.addEventListener("cancel", cancel);
    dialog.showModal();
  });
}

function forgetCodeIfRejected(error) {
  if (/owner code/i.test(error.message)) storageRemove(CODE_KEY);
}

/* Turning entries into pages */

function sorted(entries) {
  return [...entries].sort((a, b) =>
    a.date.localeCompare(b.date) || a.sort_key - b.sort_key || String(a.created_at).localeCompare(String(b.created_at)));
}

function buildPages() {
  const pages = [];
  const opening = narrow.matches
    ? [{ bouquet: true, hint: true }]
    : [{ bouquet: true }, { bouquet: true, hint: true }];
  let batch = [];
  const flush = () => {
    if (batch.length) pages.push({ items: batch, month: batch[0].date.slice(0, 7) });
    batch = [];
  };
  for (const entry of sorted(state.entries)) {
    if (batch.length && (batch.length === PER_PAGE || batch[0].date.slice(0, 7) !== entry.date.slice(0, 7))) flush();
    batch.push(entry);
  }
  flush();

  if (!pages.length) pages.push({ blank: "first" });
  if (!narrow.matches && pages.length % 2) pages.push({ blank: pages[0].blank ? "second" : "more" });
  state.pages = [...opening, ...pages];
  state.cur = Math.min(snap(state.cur), lastIndex());
  fillMonths();
}

function fillMonths() {
  const months = [...new Set(state.pages.map((page) => page.month).filter(Boolean))];
  const select = $("monthJump");
  select.hidden = months.length < 2;
  select.replaceChildren(new Option("Jump to month", ""), ...months.map((month) => new Option(
    parseDay(`${month}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    month,
  )));
}

const step = () => (narrow.matches ? 1 : 2);
const snap = (index) => index - (index % step());
const lastIndex = () => snap(state.pages.length - 1);

/* Page drawing */

const LAYOUTS = {
  1: [[{ l: 13, t: 13, w: 74, h: 72, r: -2 }]],
  2: [
    [{ l: 6, t: 11, w: 57, h: 42, r: -3 }, { l: 37, t: 51, w: 57, h: 42, r: 2.5 }],
    [{ l: 37, t: 11, w: 57, h: 42, r: 3 }, { l: 7, t: 51, w: 57, h: 42, r: -2 }],
  ],
  3: [
    [{ l: 6, t: 11, w: 49, h: 37, r: -3 }, { l: 54, t: 19, w: 41, h: 35, r: 3 }, { l: 14, t: 59, w: 60, h: 36, r: -1.5 }],
    [{ l: 45, t: 11, w: 49, h: 36, r: 2.5 }, { l: 6, t: 21, w: 40, h: 34, r: -3 }, { l: 30, t: 59, w: 62, h: 36, r: 1.5 }],
  ],
};

const STICKER_SPOTS = {
  1: [[{ l: 3, t: 83 }, { l: 84, t: 5 }]],
  2: [[{ l: 72, t: 7 }, { l: 6, t: 73 }], [{ l: 11, t: 7 }, { l: 75, t: 79 }]],
  3: [[{ l: 77, t: 7 }, { l: 79, t: 74 }], [{ l: 13, t: 7 }, { l: 8, t: 76 }]],
};

const ink = "#0a014f";
const STICKERS = {
  star: `<svg viewBox="0 0 64 64"><path d="M32 5l8 18 20 2-15 13 5 20-18-11-18 11 5-20L4 25l20-2z" fill="#f6f5ae" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  heart: `<svg viewBox="0 0 64 64"><path d="M32 56S6 40 6 22c0-9 7-15 14-15 6 0 10 3 12 8 2-5 6-8 12-8 7 0 14 6 14 15 0 18-26 34-26 34z" fill="#8e3b46" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  flower: `<svg viewBox="0 0 64 64"><g fill="#e5d0e3" stroke="${ink}" stroke-width="2.5"><circle cx="32" cy="14" r="10"/><circle cx="49" cy="27" r="10"/><circle cx="43" cy="48" r="10"/><circle cx="21" cy="48" r="10"/><circle cx="15" cy="27" r="10"/></g><circle cx="32" cy="33" r="9" fill="#f6f5ae" stroke="${ink}" stroke-width="2.5"/></svg>`,
  sun: `<svg viewBox="0 0 64 64"><g stroke="${ink}" stroke-width="3" stroke-linecap="round"><path d="M32 3v9M32 52v9M3 32h9M52 32h9M11 11l7 7M46 46l7 7M11 53l7-7M46 18l7-7"/></g><circle cx="32" cy="32" r="16" fill="#f6f5ae" stroke="${ink}" stroke-width="2.5"/><path d="M26 36c3 4 9 4 12 0" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><circle cx="26" cy="28" r="2" fill="${ink}"/><circle cx="38" cy="28" r="2" fill="${ink}"/></svg>`,
  cherry: `<svg viewBox="0 0 64 64"><path d="M20 40C24 24 34 12 46 7c0 12 2 22 2 31" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><circle cx="19" cy="47" r="12" fill="#8e3b46" stroke="${ink}" stroke-width="2.5"/><circle cx="46" cy="47" r="12" fill="#8e3b46" stroke="${ink}" stroke-width="2.5"/></svg>`,
};
const STICKER_NAMES = Object.keys(STICKERS);

function sticker(name, spot, seed) {
  const node = el("span", "sticker");
  node.innerHTML = STICKERS[name];
  node.style.left = `${spot.l}%`;
  node.style.top = `${spot.t}%`;
  node.style.setProperty("--r", `${(seed % 31) - 15}deg`);
  node.setAttribute("aria-hidden", "true");
  return node;
}

function renderCard(entry, slot, order) {
  const seed = hash(entry.id);
  const slip = seed % 3 === 0;
  const card = el("button", `card ${slip ? "card-slip" : "card-polaroid"}`);
  card.type = "button";
  card.style.cssText = `left:${slot.l}%;top:${slot.t}%;width:${slot.w}%;height:${slot.h}%;--r:${slot.r}deg;z-index:${order + 1}`;
  card.setAttribute("aria-label", `${entry.title ? `${entry.title}, ` : ""}${prettyDay(entry.date)}${entry.note ? `: ${entry.note}` : ""}.${entry.audio_url ? " Has a sound clip." : ""} Open photo.`);
  card.dataset.id = entry.id;

  const tape = el("span", `tape tape${seed % 3}`);
  tape.setAttribute("aria-hidden", "true");

  const photo = el("span", "photo");
  const img = el("img");
  img.src = entry.url;
  img.alt = "";
  img.draggable = false;
  photo.append(img);
  if (entry.audio_url) photo.append(el("span", "record card-record"));

  const caption = el("span", "caption");
  caption.append(el("span", "when", prettyDay(entry.date)));
  if (entry.title) {
    const name = el("span", "memory-title", entry.title);
    name.dir = "auto";
    caption.append(name);
  }
  if (entry.note) {
    const note = el("span", "note", entry.note);
    note.dir = "auto";
    caption.append(note);
  }
  card.append(tape, photo, caption);
  return card;
}

function renderBlank(kind) {
  const box = el("div", "blank");
  if (kind === "second") {
    box.append(el("p", "blank-line", "Photos, dates, little notes."));
    box.append(el("p", "blank-small", "They'll all live here."));
    return box;
  }
  box.append(el("p", "blank-line", kind === "first" ? "Your first memory goes here" : "Room for more memories"));
  const add = el("button", "btn btn-primary", "Add a memory");
  add.type = "button";
  add.addEventListener("click", openAdd);
  box.append(add);
  return box;
}

function renderPage(index) {
  const data = state.pages[index];
  const page = el("article", `page tint${index % 3}`);
  if (!data) return page;

  if (data.bouquet) {
    page.classList.add("endpaper");
    if (data.hint) page.append(el("p", "turn-hint", "turn the page"));
    return page;
  }

  if (data.blank) {
    page.append(renderBlank(data.blank));
    const seed = hash(`${data.blank}${index}`);
    page.append(
      sticker(STICKER_NAMES[seed % STICKER_NAMES.length], { l: 12, t: 12 }, seed),
      sticker(STICKER_NAMES[(seed >>> 4) % STICKER_NAMES.length], { l: 74, t: 76 }, seed >>> 8),
    );
    return page;
  }

  const monthName = parseDay(`${data.month}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  page.append(el("h2", "month", monthName));

  const count = data.items.length;
  const seed = hash(data.items[0].id);
  const layouts = LAYOUTS[count];
  const layout = layouts[index % layouts.length];
  data.items.forEach((entry, order) => page.append(renderCard(entry, layout[order], order)));

  const spots = STICKER_SPOTS[count][index % STICKER_SPOTS[count].length];
  spots.forEach((spot, i) => {
    page.append(sticker(STICKER_NAMES[(seed >>> (i * 5)) % STICKER_NAMES.length], spot, seed >>> (i * 3 + 2)));
  });
  return page;
}

function setSheet(sheet, index) {
  sheet.replaceChildren(renderPage(index));
}

function preloadAround(index) {
  for (const i of [index - step(), index + step(), index - 1, index + step() + 1]) {
    for (const item of state.pages[i]?.items || []) new Image().src = item.url;
  }
}

function updatePager() {
  const total = state.pages.length;
  const first = state.cur + 1;
  const last = Math.min(state.cur + step(), total);
  $("pageLabel").textContent = first === last ? `Page ${first} of ${total}` : `Pages ${first}–${last} of ${total}`;
  $("prev").disabled = state.cur === 0;
  $("next").disabled = state.cur >= lastIndex();
  $("play").disabled = total <= step();
  $("monthJump").value = state.pages[state.cur]?.month || state.pages[state.cur + 1]?.month || "";
}

function draw() {
  if (narrow.matches) {
    $("sheetL").replaceChildren();
  } else {
    setSheet($("sheetL"), state.cur);
  }
  setSheet($("sheetR"), narrow.matches ? state.cur : state.cur + 1);
  updatePager();
  preloadAround(state.cur);
  if (state.opened) {
    const wantPopup = Boolean(state.pages[state.cur]?.bouquet);
    if (wantPopup && !state.popupShown) showPopup(0);
    if (!wantPopup && state.popupShown) hidePopup();
  }
}

function rebuild() {
  buildPages();
  draw();
}

/* Page flipping */

// A turning page is a chain of hinged strips, so it can bend like real paper.
function makeLeaf(drawFront, drawBack, count) {
  const leaf = el("div", "leaf");
  const strips = [];
  const shades = [];
  let parent = leaf;
  for (let i = 0; i < count; i += 1) {
    const strip = el("div", i ? "strip" : "strip strip-root");
    if (!i) strip.style.width = `${100 / count}%`;
    for (const side of ["front", "back"]) {
      const face = el("div", `face ${side}`);
      const slice = el("div", "slice");
      slice.style.width = `${count * 100}%`;
      slice.style.left = `${-(side === "front" ? i : count - 1 - i) * 100}%`;
      slice.append(side === "front" ? drawFront() : drawBack());
      const shade = el("div", "shade");
      face.append(slice, shade);
      strip.append(face);
      shades.push(shade);
    }
    parent.append(strip);
    strips.push(strip);
    parent = strip;
  }
  $("pages").append(leaf);
  return { leaf, strips, shades };
}

// Browsers can stall animations in background tabs; never leave the book stuck.
function finishSoon(animations, ms) {
  setTimeout(() => animations.forEach((animation) => animation.finish()), ms);
  return Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
}

function showPopup(delay) {
  const popup = $("popup");
  clearTimeout(showPopup.timer);
  if (!popup.firstChild) popup.append(buildBouquet());
  state.popupShown = true;
  popup.hidden = false;
  if (calm.matches) {
    popup.className = "popup";
    return;
  }
  popup.className = "popup folded";
  showPopup.timer = setTimeout(() => { popup.className = "popup unfold"; }, delay + 30);
}

function hidePopup() {
  const popup = $("popup");
  clearTimeout(showPopup.timer);
  state.popupShown = false;
  if (calm.matches) {
    popup.hidden = true;
    return;
  }
  popup.className = "popup closing";
  showPopup.timer = setTimeout(() => { popup.hidden = true; }, 440);
}

function openBook() {
  if (state.opened) return;
  state.opened = true;
  unlockHoverSound();
  const cover = $("cover");
  const finish = () => {
    document.body.classList.remove("closed", "opening");
    cover.hidden = true;
  };
  if (calm.matches) {
    finish();
    showPopup(0);
    return;
  }
  document.body.classList.add("opening");
  cover.style.transition = "none";
  const animation = cover.animate(
    [{ transform: "perspective(2400px) rotateY(0deg)" }, { transform: "perspective(2400px) rotateY(-180deg)" }],
    { duration: OPEN_MS, easing: "cubic-bezier(.45,.05,.3,1)", fill: "forwards" },
  );
  showPopup(OPEN_MS * 0.42);
  finishSoon([animation], OPEN_MS + 150).then(finish);
}

function flipTo(target) {
  target = Math.max(0, Math.min(snap(target), lastIndex()));
  if (state.flipping || target === state.cur) return;
  stopHover();
  const forward = target > state.cur;
  const from = state.cur;
  state.cur = target;

  if (calm.matches) {
    draw();
    return;
  }

  state.flipping = true;
  if (state.pages[from]?.bouquet) hidePopup();

  const single = narrow.matches;
  const page = (index) => () => renderPage(index);
  const plainBack = () => el("article", "page tint0");
  let parts;

  if (single) {
    parts = makeLeaf(page(forward ? from : target), plainBack, 4);
    setSheet($("sheetR"), forward ? target : from);
  } else if (forward) {
    parts = makeLeaf(page(from + 1), page(target), 6);
    setSheet($("sheetR"), target + 1);
  } else {
    parts = makeLeaf(page(target + 1), page(from), 6);
    setSheet($("sheetL"), target);
  }

  const cast = el("div", "cast");
  $("pages").append(cast);

  const timing = { duration: FLIP_MS, fill: "forwards" };
  const curl = 40 / (parts.strips.length - 1);
  const direction = forward ? 1 : -1;
  const [start, end] = forward ? [0, -180] : [-180, 0];
  const animations = parts.strips.map((strip, index) => (index === 0
    ? strip.animate(
      [{ transform: `rotateY(${start}deg)` }, { transform: `rotateY(${end}deg)` }],
      { ...timing, easing: "cubic-bezier(.45,.05,.3,1)" },
    )
    : strip.animate([
      { transform: "rotateY(0deg)", easing: "ease-out" },
      { transform: `rotateY(${-curl * 0.45 * direction}deg)`, offset: 0.2, easing: "ease-in-out" },
      { transform: `rotateY(${curl * direction}deg)`, offset: 0.62, easing: "ease-in-out" },
      { transform: "rotateY(0deg)" },
    ], timing)));
  // Shadow deepens gradually toward the free edge, which reads as a smooth curve.
  parts.shades.forEach((shade, index) => {
    const depth = Math.floor(index / 2) / parts.strips.length;
    animations.push(shade.animate({ opacity: [0, 0.2 + depth * 0.8, 0] }, timing));
  });
  animations.push(cast.animate({ opacity: [0, 1, 0] }, timing));

  finishSoon(animations, FLIP_MS + 120).then(() => {
    draw();
    parts.leaf.remove();
    cast.remove();
    state.flipping = false;
  });
  updatePager();
}

function stopAutoplay() {
  clearInterval(state.autoplay);
  state.autoplay = null;
  $("play").textContent = "Play";
  $("play").setAttribute("aria-pressed", "false");
}

function toggleAutoplay() {
  if (state.autoplay) return stopAutoplay();
  $("play").textContent = "Pause";
  $("play").setAttribute("aria-pressed", "true");
  const advance = () => {
    if (document.querySelector("dialog[open]") || document.hidden) return;
    flipTo(state.cur >= lastIndex() ? 0 : state.cur + step());
  };
  advance();
  state.autoplay = setInterval(advance, 3800);
}

function manualFlip(delta) {
  if (!state.opened) {
    openBook();
    return;
  }
  stopAutoplay();
  flipTo(state.cur + delta * step());
}

/* Hover to play */

// A fraction of a second of silence, used to get the browser's permission to play.
const SILENCE = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQQAAAAAAAAA";
const hover = { clip: new Audio(), id: null, timer: 0 };

// Browsers block sound that doesn't follow a click, so this runs on the click that opens the book.
function unlockHoverSound() {
  hover.clip.src = SILENCE;
  hover.clip.play().then(() => { if (!hover.id) hover.clip.pause(); }).catch(() => {});
}

function stopHover() {
  clearTimeout(hover.timer);
  if (!hover.id) return;
  hover.id = null;
  hover.clip.pause();
  hover.clip.removeAttribute("src");
  hover.clip.load();
}

function hoverPlay(entry) {
  if (hover.id === entry.id || state.flipping) return;
  stopHover();
  hover.id = entry.id;
  // A short wait so sweeping the mouse across the page doesn't set off every clip.
  hover.timer = setTimeout(() => {
    hover.clip.src = entry.audio_url;
    hover.clip.play().catch(() => {});
  }, 150);
}

/* Add photos */

let chosenFiles = [];
let chosenAudio = null;
let dateTouched = false;

function setAudio(audio) {
  chosenAudio = audio;
  $("audioText").textContent = audio ? audio.name : "Add a sound clip (optional)";
  $("audioClear").hidden = !audio;
}

async function chooseAudio(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!Object.hasOwn(AUDIO_TYPES, ext)) {
    showError("addError", "That sound file isn't supported. Try MP3, M4A or WAV.");
    return;
  }
  if (file.size > MAX_AUDIO_MB * 1048576) {
    showError("addError", `That sound clip is too big. The limit is ${MAX_AUDIO_MB} MB.`);
    return;
  }
  // Copy the bytes now: some browsers lose access to a picked file once the picker is cleared.
  let bytes;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    showError("addError", "Couldn't read that sound file. Try saving it to your device first.");
    return;
  }
  if (!bytes.byteLength) {
    showError("addError", "That sound file came through empty. If it's in iCloud or another cloud drive, download it to your device first.");
    return;
  }
  showError("addError", "");
  setAudio({ blob: new Blob([bytes], { type: AUDIO_TYPES[ext] }), ext, name: file.name });
}

function clearPreviews() {
  $("previews").querySelectorAll("img").forEach((img) => URL.revokeObjectURL(img.src));
  $("previews").replaceChildren();
}

const memoryLabel = (entry) => entry.title || prettyDay(entry.date);

function openInsert(side) {
  const list = sorted(state.entries);
  const here = list.findIndex((entry) => entry.id === state.viewing.id);
  const [before, after] = side === "before" ? [list[here - 1], list[here]] : [list[here], list[here + 1]];
  $("viewDialog").close();
  openAdd();
  state.insertAt = { before, after };
  $("addHeading").textContent = "Add a memory here";
  $("insertHint").textContent = before && after
    ? `Goes between ${memoryLabel(before)} and ${memoryLabel(after)}`
    : `Goes ${before ? `after ${memoryLabel(before)}` : `before ${memoryLabel(after)}`}`;
  $("insertHint").hidden = false;
  // The date has to stay between the two neighbours, or it couldn't land there.
  if (before) $("dateInput").min = before.date;
  if (after) $("dateInput").max = after.date;
  $("dateInput").value = (before || after).date;
}

// Evenly spaced sort keys that fall between the two neighbours on the chosen date.
function insertKeys(count, date) {
  const { before, after } = state.insertAt;
  const onBefore = before?.date === date;
  const onAfter = after?.date === date;
  const low = onBefore ? before.sort_key : onAfter ? after.sort_key - 2 : 0;
  const high = onAfter ? after.sort_key : low + 2;
  return Array.from({ length: count }, (_, i) => low + ((high - low) * (i + 1)) / (count + 1));
}

function openAdd() {
  stopAutoplay();
  state.insertAt = null;
  $("addHeading").textContent = "Add a memory";
  $("insertHint").hidden = true;
  $("dateInput").removeAttribute("min");
  $("dateInput").removeAttribute("max");
  chosenFiles = [];
  dateTouched = false;
  clearPreviews();
  $("addForm").reset();
  $("dropText").textContent = "Choose photos, or drop them here";
  setAudio(null);
  $("dateInput").value = isoDay();
  $("authorInput").value = storageGet(AUTHOR_KEY);
  showError("addError", "");
  $("addDialog").showModal();
}

function chooseFiles(fileList) {
  const images = [...fileList].filter((file) => file.type.startsWith("image/") || /\.(hei[cf])$/i.test(file.name));
  if (!images.length) {
    showError("addError", "Those files aren't photos. Try a JPG or PNG.");
    return;
  }
  chosenFiles = images.slice(0, MAX_FILES);
  showError("addError", images.length > MAX_FILES ? `Only the first ${MAX_FILES} photos were picked.` : "");
  clearPreviews();
  for (const file of chosenFiles) {
    const preview = el("img");
    preview.alt = "";
    preview.src = URL.createObjectURL(file);
    preview.onerror = () => preview.remove();
    $("previews").append(preview);
  }
  $("dropText").textContent = chosenFiles.length === 1 ? "1 photo chosen" : `${chosenFiles.length} photos chosen`;
  if (!dateTouched && !state.insertAt) {
    $("dateInput").value = isoDay(new Date(Math.min(...chosenFiles.map((f) => f.lastModified))));
  }
}

async function toJpeg(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("this browser can't open that format");
  }
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = el("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("couldn't be prepared"))), "image/jpeg", 0.85);
  });
}

async function submitAdd(event) {
  event.preventDefault();
  if (!chosenFiles.length) {
    showError("addError", "Choose at least one photo first.");
    return;
  }
  const date = $("dateInput").value;
  const note = $("noteInput").value.trim();
  const author = $("authorInput").value.trim();
  const title = $("memoryTitle").value.trim();
  const sortKeys = state.insertAt ? insertKeys(chosenFiles.length, date) : [];
  storageSet(AUTHOR_KEY, author);
  showError("addError", "");

  const submit = $("addSubmit");
  submit.disabled = true;
  let lastId = null;
  const failed = [];
  let lastError = "";
  for (const [i, file] of chosenFiles.entries()) {
    submit.textContent = `Sticking ${i + 1} of ${chosenFiles.length}…`;
    try {
      const blob = await toJpeg(file);
      // One clip per upload: it goes on the first photo that saves.
      lastId = await state.store.add({ blob, date, note, author, title, audio: chosenAudio, sortKey: sortKeys[i] });
      setAudio(null);
    } catch (error) {
      failed.push(file);
      lastError = error.message;
    }
  }
  submit.disabled = false;
  submit.textContent = "Stick it in";

  if (lastId) await refresh({ jumpTo: lastId });

  if (failed.length) {
    chosenFiles = failed;
    $("dropText").textContent = `${failed.length} still to add`;
    showError("addError", `Couldn't add ${failed.map((f) => f.name).join(", ")}: ${lastError}.`);
    return;
  }
  $("addDialog").close();
  showToast("Stuck in!");
}

/* View, edit, delete */

function setViewEditing(editing) {
  $("viewRead").hidden = editing;
  $("viewForm").hidden = !editing;
}

function fillView(entry) {
  $("viewImg").src = entry.url;
  $("viewImg").alt = entry.note || `Photo from ${prettyDay(entry.date)}`;
  $("viewDate").textContent = prettyDay(entry.date);
  $("viewTitle").textContent = entry.title;
  $("viewNote").textContent = entry.note;
  $("viewAuthor").textContent = entry.author ? `Added by ${entry.author}` : "";
}

function resetDeleteButton() {
  $("viewDelete").textContent = "Delete";
  delete $("viewDelete").dataset.armed;
}

function openView(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  stopAutoplay();
  stopHover();
  state.viewing = entry;
  fillView(entry);
  $("viewSound").hidden = !entry.audio_url;
  if (entry.audio_url) $("viewAudio").src = entry.audio_url;
  setViewEditing(false);
  resetDeleteButton();
  showError("viewError", "");
  $("viewDialog").showModal();
}

async function startEdit() {
  if (!(await ownerCode())) return;
  $("editMemoryTitle").value = state.viewing.title;
  $("editDate").value = state.viewing.date;
  $("editNote").value = state.viewing.note;
  setViewEditing(true);
}

async function saveEdit(event) {
  event.preventDefault();
  const code = await ownerCode();
  if (!code) return;
  const changes = {
    date: $("editDate").value,
    note: $("editNote").value.trim(),
    title: $("editMemoryTitle").value.trim(),
  };
  try {
    await state.store.update(state.viewing.id, changes, code);
    state.viewing = { ...state.viewing, ...changes };
    fillView(state.viewing);
    setViewEditing(false);
    showError("viewError", "");
    await refresh({ jumpTo: state.viewing.id });
  } catch (error) {
    forgetCodeIfRejected(error);
    showError("viewError", error.message);
  }
}

async function deleteViewing() {
  const button = $("viewDelete");
  if (!button.dataset.armed) {
    if (!(await ownerCode())) return;
    button.dataset.armed = "1";
    button.textContent = "Yes, delete it";
    return;
  }
  const code = await ownerCode();
  if (!code) return;
  try {
    await state.store.remove(state.viewing.id, code);
    $("viewDialog").close();
    await refresh();
    showToast("Photo removed");
  } catch (error) {
    forgetCodeIfRejected(error);
    resetDeleteButton();
    showError("viewError", error.message);
  }
}

/* Search */

function closeSearch() {
  $("searchResults").hidden = true;
}

function searchHit(entry) {
  const hit = el("button", "search-hit");
  hit.type = "button";
  const thumb = el("img");
  thumb.src = entry.url;
  thumb.alt = "";
  const text = el("span", "search-text");
  const name = el("span", "search-name", entry.title || entry.note || "Untitled");
  name.dir = "auto";
  text.append(name, el("span", "search-when", prettyDay(entry.date)));
  hit.append(thumb, text);
  hit.addEventListener("click", () => {
    closeSearch();
    const pageIndex = state.pages.findIndex((page) => page.items?.some((item) => item.id === entry.id));
    if (pageIndex >= 0) flipTo(pageIndex);
    openView(entry.id);
  });
  return hit;
}

function runSearch() {
  const query = $("searchInput").value.trim().toLocaleLowerCase();
  const box = $("searchResults");
  if (!query) {
    closeSearch();
    return;
  }
  const inTitle = (entry) => entry.title.toLocaleLowerCase().includes(query);
  const hits = sorted(state.entries).filter((entry) => inTitle(entry) || entry.note.toLocaleLowerCase().includes(query));
  // Title matches come first; within each group the order stays by date.
  hits.sort((a, b) => inTitle(b) - inTitle(a));
  box.replaceChildren(...(hits.length ? hits.slice(0, 30).map(searchHit) : [el("p", "search-none", "No memories match that.")]));
  box.hidden = false;
}

/* Loading */

async function refresh({ jumpTo } = {}) {
  const [title, entries] = await Promise.all([state.store.getTitle(), state.store.list()]);
  const signature = JSON.stringify([title, entries.map((e) => [e.id, e.date, e.sort_key, e.title, e.note])]);
  const changed = signature !== state.signature;
  state.signature = signature;
  state.entries = entries;

  if ($("titleForm").hidden && title !== state.title) {
    state.title = title;
    document.title = title;
    renderTitle(title);
  }
  if (!changed && !jumpTo) return;

  buildPages();
  if (jumpTo) {
    const pageIndex = state.pages.findIndex((page) => page.items?.some((item) => item.id === jumpTo));
    if (pageIndex >= 0) state.cur = snap(pageIndex);
  }
  if (!state.flipping) draw();
}

function quietRefresh() {
  if (state.flipping || document.hidden || state.store?.mode !== "shared") return;
  refresh().catch(() => {});
}

/* Wiring */

function dressCover() {
  const art = $("coverArt");
  art.append(petalDefs());
  const flowers = [
    { left: -16, top: -9, size: 62, colour: "pink", seed: 301 },
    { left: 34, top: -15, size: 46, colour: "white", seed: 302 },
    { left: 66, top: 76, size: 58, colour: "white", seed: 303 },
    { left: 28, top: 85, size: 44, colour: "pink", seed: 304 },
  ];
  flowers.forEach((flower) => art.append(makeBloom(flower)));
}

function measureMasthead() {
  document.documentElement.style.setProperty("--masthead-height", `${$("title").closest("header").offsetHeight}px`);
}

function wire() {
  $("cover").addEventListener("click", openBook);
  $("title").addEventListener("click", startTitleEdit);
  $("editTitle").addEventListener("click", startTitleEdit);
  $("titleInput").addEventListener("input", () => renderTitle($("titleInput").value || " "));
  $("titleInput").addEventListener("keydown", (event) => {
    if (event.key === "Escape") endTitleEdit();
  });
  $("titleForm").addEventListener("submit", saveTitle);
  $("titleCancel").addEventListener("click", endTitleEdit);

  $("addBtn").addEventListener("click", openAdd);
  $("addCancel").addEventListener("click", () => $("addDialog").close());
  $("addForm").addEventListener("submit", submitAdd);
  $("dateInput").addEventListener("input", () => { dateTouched = true; });
  $("fileInput").addEventListener("change", (event) => chooseFiles(event.target.files));

  $("audioInput").addEventListener("change", async (event) => {
    if (event.target.files[0]) await chooseAudio(event.target.files[0]);
    event.target.value = "";
  });
  $("audioClear").addEventListener("click", () => setAudio(null));

  const dropZone = (zone, onFiles) => {
    for (const type of ["dragenter", "dragover"]) {
      zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add("over"); });
    }
    for (const type of ["dragleave", "drop"]) {
      zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.remove("over"); });
    }
    zone.addEventListener("drop", (event) => {
      if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
    });
  };
  dropZone($("drop"), chooseFiles);
  dropZone($("audioDrop"), (files) => chooseAudio(files[0]));

  $("prev").addEventListener("click", () => manualFlip(-1));
  $("next").addEventListener("click", () => manualFlip(1));
  $("play").addEventListener("click", toggleAutoplay);
  $("monthJump").addEventListener("change", (event) => {
    if (!event.target.value) return;
    stopAutoplay();
    flipTo(state.pages.findIndex((page) => page.month === event.target.value));
  });

  $("searchInput").addEventListener("input", runSearch);
  $("searchInput").addEventListener("focus", runSearch);
  $("searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearch();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#search")) closeSearch();
  });
  $("addBefore").addEventListener("click", () => openInsert("before"));
  $("addAfter").addEventListener("click", () => openInsert("after"));

  let touchX = null;
  let swipedAt = 0;
  const book = $("book");
  book.addEventListener("pointerdown", (event) => { touchX = event.clientX; });
  book.addEventListener("pointerup", (event) => {
    if (touchX === null) return;
    const dx = event.clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) {
      swipedAt = Date.now();
      manualFlip(dx < 0 ? 1 : -1);
    }
  });
  book.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    const card = event.target.closest(".card");
    const entry = card && state.entries.find((item) => item.id === card.dataset.id);
    if (entry?.audio_url) hoverPlay(entry);
    else stopHover();
  });
  book.addEventListener("pointerleave", stopHover);
  book.addEventListener("click", (event) => {
    const card = event.target.closest(".card");
    if (card && Date.now() - swipedAt > 300) openView(card.dataset.id);
  });

  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]") || event.target.matches("input,textarea,select")) return;
    if (event.key === "ArrowRight") manualFlip(1);
    if (event.key === "ArrowLeft") manualFlip(-1);
  });

  const clip = $("viewAudio");
  const spin = (playing) => $("viewRecord").classList.toggle("playing", playing);
  clip.addEventListener("play", () => spin(true));
  for (const type of ["pause", "ended", "emptied"]) clip.addEventListener(type, () => spin(false));
  clip.addEventListener("error", () => showError("viewError", "This browser can't play that sound file."));
  $("viewDialog").addEventListener("close", () => {
    clip.pause();
    clip.removeAttribute("src");
    clip.load();
  });

  $("viewClose").addEventListener("click", () => $("viewDialog").close());
  $("viewDialog").addEventListener("click", (event) => {
    if (event.target === $("viewDialog")) $("viewDialog").close();
  });
  $("viewEdit").addEventListener("click", startEdit);
  $("editCancel").addEventListener("click", () => setViewEditing(false));
  $("viewForm").addEventListener("submit", saveEdit);
  $("viewDelete").addEventListener("click", deleteViewing);

  narrow.addEventListener("change", () => { stopAutoplay(); rebuild(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopHover();
    quietRefresh();
  });
  setInterval(quietRefresh, 60000);
}

async function start() {
  wire();
  dressCover();
  const config = window.SCRAPBOOK_CONFIG;
  renderTitle(config.defaultTitle);
  measureMasthead();
  addEventListener("resize", measureMasthead);
  try {
    state.store = await createStore(config);
    $("previewBanner").hidden = state.store.mode !== "local";
    state.title = "";
    await refresh();
  } catch (error) {
    rebuild();
    $("addBtn").disabled = true;
    showToast(`The scrapbook couldn't load. ${error.message}`);
  }
}

start();
