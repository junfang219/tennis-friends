import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

// The native WebView loads the web app over the network — Next.js isn't a
// static export, so there's nothing meaningful in `out/` to bundle. Which URL
// it loads depends on CAP_ENV at `cap sync`/`cap copy` time:
//
//   • DEFAULT (production): loads the deployed site. This is what Archive →
//     TestFlight / App Store builds must use. Default is production on purpose
//     so a release build can never accidentally ship pointed at a laptop dev
//     server (which is an all-white screen for every tester).
//
//   • CAP_ENV=development: loads the Next.js dev server on this Mac over Wi-Fi
//     for on-device development. Use `npm run ios:dev` (sync) or
//     `npm run ios:ip` (refresh the LAN IP — it sets CAP_ENV itself). For the
//     iOS Simulator, point DEV_SERVER_URL at http://localhost:3000 by hand
//     (the simulator shares the Mac's loopback).
const PROD_URL = 'https://mytennisfriends.com';
// `npm run ios:ip` rewrites this literal when your DHCP-assigned LAN IP changes.
const DEV_SERVER_URL = 'http://Juns-MacBook-Pro-3.local:3000';

const useDevServer = process.env.CAP_ENV === 'development';

const config: CapacitorConfig = {
  appId: 'com.tennisfriend.app',
  appName: 'TennisFriend',
  webDir: 'out',
  plugins: {
    Keyboard: {
      // None: don't touch the WebView when the keyboard opens. We do
      // all the keyboard-aware layout ourselves via useKeyboardHeight
      // (Capacitor keyboardWillShow on native, VisualViewport on web)
      // and offset the input bar in JS. The default (Native) would
      // shrink the WebView itself, which (a) makes window.innerHeight
      // and visualViewport.height shrink in lockstep so the web hook
      // sees keyboardHeight=0 even though the keyboard is open, and
      // (b) double-counts the keyboard if the JS layout still adds the
      // height on top. KeyboardInit also calls setResizeMode at runtime
      // so this takes effect without a `cap sync`.
      resize: KeyboardResize.None,
    },
  },
  server: useDevServer
    ? {
        // On-device development: a physical iPhone on the same Wi-Fi reaches
        // the Next.js dev server via the Mac's Bonjour/mDNS hostname (the
        // hostname resolves to the current IP automatically; if mDNS doesn't
        // resolve — AP/client isolation, some VPNs — `npm run ios:ip` falls
        // back to the raw LAN IP).
        url: DEV_SERVER_URL,
        cleartext: true,
        // Belt + suspenders: tell WKWebView these hosts are OK to navigate to.
        // The signed-upload PUTs go to *.supabase.co.
        allowNavigation: [new URL(DEV_SERVER_URL).hostname, 'localhost', '*.supabase.co'],
      }
    : {
        // Production / TestFlight / App Store: load the deployed site. No
        // cleartext — HTTPS only.
        url: PROD_URL,
        allowNavigation: ['mytennisfriends.com', '*.supabase.co'],
      },
  ios: {
    contentInset: 'never',
    // Pin the native WKWebView background to the app's surface color so
    // the triangular gaps where the iOS keyboard's rounded corners meet
    // the rectangular viewport (top-left / top-right where the keyboard
    // joins the form, bottom-left / bottom-right at the home-indicator
    // strip) stop rendering as the default black. Matches --color-surface
    // in globals.css. Requires `npx cap sync ios` + app relaunch — the
    // value is read once at WKWebView init, not on hot reload.
    backgroundColor: '#F1F5EC',
  },
};

export default config;
