-- =============================================================================
-- Core App P0.1 — soft-deleted workspace RLS harden
-- order_attachments + payments table policies + legacy order-attachments Storage
--
-- CLASSIFICATION: LOCAL-REVIEWED APPLY SCRIPT
--   Persistent mutations:
--     1) DROP/CREATE of exactly five named table policies (harden wrap).
--     2) Optional DROP of legacy Storage policies ONLY when proven
--        parse/deparse-equivalent to the canonical managed order-attachment
--        expression (redundant duplicate). Non-equivalent → abort, never DROP.
--   Non-mutating: Storage managed/logo verification; helper checks; buckets.
--   Ends with COMMIT. NOT read-only.
--
-- DO NOT EXECUTE until separately authorized after manual review.
-- STATUS: Corrected locally. NOT executed against MAIN or TEST.
--
-- Canonical sources:
--   supabase/migrations/20260929000000_production_baseline.sql
--     (public.is_workspace_member(uuid), public.workspace_member_is_admin(uuid))
--   supabase/manual-sql/order_attachments_storage_policies.sql
--     (four managed order-attachments Storage policies — required)
--   supabase/migrations/20260929000400_workspace_logo_storage_policies.sql
--     (four workspace-logo Storage policies — required; this script verifies,
--      does not DROP/CREATE logo policies)
-- Legacy names order_attachments_storage_{insert,select}: no CREATE POLICY text
-- in repo under those names; compared live against managed canonical expression.
--
-- One transaction (BEGIN…COMMIT). Fail closed. Final verify before COMMIT.
-- =============================================================================

begin;

-- Predictable string-literal rules for the structural scanner / comparisons.
select set_config('standard_conforming_strings', 'on', true);

-- Ensure temp relation "objects" resolves for policy parse (objects.name).
select set_config('search_path', 'pg_temp, public', true);

-- Never trust a session-inherited ownership marker for pg_temp.objects.
-- Only p01_ensure_cmp_objects sets this to '1' after THIS transaction creates
-- its own ON COMMIT DROP temporary table.
select set_config('p01.cmp_objects_owned', '', true);

-- ---------------------------------------------------------------------------
-- Structural SQL expression helpers
-- ---------------------------------------------------------------------------

-- True if position i can start a new SQL token (not mid-identifier).
create or replace function pg_temp.p01_at_token_start(p_expr text, p_i int)
returns boolean
language sql
immutable
as $$
  select case
    when p_i <= 1 then true
    when substr(p_expr, p_i - 1, 1) ~ '[[:alnum:]_$]' then false
    else true
  end;
$$;

-- Skip a quoted token starting at p_i. Returns index after the token, or NULL
-- if the quote is unclosed / not safely parseable (fail closed).
-- Handles: $tag$ (token-start only), E'...' (backslash), U&'...' / U&"..." with
-- optional UESCAPE 'c', ordinary '...' (''), "..." ("").
-- '$' inside unquoted identifiers (e.g. column$1) is NOT a dollar-quote.
-- E / U& prefixes are recognized only at token boundaries.
create or replace function pg_temp.p01_skip_quoted(p_expr text, p_i int)
returns int
language plpgsql
immutable
as $$
declare
  e text := p_expr;
  n int := length(e);
  i int := p_i;
  ch text;
  endtag text;
  j int;
  k int;
  body_start int;
  body_end int;
  is_escape boolean := false;
  is_unicode boolean := false;
  close_ch text;
  esc_ch text;
  uesc_raw text;
begin
  if i < 1 or i > n then
    return null;
  end if;
  ch := substr(e, i, 1);

  -- Dollar-quote: $tag$ ... $tag$ ONLY at a token boundary.
  -- Mid-identifier '$' (column$1) must not be classified as dollar-quote.
  -- A lone '$' / '$1' that does not form a $tag$ opener is not a quote token
  -- (return i). A valid $tag$ opener with no closing tag → NULL (fail closed).
  if ch = '$' then
    if not pg_temp.p01_at_token_start(e, i) then
      return i;
    end if;
    j := i + 1;
    while j <= n and substr(e, j, 1) ~ '[A-Za-z0-9_]' loop
      j := j + 1;
    end loop;
    if j > n or substr(e, j, 1) is distinct from '$' then
      return i; -- not a $tag$ opener
    end if;
    endtag := substr(e, i, j - i + 1);
    j := j + 1;
    while j <= n loop
      if substr(e, j, length(endtag)) = endtag then
        return j + length(endtag);
      end if;
      j := j + 1;
    end loop;
    return null; -- unclosed dollar-quote
  end if;

  -- E'...' / e'...' only at token start
  if ch in ('E', 'e')
     and i < n
     and substr(e, i + 1, 1) = ''''
     and pg_temp.p01_at_token_start(e, i) then
    is_escape := true;
    i := i + 2;
    close_ch := '''';
  -- U&'...' / u&'...' unicode string at token start
  elsif ch in ('U', 'u')
        and i + 2 <= n
        and substr(e, i + 1, 2) = '&'''
        and pg_temp.p01_at_token_start(e, i) then
    is_unicode := true;
    i := i + 3;
    close_ch := '''';
  -- U&"..." / u&"..." unicode identifier at token start
  elsif ch in ('U', 'u')
        and i + 2 <= n
        and substr(e, i + 1, 2) = '&"'
        and pg_temp.p01_at_token_start(e, i) then
    is_unicode := true;
    i := i + 3;
    close_ch := '"';
  -- Ordinary '...'
  elsif ch = '''' then
    i := i + 1;
    close_ch := '''';
  -- Ordinary "..."
  elsif ch = '"' then
    i := i + 1;
    close_ch := '"';
  else
    return i; -- not a quote start
  end if;

  -- U& literals: find closer via doubled-quotes only (escape char is known only
  -- after an optional UESCAPE clause). Then validate body with the active escape
  -- character ('\' by default, or the UESCAPE character when present).
  if is_unicode then
    body_start := i;
    while i <= n loop
      ch := substr(e, i, 1);
      if ch = close_ch then
        if i < n and substr(e, i + 1, 1) = close_ch then
          i := i + 2;
        else
          body_end := i;
          i := i + 1; -- after closing quote
          exit;
        end if;
      else
        i := i + 1;
      end if;
    end loop;
    if body_end is null then
      return null; -- unclosed U&
    end if;

    -- Optional UESCAPE 'c' (ordinary one-character string only; else fail closed).
    esc_ch := '\';
    j := i;
    while j <= n and substr(e, j, 1) ~ '[[:space:]]' loop
      j := j + 1;
    end loop;
    if j + 6 <= n
       and lower(substr(e, j, 7)) = 'uescape'
       and (j + 7 > n or substr(e, j + 7, 1) !~ '[[:alnum:]_$]') then
      j := j + 7;
      while j <= n and substr(e, j, 1) ~ '[[:space:]]' loop
        j := j + 1;
      end loop;
      if j > n or substr(e, j, 1) is distinct from '''' then
        return null; -- unsupported / malformed UESCAPE form
      end if;
      j := j + 1;
      if j > n then
        return null;
      end if;
      if substr(e, j, 1) = '''' then
        return null; -- empty UESCAPE character
      end if;
      -- Single character, then closer. Doubled quote would be two chars — reject
      -- (UESCAPE must name exactly one character).
      uesc_raw := substr(e, j, 1);
      j := j + 1;
      if j > n or substr(e, j, 1) is distinct from '''' then
        return null;
      end if;
      j := j + 1;
      -- PostgreSQL forbids hex digits, '+', quotes, and whitespace as UESCAPE.
      if uesc_raw ~ '[0-9A-Fa-f+[:space:]''"]' then
        return null;
      end if;
      esc_ch := uesc_raw;
      i := j; -- consume through UESCAPE clause
    end if;

    -- Validate body escapes with the active escape character only.
    k := body_start;
    while k < body_end loop
      ch := substr(e, k, 1);
      if ch = close_ch then
        if k + 1 < body_end and substr(e, k + 1, 1) = close_ch then
          k := k + 2;
          continue;
        end if;
        return null;
      end if;
      if ch = esc_ch then
        if k + 1 >= body_end then
          return null; -- dangling escape
        end if;
        if substr(e, k + 1, 1) = esc_ch then
          k := k + 2;
          continue;
        elsif substr(e, k + 1, 1) = '+' then
          if k + 7 >= body_end then
            return null;
          end if;
          if substr(e, k + 2, 6) !~ '^[0-9A-Fa-f]{6}$' then
            return null;
          end if;
          k := k + 8;
          continue;
        else
          if k + 4 >= body_end then
            return null;
          end if;
          if substr(e, k + 1, 4) !~ '^[0-9A-Fa-f]{4}$' then
            return null;
          end if;
          k := k + 5;
          continue;
        end if;
      end if;
      k := k + 1;
    end loop;

    return i;
  end if;

  -- Ordinary / E-string: scan quoted body until matching closer
  while i <= n loop
    ch := substr(e, i, 1);

    if is_escape and ch = '\' then
      if i >= n then
        return null; -- dangling backslash
      end if;
      i := i + 2;
      continue;
    end if;

    if ch = close_ch then
      if i < n and substr(e, i + 1, 1) = close_ch then
        i := i + 2; -- doubled quote
      else
        return i + 1;
      end if;
    else
      i := i + 1;
    end if;
  end loop;

  return null; -- unclosed
end;
$$;

-- Skip a PostgreSQL block comment starting at p_i ('/*'). Supports nesting:
--   /* outer /* nested */ outer continues */
-- Returns index after the closing '*/' at depth 0, or NULL if unclosed.
create or replace function pg_temp.p01_skip_block_comment(p_expr text, p_i int)
returns int
language plpgsql
immutable
as $$
declare
  e text := p_expr;
  n int := length(e);
  i int := p_i;
  depth int := 0;
begin
  if i < 1 or i >= n or substr(e, i, 2) is distinct from '/*' then
    return null;
  end if;

  depth := 1;
  i := i + 2;

  while i <= n loop
    if i < n and substr(e, i, 2) = '/*' then
      depth := depth + 1;
      i := i + 2;
      continue;
    end if;
    if i < n and substr(e, i, 2) = '*/' then
      depth := depth - 1;
      i := i + 2;
      if depth = 0 then
        return i;
      end if;
      continue;
    end if;
    i := i + 1;
  end loop;

  return null; -- unclosed nested/outer block comment
end;
$$;

-- Matching ')' for '(' at open_pos (1-based). Skips strings/identifiers/dollar quotes.
create or replace function pg_temp.p01_matching_paren(p_expr text, p_open int)
returns int
language plpgsql
immutable
as $$
declare
  e text := p_expr;
  n int := length(e);
  i int;
  depth int := 0;
  ch text;
  skipped int;
begin
  if p_open is null or p_open < 1 or p_open > n or substr(e, p_open, 1) is distinct from '(' then
    return null;
  end if;

  i := p_open;
  while i <= n loop
    ch := substr(e, i, 1);

    -- SQL comments (fail closed on unclosed block comment).
    if ch = '-' and i < n and substr(e, i + 1, 1) = '-' then
      i := i + 2;
      while i <= n and substr(e, i, 1) is distinct from E'\n' loop
        i := i + 1;
      end loop;
      continue;
    end if;
    if ch = '/' and i < n and substr(e, i + 1, 1) = '*' then
      skipped := pg_temp.p01_skip_block_comment(e, i);
      if skipped is null then
        return null; -- unclosed /* ... */ (including nested)
      end if;
      i := skipped;
      continue;
    end if;

    -- '$' only via skip_quoted when at token start (column$1 must not enter).
    if (
         ch = '$'
         and pg_temp.p01_at_token_start(e, i)
       )
       or ch in ('''', '"')
       or (
         ch in ('E', 'e')
         and i < n
         and substr(e, i + 1, 1) = ''''
         and pg_temp.p01_at_token_start(e, i)
       )
       or (
         ch in ('U', 'u')
         and i + 2 <= n
         and substr(e, i + 1, 1) = '&'
         and substr(e, i + 2, 1) in ('''', '"')
         and pg_temp.p01_at_token_start(e, i)
       ) then
      skipped := pg_temp.p01_skip_quoted(e, i);
      if skipped is null then
        return null; -- unclosed / unsafe quote → fail closed
      end if;
      if skipped = i then
        null;
      else
        i := skipped;
        continue;
      end if;
    end if;

    ch := substr(e, i, 1);
    if ch = '(' then
      depth := depth + 1;
    elsif ch = ')' then
      depth := depth - 1;
      if depth = 0 then
        return i;
      end if;
    end if;
    i := i + 1;
  end loop;

  return null;
end;
$$;

-- Skip leading whitespace; return new index.
create or replace function pg_temp.p01_skip_ws(p_expr text, p_i int)
returns int
language sql
immutable
as $$
  select coalesce(
    (select min(g)
     from generate_series(p_i, length(p_expr)) g
     where substr(p_expr, g, 1) !~ '\s'),
    length(p_expr) + 1
  );
$$;

-- Strip redundant outer parentheses that wrap the *entire* expression only.
-- Does not strip from "(a) AND (b)" (matching close is not at end).
create or replace function pg_temp.p01_strip_outer_parens(p_expr text)
returns text
language plpgsql
immutable
as $$
declare
  e text := trim(p_expr);
  open_pos int;
  close_pos int;
begin
  loop
    if e is null or e = '' then
      return e;
    end if;
    open_pos := pg_temp.p01_skip_ws(e, 1);
    if open_pos > length(e) or substr(e, open_pos, 1) is distinct from '(' then
      return trim(e);
    end if;
    close_pos := pg_temp.p01_matching_paren(e, open_pos);
    if close_pos is null then
      return trim(e);
    end if;
    if pg_temp.p01_skip_ws(e, close_pos + 1) <= length(e) then
      -- trailing tokens after the matching ')' → not a full wrap
      return trim(e);
    end if;
    e := trim(substr(e, open_pos + 1, close_pos - open_pos - 1));
  end loop;
end;
$$;

-- Match [public.]is_workspace_member ( workspace_id ) from index; return index after call, or null.
create or replace function pg_temp.p01_match_helper_call_from(p_expr text, p_i int)
returns int
language plpgsql
immutable
as $$
declare
  e text := p_expr;
  n int := length(e);
  i int := pg_temp.p01_skip_ws(e, p_i);
begin
  if lower(substr(e, i, 6)) = 'public' and (i + 6 > n or substr(e, i + 6, 1) !~ '[[:alnum:]_]') then
    i := pg_temp.p01_skip_ws(e, i + 6);
    if i > n or substr(e, i, 1) is distinct from '.' then
      return null;
    end if;
    i := pg_temp.p01_skip_ws(e, i + 1);
  end if;

  if lower(substr(e, i, 19)) is distinct from 'is_workspace_member' then
    return null;
  end if;
  if i + 19 <= n and substr(e, i + 19, 1) ~ '[[:alnum:]_]' then
    return null;
  end if;
  i := pg_temp.p01_skip_ws(e, i + 19);

  if i > n or substr(e, i, 1) is distinct from '(' then
    return null;
  end if;
  i := pg_temp.p01_skip_ws(e, i + 1);

  if substr(e, i, 1) = '"' then
    if substr(e, i, 14) is distinct from '"workspace_id"' then
      return null;
    end if;
    i := i + 14;
  else
    if lower(substr(e, i, 12)) is distinct from 'workspace_id' then
      return null;
    end if;
    if i + 12 <= n and substr(e, i + 12, 1) ~ '[[:alnum:]_]' then
      return null;
    end if;
    i := i + 12;
  end if;

  i := pg_temp.p01_skip_ws(e, i);
  if i > n or substr(e, i, 1) is distinct from ')' then
    return null;
  end if;
  return pg_temp.p01_skip_ws(e, i + 1);
end;
$$;

create or replace function pg_temp.p01_is_helper_call_only(p_expr text)
returns boolean
language plpgsql
immutable
as $$
declare
  e text := trim(p_expr);
  after int;
begin
  after := pg_temp.p01_match_helper_call_from(e, 1);
  return after is not null and after > length(e);
end;
$$;

-- True iff from p_i: AND [ (] [public.]is_workspace_member(workspace_id) [) ]
-- with nothing but trailing whitespace afterward.
create or replace function pg_temp.p01_is_top_level_helper_and(p_expr text, p_i int)
returns boolean
language plpgsql
immutable
as $$
declare
  e text := p_expr;
  n int := length(e);
  i int := pg_temp.p01_skip_ws(e, p_i);
  close_pos int;
  after int;
begin
  if i > n then
    return false;
  end if;

  if upper(substr(e, i, 3)) is distinct from 'AND' then
    return false;
  end if;
  if i + 3 <= n and substr(e, i + 3, 1) ~ '[[:alnum:]_]' then
    return false;
  end if;
  i := pg_temp.p01_skip_ws(e, i + 3);

  -- Optional outer parens around the helper call only.
  if substr(e, i, 1) = '(' then
    close_pos := pg_temp.p01_matching_paren(e, i);
    if close_pos is null then
      return false;
    end if;
    if not pg_temp.p01_is_helper_call_only(trim(substr(e, i + 1, close_pos - i - 1))) then
      return false;
    end if;
    return pg_temp.p01_skip_ws(e, close_pos + 1) > n;
  end if;

  after := pg_temp.p01_match_helper_call_from(e, i);
  return after is not null and after > n;
end;
$$;

-- Structurally: ( <balanced original> ) AND [public.]is_workspace_member(workspace_id)
-- Rejects e.g. (a) OR (true) AND is_workspace_member(workspace_id)
create or replace function pg_temp.p01_is_hardened_shape(p_expr text)
returns boolean
language plpgsql
immutable
as $$
declare
  e text := pg_temp.p01_strip_outer_parens(p_expr);
  open_pos int;
  close_pos int;
begin
  if e is null or e = '' then
    return false;
  end if;

  open_pos := pg_temp.p01_skip_ws(e, 1);
  if open_pos > length(e) or substr(e, open_pos, 1) is distinct from '(' then
    return false;
  end if;

  close_pos := pg_temp.p01_matching_paren(e, open_pos);
  if close_pos is null then
    return false;
  end if;

  if trim(substr(e, open_pos + 1, close_pos - open_pos - 1)) = '' then
    return false;
  end if;

  return pg_temp.p01_is_top_level_helper_and(e, close_pos + 1);
end;
$$;

-- Peel only when structural harden shape is proven. Returns the original
-- interior expression (never peels a non-proven shape).
create or replace function pg_temp.p01_peel_harden(p_expr text)
returns text
language plpgsql
immutable
as $$
declare
  e text;
  open_pos int;
  close_pos int;
begin
  if not pg_temp.p01_is_hardened_shape(p_expr) then
    raise exception
      'p01_peel_harden: refused — expression is not a proven harden shape';
  end if;

  e := pg_temp.p01_strip_outer_parens(p_expr);
  open_pos := pg_temp.p01_skip_ws(e, 1);
  close_pos := pg_temp.p01_matching_paren(e, open_pos);
  if close_pos is null
     or not pg_temp.p01_is_top_level_helper_and(e, close_pos + 1) then
    raise exception
      'p01_peel_harden: refused — structural peel preconditions failed';
  end if;
  return trim(substr(e, open_pos + 1, close_pos - open_pos - 1));
end;
$$;

create or replace function pg_temp.p01_apply_harden(p_expr text)
returns text
language plpgsql
immutable
as $$
declare
  base text;
begin
  if pg_temp.p01_is_hardened_shape(p_expr) then
    base := pg_temp.p01_peel_harden(p_expr);
  else
    base := coalesce(p_expr, '');
  end if;
  if trim(base) = '' then
    raise exception 'p01_apply_harden: empty base expression';
  end if;
  return '(' || base || ') AND public.is_workspace_member(workspace_id)';
end;
$$;

create or replace function pg_temp.p01_format_policy_roles(p_roles name[])
returns text
language plpgsql
as $$
declare
  roles_sql text;
begin
  if p_roles is null or coalesce(array_length(p_roles, 1), 0) = 0 then
    raise exception 'p01_format_policy_roles: empty roles[]';
  end if;

  select string_agg(
           case
             when r.rolename = 'public' then 'public'
             else quote_ident(r.rolename)
           end,
           ', '
           order by r.ord
         )
    into roles_sql
  from unnest(p_roles) with ordinality as r(rolename, ord);

  if roles_sql is null or roles_sql = '' then
    raise exception 'p01_format_policy_roles: failed to format roles %', p_roles;
  end if;

  return roles_sql;
end;
$$;

-- Normalize SQL source for helper prosrc comparison: collapse whitespace and
-- strip comments ONLY outside string/identifier/dollar-quote literals.
-- Never alters bytes inside '...' / E'...' / U&'...' / "..." / $tag$.
-- Returns NULL if the source cannot be safely scanned (fail closed).
create or replace function pg_temp.p01_norm_sql_src(p text)
returns text
language plpgsql
immutable
as $$
declare
  e text := coalesce(p, '');
  n int := length(e);
  i int := 1;
  ch text;
  out_txt text := '';
  skipped int;
  pending_ws boolean := false;
begin
  while i <= n loop
    ch := substr(e, i, 1);

    if ch = '-' and i < n and substr(e, i + 1, 1) = '-' then
      i := i + 2;
      while i <= n and substr(e, i, 1) is distinct from E'\n' loop
        i := i + 1;
      end loop;
      pending_ws := true;
      continue;
    end if;

    if ch = '/' and i < n and substr(e, i + 1, 1) = '*' then
      skipped := pg_temp.p01_skip_block_comment(e, i);
      if skipped is null then
        return null; -- unclosed /* ... */ (including nested)
      end if;
      i := skipped;
      pending_ws := true;
      continue;
    end if;

    if (
         ch = '$'
         and pg_temp.p01_at_token_start(e, i)
       )
       or ch in ('''', '"')
       or (
         ch in ('E', 'e')
         and i < n
         and substr(e, i + 1, 1) = ''''
         and pg_temp.p01_at_token_start(e, i)
       )
       or (
         ch in ('U', 'u')
         and i + 2 <= n
         and substr(e, i + 1, 1) = '&'
         and substr(e, i + 2, 1) in ('''', '"')
         and pg_temp.p01_at_token_start(e, i)
       ) then
      skipped := pg_temp.p01_skip_quoted(e, i);
      if skipped is null then
        return null;
      end if;
      if skipped > i then
        if pending_ws and out_txt <> '' then
          out_txt := out_txt || ' ';
        end if;
        pending_ws := false;
        out_txt := out_txt || substr(e, i, skipped - i);
        i := skipped;
        continue;
      end if;
    end if;

    if ch ~ '[[:space:]]' then
      pending_ws := true;
      i := i + 1;
      continue;
    end if;

    if pending_ws and out_txt <> '' then
      out_txt := out_txt || ' ';
    end if;
    pending_ws := false;
    out_txt := out_txt || ch;
    i := i + 1;
  end loop;

  return out_txt;
end;
$$;

-- ---------------------------------------------------------------------------
-- Canonical expressions (verbatim from local source files)
-- ---------------------------------------------------------------------------

-- Body of public.is_workspace_member(uuid) from
-- supabase/migrations/20260929000000_production_baseline.sql
-- (prosrc only; attributes checked separately against pg_proc).
create or replace function pg_temp.p01_canon_is_workspace_member_prosrc()
returns text
language sql
immutable
as $$
  select $body$
    select exists (
        select 1
        from public.workspace_members wm
        join public.workspaces w
          on w.id = wm.workspace_id
        where wm.workspace_id = target_workspace_id
          and wm.user_id = (select auth.uid())
          and wm.deleted_at is null
          and w.deleted_at is null
    );
$body$;
$$;

-- Body of public.workspace_member_is_admin(uuid) from
-- supabase/migrations/20260929000000_production_baseline.sql
create or replace function pg_temp.p01_canon_workspace_member_is_admin_prosrc()
returns text
language sql
immutable
as $$
  select $body$
    select exists (
        select 1
        from public.workspace_members wm
        join public.workspaces w
          on w.id = wm.workspace_id
        where wm.workspace_id = p_workspace_id
          and wm.user_id = (select auth.uid())
          and wm.role::text in ('owner', 'admin')
          and wm.deleted_at is null
          and w.deleted_at is null
    );
$body$;
$$;

-- From supabase/manual-sql/order_attachments_storage_policies.sql
-- (USING / WITH CHECK body identical for all four managed policies)
create or replace function pg_temp.p01_canon_order_attachment()
returns text
language sql
immutable
as $$
  select $canon$
    bucket_id = 'order-attachments'
    and exists (
      select 1
      from public.orders o
      where o.id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 2)::uuid
          end
        )
        and o.workspace_id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 1)::uuid
          end
        )
        and public.is_workspace_member(o.workspace_id)
    )
  $canon$;
$$;

-- From supabase/migrations/20260929000400_workspace_logo_storage_policies.sql
create or replace function pg_temp.p01_canon_logo_member()
returns text
language sql
immutable
as $$
  select $canon$
    bucket_id = 'workspace'
    and public.is_workspace_member(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.webp$'
        then split_part(name, '/', 1)::uuid
      end
    )
  $canon$;
$$;

create or replace function pg_temp.p01_canon_logo_admin()
returns text
language sql
immutable
as $$
  select $canon$
    bucket_id = 'workspace'
    and public.workspace_member_is_admin(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.webp$'
        then split_part(name, '/', 1)::uuid
      end
    )
  $canon$;
$$;

-- ---------------------------------------------------------------------------
-- Parse→store→deparse comparison via temp table "objects"
-- (name must be "objects" so canonical expressions referencing objects.name
-- resolve against the comparison relation under search_path pg_temp, public)
-- ---------------------------------------------------------------------------

create or replace function pg_temp.p01_ensure_cmp_objects()
returns void
language plpgsql
as $$
declare
  rel oid;
  relkind "char";
  nsp name;
  col_count int;
  rls_on boolean;
  owned text;
begin
  -- Lifecycle: only create ON COMMIT DROP ourselves. Never DROP an unknown
  -- pre-existing session temp table. Never adopt a pre-existing one (it may
  -- use ON COMMIT PRESERVE ROWS and survive after this script commits).
  -- Ownership marker is cleared at transaction start; '1' is set only below
  -- after THIS script creates the table. Do not trust a pre-session GUC.
  owned := current_setting('p01.cmp_objects_owned', true);
  rel := to_regclass('pg_temp.objects');

  if rel is null then
    execute $c$
      create temporary table objects (
        bucket_id text,
        name text
      ) on commit drop
    $c$;
    execute 'alter table objects enable row level security';
    -- Marker set ONLY after successful create by this transaction.
    perform set_config('p01.cmp_objects_owned', '1', true);
    rel := to_regclass('pg_temp.objects');
  elsif owned is distinct from '1' then
    raise exception
      'p01_ensure_cmp_objects: pg_temp.objects already exists but was not created by this transaction (owned=%). Refuse to reuse or DROP a pre-existing session temp table (ON COMMIT lifecycle unknown). Abort.',
      owned;
  end if;

  if rel is null then
    raise exception 'p01_ensure_cmp_objects: failed to resolve pg_temp.objects';
  end if;

  select c.relkind, n.nspname, c.relrowsecurity
    into relkind, nsp, rls_on
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.oid = rel;

  if nsp is null or nsp not like 'pg_temp%' then
    raise exception
      'p01_ensure_cmp_objects: relation "objects" is not in a temporary schema (nsp=%) — refuse',
      nsp;
  end if;

  if relkind is distinct from 'r' then
    raise exception
      'p01_ensure_cmp_objects: expected ordinary table (relkind=r), got % — refuse',
      relkind;
  end if;

  select count(*)::int
    into col_count
  from pg_attribute a
  where a.attrelid = rel
    and a.attnum > 0
    and not a.attisdropped;

  if col_count is distinct from 2 then
    raise exception
      'p01_ensure_cmp_objects: expected exactly columns (bucket_id text, name text); found % columns — refuse',
      col_count;
  end if;

  if not exists (
    select 1
    from pg_attribute a
    where a.attrelid = rel
      and a.attnum > 0
      and not a.attisdropped
      and a.attname = 'bucket_id'
      and a.atttypid = 'text'::regtype
  ) then
    raise exception
      'p01_ensure_cmp_objects: column bucket_id text missing or wrong type — refuse';
  end if;

  if not exists (
    select 1
    from pg_attribute a
    where a.attrelid = rel
      and a.attnum > 0
      and not a.attisdropped
      and a.attname = 'name'
      and a.atttypid = 'text'::regtype
  ) then
    raise exception
      'p01_ensure_cmp_objects: column name text missing or wrong type — refuse';
  end if;

  if rls_on is distinct from true then
    raise exception
      'p01_ensure_cmp_objects: RLS is not enabled on pg_temp.objects — refuse';
  end if;
end;
$$;

-- Both required Storage buckets must exist and be strictly private.
-- public IS NULL fails (not treated as private). Never modifies storage.buckets.
-- FOR SHARE locks the row for the remainder of this transaction; it does not
-- claim to prevent all concurrent DDL outside normal MVCC/lock rules.
create or replace function pg_temp.p01_assert_private_buckets(p_phase text)
returns void
language plpgsql
as $$
declare
  bid text;
  is_pub boolean;
begin
  foreach bid in array array['order-attachments'::text, 'workspace'::text]
  loop
    begin
      select b.public
        into strict is_pub
      from storage.buckets b
      where b.id = bid
      for share nowait;
    exception
      when no_data_found then
        raise exception
          '%: storage.buckets id=% is missing — abort (do not auto-create)',
          p_phase, bid;
      when too_many_rows then
        raise exception
          '%: storage.buckets id=% matched multiple rows — abort',
          p_phase, bid;
      when lock_not_available then
        raise exception
          '%: could not lock storage.buckets id=% — abort',
          p_phase, bid;
    end;

    if is_pub is distinct from false then
      raise exception
        '%: storage.buckets id=% public=% (must be IS FALSE; NULL is not accepted) — abort (do not auto-repair)',
        p_phase, bid, is_pub;
    end if;
  end loop;
end;
$$;

-- Parse→store→deparse a boolean expression against the REAL target table.
-- A workspace_id-only temp stub is insufficient: live policies may reference
-- other columns. Comparison policies are created with unique names inside this
-- transaction and dropped before return; uncommitted DDL is not visible to
-- other sessions. Fails closed if PostgreSQL rejects the expression.
create or replace function pg_temp.p01_deparse_bool_expr(
  p_schema name,
  p_table name,
  p_cmd text,
  p_expr text
)
returns text
language plpgsql
as $$
declare
  pname text := 'p01_b_' || replace(gen_random_uuid()::text, '-', '');
  q text;
  create_sql text;
begin
  if coalesce(trim(p_expr), '') = '' then
    raise exception 'p01_deparse_bool_expr: empty expression';
  end if;

  if to_regclass(format('%I.%I', p_schema, p_table)) is null then
    raise exception
      'p01_deparse_bool_expr: relation %.% missing — cannot prove preservation',
      p_schema, p_table;
  end if;

  if p_cmd in ('SELECT', 'DELETE') then
    create_sql := format(
      'create policy %I on %I.%I as permissive for %s to authenticated using (%s)',
      pname, p_schema, p_table, lower(p_cmd), p_expr
    );
  elsif p_cmd = 'INSERT' then
    create_sql := format(
      'create policy %I on %I.%I as permissive for insert to authenticated with check (%s)',
      pname, p_schema, p_table, p_expr
    );
  else
    raise exception 'p01_deparse_bool_expr: unsupported cmd %', p_cmd;
  end if;

  begin
    execute create_sql;
  exception
    when others then
      raise exception
        'p01_deparse_bool_expr: PostgreSQL rejected expression on %.% (cannot prove preservation): % — expr=%',
        p_schema, p_table, sqlerrm, p_expr;
  end;

  if p_cmd in ('SELECT', 'DELETE') then
    select p.qual into q
    from pg_policies p
    where p.schemaname = p_schema
      and p.tablename = p_table
      and p.policyname = pname;
  else
    select p.with_check into q
    from pg_policies p
    where p.schemaname = p_schema
      and p.tablename = p_table
      and p.policyname = pname;
  end if;

  begin
    execute format('drop policy if exists %I on %I.%I', pname, p_schema, p_table);
  exception
    when others then
      raise exception
        'p01_deparse_bool_expr: failed to drop temporary comparison policy % on %.%: %',
        pname, p_schema, p_table, sqlerrm;
  end;

  if q is null then
    raise exception
      'p01_deparse_bool_expr: failed to read back deparsed expression for %.%.%',
      p_schema, p_table, pname;
  end if;

  return q;
end;
$$;

create or replace function pg_temp.p01_bool_exprs_equiv(
  p_schema name,
  p_table name,
  p_cmd text,
  p_a text,
  p_b text
)
returns boolean
language plpgsql
as $$
declare
  da text;
  db text;
begin
  -- Both sides are PostgreSQL-deparsed via CREATE POLICY readback. Compare the
  -- deparsed texts exactly — never whitespace-normalize (would alter literals).
  da := pg_temp.p01_deparse_bool_expr(p_schema, p_table, p_cmd, p_a);
  db := pg_temp.p01_deparse_bool_expr(p_schema, p_table, p_cmd, p_b);
  return da is not distinct from db;
end;
$$;

-- Create a temp policy from source expressions; return PG-deparsed qual/with_check.
create or replace function pg_temp.p01_deparse_policy(
  p_cmd text,
  p_using text,
  p_check text
)
returns table(qual text, with_check text)
language plpgsql
as $$
declare
  pname text := 'p01_cmp_' || replace(gen_random_uuid()::text, '-', '');
  sql text;
  q text;
  c text;
begin
  perform pg_temp.p01_ensure_cmp_objects();

  sql := format(
    'create policy %I on objects as permissive for %s to authenticated',
    pname,
    lower(p_cmd)
  );

  if p_cmd in ('SELECT', 'DELETE') then
    if coalesce(p_using, '') = '' or coalesce(p_check, '') <> '' then
      raise exception 'p01_deparse_policy: % requires USING only', p_cmd;
    end if;
    sql := sql || format(' using (%s)', p_using);
  elsif p_cmd = 'INSERT' then
    if coalesce(p_check, '') = '' or coalesce(p_using, '') <> '' then
      raise exception 'p01_deparse_policy: INSERT requires WITH CHECK only';
    end if;
    sql := sql || format(' with check (%s)', p_check);
  elsif p_cmd = 'UPDATE' then
    if coalesce(p_using, '') = '' or coalesce(p_check, '') = '' then
      raise exception 'p01_deparse_policy: UPDATE requires USING and WITH CHECK';
    end if;
    sql := sql || format(' using (%s) with check (%s)', p_using, p_check);
  else
    raise exception 'p01_deparse_policy: unsupported cmd %', p_cmd;
  end if;

  execute sql;

  select p.qual, p.with_check
    into q, c
  from pg_policies p
  where p.tablename = 'objects'
    and p.policyname = pname
    and p.schemaname like 'pg_temp%';

  if not found then
    raise exception 'p01_deparse_policy: failed to read back policy %', pname;
  end if;

  execute format('drop policy if exists %I on objects', pname);

  qual := q;
  with_check := c;
  return next;
end;
$$;

-- Compare canonical source SQL to live pg_policies text by running both through
-- the same parse→store→deparse path on pg_temp.objects.
create or replace function pg_temp.p01_live_equiv_canon(
  p_cmd text,
  p_canon text,
  p_live_qual text,
  p_live_check text
)
returns boolean
language plpgsql
as $$
declare
  canon record;
  live record;
  cu text;
  cc text;
  lu text;
  lc text;
begin
  if p_cmd = 'SELECT' or p_cmd = 'DELETE' then
    cu := p_canon; cc := null;
    lu := p_live_qual; lc := null;
    if coalesce(p_live_check, '') <> '' then
      return false;
    end if;
  elsif p_cmd = 'INSERT' then
    cu := null; cc := p_canon;
    lu := null; lc := p_live_check;
    if coalesce(p_live_qual, '') <> '' then
      return false;
    end if;
  elsif p_cmd = 'UPDATE' then
    cu := p_canon; cc := p_canon;
    lu := p_live_qual; lc := p_live_check;
  else
    raise exception 'p01_live_equiv_canon: bad cmd %', p_cmd;
  end if;

  begin
    select * into canon from pg_temp.p01_deparse_policy(p_cmd, cu, cc);
    select * into live from pg_temp.p01_deparse_policy(p_cmd, lu, lc);
  exception
    when others then
      raise exception
        'Storage equivalence: parse/deparse failed (cmd=%): % — abort; inspect MAIN definitions manually',
        p_cmd, sqlerrm;
  end;

  -- Exact parse/deparse equality of PG catalog readbacks. Do not normalize
  -- whitespace (literals / quoted identifiers must remain byte-identical).
  return coalesce(canon.qual, '') is not distinct from coalesce(live.qual, '')
     and coalesce(canon.with_check, '')
           is not distinct from coalesce(live.with_check, '');
end;
$$;

create or replace function pg_temp.p01_storage_managed_equiv(
  p_policy name,
  p_expected_cmd text
)
returns void
language plpgsql
as $$
declare
  r record;
  ok boolean;
begin
  select * into r
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = p_policy;

  if not found then
    raise exception
      'Storage: managed policy % missing — abort (no legacy drop)',
      p_policy;
  end if;

  if r.schemaname is distinct from 'storage'
     or r.tablename is distinct from 'objects' then
    raise exception
      'Storage: managed % target %.% — expected storage.objects — abort',
      p_policy, r.schemaname, r.tablename;
  end if;

  if r.cmd is distinct from p_expected_cmd
     or r.permissive is distinct from 'PERMISSIVE'
     or not (r.roles @> array['authenticated']::name[]
             and array['authenticated']::name[] @> r.roles
             and coalesce(array_length(r.roles, 1), 0) = 1) then
    raise exception
      'Storage: % metadata mismatch cmd=% permissive=% roles=% — abort',
      p_policy, r.cmd, r.permissive, r.roles;
  end if;

  if p_expected_cmd in ('SELECT', 'DELETE') then
    if coalesce(r.qual, '') = '' or coalesce(r.with_check, '') <> '' then
      raise exception
        'Storage: managed % % must have USING only — abort',
        p_policy, p_expected_cmd;
    end if;
  elsif p_expected_cmd = 'INSERT' then
    if coalesce(r.with_check, '') = '' or coalesce(r.qual, '') <> '' then
      raise exception
        'Storage: managed % INSERT must have WITH CHECK only — abort',
        p_policy;
    end if;
  elsif p_expected_cmd = 'UPDATE' then
    if coalesce(r.qual, '') = '' or coalesce(r.with_check, '') = '' then
      raise exception
        'Storage: managed % UPDATE must have USING and WITH CHECK — abort',
        p_policy;
    end if;
  end if;

  ok := pg_temp.p01_live_equiv_canon(
    p_expected_cmd,
    pg_temp.p01_canon_order_attachment(),
    r.qual,
    r.with_check
  );

  if not ok then
    raise exception
      'Storage: % is not parse/deparse-equivalent to canonical body from order_attachments_storage_policies.sql — abort for manual MAIN inspection (refuse legacy drop). live USING=% | live CHECK=%',
      p_policy, coalesce(r.qual, ''), coalesce(r.with_check, '');
  end if;
end;
$$;

-- Legacy Storage names (no CREATE POLICY text under these names in the repo).
-- Safe handling:
--   A) If live policy is fully equivalent (cmd/roles/permissive/USING/WITH CHECK
--      via parse→store→deparse) to the canonical managed order-attachment body
--      for the mapped command, DROP it as a verified redundant duplicate.
--   B/C) Otherwise abort with complete live definition — never DROP unknown.
-- Mapped commands: *_select → SELECT, *_insert → INSERT only.
create or replace function pg_temp.p01_resolve_legacy_storage_policies(p_phase text)
returns void
language plpgsql
as $$
declare
  r record;
  expected_cmd text;
  dump text;
  ok boolean;
begin
  for r in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'order_attachments_storage_insert',
        'order_attachments_storage_select'
      )
    order by policyname, cmd
  loop
    dump := format(
      'name=%s schema=%s table=%s cmd=%s permissive=%s roles=%s USING=%s WITH_CHECK=%s',
      r.policyname, r.schemaname, r.tablename, r.cmd, r.permissive,
      r.roles, coalesce(r.qual, '<null>'), coalesce(r.with_check, '<null>')
    );

    if r.policyname = 'order_attachments_storage_select' then
      expected_cmd := 'SELECT';
    elsif r.policyname = 'order_attachments_storage_insert' then
      expected_cmd := 'INSERT';
    else
      raise exception
        '%: unexpected legacy policy name % — abort. %',
        p_phase, r.policyname, dump;
    end if;

    if r.schemaname is distinct from 'storage'
       or r.tablename is distinct from 'objects' then
      raise exception
        '%: legacy % not on storage.objects — refuse DROP. %',
        p_phase, r.policyname, dump;
    end if;

    if r.cmd is distinct from expected_cmd then
      raise exception
        '%: legacy % cmd=% expected % for this name — not proven equivalent; refuse DROP. %',
        p_phase, r.policyname, r.cmd, expected_cmd, dump;
    end if;

    if r.permissive is distinct from 'PERMISSIVE' then
      raise exception
        '%: legacy % is % — refuse DROP of non-PERMISSIVE. %',
        p_phase, r.policyname, r.permissive, dump;
    end if;

    if not (r.roles @> array['authenticated']::name[]
            and array['authenticated']::name[] @> r.roles
            and coalesce(array_length(r.roles, 1), 0) = 1) then
      raise exception
        '%: legacy % roles=% expected exactly {authenticated} — refuse DROP. %',
        p_phase, r.policyname, r.roles, dump;
    end if;

    if expected_cmd = 'SELECT' then
      if coalesce(r.qual, '') = '' or coalesce(r.with_check, '') <> '' then
        raise exception
          '%: legacy % SELECT must have USING only — refuse DROP. %',
          p_phase, r.policyname, dump;
      end if;
    else
      if coalesce(r.with_check, '') = '' or coalesce(r.qual, '') <> '' then
        raise exception
          '%: legacy % INSERT must have WITH CHECK only — refuse DROP. %',
          p_phase, r.policyname, dump;
      end if;
    end if;

    begin
      ok := pg_temp.p01_live_equiv_canon(
        expected_cmd,
        pg_temp.p01_canon_order_attachment(),
        r.qual,
        r.with_check
      );
    exception
      when others then
        raise exception
          '%: cannot reliably compare legacy % to canonical managed expression (%). Refuse DROP. %',
          p_phase, r.policyname, sqlerrm, dump;
    end;

    if not ok then
      raise exception
        '%: legacy % is NOT parse/deparse-equivalent to canonical managed order-attachment policy — refuse DROP (may grant different access). %',
        p_phase, r.policyname, dump;
    end if;

    -- Proven redundant duplicate of the managed canonical expression.
    execute format('drop policy if exists %I on storage.objects', r.policyname);
    raise notice
      '%: dropped verified-redundant legacy Storage policy % (equiv to managed canon, cmd=%)',
      p_phase, r.policyname, expected_cmd;
  end loop;
end;
$$;

-- Final/post checks: legacy names must be absent after resolve (fail closed).
create or replace function pg_temp.p01_assert_no_legacy_storage_policies(p_phase text)
returns void
language plpgsql
as $$
declare
  dump text := null;
  r record;
begin
  for r in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'order_attachments_storage_insert',
        'order_attachments_storage_select'
      )
    order by policyname, cmd
  loop
    dump := coalesce(dump || E'\n', '')
      || format(
           'name=%s schema=%s table=%s cmd=%s permissive=%s roles=%s USING=%s WITH_CHECK=%s',
           r.policyname, r.schemaname, r.tablename, r.cmd, r.permissive,
           r.roles, coalesce(r.qual, '<null>'), coalesce(r.with_check, '<null>')
         );
  end loop;

  if dump is not null then
    raise exception
      '%: legacy Storage policy/policies still present after resolve — abort. %',
      p_phase, E'\n' || dump;
  end if;
end;
$$;

create or replace function pg_temp.p01_storage_logo_equiv(
  p_policy name,
  p_expected_cmd text,
  p_admin boolean
)
returns void
language plpgsql
as $$
declare
  r record;
  canon text;
  ok boolean;
begin
  canon := case
    when p_admin then pg_temp.p01_canon_logo_admin()
    else pg_temp.p01_canon_logo_member()
  end;

  select * into r
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = p_policy;

  if not found then
    raise exception
      'Storage: logo policy % missing on storage.objects — abort',
      p_policy;
  end if;

  if r.schemaname is distinct from 'storage'
     or r.tablename is distinct from 'objects' then
    raise exception
      'Storage: logo % target %.% — expected storage.objects — abort',
      p_policy, r.schemaname, r.tablename;
  end if;

  if r.cmd is distinct from p_expected_cmd then
    raise exception
      'Storage: logo % cmd=% expected % — abort',
      p_policy, r.cmd, p_expected_cmd;
  end if;

  if r.permissive is distinct from 'PERMISSIVE' then
    raise exception
      'Storage: logo % permissive=% expected PERMISSIVE — abort',
      p_policy, r.permissive;
  end if;

  if not (r.roles @> array['authenticated']::name[]
          and array['authenticated']::name[] @> r.roles
          and coalesce(array_length(r.roles, 1), 0) = 1) then
    raise exception
      'Storage: logo % roles=% expected exactly {authenticated} — abort',
      p_policy, r.roles;
  end if;

  -- Command-specific USING / WITH CHECK presence (canonical 20260929000400).
  if p_expected_cmd in ('SELECT', 'DELETE') then
    if coalesce(r.qual, '') = '' or coalesce(r.with_check, '') <> '' then
      raise exception
        'Storage: logo % % must have USING only — abort U=% C=%',
        p_policy, p_expected_cmd, coalesce(r.qual, ''), coalesce(r.with_check, '');
    end if;
  elsif p_expected_cmd = 'INSERT' then
    if coalesce(r.with_check, '') = '' or coalesce(r.qual, '') <> '' then
      raise exception
        'Storage: logo % INSERT must have WITH CHECK only — abort U=% C=%',
        p_policy, coalesce(r.qual, ''), coalesce(r.with_check, '');
    end if;
  elsif p_expected_cmd = 'UPDATE' then
    if coalesce(r.qual, '') = '' or coalesce(r.with_check, '') = '' then
      raise exception
        'Storage: logo % UPDATE must have USING and WITH CHECK — abort U=% C=%',
        p_policy, coalesce(r.qual, ''), coalesce(r.with_check, '');
    end if;
  else
    raise exception 'Storage: logo % unsupported expected cmd %', p_policy, p_expected_cmd;
  end if;

  -- Exact parse→store→deparse vs canonical body (bucket + path + helper).
  ok := pg_temp.p01_live_equiv_canon(p_expected_cmd, canon, r.qual, r.with_check);
  if not ok then
    raise exception
      'Storage: logo % not parse/deparse-equivalent to canonical from 20260929000400_workspace_logo_storage_policies.sql — abort. live U=% C=%',
      p_policy, coalesce(r.qual, ''), coalesce(r.with_check, '');
  end if;
end;
$$;

-- Harden one named table policy, proving original expression preservation via
-- parse→store→deparse of the peeled base vs the captured original.
create or replace function pg_temp.p01_harden_member_policy(
  p_schema name,
  p_table name,
  p_policy name,
  p_expected_cmd text
) returns void
language plpgsql
as $$
declare
  r record;
  roles_sql text;
  new_qual text;
  new_check text;
  create_sql text;
  saved_roles name[];
  saved_permissive text;
  saved_cmd text;
  saved_comment text;
  after_roles name[];
  after_permissive text;
  after_cmd text;
  after_qual text;
  after_check text;
  after_comment text;
  policy_oid oid;
  orig_expr text;
  base_before text;
  peeled_after text;
  already boolean;
begin
  select * into r
  from pg_policies
  where schemaname = p_schema
    and tablename = p_table
    and policyname = p_policy;

  if not found then
    raise exception 'Preflight: missing %.%.%', p_schema, p_table, p_policy;
  end if;

  -- Capture existing COMMENT ON POLICY (NULL or non-NULL) via pg_policy OID.
  select pol.oid
    into policy_oid
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = p_schema
    and c.relname = p_table
    and pol.polname = p_policy;

  if policy_oid is null then
    raise exception
      'Preflight: %.%.% pg_policy OID not found — cannot preserve comment — abort',
      p_schema, p_table, p_policy;
  end if;

  saved_comment := obj_description(policy_oid, 'pg_policy');

  if r.cmd is distinct from p_expected_cmd then
    raise exception
      'Preflight: %.%.% cmd=% expected %',
      p_schema, p_table, p_policy, r.cmd, p_expected_cmd;
  end if;

  if r.permissive is distinct from 'PERMISSIVE' then
    raise exception
      'Preflight: %.%.% is % — refuse RESTRICTIVE rewrite',
      p_schema, p_table, p_policy, r.permissive;
  end if;

  if coalesce(array_length(r.roles, 1), 0) = 0 then
    raise exception 'Preflight: %.%.% empty roles', p_schema, p_table, p_policy;
  end if;

  saved_roles := r.roles;
  saved_permissive := r.permissive;
  saved_cmd := r.cmd;

  if p_expected_cmd in ('SELECT', 'DELETE') then
    if coalesce(r.qual, '') = '' or coalesce(r.with_check, '') <> '' then
      raise exception
        'Preflight: %.%.% % must have USING only',
        p_schema, p_table, p_policy, p_expected_cmd;
    end if;
    orig_expr := r.qual;
    already := pg_temp.p01_is_hardened_shape(orig_expr);
    if already then
      -- Peeled base must round-trip; will still recreate to normalize guard.
      begin
        base_before := pg_temp.p01_peel_harden(orig_expr);
      exception
        when others then
          raise exception
            'Preflight: %.%.% already-hardened USING cannot be peeled safely: %',
            p_schema, p_table, p_policy, sqlerrm;
      end;
    else
      base_before := orig_expr;
    end if;
    -- Harden from the peeled base only — never re-wrap an already-hardened
    -- orig_expr (would risk nested membership wrappers on re-run).
    new_qual := pg_temp.p01_apply_harden(base_before);
    new_check := null;
  elsif p_expected_cmd = 'INSERT' then
    if coalesce(r.with_check, '') = '' or coalesce(r.qual, '') <> '' then
      raise exception
        'Preflight: %.%.% INSERT must have WITH CHECK only',
        p_schema, p_table, p_policy;
    end if;
    orig_expr := r.with_check;
    already := pg_temp.p01_is_hardened_shape(orig_expr);
    if already then
      begin
        base_before := pg_temp.p01_peel_harden(orig_expr);
      exception
        when others then
          raise exception
            'Preflight: %.%.% already-hardened WITH CHECK cannot be peeled safely: %',
            p_schema, p_table, p_policy, sqlerrm;
      end;
    else
      base_before := orig_expr;
    end if;
    new_qual := null;
    new_check := pg_temp.p01_apply_harden(base_before);
  else
    raise exception 'Preflight: unsupported cmd %', p_expected_cmd;
  end if;

  -- Prove we can parse/deparse the original base on the real table before mutating.
  begin
    perform pg_temp.p01_deparse_bool_expr(p_schema, p_table, p_expected_cmd, base_before);
  exception
    when others then
      raise exception
        'Preflight: %.%.% original base expression cannot be parse/deparsed on the target table (preservation unprovable): % — abort',
        p_schema, p_table, p_policy, sqlerrm;
  end;

  roles_sql := pg_temp.p01_format_policy_roles(saved_roles);

  execute format('drop policy if exists %I on %I.%I', p_policy, p_schema, p_table);

  create_sql := format(
    'create policy %I on %I.%I as permissive for %s to %s',
    p_policy, p_schema, p_table, lower(saved_cmd), roles_sql
  );
  if new_qual is not null then
    create_sql := create_sql || format(' using (%s)', new_qual);
  end if;
  if new_check is not null then
    create_sql := create_sql || format(' with check (%s)', new_check);
  end if;
  execute create_sql;

  -- Restore original COMMENT ON POLICY (IS NULL when original was NULL).
  execute format(
    'comment on policy %I on %I.%I is %L',
    p_policy, p_schema, p_table, saved_comment
  );

  select roles, permissive, cmd, qual, with_check
    into after_roles, after_permissive, after_cmd, after_qual, after_check
  from pg_policies
  where schemaname = p_schema
    and tablename = p_table
    and policyname = p_policy;

  if not found then
    raise exception 'Post-recreate: %.%.% missing', p_schema, p_table, p_policy;
  end if;

  if after_cmd is distinct from saved_cmd
     or after_permissive is distinct from saved_permissive
     or not (after_roles @> saved_roles and saved_roles @> after_roles
             and coalesce(array_length(after_roles, 1), 0)
               = coalesce(array_length(saved_roles, 1), 0)) then
    raise exception
      'Post-recreate: %.%.% identity/role drift — abort',
      p_schema, p_table, p_policy;
  end if;

  select pol.oid
    into policy_oid
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = p_schema
    and c.relname = p_table
    and pol.polname = p_policy;

  if policy_oid is null then
    raise exception
      'Post-recreate: %.%.% pg_policy OID missing after recreate — abort',
      p_schema, p_table, p_policy;
  end if;

  after_comment := obj_description(policy_oid, 'pg_policy');
  if after_comment is distinct from saved_comment then
    raise exception
      'Post-recreate: %.%.% COMMENT ON POLICY not restored (original=% after=%) — abort',
      p_schema, p_table, p_policy, saved_comment, after_comment;
  end if;

  if p_expected_cmd in ('SELECT', 'DELETE') then
    if not pg_temp.p01_is_hardened_shape(after_qual) then
      raise exception
        'Post-recreate: %.%.% USING failed structural harden-shape check — abort',
        p_schema, p_table, p_policy;
    end if;
    begin
      peeled_after := pg_temp.p01_peel_harden(after_qual);
    exception
      when others then
        raise exception
          'Post-recreate: %.%.% USING peel failed: %',
          p_schema, p_table, p_policy, sqlerrm;
    end;
  else
    if not pg_temp.p01_is_hardened_shape(after_check) then
      raise exception
        'Post-recreate: %.%.% WITH CHECK failed structural harden-shape check — abort',
        p_schema, p_table, p_policy;
    end if;
    begin
      peeled_after := pg_temp.p01_peel_harden(after_check);
    exception
      when others then
        raise exception
          'Post-recreate: %.%.% WITH CHECK peel failed: %',
          p_schema, p_table, p_policy, sqlerrm;
    end;
  end if;

  -- Original base vs peeled-after must be parse/deparse-equivalent on the
  -- real table (not whitespace-only / raw string compare). Distinguishes the
  -- original expression from the added public.is_workspace_member(workspace_id)
  -- membership guard peeled away by p01_peel_harden.
  if not pg_temp.p01_bool_exprs_equiv(
       p_schema, p_table, p_expected_cmd, base_before, peeled_after
     ) then
    raise exception
      'Post-recreate: %.%.% original policy expression was NOT preserved (parse/deparse mismatch between original base and peeled hardened base) — abort. base_before=% peeled_after=%',
      p_schema, p_table, p_policy, base_before, peeled_after;
  end if;

  raise notice
    'Hardened %.%.% (%) — original expression preserved (parse/deparse)',
    p_schema, p_table, p_policy, saved_cmd;
end;
$$;

-- ===========================================================================
-- 0a) Structural scanner self-tests (fail closed before any policy work)
-- ===========================================================================
do $$
declare
  ok boolean;
  failures text := null;
  h1 text;
  h2 text;
  base text;
  peeled text;
  normed text;
  mp int;
begin
  if current_setting('standard_conforming_strings', true) is distinct from 'on' then
    raise exception
      'Scanner self-test: standard_conforming_strings=% expected on — abort',
      current_setting('standard_conforming_strings', true);
  end if;

  -- Must ACCEPT (already-hardened shape)
  ok := pg_temp.p01_is_hardened_shape(
    '(a) AND public.is_workspace_member(workspace_id)');
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:simple';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    '((a) OR (b)) AND public.is_workspace_member(workspace_id)');
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:nested-or-inside';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = E'a\'b(c)') AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:e-string-escapes';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = 'it''s (ok)' AND y = "weird""id") AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:quotes-nested';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = $dq$paren ) inside$dq$) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:dollar-quoted';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$((x = '(nested)')) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:parens-in-ordinary-string';
  end if;

  -- Must REJECT (not top-level AND helper / OR bypass)
  ok := pg_temp.p01_is_hardened_shape(
    '(a) OR (true) AND public.is_workspace_member(workspace_id)');
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:or-then-and';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    '(a) AND public.is_workspace_member(workspace_id) OR true');
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:and-helper-or-true';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    'public.is_workspace_member(workspace_id)');
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:helper-only';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    '(a AND public.is_workspace_member(workspace_id))');
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:helper-inside-parens-only';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = E'dangling\) AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:unclosed-e-string';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = 'unclosed) AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:unclosed-ordinary-string';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = $bad$unclosed) AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:unclosed-dollar-quote';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    '(a) AND public.is_workspace_member(workspace_id, 1)');
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:malformed-helper-args';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    '(a) AND public.is_workspace_member(other_id)');
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:wrong-helper-arg';
  end if;

  -- U& unicode string / identifier (token-boundary aware)
  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'d\0061t(a)') AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:uand-string';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(U&"c\0061l" = 1) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:uand-ident';
  end if;

  -- UESCAPE clause: consumed as part of the U& token; escape char is '*', not '\'.
  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'d*0061t' UESCAPE '*') AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:uand-uescape-clause';
  end if;

  -- With UESCAPE '*', backslash is literal — must NOT be treated as unicode escape.
  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'a\b' UESCAPE '*') AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:uand-uescape-backslash-literal';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'it''s') AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:uand-doubled-quote';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = u&'\+000061') AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:uand-plus-six-hex';
  end if;

  -- '$' inside unquoted identifier must not start dollar-quoting
  ok := pg_temp.p01_is_hardened_shape(
    $t$(column$1 = 1) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:dollar-in-identifier';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'open) AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:unclosed-uand-string';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'trail\) AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:dangling-uand-backslash';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'\00') AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:incomplete-uand-hex';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'\GGGG') AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:invalid-uand-hex';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'\+00') AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:incomplete-uand-plus-hex';
  end if;

  -- Custom UESCAPE: incomplete escape with active '*' must fail closed
  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'*00' UESCAPE '*') AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:incomplete-uescape-hex';
  end if;

  -- Malformed UESCAPE (missing character literal) → fail closed
  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = U&'x' UESCAPE) AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:malformed-uescape';
  end if;

  -- Unclosed dollar-quote at token start → fail closed
  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = $tag$unclosed) AND public.is_workspace_member(workspace_id)$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:unclosed-dollar-quote-tag';
  end if;

  -- Token boundary: E inside identifier must NOT start an E-string.
  -- With correct boundaries this is a valid hardened shape (ACCEPT).
  -- Mis-scanning E as escape prefix on xE'\' makes the quote unclosed → REJECT.
  ok := pg_temp.p01_is_hardened_shape(
    $t$(xE'\') AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:e-prefix-not-mid-ident';
  end if;

  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = e'ok') AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:lowercase-e-string';
  end if;

  -- Token boundary: U& must not fire mid-identifier (xU&'...' is not U& token)
  ok := pg_temp.p01_is_hardened_shape(
    $t$(xU&'d\0061t') AND public.is_workspace_member(workspace_id)$t$);
  -- Preceded by alnum → U not token-start; '&' / quote handled as normal chars /
  -- ordinary string. Shape should still ACCEPT if quotes balance.
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:uand-prefix-not-mid-ident';
  end if;

  -- Line comment must not break paren matching / harden shape
  ok := pg_temp.p01_is_hardened_shape(
    $t$(a -- comment
) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:line-comment-inside-parens';
  end if;

  -- ----- Nested / block-comment scanner cases (matching_paren + norm_sql_src) -----

  -- 1) Simple block comment
  ok := pg_temp.p01_is_hardened_shape(
    $t$(a /* simple */) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:simple-block-comment';
  end if;
  mp := pg_temp.p01_matching_paren('(x /* c */)', 1);
  if mp is distinct from length('(x /* c */)') then
    failures := coalesce(failures || ', ', '') || 'matching:simple-block-comment';
  end if;
  normed := pg_temp.p01_norm_sql_src('a /* simple */ b');
  if normed is distinct from 'a b' then
    failures := coalesce(failures || ', ', '') || 'norm:simple-block-comment';
  end if;

  -- 2) One nested block comment
  ok := pg_temp.p01_is_hardened_shape(
    $t$(a /* outer /* nested */ still */) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:one-nested-block-comment';
  end if;
  mp := pg_temp.p01_matching_paren('(x /* o /* n */ o */)', 1);
  if mp is distinct from length('(x /* o /* n */ o */)') then
    failures := coalesce(failures || ', ', '') || 'matching:one-nested-block-comment';
  end if;
  normed := pg_temp.p01_norm_sql_src('a /* o /* n */ o */ b');
  if normed is distinct from 'a b' then
    failures := coalesce(failures || ', ', '') || 'norm:one-nested-block-comment';
  end if;

  -- 3) Multiple nesting levels
  ok := pg_temp.p01_is_hardened_shape(
    $t$(a /* L1 /* L2 /* L3 */ L2 */ L1 */) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:multi-nested-block-comment';
  end if;
  normed := pg_temp.p01_norm_sql_src('a /* L1 /* L2 /* L3 */ L2 */ L1 */ b');
  if normed is distinct from 'a b' then
    failures := coalesce(failures || ', ', '') || 'norm:multi-nested-block-comment';
  end if;

  -- 4) Multiple separate block comments
  ok := pg_temp.p01_is_hardened_shape(
    $t$(a /* one */ OR b /* two */) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:multiple-separate-block-comments';
  end if;
  normed := pg_temp.p01_norm_sql_src('a /* one */ b /* two */ c');
  if normed is distinct from 'a b c' then
    failures := coalesce(failures || ', ', '') || 'norm:multiple-separate-block-comments';
  end if;

  -- 5) Parentheses inside nested comments must not affect matching
  mp := pg_temp.p01_matching_paren($t$(x /* ( (() /* )( */ )) */)$t$, 1);
  if mp is distinct from length($t$(x /* ( (() /* )( */ )) */)$t$) then
    failures := coalesce(failures || ', ', '') || 'matching:parens-inside-nested-comments';
  end if;
  ok := pg_temp.p01_is_hardened_shape(
    $t$(a /* ( (() /* )( */ )) */) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:parens-inside-nested-comments';
  end if;

  -- 6) Parentheses after a nested comment must still match
  mp := pg_temp.p01_matching_paren('(x /* o /* n */ o */ y)', 1);
  if mp is distinct from length('(x /* o /* n */ o */ y)') then
    failures := coalesce(failures || ', ', '') || 'matching:parens-after-nested-comment';
  end if;

  -- 7) Nested comment containing SQL-looking text, quotes, parentheses
  ok := pg_temp.p01_is_hardened_shape(
    $t$(a /* 'x' "y" (z) /* nest */ */) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:sql-looking-text-in-nested-comment';
  end if;
  normed := pg_temp.p01_norm_sql_src($t$a /* 'x' "y" (z) /* nest */ */ b$t$);
  if normed is distinct from 'a b' then
    failures := coalesce(failures || ', ', '') || 'norm:sql-looking-text-in-nested-comment';
  end if;

  -- 8) Single-quoted strings / escaped quotes: comment must not eat string;
  --    string spaces preserved by norm; existing doubled-quote tests remain above.
  ok := pg_temp.p01_is_hardened_shape(
    $t$(x = 'a /* not comment */ b') AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:block-delim-inside-single-quote';
  end if;
  normed := pg_temp.p01_norm_sql_src($t$'keep  spaces' /* c */$t$);
  if normed is distinct from $t$'keep  spaces'$t$ then
    failures := coalesce(failures || ', ', '') || 'norm:preserve-single-quoted-spaces';
  end if;
  normed := pg_temp.p01_norm_sql_src($t$'it''s' /* c */$t$);
  if normed is distinct from $t$'it''s'$t$ then
    failures := coalesce(failures || ', ', '') || 'norm:preserve-escaped-single-quotes';
  end if;

  -- 9) Double-quoted identifiers preserved (comment outside)
  ok := pg_temp.p01_is_hardened_shape(
    $t$("col /* x */" = 1) AND public.is_workspace_member(workspace_id)$t$);
  if not ok then
    failures := coalesce(failures || ', ', '') || 'accept:block-delim-inside-double-quote';
  end if;
  normed := pg_temp.p01_norm_sql_src($t$"weird  id" /* c */$t$);
  if normed is distinct from $t$"weird  id"$t$ then
    failures := coalesce(failures || ', ', '') || 'norm:preserve-double-quoted-ident';
  end if;

  -- 10) Malformed / unclosed nested comments → fail closed
  ok := pg_temp.p01_is_hardened_shape(
    $t$(a /* unclosed$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:unclosed-block-comment';
  end if;
  ok := pg_temp.p01_is_hardened_shape(
    $t$(a /* outer /* nested */ still open$t$);
  if ok then
    failures := coalesce(failures || ', ', '') || 'reject:unclosed-outer-after-nested';
  end if;
  if pg_temp.p01_matching_paren('(x /* o /* n */', 1) is not null then
    failures := coalesce(failures || ', ', '') || 'matching:reject-unclosed-nested';
  end if;
  if pg_temp.p01_norm_sql_src('a /* o /* n */') is not null then
    failures := coalesce(failures || ', ', '') || 'norm:reject-unclosed-nested';
  end if;
  if pg_temp.p01_skip_block_comment('/* o /* n */', 1) is not null then
    failures := coalesce(failures || ', ', '') || 'skip:reject-unclosed-nested';
  end if;

  -- Idempotency: harden from raw base; second harden of result peels to same base
  h1 := pg_temp.p01_apply_harden('a OR b');
  if not pg_temp.p01_is_hardened_shape(h1) then
    failures := coalesce(failures || ', ', '') || 'idem:first-harden-shape';
  end if;
  base := pg_temp.p01_peel_harden(h1);
  h2 := pg_temp.p01_apply_harden(base); -- same path as fixed harden_member_policy
  peeled := pg_temp.p01_peel_harden(h2);
  if trim(base) is distinct from trim(peeled) then
    failures := coalesce(failures || ', ', '') || 'idem:peeled-base-stable';
  end if;
  -- Applying harden to already-hardened expression via peel→apply must not nest
  h2 := pg_temp.p01_apply_harden(pg_temp.p01_peel_harden(h1));
  if not pg_temp.p01_is_hardened_shape(h2) then
    failures := coalesce(failures || ', ', '') || 'idem:reapply-from-base-shape';
  end if;
  if pg_temp.p01_is_hardened_shape(pg_temp.p01_peel_harden(h2)) then
    failures := coalesce(failures || ', ', '') || 'idem:nested-wrapper-detected';
  end if;

  -- Legitimate membership inside base must remain part of peeled business expr
  h1 := pg_temp.p01_apply_harden(
    'public.is_workspace_member(workspace_id) AND other_col = 1');
  peeled := pg_temp.p01_peel_harden(h1);
  if position('other_col = 1' in peeled) = 0 then
    failures := coalesce(failures || ', ', '') || 'idem:preserve-inner-business';
  end if;

  if failures is not null then
    raise exception
      'Scanner self-test FAILED: %. Abort before any policy changes.',
      failures;
  end if;

  raise notice 'Scanner self-test OK (accept/reject + idempotency cases)';
end;
$$;

-- Probe function: identical SET search_path TO '' as baseline, so PostgreSQL's
-- own catalog representation of empty search_path is the expected proconfig
-- (not guessed as search_path= vs search_path="").
create or replace function pg_temp.p01_cfg_probe_empty_search_path()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select true;
$$;

-- ===========================================================================
-- 0) Shared preflight (helper metadata, tables/RLS, private buckets)
-- ===========================================================================
do $$
declare
  live_oid oid;
  live_nsp name;
  live_name name;
  live_src text;
  canon_src text;
  live_secdef boolean;
  live_vol "char";
  live_config text[];
  expected_config text[];
  live_argmodes "char"[];
  live_variadic oid;
  live_lang name;
  live_ret oid;
  live_nargs int;
  live_argtype oid;
begin
  -- Resolve by signature (schema + name + arg types). Do not compare
  -- pg_get_function_identity_arguments() to the bare literal 'uuid' — PostgreSQL
  -- returns named forms such as 'target_workspace_id uuid'.
  live_oid := to_regprocedure('public.is_workspace_member(uuid)');
  if live_oid is null then
    raise exception 'Preflight: public.is_workspace_member(uuid) missing';
  end if;

  select n.nspname, p.proname, p.prosrc, p.prosecdef, p.provolatile, p.proconfig,
         p.proargmodes, p.provariadic, l.lanname, p.prorettype,
         p.pronargs, p.proargtypes[0]
    into live_nsp, live_name, live_src, live_secdef, live_vol, live_config,
         live_argmodes, live_variadic, live_lang, live_ret,
         live_nargs, live_argtype
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where p.oid = live_oid;

  if live_nsp is distinct from 'public' then
    raise exception 'Preflight: is_workspace_member schema=% expected public — abort', live_nsp;
  end if;

  if live_name is distinct from 'is_workspace_member' then
    raise exception 'Preflight: function name=% expected is_workspace_member — abort', live_name;
  end if;

  if live_ret is distinct from 'boolean'::regtype then
    raise exception
      'Preflight: is_workspace_member return type=% expected boolean — abort',
      live_ret::regtype;
  end if;

  if live_nargs is distinct from 1 or live_argtype is distinct from 'uuid'::regtype then
    raise exception
      'Preflight: is_workspace_member args nargs=% type=% expected 1×uuid — abort',
      live_nargs, live_argtype::regtype;
  end if;

  -- Canonical: single IN argument (proargmodes NULL means all-IN) and no variadic.
  if live_variadic is distinct from 0::oid then
    raise exception
      'Preflight: is_workspace_member provariadic=% expected 0 (no variadic) — abort',
      live_variadic;
  end if;

  if live_argmodes is not null
     and live_argmodes is distinct from array['i']::"char"[] then
    raise exception
      'Preflight: is_workspace_member proargmodes=% expected NULL or {i} (IN only) — abort',
      live_argmodes;
  end if;

  if live_lang is distinct from 'sql' then
    raise exception
      'Preflight: is_workspace_member language=% expected sql — abort',
      live_lang;
  end if;

  if live_secdef is distinct from true then
    raise exception
      'Preflight: is_workspace_member must be SECURITY DEFINER (prosecdef=true) — abort';
  end if;

  if live_vol is distinct from 's' then
    raise exception
      'Preflight: is_workspace_member must be STABLE (provolatile=s) — abort';
  end if;

  -- Exact proconfig array vs probe created with SET search_path TO '' (baseline).
  select p.proconfig
    into expected_config
  from pg_proc p
  where p.oid = 'pg_temp.p01_cfg_probe_empty_search_path()'::regprocedure;

  if expected_config is null then
    raise exception
      'Preflight: could not establish expected empty search_path proconfig from probe — abort';
  end if;

  if live_config is distinct from expected_config then
    raise exception
      'Preflight: is_workspace_member proconfig=% is not exactly equal to canonical empty search_path probe proconfig=% — abort (no extra settings allowed)',
      live_config, expected_config;
  end if;

  -- Exact body vs baseline: quote-aware normalize (literals preserved).
  canon_src := pg_temp.p01_canon_is_workspace_member_prosrc();
  if pg_temp.p01_norm_sql_src(live_src) is null
     or pg_temp.p01_norm_sql_src(canon_src) is null then
    raise exception
      'Preflight: is_workspace_member prosrc cannot be safely scanned for comparison — abort';
  end if;
  if pg_temp.p01_norm_sql_src(live_src)
       is distinct from pg_temp.p01_norm_sql_src(canon_src) then
    raise exception
      'Preflight: public.is_workspace_member(uuid) prosrc is NOT identical (quote-aware normalized) to the canonical body from supabase/migrations/20260929000000_production_baseline.sql. Abort for manual inspection. live=%',
      live_src;
  end if;

  -- public.workspace_member_is_admin(uuid) — required by logo Storage policies.
  live_oid := to_regprocedure('public.workspace_member_is_admin(uuid)');
  if live_oid is null then
    raise exception 'Preflight: public.workspace_member_is_admin(uuid) missing — abort';
  end if;

  select n.nspname, p.proname, p.prosrc, p.prosecdef, p.provolatile, p.proconfig,
         p.proargmodes, p.provariadic, l.lanname, p.prorettype,
         p.pronargs, p.proargtypes[0]
    into live_nsp, live_name, live_src, live_secdef, live_vol, live_config,
         live_argmodes, live_variadic, live_lang, live_ret,
         live_nargs, live_argtype
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where p.oid = live_oid;

  if live_nsp is distinct from 'public'
     or live_name is distinct from 'workspace_member_is_admin' then
    raise exception
      'Preflight: workspace_member_is_admin identity %.% — expected public.workspace_member_is_admin — abort',
      live_nsp, live_name;
  end if;

  if live_ret is distinct from 'boolean'::regtype then
    raise exception
      'Preflight: workspace_member_is_admin return type=% expected boolean — abort',
      live_ret::regtype;
  end if;

  if live_nargs is distinct from 1 or live_argtype is distinct from 'uuid'::regtype then
    raise exception
      'Preflight: workspace_member_is_admin args nargs=% type=% expected 1×uuid — abort',
      live_nargs, live_argtype::regtype;
  end if;

  if live_variadic is distinct from 0::oid then
    raise exception
      'Preflight: workspace_member_is_admin provariadic=% expected 0 (no variadic) — abort',
      live_variadic;
  end if;

  if live_argmodes is not null
     and live_argmodes is distinct from array['i']::"char"[] then
    raise exception
      'Preflight: workspace_member_is_admin proargmodes=% expected NULL or {i} (IN only) — abort',
      live_argmodes;
  end if;

  if live_lang is distinct from 'sql' then
    raise exception
      'Preflight: workspace_member_is_admin language=% expected sql — abort',
      live_lang;
  end if;

  if live_secdef is distinct from true then
    raise exception
      'Preflight: workspace_member_is_admin must be SECURITY DEFINER (prosecdef=true) — abort';
  end if;

  if live_vol is distinct from 's' then
    raise exception
      'Preflight: workspace_member_is_admin must be STABLE (provolatile=s) — abort';
  end if;

  if live_config is distinct from expected_config then
    raise exception
      'Preflight: workspace_member_is_admin proconfig=% is not exactly equal to canonical empty search_path probe proconfig=% — abort',
      live_config, expected_config;
  end if;

  canon_src := pg_temp.p01_canon_workspace_member_is_admin_prosrc();
  if pg_temp.p01_norm_sql_src(live_src) is null
     or pg_temp.p01_norm_sql_src(canon_src) is null then
    raise exception
      'Preflight: workspace_member_is_admin prosrc cannot be safely scanned for comparison — abort';
  end if;
  if pg_temp.p01_norm_sql_src(live_src)
       is distinct from pg_temp.p01_norm_sql_src(canon_src) then
    raise exception
      'Preflight: public.workspace_member_is_admin(uuid) prosrc is NOT identical (quote-aware normalized) to the canonical body from supabase/migrations/20260929000000_production_baseline.sql. Abort for manual inspection. live=%',
      live_src;
  end if;

  -- workspace_id must be base type uuid (not a domain over uuid).
  if not exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    where n.nspname = 'public'
      and c.relname = 'order_attachments'
      and a.attname = 'workspace_id'
      and a.attnum > 0
      and not a.attisdropped
      and a.atttypid = 'uuid'::regtype
      and t.typtype = 'b'
  ) then
    raise exception
      'Preflight: public.order_attachments.workspace_id missing or not base type uuid — abort';
  end if;

  if not exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    where n.nspname = 'public'
      and c.relname = 'payments'
      and a.attname = 'workspace_id'
      and a.attnum > 0
      and not a.attisdropped
      and a.atttypid = 'uuid'::regtype
      and t.typtype = 'b'
  ) then
    raise exception
      'Preflight: public.payments.workspace_id missing or not base type uuid — abort';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'order_attachments' and c.relrowsecurity
  ) then
    raise exception 'Preflight: RLS not enabled on order_attachments';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'payments' and c.relrowsecurity
  ) then
    raise exception 'Preflight: RLS not enabled on payments';
  end if;

  -- storage.objects must exist with RLS enabled (do not auto-enable).
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'objects'
      and c.relkind in ('r', 'p')
  ) then
    raise exception
      'Preflight: storage.objects missing or not an ordinary/partitioned table — abort';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'objects'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity is true
  ) then
    raise exception
      'Preflight: storage.objects relrowsecurity is not true — abort (this script will not ENABLE ROW LEVEL SECURITY)';
  end if;

  -- Both Storage buckets must exist and be private before any policy DDL.
  perform pg_temp.p01_assert_private_buckets('Preflight');
end;
$$;

-- ===========================================================================
-- 1) payments: only the two named permissive targets allowed
-- ===========================================================================
do $$
declare
  r record;
  extras text := null;
begin
  for r in
    select policyname, permissive, roles, cmd
    from pg_policies
    where schemaname = 'public' and tablename = 'payments'
    order by policyname
  loop
    if r.permissive = 'RESTRICTIVE' then
      raise notice 'payments RESTRICTIVE %/% noted (cannot OR-grant)', r.policyname, r.cmd;
      continue;
    end if;
    if r.permissive is distinct from 'PERMISSIVE' then
      raise exception 'Preflight payments: % unexpected permissive=%', r.policyname, r.permissive;
    end if;
    if (r.policyname, r.cmd) in (
      ('payments_select_workspace_member', 'SELECT'),
      ('payments_insert_workspace_member', 'INSERT')
    ) then
      continue;
    end if;
    extras := coalesce(extras || ', ', '') || format('%s/%s', r.policyname, r.cmd);
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments'
      and policyname = 'payments_select_workspace_member' and cmd = 'SELECT'
      and permissive = 'PERMISSIVE'
  ) then
    raise exception 'Preflight payments: payments_select_workspace_member/SELECT/PERMISSIVE missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments'
      and policyname = 'payments_insert_workspace_member' and cmd = 'INSERT'
      and permissive = 'PERMISSIVE'
  ) then
    raise exception 'Preflight payments: payments_insert_workspace_member/INSERT/PERMISSIVE missing';
  end if;

  if extras is not null then
    raise exception
      'Preflight payments: abort before changes — extra permissive policies (no heuristic safe-classify): %',
      extras;
  end if;
end;
$$;

-- ===========================================================================
-- 2) order_attachments: exactly three expected policies/commands
-- ===========================================================================
do $$
declare
  bad text;
begin
  select string_agg(policyname || '/' || cmd || '/' || permissive, ', ' order by policyname)
    into bad
  from pg_policies
  where schemaname = 'public'
    and tablename = 'order_attachments'
    and not (
      (policyname = 'order_attachments_select_member' and cmd = 'SELECT' and permissive = 'PERMISSIVE')
      or (policyname = 'order_attachments_insert_member' and cmd = 'INSERT' and permissive = 'PERMISSIVE')
      or (policyname = 'order_attachments_delete_member' and cmd = 'DELETE' and permissive = 'PERMISSIVE')
    );
  if bad is not null then
    raise exception 'Preflight order_attachments: unexpected policies — abort: %', bad;
  end if;

  if (
    select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'order_attachments'
  ) is distinct from 3 then
    raise exception 'Preflight order_attachments: expected exactly 3 policies';
  end if;
end;
$$;

-- ===========================================================================
-- 3) Storage inventory + managed coverage (always) + legacy handling
-- ===========================================================================
-- Canonical managed set (all four are CREATE'd in
-- supabase/manual-sql/order_attachments_storage_policies.sql) — always required.
--
-- Legacy names order_attachments_storage_{insert,select}: resolve via
-- p01_resolve_legacy_storage_policies (DROP only if proven equiv to managed
-- canon; otherwise abort with full dump).
-- Logo policies: verified against 20260929000400; this script does not mutate them.
-- ===========================================================================
do $$
declare
  r record;
  unexpected text := null;
  have_view boolean := false;
  have_upload boolean := false;
  have_update boolean := false;
  have_delete boolean := false;
  have_logo_view boolean := false;
  have_logo_upload boolean := false;
  have_logo_update boolean := false;
  have_logo_delete boolean := false;
begin
  -- Resolve legacy names before managed inventory / table harden.
  perform pg_temp.p01_resolve_legacy_storage_policies('Preflight Storage');
  perform pg_temp.p01_assert_no_legacy_storage_policies('Preflight Storage');

  select string_agg(policyname || '/' || cmd, ', ')
    into unexpected
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and permissive = 'RESTRICTIVE';
  if unexpected is not null then
    raise exception 'Preflight Storage: RESTRICTIVE policies — abort: %', unexpected;
  end if;
  unexpected := null;

  for r in
    select policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and permissive = 'PERMISSIVE'
    order by policyname, cmd
  loop
    if r.policyname = 'Workspace members can view order attachments' and r.cmd = 'SELECT' then
      perform pg_temp.p01_storage_managed_equiv(r.policyname, 'SELECT');
      have_view := true;
    elsif r.policyname = 'Workspace members can upload order attachments' and r.cmd = 'INSERT' then
      perform pg_temp.p01_storage_managed_equiv(r.policyname, 'INSERT');
      have_upload := true;
    elsif r.policyname = 'Workspace members can update order attachments' and r.cmd = 'UPDATE' then
      perform pg_temp.p01_storage_managed_equiv(r.policyname, 'UPDATE');
      have_update := true;
    elsif r.policyname = 'Workspace members can delete order attachments' and r.cmd = 'DELETE' then
      perform pg_temp.p01_storage_managed_equiv(r.policyname, 'DELETE');
      have_delete := true;
    elsif r.policyname = 'Workspace members can view workspace logos' and r.cmd = 'SELECT' then
      perform pg_temp.p01_storage_logo_equiv(r.policyname, 'SELECT', false);
      have_logo_view := true;
    elsif r.policyname = 'Workspace admins can upload workspace logos' and r.cmd = 'INSERT' then
      perform pg_temp.p01_storage_logo_equiv(r.policyname, 'INSERT', true);
      have_logo_upload := true;
    elsif r.policyname = 'Workspace admins can update workspace logos' and r.cmd = 'UPDATE' then
      perform pg_temp.p01_storage_logo_equiv(r.policyname, 'UPDATE', true);
      have_logo_update := true;
    elsif r.policyname = 'Workspace admins can delete workspace logos' and r.cmd = 'DELETE' then
      perform pg_temp.p01_storage_logo_equiv(r.policyname, 'DELETE', true);
      have_logo_delete := true;
    else
      unexpected := coalesce(unexpected || ', ', '')
        || format('%s/%s', r.policyname, r.cmd);
    end if;
  end loop;

  if unexpected is not null then
    raise exception
      'Preflight Storage: abort — permissive storage.objects policies outside managed/logo allowlist: %',
      unexpected;
  end if;

  -- Always required (independent of legacy presence).
  if not have_view then
    raise exception
      'Preflight Storage: managed SELECT "Workspace members can view order attachments" missing or not verified — abort';
  end if;
  if not have_upload then
    raise exception
      'Preflight Storage: managed INSERT "Workspace members can upload order attachments" missing or not verified — abort';
  end if;
  if not have_update then
    raise exception
      'Preflight Storage: managed UPDATE "Workspace members can update order attachments" missing or not verified — abort (required by order_attachments_storage_policies.sql)';
  end if;
  if not have_delete then
    raise exception
      'Preflight Storage: managed DELETE "Workspace members can delete order attachments" missing or not verified — abort (required by order_attachments_storage_policies.sql)';
  end if;

  -- Canonical logo policies from 20260929000400 — required (full equiv, not names only).
  if not have_logo_view then
    raise exception
      'Preflight Storage: logo SELECT "Workspace members can view workspace logos" missing or not canonical — abort';
  end if;
  if not have_logo_upload then
    raise exception
      'Preflight Storage: logo INSERT "Workspace admins can upload workspace logos" missing or not canonical — abort';
  end if;
  if not have_logo_update then
    raise exception
      'Preflight Storage: logo UPDATE "Workspace admins can update workspace logos" missing or not canonical — abort';
  end if;
  if not have_logo_delete then
    raise exception
      'Preflight Storage: logo DELETE "Workspace admins can delete workspace logos" missing or not canonical — abort';
  end if;

  raise notice
    'Storage: four managed + four logo policies verified; no legacy order_attachments_storage_* present';
end;
$$;

-- ===========================================================================
-- 4) Harden five named table policies
-- ===========================================================================
select pg_temp.p01_harden_member_policy(
  'public', 'order_attachments', 'order_attachments_select_member', 'SELECT');
select pg_temp.p01_harden_member_policy(
  'public', 'order_attachments', 'order_attachments_insert_member', 'INSERT');
select pg_temp.p01_harden_member_policy(
  'public', 'order_attachments', 'order_attachments_delete_member', 'DELETE');
select pg_temp.p01_harden_member_policy(
  'public', 'payments', 'payments_select_workspace_member', 'SELECT');
select pg_temp.p01_harden_member_policy(
  'public', 'payments', 'payments_insert_workspace_member', 'INSERT');

-- ===========================================================================
-- 5) Re-assert legacy Storage absent (no auto-DROP — no repo CREATE POLICY)
-- ===========================================================================
do $$
begin
  -- Managed coverage still required immediately before continuing past harden.
  perform pg_temp.p01_storage_managed_equiv(
    'Workspace members can view order attachments', 'SELECT');
  perform pg_temp.p01_storage_managed_equiv(
    'Workspace members can upload order attachments', 'INSERT');
  perform pg_temp.p01_storage_managed_equiv(
    'Workspace members can update order attachments', 'UPDATE');
  perform pg_temp.p01_storage_managed_equiv(
    'Workspace members can delete order attachments', 'DELETE');

  perform pg_temp.p01_assert_no_legacy_storage_policies('Post-harden Storage');
end;
$$;

-- ===========================================================================
-- 6) Final verification
-- ===========================================================================
do $$
declare
  t record;
  p record;
  extras text;
  saw_view boolean := false;
  saw_upload boolean := false;
  saw_update boolean := false;
  saw_delete boolean := false;
  saw_logo_view boolean := false;
  saw_logo_upload boolean := false;
  saw_logo_update boolean := false;
  saw_logo_delete boolean := false;
begin
  -- 6a/6b targets by exact schema+table+name
  for t in
    select * from (values
      ('public'::name, 'order_attachments'::name, 'order_attachments_select_member'::name, 'SELECT'::text),
      ('public', 'order_attachments', 'order_attachments_insert_member', 'INSERT'),
      ('public', 'order_attachments', 'order_attachments_delete_member', 'DELETE'),
      ('public', 'payments', 'payments_select_workspace_member', 'SELECT'),
      ('public', 'payments', 'payments_insert_workspace_member', 'INSERT')
    ) as v(schemaname, tablename, policyname, cmd)
  loop
    select * into p
    from pg_policies
    where schemaname = t.schemaname
      and tablename = t.tablename
      and policyname = t.policyname;

    if not found then
      raise exception 'Final: missing %.%.%', t.schemaname, t.tablename, t.policyname;
    end if;
    if p.cmd is distinct from t.cmd then
      raise exception 'Final: %.%.% cmd=% expected %',
        t.schemaname, t.tablename, t.policyname, p.cmd, t.cmd;
    end if;
    if p.permissive is distinct from 'PERMISSIVE' then
      raise exception 'Final: %.%.% not PERMISSIVE', t.schemaname, t.tablename, t.policyname;
    end if;
    if coalesce(array_length(p.roles, 1), 0) = 0 then
      raise exception 'Final: %.%.% empty roles', t.schemaname, t.tablename, t.policyname;
    end if;

    if t.cmd in ('SELECT', 'DELETE') then
      if not pg_temp.p01_is_hardened_shape(p.qual) then
        raise exception
          'Final: %.%.% USING failed structural harden-shape',
          t.schemaname, t.tablename, t.policyname;
      end if;
      if coalesce(p.with_check, '') <> '' then
        raise exception 'Final: %.%.% unexpected WITH CHECK', t.schemaname, t.tablename, t.policyname;
      end if;
    else
      if not pg_temp.p01_is_hardened_shape(p.with_check) then
        raise exception
          'Final: %.%.% WITH CHECK failed structural harden-shape',
          t.schemaname, t.tablename, t.policyname;
      end if;
      if coalesce(p.qual, '') <> '' then
        raise exception 'Final: %.%.% unexpected USING', t.schemaname, t.tablename, t.policyname;
      end if;
    end if;
  end loop;

  -- order_attachments: exactly three
  if (
    select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'order_attachments'
  ) is distinct from 3 then
    raise exception 'Final: order_attachments must have exactly 3 policies';
  end if;

  -- payments: both targets; no other permissive
  select string_agg(policyname || '/' || cmd, ', ') into extras
  from pg_policies
  where schemaname = 'public'
    and tablename = 'payments'
    and permissive = 'PERMISSIVE'
    and not (
      (policyname = 'payments_select_workspace_member' and cmd = 'SELECT')
      or (policyname = 'payments_insert_workspace_member' and cmd = 'INSERT')
    );
  if extras is not null then
    raise exception 'Final payments: extra permissive policies: %', extras;
  end if;

  -- Legacy Storage must remain absent after resolve.
  perform pg_temp.p01_assert_no_legacy_storage_policies('Final Storage');

  -- Reject any RESTRICTIVE storage.objects policy (same as preflight).
  select string_agg(policyname || '/' || cmd, ', ' order by policyname)
    into extras
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and permissive = 'RESTRICTIVE';
  if extras is not null then
    raise exception
      'Final Storage: RESTRICTIVE policies on storage.objects — abort: %',
      extras;
  end if;

  -- remaining permissive storage.objects: approved allowlist + full equiv;
  -- all four managed + all four logo policies must be proven canonical.
  for t in
    select policyname, cmd
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and permissive = 'PERMISSIVE'
  loop
    if t.policyname = 'Workspace members can view order attachments' and t.cmd = 'SELECT' then
      perform pg_temp.p01_storage_managed_equiv(t.policyname, 'SELECT');
      saw_view := true;
    elsif t.policyname = 'Workspace members can upload order attachments' and t.cmd = 'INSERT' then
      perform pg_temp.p01_storage_managed_equiv(t.policyname, 'INSERT');
      saw_upload := true;
    elsif t.policyname = 'Workspace members can update order attachments' and t.cmd = 'UPDATE' then
      perform pg_temp.p01_storage_managed_equiv(t.policyname, 'UPDATE');
      saw_update := true;
    elsif t.policyname = 'Workspace members can delete order attachments' and t.cmd = 'DELETE' then
      perform pg_temp.p01_storage_managed_equiv(t.policyname, 'DELETE');
      saw_delete := true;
    elsif t.policyname = 'Workspace members can view workspace logos' and t.cmd = 'SELECT' then
      perform pg_temp.p01_storage_logo_equiv(t.policyname, 'SELECT', false);
      saw_logo_view := true;
    elsif t.policyname = 'Workspace admins can upload workspace logos' and t.cmd = 'INSERT' then
      perform pg_temp.p01_storage_logo_equiv(t.policyname, 'INSERT', true);
      saw_logo_upload := true;
    elsif t.policyname = 'Workspace admins can update workspace logos' and t.cmd = 'UPDATE' then
      perform pg_temp.p01_storage_logo_equiv(t.policyname, 'UPDATE', true);
      saw_logo_update := true;
    elsif t.policyname = 'Workspace admins can delete workspace logos' and t.cmd = 'DELETE' then
      perform pg_temp.p01_storage_logo_equiv(t.policyname, 'DELETE', true);
      saw_logo_delete := true;
    else
      raise exception 'Final Storage: unexpected permissive %/%', t.policyname, t.cmd;
    end if;
  end loop;

  if not (saw_view and saw_upload and saw_update and saw_delete) then
    raise exception
      'Final Storage: missing required managed policies view=% upload=% update=% delete=%',
      saw_view, saw_upload, saw_update, saw_delete;
  end if;

  if not (saw_logo_view and saw_logo_upload and saw_logo_update and saw_logo_delete) then
    raise exception
      'Final Storage: missing or unverified canonical logo policies view=% upload=% update=% delete=% — abort (name-only presence is insufficient)',
      saw_logo_view, saw_logo_upload, saw_logo_update, saw_logo_delete;
  end if;

  -- Buckets must still exist and remain private after all policy work.
  perform pg_temp.p01_assert_private_buckets('Final');

  raise notice 'P0.1 patch final verification OK';
end;
$$;

commit;

-- =============================================================================
-- Post-script notes (not executed): authorize APPLY separately after review.
-- Dump pg_policies on MAIN before/after; confirm managed Storage from
-- order_attachments_storage_policies.sql and logos from 20260929000400.
-- =============================================================================
