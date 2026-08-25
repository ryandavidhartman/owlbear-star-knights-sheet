import { getPluginId } from "./pluginId";

/**
 * The Action panel's URL is fixed (declared once in manifest.json), so
 * unlike the old per-click Modal/Popover URL it can't carry an `itemId`
 * query param. Right-clicking a token instead writes the chosen item id
 * here -- localStorage so an already-loaded panel or a fresh page load
 * both have somewhere to read the "current character" from, and a
 * BroadcastChannel so a panel that's already open updates live instead
 * of needing to be closed and reopened.
 */
export const SELECTED_ITEM_STORAGE_KEY = getPluginId("selected-item");
export const SELECTED_ITEM_CHANNEL = getPluginId("selected-item-channel");
