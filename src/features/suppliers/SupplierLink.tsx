import { Link, useLocation } from "react-router-dom";
import { languageFromPath } from "../../i18n/languages";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { supplierDetailsPath } from "./supplierRoutes";
import { cn } from "../../lib/utils";

type SupplierLinkProps = {
  supplier: string;
  className?: string;
  /** Extra classes for the empty "—" placeholder. */
  emptyClassName?: string;
};

/**
 * Navigates to the supplier page. Stops propagation so parent row/card clicks do not fire.
 */
export function SupplierLink({ supplier, className, emptyClassName }: SupplierLinkProps) {
  const location = useLocation();
  const { workspaceId } = useActiveWorkspaceId();
  const name = supplier.trim();

  if (!name || !workspaceId) {
    return <span className={cn(emptyClassName ?? className)}>—</span>;
  }

  const locale = languageFromPath(location.pathname);
  return (
    <Link
      to={supplierDetailsPath(locale, workspaceId, name)}
      title={name}
      className={cn("text-primary underline-offset-2 hover:underline", className)}
      onClick={(event) => event.stopPropagation()}
    >
      {name}
    </Link>
  );
}
