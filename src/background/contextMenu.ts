import OBR from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";

const CONTEXT_MENU_ID = getPluginId("context-menu/character-sheet");
const MODAL_ID = getPluginId("modal/character-sheet");

export function registerContextMenu() {
  OBR.contextMenu.create({
    id: CONTEXT_MENU_ID,
    icons: [
      {
        icon: "/icon.svg",
        label: "Character Sheet",
        filter: {
          every: [{ key: "layer", value: "CHARACTER" }],
          permissions: ["UPDATE"],
        },
      },
    ],
    onClick(context) {
      const item = context.items[0];
      if (!item) {
        return;
      }
      OBR.modal.open({
        id: MODAL_ID,
        url: `/sheet.html?itemId=${encodeURIComponent(item.id)}`,
        width: 760,
        height: 840,
      });
    },
  });
}
