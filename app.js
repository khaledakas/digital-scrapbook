const $ = (id) => document.getElementById(id);
const CODE_KEY = "scrapbook-owner-code";
const AUTHOR_KEY = "scrapbook-author";
const PER_PAGE = 3;
const MAX_FILES = 12;
const FLIP_MS = 850;
const narrow = matchMedia("(max-width: 760px)");
const calm = matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  store: null,
  title: "",
  entries: [],
  pages: [],
  cur: 0,
  flipping: false,
  signature: "",
  viewing: null,
  autoplay: null,
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
const LETTER_PAPERS = ["pink", "butter", "cream", "ink-butter", "pink", "butter", "ink-pink"];

function renderTitle(text) {
  const title = $("title");
  title.replaceChildren();
  title.setAttribute("aria-label", text);
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
    a.date.localeCompare(b.date) || String(a.created_at).localeCompare(String(b.created_at)));
}

function buildPages() {
  const pages = [];
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
  state.pages = pages;
  state.cur = Math.min(snap(state.cur), lastIndex());
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

const ink = "#4a2f38";
const STICKERS = {
  star: `<svg viewBox="0 0 64 64"><path d="M32 5l8 18 20 2-15 13 5 20-18-11-18 11 5-20L4 25l20-2z" fill="#fce98f" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  heart: `<svg viewBox="0 0 64 64"><path d="M32 56S6 40 6 22c0-9 7-15 14-15 6 0 10 3 12 8 2-5 6-8 12-8 7 0 14 6 14 15 0 18-26 34-26 34z" fill="#f8c8d4" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  flower: `<svg viewBox="0 0 64 64"><g fill="#f8c8d4" stroke="${ink}" stroke-width="2.5"><circle cx="32" cy="14" r="10"/><circle cx="49" cy="27" r="10"/><circle cx="43" cy="48" r="10"/><circle cx="21" cy="48" r="10"/><circle cx="15" cy="27" r="10"/></g><circle cx="32" cy="33" r="9" fill="#fce98f" stroke="${ink}" stroke-width="2.5"/></svg>`,
  sun: `<svg viewBox="0 0 64 64"><g stroke="${ink}" stroke-width="3" stroke-linecap="round"><path d="M32 3v9M32 52v9M3 32h9M52 32h9M11 11l7 7M46 46l7 7M11 53l7-7M46 18l7-7"/></g><circle cx="32" cy="32" r="16" fill="#fce98f" stroke="${ink}" stroke-width="2.5"/><path d="M26 36c3 4 9 4 12 0" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><circle cx="26" cy="28" r="2" fill="${ink}"/><circle cx="38" cy="28" r="2" fill="${ink}"/></svg>`,
  cherry: `<svg viewBox="0 0 64 64"><path d="M20 40C24 24 34 12 46 7c0 12 2 22 2 31" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><circle cx="19" cy="47" r="12" fill="#f8c8d4" stroke="${ink}" stroke-width="2.5"/><circle cx="46" cy="47" r="12" fill="#f8c8d4" stroke="${ink}" stroke-width="2.5"/></svg>`,
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
  card.setAttribute("aria-label", `${prettyDay(entry.date)}${entry.note ? `: ${entry.note}` : ""}. Open photo.`);
  card.dataset.id = entry.id;

  const tape = el("span", `tape tape${seed % 3}`);
  tape.setAttribute("aria-hidden", "true");

  const photo = el("span", "photo");
  const img = el("img");
  img.src = entry.url;
  img.alt = "";
  img.draggable = false;
  photo.append(img);

  const caption = el("span", "caption");
  caption.append(el("span", "when", prettyDay(entry.date)));
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
}

function rebuild() {
  buildPages();
  draw();
}

/* Page flipping */

function makeLeaf(frontIndex, backIndex) {
  const leaf = el("div", "leaf");
  const front = el("div", "face front");
  const back = el("div", "face back");
  front.append(renderPage(frontIndex));
  back.append(renderPage(backIndex));
  leaf.append(front, back);
  $("pages").append(leaf);
  return leaf;
}

function flipTo(target) {
  target = Math.max(0, Math.min(snap(target), lastIndex()));
  if (state.flipping || target === state.cur) return;
  const forward = target > state.cur;
  const from = state.cur;
  state.cur = target;

  if (calm.matches) {
    draw();
    return;
  }

  state.flipping = true;
  const single = narrow.matches;
  const open = single ? -112 : -180;
  let leaf;

  if (single) {
    leaf = makeLeaf(forward ? from : target, forward ? from : target);
    setSheet($("sheetR"), forward ? target : from);
  } else if (forward) {
    leaf = makeLeaf(from + 1, target);
    setSheet($("sheetR"), target + 1);
  } else {
    leaf = makeLeaf(target + 1, from);
    setSheet($("sheetL"), target);
  }

  const start = forward ? 0 : open;
  const end = forward ? open : 0;
  const frames = [{ transform: `rotateY(${start}deg)` }, { transform: `rotateY(${end}deg)` }];
  if (single) {
    frames[0].opacity = forward ? 1 : 0;
    frames[1].opacity = forward ? 0 : 1;
  }
  const animation = leaf.animate(frames, {
    duration: FLIP_MS,
    easing: "cubic-bezier(.45,.05,.3,1)",
    fill: "forwards",
  });
  // Browsers can stall animations in background tabs; never leave the book stuck mid-flip.
  setTimeout(() => animation.finish(), FLIP_MS + 120);
  animation.finished.catch(() => {}).finally(() => {
    draw();
    leaf.remove();
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
  stopAutoplay();
  flipTo(state.cur + delta * step());
}

/* Add photos */

let chosenFiles = [];
let dateTouched = false;

function clearPreviews() {
  $("previews").querySelectorAll("img").forEach((img) => URL.revokeObjectURL(img.src));
  $("previews").replaceChildren();
}

function openAdd() {
  stopAutoplay();
  chosenFiles = [];
  dateTouched = false;
  clearPreviews();
  $("addForm").reset();
  $("dropText").textContent = "Choose photos, or drop them here";
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
  if (!dateTouched) {
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
      lastId = await state.store.add({ blob, date, note, author });
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
  state.viewing = entry;
  fillView(entry);
  setViewEditing(false);
  resetDeleteButton();
  showError("viewError", "");
  $("viewDialog").showModal();
}

async function startEdit() {
  if (!(await ownerCode())) return;
  $("editDate").value = state.viewing.date;
  $("editNote").value = state.viewing.note;
  setViewEditing(true);
}

async function saveEdit(event) {
  event.preventDefault();
  const code = await ownerCode();
  if (!code) return;
  const changes = { date: $("editDate").value, note: $("editNote").value.trim() };
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

/* Loading */

async function refresh({ jumpTo } = {}) {
  const [title, entries] = await Promise.all([state.store.getTitle(), state.store.list()]);
  const signature = JSON.stringify([title, entries.map((e) => [e.id, e.date, e.note])]);
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

function wire() {
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

  const drop = $("drop");
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add("over"); });
  }
  for (const type of ["dragleave", "drop"]) {
    drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove("over"); });
  }
  drop.addEventListener("drop", (event) => chooseFiles(event.dataTransfer.files));

  $("prev").addEventListener("click", () => manualFlip(-1));
  $("next").addEventListener("click", () => manualFlip(1));
  $("play").addEventListener("click", toggleAutoplay);

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
  book.addEventListener("click", (event) => {
    const card = event.target.closest(".card");
    if (card && Date.now() - swipedAt > 300) openView(card.dataset.id);
  });

  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]") || event.target.matches("input,textarea")) return;
    if (event.key === "ArrowRight") manualFlip(1);
    if (event.key === "ArrowLeft") manualFlip(-1);
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
  document.addEventListener("visibilitychange", quietRefresh);
  setInterval(quietRefresh, 60000);
}

async function start() {
  wire();
  const config = window.SCRAPBOOK_CONFIG;
  renderTitle(config.defaultTitle);
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
