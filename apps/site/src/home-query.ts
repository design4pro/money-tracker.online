import { getEmDashEntry, getRequestContext, runWithContext } from "emdash";
import type { Home } from "./home.ts";

export function loadPublishedHome() {
  const context = getRequestContext();
  const loadHome = () => getEmDashEntry<"landing", Home>("landing", "home");
  // Use the live published revision even during editing or after an unpublish.
  return context
    ? runWithContext(
        {
          ...context,
          editMode: false,
          preview: undefined,
          routeCacheFill: true,
        },
        loadHome,
      )
    : loadHome();
}
