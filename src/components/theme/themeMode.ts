// DEC-2026-026: the R0 recruiting launch renders light mode only. Saved and OS dark
// preferences are ignored (not erased) and the theme control is hidden. The `.dark`
// tokens and `dark:` styles stay in place for the dark-mode repair release, which
// sets this to false after its own contrast and visual verification.
export const LIGHT_ONLY_LAUNCH = true;
