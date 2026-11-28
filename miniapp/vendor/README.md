# Supabase browser SDK

`supabase-2.105.0.js` is the unmodified `dist/umd/supabase.js` from the npm
tarball for `@supabase/supabase-js@2.105.0`. The app fetches it from its own
origin only when restoring a saved session or submitting credentials.

To reproduce, run `npm pack @supabase/supabase-js@2.105.0` and extract
`package/dist/umd/supabase.js`. Its SHA-256 is
`24e8c00dc25da420ee741068b60bcdb5f62cb3598d8834058acF37ec6ee1a724`.
When updating the SDK, verify the version, bundle hash, bundled dependency
licenses and owner sign-in flow before changing the filename in `index.html`.
