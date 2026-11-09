# Digital Scrapbook

A spiral-notebook photo collage with page flips, dates, handwritten notes and an editable cut-paper title.

## Change the title

Click the title on the site, type, and save. To change what a brand-new scrapbook starts with, edit `defaultTitle` in `config.js`.

## Let other people add photos

Until this is set up, the site runs in preview mode and photos stay in your own browser.

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and paste in `supabase/schema.sql`.
3. In the editor only, replace `CHANGE-THIS-OWNER-CODE` with your own long private code, then click **Run**.
4. Open **Project Settings > API** and copy the **Project URL** and the **publishable/anon** key.
5. Put them in `config.js` as `supabaseUrl` and `supabaseKey`, then commit and push.

## Who can do what

- Anyone with the link can view and add photos.
- Changing the title, editing and deleting need the owner code. The browser remembers it after the first use.
- Anyone adding photos can attach one sound clip (MP3, M4A, WAV and similar, up to 15 MB). It goes on the first photo in that upload, and a spinning record marks it on the page.
- Deleting removes a memory from the scrapbook. Its files stay in the Supabase `scrapbook-photos` and `scrapbook-audio` buckets until you remove them there.
- Free Supabase projects pause after a week with no activity. Restore it from the Supabase dashboard if the site stops loading.

## Run it locally

```bash
python3 -m http.server 8799
```
