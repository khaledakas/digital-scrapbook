// Storage behind the scrapbook. Both stores expose the same methods, so the
// interface doesn't care whether photos live in this browser or in Supabase.

const SUPABASE_SDK =
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js";

function createLocalStore(defaultTitle) {
  const urls = new Map();
  const dbReady = new Promise((resolve, reject) => {
    const req = indexedDB.open("digital-scrapbook", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("entries", { keyPath: "id" });
      req.result.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("This browser is blocking local storage."));
  });

  async function run(storeName, mode, action) {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = action(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Couldn't save. Your browser storage may be full."));
    });
  }

  const urlFor = (key, blob) => {
    if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
    return urls.get(key);
  };

  return {
    mode: "local",
    needsCode: false,
    async getTitle() {
      return (await run("meta", "readonly", (s) => s.get("title"))) || defaultTitle;
    },
    async setTitle(title) {
      await run("meta", "readwrite", (s) => s.put(title, "title"));
    },
    async list() {
      const rows = await run("entries", "readonly", (s) => s.getAll());
      return rows.map(({ blob, audioBlob, ...row }) => ({
        ...row,
        url: urlFor(row.id, blob),
        audio_url: audioBlob ? urlFor(`audio-${row.id}`, audioBlob) : null,
      }));
    },
    async add({ blob, date, note, author, audio }) {
      const row = {
        id: crypto.randomUUID(), blob, date, note, author,
        audioBlob: audio?.blob || null,
        created_at: new Date().toISOString(),
      };
      await run("entries", "readwrite", (s) => s.put(row));
      return row.id;
    },
    async update(id, { date, note }) {
      const row = await run("entries", "readonly", (s) => s.get(id));
      await run("entries", "readwrite", (s) => s.put({ ...row, date, note }));
    },
    async remove(id) {
      await run("entries", "readwrite", (s) => s.delete(id));
      for (const key of [id, `audio-${id}`]) {
        if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
        urls.delete(key);
      }
    },
    async verifyCode() {
      return true;
    },
  };
}

function loadSupabaseSdk() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SUPABASE_SDK;
    script.onload = () => resolve(window.supabase);
    script.onerror = () => reject(new Error("Couldn't reach the scrapbook's storage."));
    document.head.append(script);
  });
}

function createSharedStore(db, defaultTitle) {
  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  const publicUrl = (bucket, path) => db.storage.from(bucket).getPublicUrl(path).data.publicUrl;

  return {
    mode: "shared",
    needsCode: true,
    async getTitle() {
      const row = check(await db.from("scrapbook_settings").select("title").eq("id", 1).maybeSingle());
      return row?.title || defaultTitle;
    },
    async setTitle(title, code) {
      check(await db.rpc("scrapbook_set_title", { p_code: code, p_title: title }));
    },
    async list() {
      const rows = check(await db.from("scrapbook_entries").select("id,photo_path,audio_path,date,note,author,created_at"));
      return rows.map((row) => ({
        ...row,
        url: publicUrl("scrapbook-photos", row.photo_path),
        audio_url: row.audio_path ? publicUrl("scrapbook-audio", row.audio_path) : null,
      }));
    },
    async add({ blob, date, note, author, audio }) {
      const id = crypto.randomUUID();
      const path = `${id}.jpg`;
      const audioPath = audio ? `${id}.${audio.ext}` : null;
      // Sound goes first: it's the upload most likely to be refused.
      if (audio) {
        // The SDK sends a File's own type and ignores contentType, so relabel the bytes.
        const sound = audio.blob.slice(0, audio.blob.size, audio.type);
        check(await db.storage.from("scrapbook-audio").upload(audioPath, sound, {
          cacheControl: "31536000",
        }));
      }
      check(await db.storage.from("scrapbook-photos").upload(path, blob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      }));
      check(await db.from("scrapbook_entries").insert({ id, photo_path: path, audio_path: audioPath, date, note, author }));
      return id;
    },
    async update(id, { date, note }, code) {
      check(await db.rpc("scrapbook_update_entry", { p_code: code, p_id: id, p_date: date, p_note: note }));
    },
    async remove(id, code) {
      check(await db.rpc("scrapbook_delete_entry", { p_code: code, p_id: id }));
    },
    async verifyCode(code) {
      return check(await db.rpc("scrapbook_check_owner_code", { p_code: code }));
    },
  };
}

async function createStore(config) {
  if (!config.supabaseUrl || !config.supabaseKey) return createLocalStore(config.defaultTitle);
  const sdk = await loadSupabaseSdk();
  const db = sdk.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false },
  });
  return createSharedStore(db, config.defaultTitle);
}
