/**
 * Desktop-only UI, mounted by the host at a single point. Everything here
 * renders to nothing in a browser build, so the host does not need its own
 * `isTauriDesktop()` branch around it.
 */

export { DynamicIsland } from "./DynamicIsland";
export { useDesktopChrome, type DesktopChrome } from "./useDesktopChrome";
export { useWindowDrag } from "./useWindowDrag";
