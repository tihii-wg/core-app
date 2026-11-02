import { useEffect, useState } from "react";
import {
  isVehicleMileageUnitSupported,
  probeVehicleMileageUnitSupport,
} from "../../services/apiVehicles";

/**
 * Whether vehicles.mileage_unit is available on the linked DB.
 * False until the manual SQL is applied — UI must not invent units.
 */
export function useVehicleMileageUnitSupport() {
  const [supported, setSupported] = useState(isVehicleMileageUnitSupported);

  useEffect(() => {
    let cancelled = false;
    void probeVehicleMileageUnitSupport().then((ok) => {
      if (!cancelled) setSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return supported;
}
