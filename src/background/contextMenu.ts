import OBR from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";
import { CHARACTER_SHEET_WINDOW_ID } from "../shared/windowId";

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
    onClick(context, elementId) {
      const item = context.items[0];
      if (!item) {
        return;
      }
      // Popover (unlike Modal) supports live setWidth/setHeight, so the
      // resize handle in the sheet can genuinely shrink/grow the on-screen
      // footprint instead of just rearranging content inside a fixed box.
      // It has no live reposition API though, so unlike Modal there's no
      // drag-to-move -- it stays anchored where it opened.
      OBR.popover.open({
        id: CHARACTER_SHEET_WINDOW_ID,
        url: absoluteUrl(`sheet.html?itemId=${encodeURIComponent(item.id)}`),
        width: 900,
        height: 760,
        anchorElementId: elementId,
        anchorOrigin: { horizontal: "CENTER", vertical: "CENTER" },
        transformOrigin: { horizontal: "CENTER", vertical: "CENTER" },
        disableClickAway: true,
        hidePaper: true,
      });
    },
  });
}
