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
  },
};

export default config;
