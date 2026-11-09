-- Run this once in the Supabase SQL Editor.
-- BEFORE running: replace CHANGE-THIS-OWNER-CODE near the bottom with your own
-- long private code. Do that in the SQL Editor only, never in this public file.

create table public.scrapbook_settings (
  id int primary key default 1 check (id = 1),
  title text not null check (char_length(title) between 1 and 60)
);
insert into public.scrapbook_settings (title) values ('Our Scrapbook');

create table public.scrapbook_entries (
  id uuid primary key,
  photo_path text not null unique check (photo_path ~ '^[0-9a-f-]{36}\.jpg$'),
  audio_path text unique check (audio_path ~ '^[0-9a-f-]{36}\.(mp3|m4a|aac|wav|ogg|opus|webm|flac)$'),
  date date not null,
  sort_key double precision not null default extract(epoch from now()),
  title text not null default '' check (char_length(title) <= 80),
  note text not null default '' check (char_length(note) <= 500),
  author text not null default '' check (char_length(author) <= 40),
  created_at timestamptz not null default now()
);

alter table public.scrapbook_settings enable row level security;
alter table public.scrapbook_entries enable row level security;

create policy "Scrapbook: anyone can read the title" on public.scrapbook_settings
  for select to anon using (true);
create policy "Scrapbook: anyone can read entries" on public.scrapbook_entries
  for select to anon using (true);
create policy "Scrapbook: anyone can add entries" on public.scrapbook_entries
  for insert to anon with check (true);

grant select on public.scrapbook_settings to anon;
grant select, insert on public.scrapbook_entries to anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scrapbook-photos', 'scrapbook-photos', true, 5242880, array['image/jpeg']);

create policy "Scrapbook: anyone can upload photos" on storage.objects
  for insert to anon with check (bucket_id = 'scrapbook-photos');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scrapbook-audio', 'scrapbook-audio', true, 15728640,
  array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/flac']);

create policy "Scrapbook: anyone can upload audio" on storage.objects
  for insert to anon with check (bucket_id = 'scrapbook-audio');

-- The owner code lives in a schema the public API can't read.
create schema if not exists scrapbook_private;
create table scrapbook_private.owner (code text not null);
insert into scrapbook_private.owner (code) values ('CHANGE-THIS-OWNER-CODE');

create function public.scrapbook_check_owner_code(p_code text) returns boolean
language sql security definer set search_path = '' as $$
  select exists (
    select 1 from scrapbook_private.owner
    where code = p_code and code <> 'CHANGE-THIS-OWNER-CODE'
  );
$$;

create function scrapbook_private.require_owner(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.scrapbook_check_owner_code(p_code) then
    raise exception 'Wrong owner code';
  end if;
end;
$$;

create function public.scrapbook_set_title(p_code text, p_title text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform scrapbook_private.require_owner(p_code);
  update public.scrapbook_settings set title = p_title where id = 1;
end;
$$;

create function public.scrapbook_update_entry(p_code text, p_id uuid, p_date date, p_note text, p_title text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform scrapbook_private.require_owner(p_code);
  update public.scrapbook_entries set date = p_date, note = p_note, title = p_title where id = p_id;
end;
$$;

create function public.scrapbook_delete_entry(p_code text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform scrapbook_private.require_owner(p_code);
  delete from public.scrapbook_entries where id = p_id;
end;
$$;

revoke all on function scrapbook_private.require_owner(text) from public;
grant execute on function public.scrapbook_check_owner_code(text) to anon;
grant execute on function public.scrapbook_set_title(text, text) to anon;
grant execute on function public.scrapbook_update_entry(text, uuid, date, text, text) to anon;
grant execute on function public.scrapbook_delete_entry(text, uuid) to anon;
