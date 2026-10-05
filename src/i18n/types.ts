type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

/**
 * Shape a translation must have: every key of the English source, plus the extra plural forms a
 * language needs (Romanian `_few`, Russian `_few` / `_many`).
 */
export type Messages<T> = { [K in keyof T]: T[K] extends string ? string : Messages<T[K]> } & { [key: `${string}_${PluralSuffix}`]: string };
