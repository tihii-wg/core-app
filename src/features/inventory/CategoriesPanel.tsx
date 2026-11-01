import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import type { CategoryRecord } from "../../services/apiCategories";
import { useGetCategories } from "../categories/useGetCategories";

type CategoryRow = { category: CategoryRecord; depth: number };

/** Orders categories parent-first with depth; orphans (missing parent) become roots. */
export function flattenCategories(categories: CategoryRecord[]): CategoryRow[] {
  const ids = new Set(categories.map((category) => category.id));
  const children = new Map<string | null, CategoryRecord[]>();
  for (const category of categories) {
    const key = category.parentId && ids.has(category.parentId) ? category.parentId : null;
    const list = children.get(key) ?? [];
    list.push(category);
    children.set(key, list);
  }

  const rows: CategoryRow[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const category of children.get(parent) ?? []) {
      if (visited.has(category.id)) continue;
      visited.add(category.id);
      rows.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Read-only product categories. Renders nothing until the `categories` table exists. */
export function CategoriesPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useGetCategories("product");
  const rows = useMemo(() => flattenCategories(data?.categories ?? []), [data]);

  if (isLoading || isError || !data?.available) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("inventory.categories.title")}</CardTitle>
        <CardDescription>{t("inventory.categories.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("inventory.categories.empty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {rows.map(({ category, depth }) => (
              <li
                key={category.id}
                className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground"
              >
                {depth > 0 ? "↳ " : ""}
                {category.name}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
