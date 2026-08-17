# Bliss Ayres Demo extension

Local, unpacked Chrome extension. It auto-injects the Bliss payment plan overlay
on Ayres iHotelier booking pages so the overlay no longer has to be pasted into
the console, and so it survives the real page loads iHotelier does between the
room list and checkout.

Demo only. Not packed, not signed, not for the Chrome Web Store.

## overlay.js IS A COPY

`overlay.js` is a verbatim copy of `frontend/public/ayres-overlay.js`. It is not
a symlink and there is no build step, so the two drift apart silently the moment
that file changes.

**Re-copy after every change to `frontend/public/ayres-overlay.js`:**

```
cp ~/b2b_bliss/frontend/public/ayres-overlay.js ~/b2b_bliss/tools/ayres-extension/overlay.js
```

Then reload the extension (see below) and hard-reload the booking page.

To check whether the copy is stale:

```
cmp ~/b2b_bliss/frontend/public/ayres-overlay.js ~/b2b_bliss/tools/ayres-extension/overlay.js && echo "in sync" || echo "STALE, re-copy"
```

`frontend/public/ayres-overlay.js` stays the original and the place to edit.
Never edit `overlay.js` directly: the next copy overwrites it.

## Files

| File | What it is |
|---|---|
| `manifest.json` | Manifest V3. One content script, no permissions, no background worker. |
| `overlay.js` | Copy of `frontend/public/ayres-overlay.js`. |

## Why `"world": "MAIN"`

The content script declares `"world": "MAIN"`, which runs it in the page's own
JavaScript context rather than the isolated content script world. Two reasons,
both hard requirements:

1. **Shadow roots.** The Ayres page is an Amadeus `amadeus-hos-res-wc` Web
   Component bundle and renders its room cards inside shadow roots. The overlay
   walks them with `element.shadowRoot`, and it reads the page's own objects.
   The isolated world gets a separate wrapper around the DOM and its own
   `window`, so that traversal does not behave the same way.
2. **The double-injection guard.** The overlay's `destroyExisting()` reads
   `window.__blissOverlay`, disconnects the previous instance's MutationObservers
   and deep-strips every node it injected before starting again. In the isolated
   world the extension and a console paste would hold two different `window`
   objects, neither able to see the other, and you would get two overlapping
   teasers on every card. Sharing the page's `window` is what makes a manual
   paste on top of the extension cleanly replace it instead of duplicating it.

`"world": "MAIN"` needs Chrome 111 or newer.

## Scope

- `matches` is `https://reservations.ayreshotels.com/*` only.
- `all_frames: true`, because the booking page carries iframes. Each frame gets
  its own instance and each guards itself.
- `run_at: document_idle`, so the component bundle has mounted before the
  overlay first looks for cards. It does not have to be exact: the overlay
  installs a MutationObserver and re-syncs as the page renders.
- No `permissions` and no `host_permissions`. A content script declared in the
  manifest needs neither.
- No background service worker. Nothing here needs one.

## Verifying it is running

Open DevTools on a booking page and look in the console for:

```
[bliss] ayres overlay installed. __blissOverlay.refresh() / .destroy() / .open() / .state() / .probe()
```

Useful from the console once it is running:

- `__blissOverlay.probe()` shows the cards discovery found and the price
  assembled for each.
- `__blissOverlay.stay()` shows the parsed check-in, check-out and night count,
  and whether they came from the page's date control or from the URL.
- `__blissOverlay.destroy()` removes everything the overlay injected.
- `__blissOverlay.refresh()` re-samples and re-renders.

If the console is silent, the extension is not injecting: confirm the URL is
under `reservations.ayreshotels.com`, then reload the extension.
