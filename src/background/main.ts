import OBR from "@owlbear-rodeo/sdk";
import { registerContextMenu } from "./contextMenu";

OBR.onReady(() => {
  registerContextMenu();
});
