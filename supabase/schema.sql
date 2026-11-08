-- Run this once in the Supabase SQL Editor.
-- BEFORE running: replace CHANGE-THIS-OWNER-CODE near the bottom with your own
-- long private code. Do that in the SQL Editor only, never in this public file.

create table public.scrapbook_settings (
  id int primary key default 1 check (id = 1),
  title text not null check (char_length(title) between 1 and 60)
);
insert into public.scrapbook_settings (title) values ('Our Scrapbook');

create table public.entries (
  id uuid primary key,
  photo_path text not null unique check (photo_path ~ '^[0-9a-f-]{36}\.jpg$'),
  date date not null,
  note text not null default '' check (char_length(note) <= 500),
  author text not null default '' check (char_length(author) <= 40),
  created_at timestamptz not null default now()
);

alter table public.scrapbook_settings enable row level security;
alter table public.entries enable row level security;

create policy "Anyone can read the title" on public.scrapbook_settings
  for select to anon using (true);
create policy "Anyone can read entries" on public.entries
  for select to anon using (true);
create policy "Anyone can add entries" on public.entries
  for insert to anon with check (true);

grant select on public.scrapbook_settings to anon;
grant select, insert on public.entries to anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg']);

create policy "Anyone can upload photos" on storage.objects
  for insert to anon with check (bucket_id = 'photos');

-- The owner code lives in a schema the public API can't read.
create schema if not exists private;
create table private.owner (code text not null);
insert into private.owner (code) values ('CHANGE-THIS-OWNER-CODE');

create function public.check_owner_code(p_code text) returns boolean
language sql security definer set search_path = '' as $$
  select exists (
    select 1 from private.owner
    where code = p_code and code <> 'CHANGE-THIS-OWNER-CODE'
  );
$$;

create function private.require_owner(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.check_owner_code(p_code) then
    raise exception 'Wrong owner code';
  end if;
end;
$$;

create function public.set_title(p_code text, p_title text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_code);
  update public.scrapbook_settings set title = p_title where id = 1;
end;
$$;

create function public.update_entry(p_code text, p_id uuid, p_date date, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_code);
  update public.entries set date = p_date, note = p_note where id = p_id;
end;
$$;

create function public.delete_entry(p_code text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_code);
  delete from public.entries where id = p_id;
end;
$$;

revoke all on function private.require_owner(text) from public;
grant execute on function public.check_owner_code(text) to anon;
grant execute on function public.set_title(text, text) to anon;
grant execute on function public.update_entry(text, uuid, date, text) to anon;
grant execute on function public.delete_entry(text, uuid) to anon;
