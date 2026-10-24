# Publishing to the Figma Community

Publishing happens inside the Figma desktop app, not on GitHub. Figma uploads the built
files (`dist/code.js`, `dist/ui.html`) together with the listing you fill in, and
reviews the plugin before it goes public.

Sources: [Publish plugins to the Figma Community](https://help.figma.com/hc/en-us/articles/360042293394-Publish-plugins-to-the-Figma-Community),
[Publishing to the Community (BYFP 5)](https://help.figma.com/hc/en-us/articles/4407531267607--BYFP-5-Publishing-to-the-Community).

## Status

Version 0.1.0 was submitted on 2026-10-24 and is **in review**.

- **Author:** Edo (individual creator), from the edoardo@patterns.digital account.
- **Plugin ID:** `1695932217794835681`.
- **Community page:** https://www.figma.com/community/plugin/1695932217794835681,
  which goes live when the review is approved.

## Before you start

- **Two-factor authentication** must be on for the account you publish from (Settings →
  Security). Figma refuses to publish without it.
- **Mind which account a tab belongs to.** The desktop app can be signed into several
  accounts, and each file tab runs under the account that opened it. Start publishing
  from a file opened with the account that has 2FA. Otherwise the dialog keeps saying
  "You must enable two-factor authentication to publish". If you've just turned 2FA
  on, quit and reopen Figma first.
- **A file you can edit.** Plugins, including the publish dialog, are unavailable in
  view-only files.
- **The Figma desktop app.** Publishing isn't possible from the browser.
- **A fresh build, imported from this repository.** Run `pnpm build`, then import
  `manifest.json` from the repository folder (not from an unzipped release), so the ID
  you'll get in the next section lands in the file you commit.
- **The listing assets**, both ready in [`docs/community/`](community/):
  - the **icon**, [`icon.png`](community/icon.png), 128 × 128 px;
  - the **thumbnail**, [`cover.png`](community/cover.png), 1920 × 1080 px. It shows a
    drawing traced by the plugin, half as the Texture effect and half in outline mode.
  - optionally, a **carousel** of up to 9 images or videos and a **playground file**
    that people can open to try the plugin.

  To change them, edit `docs/community/build.mjs` and run
  `node docs/community/build.mjs`. It needs Google Chrome installed.

## The plugin ID

`manifest.json` carries the ID Figma assigned on the first publish,
`1695932217794835681`. **Never change it.** Every update must be published with this
ID, or Figma treats the upload as a new, separate plugin.

On the first publish the manifest still had a placeholder. The dialog flagged it with
**"Invalid ID in manifest.json"** and offered **Generate ID**, and the generated value
went into `manifest.json` before publishing. Only a fork published as its own plugin
would need to go through that again.

## Publish

1. Open any design file in the desktop app.
2. Go to **Plugins → Development → Manage plugins in development**. The Figma menu
   (top-left logo) also has it under Plugins → Manage plugins.
3. Open the **⋯** menu next to *Texture to Vector* and choose **Publish**.
4. **Describe your resource.** Suggested copy:
   - **Name:** Texture to Vector
   - **Tagline:** Turn Figma's Texture effect into real vector paths that survive SVG
     export.
   - **Description:**

     > Figma's Texture effect gives shapes a lovely hand-drawn edge, but it lives only in
     > Figma: SVG export writes it as a filter that Illustrator, Inkscape and browsers
     > can't turn into shapes.
     >
     > Texture to Vector traces Figma's own render of the texture, one colour at a
     > time, and places clean vector paths next to your layer, ready to export. It
     > handles icons with several colours, textures on frames or on individual layers,
     > and "Clip to shape".
     >
     > Select layers → Vectorize texture. Choose the trace resolution (4×, 8×, 16×),
     > how much to simplify, and whether to keep the original. Copy or download the SVG
     > straight from the panel.

   - **Category:** Design tools › Import & export
5. **Choose some images.** Upload the icon, the thumbnail and any carousel images.
6. **Data security** is optional. If you fill it in, the honest answers are short: the
   plugin makes no network requests (`networkAccess` is `none`), stores nothing, and
   only reads and writes the current file. Figma reviews these answers separately,
   which can take up to two weeks.
7. **Add the final details.**
   - **Publish to:** Community.
   - **Support contact:** the issues page,
     `https://github.com/edoardobiasini/figma-texture-vector/issues`, or an email
     address.
   - **Network access** should read **No access**, taken from the manifest.
   - **Leave "Sell on Community" off.** The plugin is free by default, and a paid
     plugin can never be made free later, only delisted.
8. Click **Publish**. The plugin moves to the Published section with an **In review**
   badge, and Figma emails you when the review is done. There is no fixed timeline. If
   the plugin is rejected, address the feedback and submit again.

## Updating a published plugin

1. Make the change, bump `"version"` in `package.json`, and run `pnpm build`.
2. Go to **Plugins → Development → Manage plugins in development** and choose **⋯ →
   Publish** again. The dialog now publishes a new version of the existing listing. Add
   a short note on what changed.
3. Optionally, attach the same build to a GitHub release with `pnpm package` (see the
   README).

You can edit the listing text and images at any time without uploading a new version.
