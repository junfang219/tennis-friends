import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tennisfriend.app',
  appName: 'TennisFriend',
  webDir: 'out',
  server: {
    // Currently pointed at the Mac's LAN IP so a physical iPhone on the
    // same Wi-Fi can reach the Next.js dev server. Switch back to
    // http://localhost:3000 for iOS Simulator runs (the simulator shares
    // the Mac's loopback). For production, change to the deployed URL
    // and remove cleartext.
    url: 'http://192.168.7.129:3000',
    cleartext: true,
    // Belt + suspenders: tell WKWebView these hosts are OK to navigate to.
    // The signed-upload PUTs go to *.supabase.co.
    allowNavigation: ['192.168.7.129', 'localhost', '*.supabase.co'],
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
