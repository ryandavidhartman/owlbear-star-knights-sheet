import OBR from "@owlbear-rodeo/sdk";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Only render the children once we're running inside Owlbear Rodeo
 * and the SDK has signaled it's ready.
 */
export function PluginGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (OBR.isAvailable) {
      OBR.onReady(() => setReady(true));
    }
  }, []);

  if (!ready) {
    return null;
  }

  return <>{children}</>;
}
