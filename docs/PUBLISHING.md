# Publishing to the Figma Community

Publishing happens inside the Figma desktop app, not on GitHub. Figma uploads the built
files (`dist/code.js`, `dist/ui.html`) together with the listing you fill in, and
reviews the plugin before it goes public.

Sources: [Publish plugins to the Figma Community](https://help.figma.com/hc/en-us/articles/360042293394-Publish-plugins-to-the-Figma-Community),
[Publishing to the Community (BYFP 5)](https://help.figma.com/hc/en-us/articles/4407531267607--BYFP-5-Publishing-to-the-Community).

## Before you start

- **Two-factor authentication** must be on for your Figma account (Settings →
  Security). Figma refuses to publish without it.
- **The Figma desktop app.** Publishing isn't possible from the browser.
- **A fresh build, imported from this repository.** Run `pnpm build`, then import
  `manifest.json` from the repository folder (not from an unzipped release), so the ID
  you'll get in the next section lands in the file you commit.
- **The listing assets**:
  - an **icon**, 128 × 128 px PNG;
  - a **thumbnail**, 1920 × 1080 px image or video;
  - optionally, a **carousel** of up to 9 images or videos and a **playground file**
    that people can open to try the plugin.

  A good thumbnail is a before/after: the textured original next to its vector result
  in outline mode.

## The plugin ID

`manifest.json` ships with a placeholder ID, `texture-to-vector-dev`, which Figma
won't publish. The publish dialog flags it with **"Invalid ID in manifest.json"** and
offers **Generate ID**.

1. Click **Generate ID** and copy the value it shows.
2. Paste it into `manifest.json` as `"id"`, replacing the placeholder.
3. Commit that change right away. Every future update must be published with the same
   ID. Losing it means the next upload becomes a new, separate plugin.

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

   - **Category:** Design tools
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
