// expo-router/entry eagerly requires every file under app/ to build its route manifest, before
// app/_layout.tsx ever runs. That means polyfills imported from _layout.tsx run too late if any
// other route file transitively needs them at module-init time. Importing them here, ahead of
// expo-router/entry, guarantees they're in place first.
import './polyfills';
import 'expo-router/entry';
