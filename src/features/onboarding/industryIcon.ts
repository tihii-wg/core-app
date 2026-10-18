import { Building2, Car, House, Laptop, Plug, Smartphone, Wrench, Zap, type LucideIcon } from "lucide-react";

const icons: Record<string, LucideIcon> = {
  auto_repair: Car,
  phone_electronics_repair: Smartphone,
  computer_repair: Laptop,
  appliance_repair: Plug,
  equipment_repair: Wrench,
  electrical_services: Zap,
  home_services: House,
};

export function industryIcon(slug: string | null | undefined): LucideIcon {
  if (!slug) return Building2;
  return icons[slug] ?? Building2;
}
