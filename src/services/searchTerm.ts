// PostgREST `or()` filters treat these characters as syntax, so they cannot appear in an ilike value.
export function searchTerm(search: string | undefined) {
  return search?.replace(/[%_,().]/g, " ").trim() ?? "";
}
