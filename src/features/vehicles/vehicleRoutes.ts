export function vehicleDetailsPath(locale: string, workspaceId: string, vehicleId: string) {
  return `/${locale}/${workspaceId}/vehicles/${vehicleId}`;
}

export function ordersListPath(locale: string, workspaceId: string) {
  return `/${locale}/${workspaceId}/orders`;
}

export function clientDetailsPath(locale: string, workspaceId: string, clientId: string) {
  return `/${locale}/${workspaceId}/clients?client=${encodeURIComponent(clientId)}`;
}
