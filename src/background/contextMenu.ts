import OBR from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";

const CONTEXT_MENU_ID = getPluginId("context-menu/character-sheet");
const MODAL_ID = getPluginId("modal/character-sheet");

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
      OBR.modal.open({
        id: MODAL_ID,
        url: absoluteUrl(`sheet.html?itemId=${encodeURIComponent(item.id)}`),
        width: 760,
        height: 840,
      });
    },
  });
}
