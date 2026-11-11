/**
 * The signed-in studio (dashboard, composer, channels, calendar, settings, and
 * the rest) mounts only when a session token is present. Landing, login, and
 * signup stay public. Privacy and terms are separate server pages.
 */
export function showsAppShell(isLoggedIn, token) {
  return Boolean(isLoggedIn) && Boolean(token);
}
