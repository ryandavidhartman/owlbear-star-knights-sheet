import OBR from "@owlbear-rodeo/sdk";
import { registerContextMenu } from "./contextMenu";
import { backfillCharacterTemplates } from "./backfillCharacterTemplates";

OBR.onReady(() => {
  registerContextMenu();

  // Run once for whatever scene is active on load, then again every time
  // the active scene finishes (re)loading -- e.g. a GM switching to a
  // different saved scene within the same room -- so each scene's already
  // filled character sheets get a chance to seed the cross-scene cache.
  backfillCharacterTemplates();
  OBR.scene.onReadyChange((ready) => {
    if (ready) {
      backfillCharacterTemplates();
    }
  });
});
