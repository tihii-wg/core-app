import { useContext } from "react";
import { AppContext } from "./AppProvider";

export function useAppContext() {
  const context = useContext(AppContext);

  if (context === null) {
    throw new Error("useAppContext must be used within an AppProvider");
  }

  return context;
}
