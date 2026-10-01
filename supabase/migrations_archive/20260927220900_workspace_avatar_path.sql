alter table public.workspaces
add column if not exists avatar_path text;

alter table public.workspaces
  drop constraint if exists workspaces_avatar_path_check;

alter table public.workspaces
  add constraint workspaces_avatar_path_check
  check (
    avatar_path is null
    or avatar_path = id::text || '/logo.webp'
  );

notify pgrst, 'reload schema';
