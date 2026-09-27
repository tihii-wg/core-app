export function workspaceInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .flatMap((part) => {
      const words = part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);
      return words.length > 1 ? words : [part];
    })
    .filter(Boolean);

  if (parts.length === 0) return "C";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}
