export function supplierDetailsPath(locale: string, workspaceId: string, supplierName: string) {
  return `/${locale}/${workspaceId}/suppliers/${encodeURIComponent(supplierName.trim())}`;
}

export function inventoryListPath(locale: string, workspaceId: string) {
  return `/${locale}/${workspaceId}/inventory`;
}

export function inventoryItemPath(locale: string, workspaceId: string, itemId: string) {
  return `/${locale}/${workspaceId}/inventory?item=${encodeURIComponent(itemId)}`;
}
