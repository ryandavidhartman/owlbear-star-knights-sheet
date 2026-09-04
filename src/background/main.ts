import OBR from "@owlbear-rodeo/sdk";
import { registerContextMenu } from "./contextMenu";
import { backfillCharacterTemplates } from "./backfillCharacterTemplates";

const BACKFILL_DEBOUNCE_MS = 500;

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

  // Also re-run (debounced) on any scene item change, so a token dropped
  // onto an already-loaded scene -- the common case, not just on scene
  // switch -- gets its cached sheet/Owner picked up without waiting for
  // someone to open its sheet or reassign Owner by hand.
  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  OBR.scene.items.onChange(() => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(backfillCharacterTemplates, BACKFILL_DEBOUNCE_MS);
  });
});
