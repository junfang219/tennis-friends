import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

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
  server: {
    // Pointed at the Mac's Bonjour/mDNS hostname so a physical iPhone on the
    // same Wi-Fi reaches the Next.js dev server without hardcoding a LAN IP
    // (DHCP reassigns those, which shows up as an all-white screen). The
    // hostname resolves to the current IP automatically. If mDNS doesn't
    // resolve on your network (AP/client isolation, some VPNs), run
    // `npm run ios:ip` to fall back to the raw LAN IP. Switch to
    // http://localhost:3000 for iOS Simulator runs (the simulator shares the
    // Mac's loopback). For production, change to the deployed URL and remove
    // cleartext.
    url: 'http://Juns-MacBook-Pro-3.local:3000',
    cleartext: true,
    // Belt + suspenders: tell WKWebView these hosts are OK to navigate to.
    // The signed-upload PUTs go to *.supabase.co.
    allowNavigation: ['Juns-MacBook-Pro-3.local', 'localhost', '*.supabase.co'],
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
