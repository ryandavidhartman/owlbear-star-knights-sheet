import OBR from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";
import { SELECTED_ITEM_CHANNEL, SELECTED_ITEM_STORAGE_KEY } from "../shared/selection";

const CONTEXT_MENU_ID = getPluginId("context-menu/character-sheet");

/**
 * The SDK resolves relative icon/url paths as `${location.origin}${path}`,
 * which breaks when the extension is hosted under a subpath (e.g. GitHub
 * Pages project sites at /repo-name/). Resolving against document.baseURI
 * first yields an absolute URL that passes through unchanged instead.
 */
function absoluteUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

export function registerContextMenu() {
  OBR.contextMenu.create({
    id: CONTEXT_MENU_ID,
    icons: [
      {
        icon: absoluteUrl("icon.svg"),
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
      try {
        window.localStorage.setItem(SELECTED_ITEM_STORAGE_KEY, item.id);
      } catch {
        // best-effort; the sheet panel falls back to its own state if this
        // is unavailable (e.g. storage blocked)
      }
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(SELECTED_ITEM_CHANNEL);
        channel.postMessage(item.id);
        channel.close();
      }
      OBR.action.open();
    },
  });
}
