import OBR from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";
import { CHARACTER_SHEET_MODAL_ID } from "../shared/modalId";

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
      OBR.modal.open({
        id: CHARACTER_SHEET_MODAL_ID,
        url: absoluteUrl(`sheet.html?itemId=${encodeURIComponent(item.id)}`),
        // Modal has no live resize/reposition API, so this footprint is
        // fixed on screen for as long as the modal is open (Owlbear routes
        // all pointer events inside it to us; nothing outside a modal's own
        // rectangle is affected either way). Sized to give the floating
        // window room to move/resize within, without covering the whole
        // screen the way `fullScreen` does.
        width: 1000,
        height: 820,
        hideBackdrop: true,
        hidePaper: true,
      });
    },
  });
}
