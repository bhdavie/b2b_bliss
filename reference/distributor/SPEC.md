# Mews Distributor DOM spec

Derived from five live captures of the Mews Distributor iframe body (`outerHTML`) at
each of its five steps:

| File | Step | `data-test-step` | Bytes |
| --- | --- | --- | --- |
| `01-dates.html` | 1 Dates | `dates` | 25,683 |
| `02-categories.html` | 2 Categories | `categories` | 163,773 |
| `03-rates.html` | 3 Rates | `rates` | 52,420 |
| `04-summary.html` | 4 Summary | `summary` | 34,156 |
| `05-details.html` | 5 Details | `checkout` | 55,255 |

Property captured: **Freehand New York**. Locale `English (United States)`, currency `USD`.
Each file is a single line with no newlines. All markup quoted below is verbatim from the
captures; ellipses (`…`) mark elided subtrees and are called out where used.

---

## 1. Page shell per step

### 1.1 Outer wrappers

Identical in all five files, byte for byte:

```html
<body style="margin: 0px; padding: 0px; overflow-x: hidden; height: 100%; cursor: auto;">
  <div id="distributor" style="height: 100%">
    <div data-mds-element="true" class="AppCanvas-sc-c84cea1d-0 jPaNXy">
      <div data-mds-element="true" class="Card-sc-6935efe6-0 SkipLinksCard-sc-36f0bdac-0 dZDrMq cOUJdN">…</div>
      <div width="100%" data-mds-element="true" class="Container-sc-bac7a368-0 ewGPaK">
        <div role="banner" id="toolbar" class="AppbarContainer-sc-a9596810-0 bOscxz AppbarFlat-sc-76573618-0 hUSfdS" data-mds-element="true">…</div>
        <nav id="navigation" aria-label="Progress" class="Navbar-sc-d0924235-0 ijAlIS">…</nav>
      </div>
      <main offset="152" id="main" data-mds-element="true" class="AppView-sc-c84cea1d-1 jJKfnO">…</main>
      <div data-mds-element="true"></div>
      <div id="portal-container">…</div>
    </div>
  </div>
  <div class="apt-guide-overlay-top"    style="display: none; visibility: hidden;"></div>
  <div class="apt-guide-overlay-bottom" style="display: none; visibility: hidden;"></div>
  <div class="apt-guide-overlay-left"   style="display: none; visibility: hidden;"></div>
  <div class="apt-guide-overlay-right"  style="display: none; visibility: hidden;"></div>
  <style id="px-default-font-var" type="text/css">…</style>
</body>
```

Stable hooks in this chain, present on every step:

| Hook | Element |
| --- | --- |
| `#distributor` | app mount point, direct child of `body` |
| `.AppCanvas-sc-c84cea1d-0` | app canvas |
| `#toolbar` (`role="banner"`) | property header |
| `#navigation` (`aria-label="Progress"`) | stepper |
| `#main` (`<main offset="152">`) | step content |
| `#portal-container` | overlay/alert portal root |

`#portal-container` is empty on steps 2–5. On step 1 only it holds an alerts container:

```html
<div id="portal-container"><div><div data-test-alerts-container="true" data-test-alerts-container-position="center" data-mds-element="true" data-disable-click-away="true" class="AlertTransitionGroup-sc-20285b7-0 hCYGov"></div></div></div>
```

The four `apt-guide-overlay-*` divs and the `#px-default-font-var` `<style>` block are a
third-party product-tour library (`apt-`/`px-`), present and hidden in **all five**
captures. On step 5 they are followed by the reCAPTCHA badge and its iframes (see §8), so
they are no longer the last nodes in the document.

### 1.2 Skip links

First child of `AppCanvas`, identical on all five steps:

```html
<div data-mds-element="true" class="Card-sc-6935efe6-0 SkipLinksCard-sc-36f0bdac-0 dZDrMq cOUJdN">
  <div data-mds-element="true" class="Typography-sc-b700300d-0 kHa-dAQ">
    <span data-test-textkey="SkipTo" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Skip to:</span>
  </div>
  <ol data-mds-element="true" class="SkipLinksList-sc-36f0bdac-1 hloZEm">
    <li><a href="#toolbar" …><span data-test-textkey="Toolbar" …>Toolbar</span></a></li>
    <li><a href="#navigation" …><span data-test-textkey="SiteNavigation" …>Site navigation</span></a></li>
    <li><a href="#main" …><span data-test-textkey="MainContent" …>Main content</span></a></li>
  </ol>
</div>
```

### 1.3 Toolbar (`#toolbar`)

Property identity on the left, language + currency selectors on the right:

```html
<div role="banner" id="toolbar" class="AppbarContainer-sc-a9596810-0 bOscxz AppbarFlat-sc-76573618-0 hUSfdS" data-mds-element="true">
  <div class="Stack-sc-261eb2-0 iAeqZk">
    <div class="Container-sc-bac7a368-0 duXZMW">
      <div class="Stack-sc-261eb2-0 hArRLs">
        <div class="ImageWrap-sc-6ae5e35e-0 YwkRJ">
          <img sizes="…" srcset="https://cdn.mews.com/media/image/ebdcdf11-3fc7-441b-90d2-abb1014aa8f1?…" src="…" alt="Freehand New York" class="ImageElement-sc-88b5c048-0 jImfKO">
        </div>
        <div class="PropertyName-sc-6ae5e35e-1 jpwOiZ">Freehand New York</div>
      </div>
    </div>
    <div class="Stack-sc-261eb2-0 NYldK">
      <!-- language -->
      <div class="FieldContainer-sc-22d84847-0 cJhBJZ" data-test-field="languageSelector">
        <div tabindex="-1" data-test-id="language-selector" aria-label="Select language" class="ComboInputElement-sc-5627ed07-0 eXMtKb">…English (United States)…</div>
      </div>
      <!-- currency -->
      <div class="FieldContainer-sc-22d84847-0 cJhBJZ" data-test-field="currencySelect">
        <div tabindex="-1" data-test-id="currency-selector" aria-label="Select currency" class="ComboInputElement-sc-5627ed07-0 eXMtKb">…USD…</div>
      </div>
    </div>
  </div>
</div>
```

The displayed value of each selector is duplicated three ways: as text in
`div.SingleValueElement-sc-5627ed07-9`, as `data-test-display-value` on the `<input
role="combobox">` (`id="languageSelector"` / `id="currencySelect"`), and inside a
`VisuallyHidden-sc-ad4461ad-0` label span. `data-test-display-value` is the cleanest read
for the active currency code.

### 1.4 Stepper (`#navigation`) and the "N of 5" control

```html
<nav id="navigation" aria-label="Progress" class="Navbar-sc-d0924235-0 ijAlIS">
  <div data-mds-element="true" class="OpenableVerticalStepperContainer-sc-78ab04ee-3 blRrXP">
    <button type="button" aria-expanded="false" data-mds-element="true" class="ToggleButtonElement-sc-78ab04ee-4 bBWpGX">
      <div data-mds-element="true" class="StepCountElement-sc-78ab04ee-5 jMkIXp">1 of 5</div>
      <span data-test-icon="chevron_down" aria-hidden="true" class="IconWrapper-sc-1055dc55-0 djSlFw ExpandIcon-sc-99518696-0 gwnTHe"><svg …/></span>
    </button>
    <nav aria-label="progress" data-mds-element="true" class="NavElement-sc-78ab04ee-0">
      <ol data-mds-element="true" class="ProgressIndicatorContainer-sc-78ab04ee-1 fWxlQr">
        <li data-mds-element="true" class="StepWrapper-sc-78ab04ee-6 hiaRwu">
          <div type="button" aria-current="step" data-test-step="dates" aria-label="Link to Dates" data-mds-element="true" class="StepButton-sc-78ab04ee-7 dswEeZ">
            <div data-mds-element="true" class="Container-sc-bac7a368-0 StepInnerWrapper-sc-78ab04ee-8 fieOmq kTHjAr">
              <span data-mds-element="true" class="StepNumberElement-sc-78ab04ee-13 boKMSo">1</span>
              <div data-mds-element="true" class="StepTextWrapper-sc-78ab04ee-9 gAldUt">
                <div data-mds-element="true" class="StepPrimaryTextElement-sc-78ab04ee-10 iLOjXr">
                  <div data-mds-element="true" class="StackItem-sc-261eb2-1 jJXUXI">
                    <span data-test-textkey="DatePlural" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Dates</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </li>
      </ol>
    </nav>
  </div>
</nav>
```

The stepper is in its **collapsed** state in all five captures
(`ToggleButtonElement` has `aria-expanded="false"`). Consequence, and this matters for any
overlay that wants to read progress: **exactly one `li.StepWrapper-sc-78ab04ee-6` and one
`[data-test-step]` element exist per capture — the current step only.** The other four
steps are not in the DOM. The reliable current-step reads are:

- `[data-test-step]` — value is the step key (`dates`, `categories`, `rates`, `summary`, `checkout`)
- `.StepNumberElement-sc-78ab04ee-13` — text `1`…`5`
- `.StepCountElement-sc-78ab04ee-5` — text `"1 of 5"`…`"5 of 5"`
- `[aria-label]` on the step button — `Link to Dates` / `Link to Categories` / `Link to Rates` / `Link to Summary` / `Link to Details`

Per-step values:

| File | `data-test-step` | number | count text | textkey | label |
| --- | --- | --- | --- | --- | --- |
| 01 | `dates` | 1 | `1 of 5` | `DatePlural` → "Dates" | `Link to Dates` |
| 02 | `categories` | 2 | `2 of 5` | `Categories` → "Categories" | `Link to Categories` |
| 03 | `rates` | 3 | `3 of 5` | `RatePlural` → "Rates" | `Link to Rates` |
| 04 | `summary` | 4 | `4 of 5` | `Summary` → "Summary" | `Link to Summary` |
| 05 | `checkout` | 5 | `5 of 5` | `DetailPlural` → "Details" | `Link to Details` |

Note the step key for step 5 is `checkout`, not `details`, while its label and textkey say
"Details". Match on `data-test-step="checkout"`.

### 1.5 Layout containers under `#main`

Identical scaffold on all five steps down to the view node:

```html
<main offset="152" id="main" data-mds-element="true" class="AppView-sc-c84cea1d-1 jJKfnO">
  <div data-mds-element="true">
    <div width="100%" data-mds-element="true" class="TransitionElement-sc-d3a4d3f9-0 dSBCuD Container-sc-bac7a368-0 jkdqeE">
      <div aria-busy="false" data-mds-element="true" class="AppContent-sc-c84cea1d-2 ezHttb">
        <div aria-live="assertive" height="100%" data-mds-element="true" class="Container-sc-bac7a368-0 cmmGna"></div>
        <div class="TransitionViewWrapper-sc-ab19fdc9-1 fkzprh" data-mds-element="true">
          <div data-mds-element="true" class="TransitionElement-sc-d3a4d3f9-0 dSBCuD">
            <div aria-live="assertive" class="View-sc-ab19fdc9-0 kkeFKI"></div>   <!-- outgoing view, empty -->
            <div aria-busy="false" class="View-sc-ab19fdc9-0 kkeFKI">            <!-- live view -->
              <div data-test-id="{step}-view" …>
```

Two `div.View-sc-ab19fdc9-0.kkeFKI` siblings exist on every step: the first
(`aria-live="assertive"`) is the empty outgoing transition slot, the second
(`aria-busy="false"`) holds the live content. Select the live view via
`[data-test-id$="-view"]`, never by `.View-sc-…` index.

Per-step view root:

| File | View root (verbatim) |
| --- | --- |
| 01 | `<div height="100%" data-test-id="dates-view" data-mds-element="true" class="Container-sc-bac7a368-0 iwhUZo">` |
| 02 | `<div role="region" class="Container-sc-bac7a368-0 iYAYVN rooms-view" data-test-id="rooms-view" data-mds-element="true">` |
| 03 | `<div data-test-id="rates-view" role="region" data-mds-element="true" class="Container-sc-bac7a368-0 iYAYVN">` |
| 04 | `<div class="Container-sc-bac7a368-0 iYAYVN summary-view" data-test-id="summary-view" role="region" data-mds-element="true">` |
| 05 | `<div data-test-id="checkout-view" role="region" data-mds-element="true" class="Container-sc-bac7a368-0 iYAYVN">` |

Step 2's view id is `rooms-view`, not `categories-view`. Steps 2 and 4 additionally carry
the view name as a literal class token (`rooms-view`, `summary-view`); steps 1, 3 and 5 do
not. Attribute order inside the tag varies per step, so match on the attribute, not on the
serialized string.

### 1.6 Identical vs. changing

**Identical across all five captures.** Everything from `<body>` through the end of
`#navigation` is byte-for-byte identical except for a single text node — the `"N of 5"`
inside `.StepCountElement-sc-78ab04ee-5`. A unified diff of that prefix between any two
files yields exactly one changed line. That covers: body inline style, `#distributor`,
`AppCanvas`, skip links, the whole toolbar (logo URL, property name, language and currency
selectors and their generated class hashes), the stepper container, its toggle button, and
its chevron SVG path data.

The step-identity attributes inside the stepper (`data-test-step`, `StepNumberElement`
text, `data-test-textkey`, `aria-label`) sit past that prefix and do change; the wrapper
classes around them do not, with one exception: `StepButton-sc-78ab04ee-7` takes hash
`dswEeZ` on steps 1 and 4 and `eGgYQk` on steps 2, 3 and 5 (a state variant, not a
per-step identity).

Also identical: the `<main offset="152" id="main" class="AppView-sc-c84cea1d-1 jJKfnO">`
tag, `AppContent-sc-c84cea1d-2 ezHttb`, `TransitionViewWrapper-sc-ab19fdc9-1 fkzprh`, and
the double `View-sc-ab19fdc9-0 kkeFKI` pattern.

**Changes across captures:** the `"N of 5"` text; the step identity attributes; the
`TransitionElement-sc-d3a4d3f9-0` second hash on the `#main` wrapper (`dSBCuD` on step 1,
`jPtPNA` on steps 2–5); the `[data-test-id$="-view"]` subtree; `#portal-container`
contents (populated on step 1, empty on 2–5); and the trailing third-party nodes (the four
tour overlays and the `px-` style block appear in all five, but step 5 adds the reCAPTCHA
badge and iframes after them).

**Structures that appear on some steps only:**

- `data-test-id="dates-occupancy-header"` — steps 2 and 3, the editable dates/guests summary bar.
- Decoration hero image (`DecorationImageElement-sc-77587fe0-0`) — step 1 only.
- Price/total bar (`total-bar-total`, `total-bar-total-value`, `total-bar-tax-included`) — steps 4 and 5 only.
- Tax breakdown (`tax-breakdown-toggle-expandable-box`, `tax-rate`) — steps 4 and 5 only.

The total bar is **not** a fixed footer element: on steps 4 and 5 it lives inline inside
the price breakdown card, after a `data-test-divider="true"` separator, still within the
view subtree. There is no `<footer>` element in any capture.

---

## 2. The five overlay selectors

Summary of presence and match counts. Counts are exact matches on the
`data-test-id` attribute value, not substring matches.

| Selector (`data-test-id=`) | 01 dates | 02 categories | 03 rates | 04 summary | 05 details | Total |
| --- | --- | --- | --- | --- | --- | --- |
| `rate-item` | — | — | **2** | — | — | 2 |
| `rate-item-name` | — | — | **2** | — | — | 2 |
| `localizedCurrency` | — | **14** | **5** | **7** | **6** | 32 |
| `total-bar-total-value` | — | — | — | **1** | **1** | 2 |
| `rate-settlement-rule-description-later` | — | — | — | — | **1** | 1 |

All five are present somewhere in the capture set. None is absent from all files.
Watch for one trap: a naive substring grep for `rate-item` in `03-rates.html` returns 7
hits, because `rate-item-name`, `rate-item-description` and `rate-item-discount` all
contain it. Use an exact attribute-value selector (`[data-test-id="rate-item"]`), which
matches 2.

### 2.1 `rate-item`

Present in `03-rates.html` only. 2 matches. Both are structurally identical `<li>` siblings
of the same `<ul>`.

```html
<li data-test-id="rate-item" data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
```

Parent chain, five levels up (identical for both matches):

```
-1  <ul data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
-2  <div data-mds-element="true" class="Card-sc-6935efe6-0 eZOYxf">
-3  <div data-mds-element="true" class="Stack-sc-261eb2-0 fCDRgD">
-4  <div data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
-5  <div data-test-id="rates-container" data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
```

`[data-test-id="rates-container"]` is the stable ancestor to scope from; it is unique
(1 match) and holds the `rates-heading` `<h2>` plus the `<ul>` of rate items.

### 2.2 `rate-item-name`

Present in `03-rates.html` only. 2 matches, one per rate item.

```html
<h3 data-test-id="rate-item-name" data-mds-element="true" class="Typography-sc-b700300d-0 cjKKGQ">
```

Parent chain:

```
-1  <div>                                                             <!-- bare, no attributes -->
-2  <li data-test-id="rate-item" data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
-3  <ul data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
-4  <div data-mds-element="true" class="Card-sc-6935efe6-0 eZOYxf">
-5  <div data-mds-element="true" class="Stack-sc-261eb2-0 fCDRgD">
```

The `<h3>` wraps a single `<span data-localized-entity="true">` holding the rate name.
Observed values: `Flexible Rate` and `Advance Purchase Rate - 10% OFF ` (note the trailing
space, present in the source). Read `.textContent` and trim; do not assume the text is a
direct child of the `<h3>`.

Note the bare `<div>` at level -1: it carries no class or attribute at all, so
`rate-item > h3[data-test-id="rate-item-name"]` will **not** match. Use a descendant
combinator: `[data-test-id="rate-item"] [data-test-id="rate-item-name"]`.

### 2.3 `localizedCurrency`

Present in four of five files (all but `01-dates.html`). Always the same element shape:

```html
<span dir="ltr" data-test-id="localizedCurrency">$320.50</span>
```

It carries no class and no `data-mds-element`. It is the universal money-text leaf: every
rendered price in the Distributor sits inside one, and the formatted string (symbol,
grouping separators, decimals) is its entire text content. Values observed:

- `02-categories.html` (14): `$253.25`, `$291.95`, `$317.60`, `$330.65`, `$356.30`, `$319.85`, `$319.85`, `$390.95`, `$2,735.00`, `$2,285.00`, `$253.25`, `$317.60`, `$356.30`, `$319.85`
- `03-rates.html` (5): `$75.00`, `$75.00`, `$320.50`, `$320.50`, `$291.95`
- `04-summary.html` (7): `$641.00`, `$641.00`, `$641.00`, `$35.00`, `$1.50`, `$2.00`, `$742.58`
- `05-details.html` (6): `$641.00`, `$641.00`, `$35.00`, `$1.50`, `$2.00`, `$742.58`

Because the element itself is anonymous, **the parent identifies what the money means.**
The distinct parent chains found:

`02-categories.html` — all 14 identical, one per category card "from" price:

```
-1  <strong data-test-id="from-price-value" data-mds-element="true" class="Typography-sc-b700300d-0 dPZSoQ">
-2  <div>
-3  <div data-test-id="from-price-wrapper" data-mds-element="true" class="Stack-sc-261eb2-0 cAYXwR">
-4  <div data-mds-element="true" class="StackItem-sc-261eb2-1 hhTJSI">
-5  <div data-mds-element="true" class="Stack-sc-261eb2-0 dUMcSa">
```

`03-rates.html` — three distinct chains:

Hits 1–2, the two upsell product prices:

```
-1  <strong data-mds-element="true" class="Typography-sc-b700300d-0 fEjEtB">
-2  <div data-test-id="from-price-wrapper" data-mds-element="true" class="Stack-sc-261eb2-0 hcLPBv">
-3  <div data-mds-element="true" class="Stack-sc-261eb2-0 fjzPlV">
-4  <div data-mds-element="true" class="StackItem-sc-261eb2-1 hhTJSI">
-5  <div data-test-id="product-not-added" data-mds-element="true" class="Stack-sc-261eb2-0 cFlOhS">
```

Hits 3 and 5, the effective nightly price of each rate card:

```
-1  <strong data-mds-element="true" class="Typography-sc-b700300d-0 dPZSoQ">
-2  <div data-test-id="from-price-wrapper" data-mds-element="true" class="Stack-sc-261eb2-0 hcLPBv">
-3  <div data-mds-element="true" class="StackItem-sc-261eb2-1 hhTJSI">
-4  <div data-mds-element="true" class="Stack-sc-261eb2-0 dUMcSa">
-5  <li data-test-id="rate-item" data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
```

Hit 4, the struck-through pre-discount price on the discounted rate card only:

```
-1  <s>
-2  <div data-test-id="rate-item-discount" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">
-3  <div data-mds-element="true" class="StackItem-sc-261eb2-1 hhTJSI">
-4  <div data-mds-element="true" class="Stack-sc-261eb2-0 dUMcSa">
-5  <li data-test-id="rate-item" data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
```

This is the one to guard against: within a rate item, `[data-test-id="localizedCurrency"]`
alone can return the crossed-out original price. Scope to
`[data-test-id="from-price-wrapper"] [data-test-id="localizedCurrency"]` for the price
actually charged, and treat `[data-test-id="rate-item-discount"]` as the strikethrough.

`04-summary.html` (7 hits) and `05-details.html` (6) share the same breakdown chains; 04
has one extra hit (the reservation-card room price at `Stack…jOkeHZ > strong…fJRMUK`) that
05 does not render. The remaining chains, in document order:

```
subtotal        -1 <strong data-mds-element="true" class="Typography-sc-b700300d-0 fEjEtB">
                -2 <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                -3 <div data-mds-element="true" class="StackItem-sc-261eb2-1 jJXUXI">
                -4 <div data-mds-element="true" class="Stack-sc-261eb2-0 cOVcHv">
                -5 <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">

nights line     -1 <div data-test-id="additional-info" data-mds-element="true" class="Typography-sc-b700300d-0 iqRakW">
                -2 <div data-mds-element="true" class="StackItem-sc-261eb2-1 jJXUXI">
                -3 <div data-mds-element="true" class="Stack-sc-261eb2-0 cOVcHv">
                -4 <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
                -5 <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">

product line    -1 <div data-test-id="additional-info" data-mds-element="true" class="Typography-sc-b700300d-0 iqRakW">
                -2 <div data-mds-element="true" class="Stack-sc-261eb2-0 eaguPr">
                -3 <div data-mds-element="true" class="Stack-sc-261eb2-0 fNsTGo">
                -4 <div data-mds-element="true" class="ExpandableBoxElement-sc-9d74e602-0 josDNa" style="height: auto;">
                -5 <div data-mds-element="true" class="StackItem-sc-261eb2-1 jJXUXI">

tax lines (x2)  -1 <div data-test-id="tax-rate" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">
                -2 <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                -3 <div data-mds-element="true" class="ExpandableBoxElement-sc-9d74e602-0 josDNa" style="height: auto;">
                -4 <div data-mds-element="true" class="StackItem-sc-261eb2-1 jJXUXI">
                -5 <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">

grand total     -1 <strong data-test-id="total-bar-total-value" data-mds-element="true" class="Typography-sc-b700300d-0 iTJbDv">
                -2 <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                -3 <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
                -4 <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
                -5 <div aria-busy="false">
```

### 2.4 `total-bar-total-value`

Present in `04-summary.html` and `05-details.html`. Exactly 1 match in each. The two are
byte-identical, including the value.

```html
<strong data-test-id="total-bar-total-value" data-mds-element="true" class="Typography-sc-b700300d-0 iTJbDv"><span dir="ltr" data-test-id="localizedCurrency">$742.58</span></strong>
```

Parent chain (identical in both files):

```
-1  <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
-2  <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
-3  <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
-4  <div aria-busy="false">
-5  <div data-mds-element="true" class="TransitionElement-sc-d3a4d3f9-0 dSBCuD">
```

Its label sibling inside the same `Stack…jtbGwA` row is
`<strong data-test-id="total-bar-total" …><span data-test-textkey="Total" …>Total</span></strong>`,
and the row below it is
`<div data-test-id="total-bar-tax-included" …>` containing
`<span data-test-textkey="TaxIncluded" …>Tax included</span>`.

This is the single most reliable "amount the guest will be charged" hook in the whole flow,
but note it only exists on steps 4 and 5. On steps 1–3 there is no total anywhere in the
DOM; the largest price visible is a per-night or per-stay rate.

### 2.5 `rate-settlement-rule-description-later`

Present in `05-details.html` only. Exactly 1 match. Unlike the other four it is a
text-key span, so it carries copy, not a number.

```html
<span data-test-id="rate-settlement-rule-description-later" data-test-textkey="YouWillPayLater" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">You'll pay later based on your booking conditions.</span>
```

Parent chain:

```
-1  <div data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">
-2  <div data-test-id="rate-group-description" data-mds-element="true" class="Stack-sc-261eb2-0 ePaymS">
-3  <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
-4  <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
-5  <div aria-busy="false">
```

Levels -3 through -5 are shared with `total-bar-total-value`, so
`[data-test-id="rate-group-description"]` and the total bar are siblings within the same
payment block on step 5. `[data-test-id="rate-group-description"]` is unique (1 match) and
is the better anchor for injecting adjacent to the settlement copy.

The `-later` suffix is a settlement-rule variant. This capture was of a "pay later" rate;
a prepaid/deposit rate would presumably swap in a different variant id, which this capture
set does not contain, so do not assume `-later` is always present. `data-test-textkey`
holds the invariant key `YouWillPayLater`, which is locale-stable where the visible text is
not.

---

## 3. Rate card anatomy (`03-rates.html`)

### 3.1 Container above the cards

Both cards sit in one shared `<ul>` inside one shared `Card` shell. There is no per-card
`Card` wrapper, so the visual "cards" are `<li>` rows separated by CSS, not discrete card
components.

```html
<div data-mds-element="true" class="ViewWrapper-sc-ab19fdc9-2 gahEAL">
  <div data-mds-element="true" class="View-sc-ab19fdc9-0 iSYczP">
    <div data-mds-element="true" class="Container-sc-bac7a368-0 gpnqbQ">
      <div data-test-id="rates-container" data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
        <div data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
          <h2 data-test-id="rates-heading" data-mds-element="true" class="Typography-sc-b700300d-0 fjxwyQ">
            <span data-test-textkey="RatePlural" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Rates</span>
          </h2>
          <div data-mds-element="true" class="Stack-sc-261eb2-0 fCDRgD">
            <div data-mds-element="true" class="Card-sc-6935efe6-0 eZOYxf">
              <ul data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
                <!-- rate items here -->
```

### 3.2 One complete card, verbatim

Card 1 of 2, `<li>` through CTA button, indentation added; text and attributes unmodified.

```html
<li data-test-id="rate-item" data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">
  <div>
    <h3 data-test-id="rate-item-name" data-mds-element="true" class="Typography-sc-b700300d-0 cjKKGQ">
      <span data-localized-entity="true">Flexible Rate</span>
    </h3>
  </div>
  <div>
    <div data-mds-element="true" class="ExpandableBoxElement-sc-9d74e602-0 bCPIHw">
      <div data-mds-element="true" class="ContentContainer-sc-f87faaca-1 flDbxK">
        <div>
          <div data-mds-element="true" class="Typography-sc-b700300d-0 hcYQdh">
            <p data-test-id="rate-item-description" data-mds-element="true" class="Typography-sc-b700300d-0 byShYI">
              <span>Take advantage of our best and least restrictive publicly available rate, with the option to cancel up to 24 hours prior to arrival with no charge. <br><br>Cancelling the reservation after 24 hours prior to arrival (local hotel time), or failing to show, will result in a charge for the entire stay (including all taxes and fees) being made to your credit card or other guaranteed payment method.<br><br>Guarantee Policy - A credit or debit card will be required to confirm your reservation.</span>
            </p>
          </div>
          <div aria-hidden="true" data-mds-element="true" class="GradientElement-sc-f87faaca-2 gIiZWV"></div>
        </div>
      </div>
    </div>
    <button type="button" data-test-toggle="true" aria-expanded="false" aria-hidden="true" data-mds-element="true" class="ToggleContainer-sc-f87faaca-0 bFwyh">
      <div data-mds-element="true" class="Stack-sc-261eb2-0 hSGKiu">
        <span data-test-icon="chevron_down" aria-hidden="true" data-mds-element="true" class="IconWrapper-sc-1055dc55-0 djSlFw ExpandIcon-sc-99518696-0 gwnTHe">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" variant="inherit" role="presentation" data-mds-element="true" class="StyledIcon-sc-1055dc55-1 dSJjlg">
            <path fill="#21212E" d="M5.22 8.227a.79.79 0 0 0 0 1.095l6.25 6.451a.733.733 0 0 0 1.06 0l6.25-6.451a.79.79 0 0 0 0-1.095.733.733 0 0 0-1.06 0L12 14.13 6.28 8.227a.734.734 0 0 0-1.06 0"></path>
          </svg>
        </span>
        <div data-mds-element="true" class="Typography-sc-b700300d-0 kHa-dAQ">
          <span data-test-textkey="More" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">More</span>
        </div>
      </div>
    </button>
  </div>
  <div data-mds-element="true" class="Stack-sc-261eb2-0 dUMcSa">
    <div data-mds-element="true" class="StackItem-sc-261eb2-1 hhTJSI">
      <div data-test-id="from-price-wrapper" data-mds-element="true" class="Stack-sc-261eb2-0 hcLPBv">
        <strong data-mds-element="true" class="Typography-sc-b700300d-0 dPZSoQ">
          <span dir="ltr" data-test-id="localizedCurrency">$320.50</span>
          <span>&nbsp;</span>
        </strong>
        <div data-mds-element="true" class="Typography-sc-b700300d-0 hIDkpl">
          <span data-test-textkey="PerNight" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 cEOpqt">Nightly</span>
        </div>
      </div>
      <div data-test-id="tax-label" data-mds-element="true" class="Typography-sc-b700300d-0 fgHFfh">(<span data-test-id="tax-label" data-test-textkey="FeesIncluded" class="StyledSpan-sc-943982d8-0 inKsGw">Facility Fee  included</span>, <span data-test-id="tax-label" data-test-textkey="ExcludingTaxes" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Taxes excluded</span>)</div>
    </div>
    <button data-test-id="price-footer-button" type="button" aria-label="Book now" data-mds-element="true" class="ButtonElement-sc-b5156f03-2 bVLDiw">
      <span data-test-textkey="AddRoom" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Book now</span>
    </button>
  </div>
</li>
```

Three top-level blocks inside the `<li>`, in order:

1. **Name block** — bare `<div>` → `h3[data-test-id="rate-item-name"]` → `span[data-localized-entity="true"]`.
2. **Description block** — bare `<div>` → collapsible `ExpandableBoxElement` containing `p[data-test-id="rate-item-description"]`, plus a fade `GradientElement` and a `button[data-test-toggle="true"]` "More" control. The toggle is `aria-expanded="false"` and `aria-hidden="true"` in this capture.
3. **Price/CTA block** — `div.Stack-sc-261eb2-0.dUMcSa` containing the price stack and `button[data-test-id="price-footer-button"]`.

The CTA carries no rate identifier of its own. To bind a click to a specific rate, read the
name from the enclosing `[data-test-id="rate-item"]`, or use the `<li>` index within the
`<ul>`. `aria-label="Book now"` duplicates the button text.

Both `data-test-id="tax-label"` on the wrapper `<div>` and on the two inner `<span>`s: the
id is not unique within a card (3 occurrences per card), and the wrapper's text content
includes the literal parentheses and comma glue characters. Note the double space in
`Facility Fee  included`, which is in the source.

### 3.3 What varies between the two cards

The two `<li>`s are structurally identical except in four places. A unified diff of card 1
against card 2 yields exactly these changes:

| # | Location | Card 1 | Card 2 |
| --- | --- | --- | --- |
| 1 | `h3[data-test-id="rate-item-name"] > span` | `Flexible Rate` | `Advance Purchase Rate - 10% OFF ` (trailing space) |
| 2 | `p[data-test-id="rate-item-description"] > span` | flexible-rate cancellation copy | advance-purchase prepaid/non-refundable copy |
| 3 | `div.StackItem-sc-261eb2-1.hhTJSI` first child | absent | extra discount node inserted **before** `from-price-wrapper` |
| 4 | `from-price-wrapper` price text | `$320.50` | `$291.95` |

The inserted discount node, present only on card 2:

```html
<div data-test-id="rate-item-discount" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">
  <s>&nbsp;<span dir="ltr" data-test-id="localizedCurrency">$320.50</span>&nbsp;</s>
</div>
```

The struck price equals card 1's price ($320.50), and $291.95 is 10% off $324.39 — that is,
the discount is applied to the underlying rate, not to card 1's displayed figure, so do not
derive one from the other.

Everything else is byte-identical between the cards: every class hash, the chevron SVG
path, the `More` toggle, `PerNight` → "Nightly", the full `tax-label` group, the
`price-footer-button` class `ButtonElement-sc-b5156f03-2 bVLDiw`, and the `AddRoom` →
"Book now" CTA label. In particular, **the discounted card does not get a distinguishing
class or modifier** — presence of `[data-test-id="rate-item-discount"]` is the only signal
that a card is discounted.

Also note the CTA textkey is `AddRoom` while the rendered text is "Book now", and the
upsell items further up the same page use the same `data-test-id="price-footer-button"`
with textkey `Add`. A page-wide `[data-test-id="price-footer-button"]` selector matches 4
elements on this step: 2 upsell "Add" buttons and 2 rate "Book now" buttons. Scope through
`[data-test-id="rate-item"]`.

---

## 4. Summary price breakdown (`04-summary.html`)

The breakdown is a single `Card-sc-6935efe6-0 eZOYxf` sibling of the reservation card,
inside `[data-test-id="summary-view"]`. It contains, in order: the line-item block, a
divider, the tax block, a divider, and the total block. Quoted verbatim below with
indentation added and the two chevron `<svg>` subtrees elided as `<svg …/>`; every other
character, including `&nbsp;`-free inline spacing and the `×` glyphs, is as captured.

```html
<div data-mds-element="true" class="Card-sc-6935efe6-0 eZOYxf">
  <div class="TransitionViewWrapper-sc-ab19fdc9-1 fkzprh" data-mds-element="true">
    <div data-mds-element="true" class="TransitionElement-sc-d3a4d3f9-0 dSBCuD">
      <div aria-live="assertive"></div>
      <div aria-busy="false">

        <!-- ── line items ────────────────────────────────────────────── -->
        <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
          <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
            <div data-mds-element="true" class="Stack-sc-261eb2-0 cOVcHv">

              <div data-mds-element="true" class="StackItem-sc-261eb2-1 jJXUXI">
                <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                  <strong data-mds-element="true" class="Typography-sc-b700300d-0 fEjEtB">
                    <span data-localized-entity="true">Premium Queen</span>  + <span data-localized-entity="true">Flexible Rate</span>
                  </strong>
                  <strong data-mds-element="true" class="Typography-sc-b700300d-0 fEjEtB">
                    <span dir="ltr" data-test-id="localizedCurrency">$641.00</span>
                  </strong>
                </div>
                <div data-test-id="additional-info" data-mds-element="true" class="Typography-sc-b700300d-0 iqRakW">1 × <span dir="ltr" data-test-id="localizedCurrency">$641.00</span></div>
              </div>

              <div data-mds-element="true" class="StackItem-sc-261eb2-1 jJXUXI">
                <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                  <button data-test-id="toggle-expandable-box" type="button" data-mds-element="true" class="Clickable-sc-cc903565-0 hxHGtE">
                    <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                      <div data-mds-element="true" class="Typography-sc-b700300d-0 kHa-dAQ">
                        <span data-test-textkey="ProductsAndExtras" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Products and extras</span>
                        <span data-test-icon="chevron_up" aria-hidden="true" data-mds-element="true" class="IconWrapper-sc-1055dc55-0 djSlFw ExpandIcon-sc-99518696-0 iAiIxz"><svg …/></span>
                      </div>
                    </div>
                  </button>
                  <div data-mds-element="true" class="Typography-sc-b700300d-0 kHa-dAQ"></div>
                </div>

                <div data-mds-element="true" class="ExpandableBoxElement-sc-9d74e602-0 josDNa" style="height: auto;">
                  <div data-mds-element="true" class="Stack-sc-261eb2-0 fNsTGo">
                    <div data-mds-element="true" class="Stack-sc-261eb2-0 eaguPr">
                      <div data-test-id="product" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">
                        <span data-localized-entity="true">Facility Fee </span>
                      </div>
                      <div data-test-id="additional-info" data-mds-element="true" class="Typography-sc-b700300d-0 iqRakW">2 × <span dir="ltr" data-test-id="localizedCurrency">$35.00</span></div>
                    </div>
                    <div data-mds-element="true" class="Typography-sc-b700300d-0 iqRakW">
                      <span data-test-textkey="IncludedInRate" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Included in rate</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        <div data-test-divider="true" direction="horizontal" role="none" data-mds-element="true" class="DividerContainer-sc-b980cab6-0 jQYXav">
          <div direction="horizontal" data-mds-element="true" class="DividerElement-sc-b980cab6-1 hlaxBP"></div>
        </div>

        <!-- ── taxes ─────────────────────────────────────────────────── -->
        <div data-mds-element="true" class="Stack-sc-261eb2-0 uramG">
          <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
            <div data-mds-element="true" class="StackItem-sc-261eb2-1 jJXUXI">
              <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                <button data-test-id="tax-breakdown-toggle-expandable-box" type="button" data-mds-element="true" class="Clickable-sc-cc903565-0 hxHGtE">
                  <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                    <div data-mds-element="true" class="Typography-sc-b700300d-0 kHa-dAQ">
                      <span data-test-textkey="TaxPlural" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Taxes</span>
                      <span data-test-icon="chevron_up" aria-hidden="true" data-mds-element="true" class="IconWrapper-sc-1055dc55-0 djSlFw ExpandIcon-sc-99518696-0 iAiIxz"><svg …/></span>
                    </div>
                  </div>
                </button>
                <div data-mds-element="true" class="Typography-sc-b700300d-0 kHa-dAQ">$101.58</div>
              </div>

              <div data-mds-element="true" class="ExpandableBoxElement-sc-9d74e602-0 josDNa" style="height: auto;">
                <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                  <div data-test-id="tax-rate" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">New York Javits Expansion Charge <span dir="ltr" data-test-id="localizedCurrency">$1.50</span></div>
                  <div data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">$3.00</div>
                </div>
                <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                  <div data-test-id="tax-rate" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">New York Metropolitan Commuter Transportation Mobility Tax <span data-localized-entity="true">0.375%</span></div>
                  <div data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">$2.41</div>
                </div>
                <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                  <div data-test-id="tax-rate" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">New York City Hotel Room Occupancy Tax <span dir="ltr" data-test-id="localizedCurrency">$2.00</span></div>
                  <div data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">$4.00</div>
                </div>
                <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                  <div data-test-id="tax-rate" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">New York City Occupancy Tax <span data-localized-entity="true">5.875%</span></div>
                  <div data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">$37.67</div>
                </div>
                <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                  <div data-test-id="tax-rate" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">New York City Sales Tax <span data-localized-entity="true">4.5%</span></div>
                  <div data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">$28.86</div>
                </div>
                <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
                  <div data-test-id="tax-rate" data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">New York State Sales Tax <span data-localized-entity="true">4%</span></div>
                  <div data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">$25.64</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div data-test-divider="true" direction="horizontal" role="none" data-mds-element="true" class="DividerContainer-sc-b980cab6-0 jQYXav">
          <div direction="horizontal" data-mds-element="true" class="DividerElement-sc-b980cab6-1 hlaxBP"></div>
        </div>

        <!-- ── total ─────────────────────────────────────────────────── -->
        <div data-mds-element="true" class="Stack-sc-261eb2-0 iXMjCC">
          <div data-mds-element="true" class="Stack-sc-261eb2-0 jtbGwA">
            <strong data-test-id="total-bar-total" data-mds-element="true" class="Typography-sc-b700300d-0 iTJbDv">
              <span data-test-textkey="Total" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Total</span>
            </strong>
            <strong data-test-id="total-bar-total-value" data-mds-element="true" class="Typography-sc-b700300d-0 iTJbDv">
              <span dir="ltr" data-test-id="localizedCurrency">$742.58</span>
            </strong>
          </div>
          <div data-test-id="total-bar-tax-included" data-mds-element="true" class="Stack-sc-261eb2-0 ePaymS">
            <div data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">
              <span data-test-textkey="TaxIncluded" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">Tax included</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</div>
```

### 4.1 Line items

| Row | Label source | Amount | Amount element |
| --- | --- | --- | --- |
| Room + rate | two `span[data-localized-entity]` joined by a literal `" + "` (two spaces before the `+`): `Premium Queen`, `Flexible Rate` | `$641.00` | `strong.Typography-sc-b700300d-0.fEjEtB > span[data-test-id="localizedCurrency"]` |
| Unit detail | `[data-test-id="additional-info"]`, text prefix `1 × ` | `$641.00` | nested `[data-test-id="localizedCurrency"]` |
| Products and extras (collapsible header) | `[data-test-textkey="ProductsAndExtras"]` | none | value div is empty |
| Facility Fee | `[data-test-id="product"] > span[data-localized-entity]` (trailing space in `Facility Fee `) | `2 × $35.00` in `[data-test-id="additional-info"]`; charge shown as `[data-test-textkey="IncludedInRate"]` → "Included in rate" | `[data-test-id="localizedCurrency"]` for the unit price only |

The product row has **no own-line total** — it is included in the rate, so the only money
on it is the unit price. Do not sum it into the total.

### 4.2 Taxes

Aggregate: `$101.58`, rendered as a **bare text node** in
`div.Typography-sc-b700300d-0.kHa-dAQ`, the sibling immediately after
`button[data-test-id="tax-breakdown-toggle-expandable-box"]`. It has no `data-test-id` and
is **not** wrapped in `localizedCurrency`.

Six `[data-test-id="tax-rate"]` rows. Each is a two-cell `Stack-sc-261eb2-0 jtbGwA`: the
`tax-rate` div holds name + basis, and its unlabelled sibling holds the charged amount.

| Tax name | Basis (element) | Charged amount |
| --- | --- | --- |
| New York Javits Expansion Charge | `$1.50` in `span[data-test-id="localizedCurrency"]` | `$3.00` |
| New York Metropolitan Commuter Transportation Mobility Tax | `0.375%` in `span[data-localized-entity="true"]` | `$2.41` |
| New York City Hotel Room Occupancy Tax | `$2.00` in `span[data-test-id="localizedCurrency"]` | `$4.00` |
| New York City Occupancy Tax | `5.875%` in `span[data-localized-entity="true"]` | `$37.67` |
| New York City Sales Tax | `4.5%` in `span[data-localized-entity="true"]` | `$28.86` |
| New York State Sales Tax | `4%` in `span[data-localized-entity="true"]` | `$25.64` |

Two things to be careful about here. First, the basis is heterogeneous: per-unit charges
use `localizedCurrency`, percentage taxes use `data-localized-entity`. A selector that
looks for `localizedCurrency` inside `tax-rate` finds 2 of 6 rows. Second, **the charged
amounts ($3.00, $2.41, $4.00, $37.67, $28.86, $25.64) are bare text nodes with no
`data-test-id` and no `localizedCurrency` wrapper.** The only handle on them is
"next element sibling of the `[data-test-id="tax-rate"]` div". This is why the file has 6
`tax-rate` elements but only 7 `localizedCurrency` spans in total.

The six charged amounts sum to $101.58, matching the aggregate.

### 4.3 Total

```
[data-test-id="total-bar-total"]        → textkey "Total"
[data-test-id="total-bar-total-value"]  → $742.58 (inside localizedCurrency)
[data-test-id="total-bar-tax-included"] → textkey "TaxIncluded" → "Tax included"
```

$641.00 room + $101.58 taxes = $742.58. The Facility Fee is excluded, consistent with its
"Included in rate" marker.

### 4.4 Every `data-test-id` inside this breakdown

`localizedCurrency` (6 of the file's 7; the 7th is on the reservation card above),
`additional-info` (2), `toggle-expandable-box` (1), `product` (1),
`tax-breakdown-toggle-expandable-box` (1), `tax-rate` (6), `total-bar-total` (1),
`total-bar-total-value` (1), `total-bar-tax-included` (1).

`data-test-textkey` inside the breakdown: `ProductsAndExtras`, `IncludedInRate`,
`TaxPlural`, `Total`, `TaxIncluded`. `data-test-icon`: `chevron_up` ×2.
Structural-only attributes: `data-test-divider="true"` ×2, `data-localized-entity="true"`
×7 (room, rate, product name, four tax percentages).

### 4.5 Difference on step 5

Step 5 re-renders the same breakdown with the same values ($641.00 / $101.58 / $742.58),
the same six tax rows and the same class hashes. Comparing the two
`TransitionViewWrapper-sc-ab19fdc9-1 fkzprh` subtrees, the diff is exactly one insertion:
step 5 appends the settlement block after `[data-test-id="total-bar-tax-included"]`,
inside the same `Stack-sc-261eb2-0 iXMjCC` as the total.

```html
<div data-test-id="rate-group-description" data-mds-element="true" class="Stack-sc-261eb2-0 ePaymS">
  <div data-mds-element="true" class="Typography-sc-b700300d-0 bmYgdK">
    <span data-test-id="rate-settlement-rule-description-later" data-test-textkey="YouWillPayLater" data-non-sensitive="true" class="StyledSpan-sc-943982d8-0 inKsGw">You'll pay later based on your booking conditions.</span>
  </div>
</div>
```

The enclosing wrapper differs, though. On step 4 the breakdown is its own
`Card-sc-6935efe6-0 eZOYxf`, a sibling of `summary-reservation-card`. On step 5 there is
no reservation card at all (no `summary-card-*` ids, hence 6 `localizedCurrency` spans
instead of 7); the breakdown lives **inside the payment card**, as the sibling that follows
`<form id="payment-details" aria-label="Payment">`. Anchor on
`TransitionViewWrapper` or on the `total-bar-*` ids, not on "the second `Card` in the
view".

---

## 5. Full attribute vocabulary

Every distinct value of `data-test-id`, `data-test-icon`, `data-test-textkey` and
`data-test-date` across all five captures. Counts are per file (`·` = absent) and are exact
attribute-value matches. Columns 01–05 map to `01-dates`, `02-categories`, `03-rates`,
`04-summary`, `05-details`.

### 5.1 `data-test-id` — 84 distinct values

| value | 01 | 02 | 03 | 04 | 05 | element(s) |
| --- | --- | --- | --- | --- | --- | --- |
| `add-another-reservation-button` | · | · | · | 1 | · | `<button>` |
| `additional-info` | · | · | · | 2 | 2 | `<div>` |
| `age-category-occupancy-field` | 3 | · | 3 | · | · | `<div>` |
| `booker-selection` | · | · | · | · | 1 | `<div>` |
| `button-minus-sign` | 3 | · | 4 | · | · | `<button>` |
| `button-plus-sign` | 3 | · | 4 | · | · | `<button>` |
| `categories-without-availability-heading` | · | 1 | · | · | · | `<div>` |
| `category-card` | · | 14 | · | · | · | `<div>` |
| `category-card-max-persons` | · | 28 | · | · | · | `<div>`, `<ul>` |
| `category-card-name` | · | 14 | · | · | · | `<h3>` |
| `category-detail-card` | · | · | 1 | · | · | `<div>` |
| `category-detail-description` | · | · | 1 | · | · | `<p>` |
| `category-detail-max-persons` | · | · | 1 | · | · | `<div>` |
| `checkout-field-agreeWithConditions` | · | · | · | · | 1 | `<div>` |
| `checkout-field-email` | · | · | · | · | 1 | `<input>` |
| `checkout-field-expiration` | · | · | · | · | 1 | `<input>` |
| `checkout-field-firstName` | · | · | · | · | 1 | `<input>` |
| `checkout-field-holderName` | · | · | · | · | 1 | `<input>` |
| `checkout-field-lastName` | · | · | · | · | 1 | `<input>` |
| `checkout-field-nationalityCode` | · | · | · | · | 1 | `<div>` |
| `checkout-field-notes` | · | · | · | · | 1 | `<textarea>` |
| `checkout-field-phone` | · | · | · | · | 1 | `<div>` |
| `checkout-next-button` | · | · | · | · | 1 | `<button>` |
| `checkout-payment-heading` | · | · | · | · | 1 | `<h2>` |
| `checkout-view` | · | · | · | · | 1 | `<div>` |
| `checkout-your-details-heading` | · | · | · | · | 1 | `<h3>` |
| `currency-selector` | 1 | 1 | 1 | 1 | 1 | `<div>` |
| `dates-next-button` | 1 | · | · | · | · | `<button>` |
| `dates-occupancy-header` | · | 1 | 1 | · | · | `<div>` |
| `dates-view` | 1 | · | · | · | · | `<div>` |
| `enable-booker` | · | · | · | · | 1 | `<button>` |
| `field-pci-proxy-card-number` | · | · | · | · | 1 | `<div>` |
| `field-pci-proxy-cvv` | · | · | · | · | 1 | `<div>` |
| `from-price-value` | · | 14 | · | · | · | `<strong>` |
| `from-price-wrapper` | · | 14 | 4 | · | · | `<div>` |
| `language-selector` | 1 | 1 | 1 | 1 | 1 | `<div>` |
| `localizedCurrency` | · | 14 | 5 | 7 | 6 | `<span>` |
| `marketing-emails-checkbox` | · | · | · | · | 1 | `<div>` |
| `occupancy-container` | · | · | 1 | · | · | `<div>` |
| `occupancy-rooms-selector` | · | · | 1 | · | · | `<div>` |
| `phone.countryCode` | · | · | · | · | 1 | `<input>` |
| `phone.number` | · | · | · | · | 1 | `<input>` |
| `price-footer-button` | · | 14 | 4 | · | · | `<button>` |
| `product` | · | · | · | 1 | 1 | `<div>` |
| `product-item` | · | · | 2 | · | · | `<li>` |
| `product-item-charging-mode` | · | · | 2 | · | · | `<div>` |
| `product-item-description` | · | · | 2 | · | · | `<p>` |
| `product-item-name` | · | · | 2 | · | · | `<h3>` |
| `product-not-added` | · | · | 2 | · | · | `<div>` |
| `rate-group-description` | · | · | · | · | 1 | `<div>` |
| `rate-item` | · | · | 2 | · | · | `<li>` |
| `rate-item-description` | · | · | 2 | · | · | `<p>` |
| `rate-item-discount` | · | · | 1 | · | · | `<div>` |
| `rate-item-name` | · | · | 2 | · | · | `<h3>` |
| `rate-settlement-rule-description-later` | · | · | · | · | 1 | `<span>` |
| `rates-container` | · | · | 1 | · | · | `<div>` |
| `rates-heading` | · | · | 1 | · | · | `<h2>` |
| `rates-view` | · | · | 1 | · | · | `<div>` |
| `reservation-counter-decrement-button` | · | · | · | 1 | · | `<button>` |
| `reservation-counter-increment-button` | · | · | · | 1 | · | `<button>` |
| `rooms-view` | · | 1 | · | · | · | `<div>` |
| `select-category-heading` | · | 1 | · | · | · | `<h1>` |
| `select-rate-heading` | · | · | 1 | · | · | `<h1>` |
| `summary-card-counts-wrapper` | · | · | · | 1 | · | `<div>` |
| `summary-card-date` | · | · | · | 1 | · | `<div>` |
| `summary-card-image` | · | · | · | 1 | · | `<div>` |
| `summary-card-name` | · | · | · | 1 | · | `<h2>` |
| `summary-card-occupancy` | · | · | · | 1 | · | `<div>` |
| `summary-card-rate` | · | · | · | 1 | · | `<div>` |
| `summary-card-rate-description` | · | · | · | 1 | · | `<p>` |
| `summary-heading` | · | · | · | 1 | · | `<h1>` |
| `summary-next-button` | · | · | · | 1 | · | `<button>` |
| `summary-reservation-card` | · | · | · | 1 | · | `<div>` |
| `summary-view` | · | · | · | 1 | · | `<div>` |
| `tax-breakdown-toggle-expandable-box` | · | · | · | 1 | 1 | `<button>` |
| `tax-label` | · | 42 | 10 | · | · | `<div>`, `<span>` |
| `tax-rate` | · | · | · | 6 | 6 | `<div>` |
| `toggle-expandable-box` | · | · | · | 1 | 1 | `<button>` |
| `total-bar-tax-included` | · | · | · | 1 | 1 | `<div>` |
| `total-bar-total` | · | · | · | 1 | 1 | `<strong>` |
| `total-bar-total-value` | · | · | · | 1 | 1 | `<strong>` |
| `upsell-list-expand-button` | · | · | 1 | · | · | `<button>` |
| `upsells-container` | · | · | 1 | · | · | `<div>` |
| `voucher-link` | 1 | · | · | · | · | `<button>` |

### 5.2 `data-test-icon` — 12 distinct values

| value | 01 | 02 | 03 | 04 | 05 | element(s) |
| --- | --- | --- | --- | --- | --- | --- |
| `add` | 1 | · | · | · | · | `<span>` |
| `calendar` | 1 | · | · | 1 | · | `<span>` |
| `camera` | · | 14 | 1 | 1 | · | `<span>` |
| `chevron_down` | 3 | 17 | 9 | 4 | 5 | `<span>` |
| `chevron_left` | · | 14 | 1 | 1 | · | `<span>` |
| `chevron_right` | · | 14 | 1 | 1 | · | `<span>` |
| `chevron_up` | · | · | · | 2 | 2 | `<span>` |
| `countries` | · | · | · | · | 2 | `<span>` |
| `minus_simple` | 3 | · | 4 | 1 | · | `<span>` |
| `plus_simple` | 3 | · | 4 | 2 | · | `<span>` |
| `profile` | · | 14 | 1 | 1 | · | `<span>` |
| `rate_management` | · | · | · | 1 | · | `<span>` |

### 5.3 `data-test-textkey` — 82 distinct values

| value | 01 | 02 | 03 | 04 | 05 | element(s) |
| --- | --- | --- | --- | --- | --- | --- |
| `Add` | · | · | 2 | · | · | `<span>` |
| `AddAnotherItem` | · | · | · | 1 | · | `<span>` |
| `AddPromotionalCode` | 1 | · | · | · | · | `<span>` |
| `AddRoom` | · | · | 2 | · | · | `<span>` |
| `AddToCart` | · | · | · | 1 | · | `<span>` |
| `AdultPlural` | · | 1 | 1 | · | · | `<span>` |
| `AgeCategoryLowerAndUpperBounded` | 2 | · | 2 | · | · | `<span>` |
| `AgreeTo` | · | · | · | · | 1 | `<span>` |
| `BookerDisabled` | · | · | · | · | 1 | `<span>` |
| `BookerEnabled` | · | · | · | · | 1 | `<span>` |
| `BookingNotes` | · | · | · | · | 1 | `<span>` |
| `BookNow` | · | · | 1 | · | · | `<span>` |
| `Categories` | · | 1 | · | · | · | `<span>` |
| `CategoriesWithoutAvailability` | · | 1 | · | · | · | `<span>` |
| `Confirm` | · | · | · | · | 1 | `<span>` |
| `ContactAndPaymentDetails` | · | · | · | · | 1 | `<span>` |
| `Continue` | · | · | · | 1 | · | `<span>` |
| `DatePlural` | 2 | · | · | · | · | `<span>` |
| `DayShortFriday` | · | 1 | 1 | 1 | · | `<span>` |
| `DayShortSunday` | · | 1 | 1 | 1 | · | `<span>` |
| `DetailPlural` | · | · | · | · | 1 | `<span>` |
| `Edit` | · | 1 | 1 | · | · | `<span>` |
| `Email` | · | · | · | · | 2 | `<span>` |
| `EnhanceYourStay` | · | · | 1 | · | · | `<span>` |
| `ExcludingTaxes` | · | 14 | 4 | · | · | `<span>` |
| `FeesIncluded` | · | 14 | 2 | · | · | `<span>` |
| `FirstName` | · | · | · | · | 2 | `<span>` |
| `FromPrice` | · | 14 | · | · | · | `<span>` |
| `GoogleRecaptchaBranding` | · | · | · | · | 1 | `<span>` |
| `GuestPluralSelected` | · | 1 | 1 | · | · | `<span>` |
| `IncludedInRate` | · | · | · | 1 | 1 | `<span>` |
| `LastName` | · | · | · | · | 2 | `<span>` |
| `MainContent` | 1 | 1 | 1 | 1 | 1 | `<span>` |
| `MaxPersons` | · | · | 1 | · | · | `<span>` |
| `MewsMerchant` | · | · | · | · | 1 | `<span>` |
| `MewsPrivacyNotice` | · | · | · | · | 1 | `<span>` |
| `More` | · | 14 | 5 | 1 | · | `<span>` |
| `NameOnCard` | · | · | · | · | 2 | `<span>` |
| `Nationality` | · | · | · | · | 2 | `<span>` |
| `Next` | 1 | · | · | · | · | `<span>` |
| `NightPluralSelected` | · | 1 | 1 | · | · | `<span>` |
| `Occupancy` | · | · | 1 | · | · | `<span>` |
| `Payment` | · | · | · | · | 1 | `<span>` |
| `PaymentCardCVV` | · | · | · | · | 1 | `<span>` |
| `PaymentCardExpiration` | · | · | · | · | 2 | `<span>` |
| `PaymentCardNumber` | · | · | · | · | 1 | `<span>` |
| `PerDorm` | · | 1 | · | · | · | `<span>` |
| `PerNight` | · | 14 | 2 | · | · | `<span>` |
| `PerRoom` | · | 11 | · | · | · | `<span>` |
| `PerSuite` | · | 2 | · | · | · | `<span>` |
| `PhoneNumber` | · | · | · | · | 2 | `<span>` |
| `PrivacyPolicy` | · | · | · | · | 1 | `<span>` |
| `ProductChargingOnce` | · | · | 2 | · | · | `<span>` |
| `ProductsAndExtras` | · | · | · | 1 | 1 | `<span>` |
| `PropertyPrivacyPolicy` | · | · | · | · | 1 | `<span>` |
| `PropertyPrivacyPolicySentence` | · | · | · | · | 1 | `<span>` |
| `PropertyTermsAndConditions` | · | · | · | · | 1 | `<span>` |
| `Rate` | · | · | · | 1 | · | `<span>` |
| `RatePlural` | · | · | 2 | · | · | `<span>` |
| `RemoveFromCart` | · | · | · | 1 | · | `<span>` |
| `Room` | · | · | 1 | · | · | `<span>` |
| `RoomPlural` | · | · | 1 | · | · | `<span>` |
| `SecuredWith` | · | · | · | · | 1 | `<span>` |
| `SelectCategory` | · | 1 | · | · | · | `<span>` |
| `SelectCurrency` | 1 | 1 | 1 | 1 | 1 | `<span>` |
| `SelectDatesTitle` | 1 | · | · | · | · | `<span>` |
| `SelectLanguage` | 1 | 1 | 1 | 1 | 1 | `<span>` |
| `SelectRate` | · | · | 1 | · | · | `<span>` |
| `SendMarketingEmailsTemplateEnterpriseAndChain` | · | · | · | · | 1 | `<span>` |
| `ShowMore` | · | · | 1 | · | · | `<span>` |
| `ShowRates` | · | 14 | · | · | · | `<span>` |
| `SiteNavigation` | 1 | 1 | 1 | 1 | 1 | `<span>` |
| `SkipTo` | 1 | 1 | 1 | 1 | 1 | `<span>` |
| `Sleeps` | · | 14 | · | · | · | `<span>` |
| `Summary` | · | · | · | 2 | · | `<span>` |
| `TaxIncluded` | · | · | · | 1 | 1 | `<span>` |
| `TaxPlural` | · | · | · | 1 | 1 | `<span>` |
| `TermsOfService` | · | · | · | · | 1 | `<span>` |
| `Toolbar` | 1 | 1 | 1 | 1 | 1 | `<span>` |
| `Total` | · | · | · | 1 | 1 | `<span>` |
| `YourDetails` | · | · | · | · | 1 | `<span>` |
| `YouWillPayLater` | · | · | · | · | 1 | `<span>` |

### 5.4 `data-test-date`

**Absent.** Zero occurrences of the attribute `data-test-date` in any of the five captures,
under any value and in any element. A raw substring search for the literal string
`data-test-date` across all five files also returns nothing. If a date-carrying test hook
exists in the Distributor it is not in this capture set and not under this name; the dates
that are present (check-in / check-out, `DayShortFriday`, `DayShortSunday`) are rendered as
plain text inside `[data-test-id="dates-occupancy-header"]` and
`[data-test-id="summary-card-date"]`.

### 5.5 Other `data-*` attributes present

Not requested, but worth recording since two of them carry more signal than the
`data-test-*` set:

| Attribute | 01 | 02 | 03 | 04 | 05 | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `data-mds-element` | 154 | 879 | 329 | 211 | 299 | on nearly every design-system element; value always `"true"` |
| `data-non-sensitive` | 11 | 113 | 37 | 21 | 45 | on translated `<span>`s; marks copy safe to log |
| `data-localized-entity` | · | 16 | 5 | 11 | 7 | property-supplied names (categories, rates, products) and tax percentages |
| `data-test-field` | 5 | 2 | 6 | 2 | 14 | form field wrappers, e.g. `languageSelector`, `currencySelect`, `number`, `expiration` |
| `data-test-toggle` | · | 14 | 5 | 1 | · | expand/collapse buttons |
| `data-test-image` | · | 14 | 1 | 1 | · | carousel images |
| `data-test-slide-next` / `-previous` | · | 14 / 14 | 1 / 1 | 1 / 1 | · | carousel arrows |
| `data-test-divider` | 2 | · | 4 | 2 | 3 | horizontal rules |
| `data-test-display-value` | 2 | 2 | 2 | 2 | 2 | current value of the language and currency combos |
| `data-test-button-minus` / `-plus` | 3 / 3 | · | 4 / 4 | · | · | occupancy steppers |
| `data-test-alerts-container` | 1 | · | · | · | · | portal alert host |
| `data-test-alerts-container-position` | 1 | · | · | · | · | value `center` |
| `data-test-skeleton-card` | · | 1 | · | · | · | loading placeholder |
| `data-test-autosize-text-area` | · | · | · | · | 1 | notes textarea |
| `data-test-step` | 1 | 1 | 1 | 1 | 1 | current step key (§1.4) |
| `data-disable-click-away` | 1 | · | · | · | · | on the alerts container |
| `data-style` | · | · | · | · | 1 | third-party injected |

`data-localized-entity="true"` is the most useful of these for an overlay: it wraps exactly
the property-authored strings (`Premium Queen`, `Flexible Rate`, `Facility Fee `) and the
tax percentages, which are the values that differ between hotels.

---

## 6. Class naming

### 6.1 The pattern

Every styled element carries two class tokens:

```
class="Stack-sc-261eb2-0 cVHJkl"
        └────┬────┘ └──┬──┘ └─┬─┘   └──┬───┘
      component name   │   index    instance hash
                  component hash
```

- **Component id** — `<ComponentName>-sc-<hash>-<index>`. This is a styled-components
  `componentId`, generated at build time. `<hash>` is derived from the module, `<index>`
  is the ordinal of the styled component within that module (`Stack-sc-261eb2-0` and
  `StackItem-sc-261eb2-1` share module hash `261eb2`, indices 0 and 1).
- **Instance hash** — a 5–7 char base-52-looking token (`cVHJkl`, `jPaNXy`, `inKsGw`,
  `PDa-dE`). This is the generated class for one *resolved set of CSS props*, so a single
  component emits many of these.

Across the five captures: **115 distinct component ids, 109 distinct component base
names.** Some elements compose two components in one `class` attribute, e.g.
`class="Card-sc-6935efe6-0 SkipLinksCard-sc-36f0bdac-0 dZDrMq cOUJdN"` — two component ids
followed by two instance hashes, in that order. Plain, ungenerated classes also appear
(`rooms-view`, `summary-view`, `grecaptcha-*`, `apt-guide-overlay-*`, `securefields-*`).

### 6.2 Is the hash stable across captures?

**Within this capture set: yes, completely.** The five files were captured from one live
session of one build, and both halves of the class name are byte-identical wherever the
same element recurs:

- The entire shell prefix (`body` → end of `#navigation`), roughly 110 elements deep, is
  byte-identical across all five files, class hashes included (§1.6).
- Of the 18 `data-test-id` values that appear in two or more files, **15 carry a
  byte-identical `class` string in every file.**
- The other 3 differ for reasons that are prop-driven, not random:
  - `from-price-wrapper` — `Stack-sc-261eb2-0 cAYXwR` on step 2, `Stack-sc-261eb2-0 hcLPBv` on step 3. Same component, different spacing props.
  - `price-footer-button` — `ButtonElement-sc-b5156f03-2 bVLDiw` for "Book now", `… eZCJmm` for the upsell "Add". Different button variant.
  - `tax-label` — two different components share the id in both files (`Typography-sc-b700300d-0 fgHFfh` on the wrapper, `StyledSpan-sc-943982d8-0 inKsGw` on the inner spans). Consistent between files.

In every case the **component id half stayed identical** and only the instance hash
tracked a visual variant. That is the expected behaviour, and it is the useful distinction:
`-sc-<hash>-<index>` identifies *which component*, the trailing token identifies *which
styling of it*.

### 6.3 But: not stable across builds

The captures cannot show this directly — they are all one build — but the mechanism makes
it near-certain, and the evidence is on the page. `05-details.html` references
`https://apps.mews.com/mews-assets/release/67.0.0/images/creditCards/*.svg` (7 occurrences):
the Distributor ships as versioned release bundles. styled-components regenerates the
component id when the module's contents or path change, and regenerates the instance hash
whenever the evaluated CSS for that prop combination changes. A Mews release that touches
spacing, a token, or a component file will move these hashes.

Two further hazards visible in the data:

- **Base names are not unique.** Five names map to more than one component id:
  `Container` (`bac7a368-0`, `fd59ea88-3`), `ContainerElement` (`3a6e4bf2-1`,
  `84bd401e-0`, `aa686870-0`), `ValueContainerElement` (`5627ed07-1`, `786da287-2`),
  `InputElement` (`3a6e4bf2-0`, `b7fddab1-3`), `PlaceholderElement` (`3a6e4bf2-2`,
  `b7fddab1-7`). A prefix selector like `[class*="Container"]` is meaningless.
- **Generic components are everywhere.** `Stack-sc-261eb2-0` appears with 50 distinct
  instance hashes, `Container-sc-bac7a368-0` with 26, `Typography-sc-b700300d-0` with 22,
  `ButtonElement-sc-b5156f03-2` with 12. These are layout primitives with no semantics;
  matching one tells you nothing about what you matched.

### 6.4 Conclusion for selector strategy

**Use `data-test-*` attributes. Do not use generated classes as selectors.**

Concretely, in descending order of durability:

1. `[data-test-id="…"]` — semantic, one per concept, survives restyling. Primary hook.
2. `[data-test-step]`, `[data-test-field]`, `[data-test-toggle]`, `[data-test-icon]` — semantic secondary hooks.
3. `[data-test-textkey="…"]` — locale-invariant key for copy. Use this rather than matching visible text, which changes with the language selector.
4. Stable DOM ids: `#distributor`, `#toolbar`, `#navigation`, `#main`, `#portal-container`, `#payment-details`, `#contact-details`.
5. ARIA and semantics: `role="banner"`, `role="region"`, `aria-current="step"`, `<main>`, `<li>` position within `<ul>`.
6. Generated classes — **avoid**. If one is unavoidable, match only the component-id half
   (`[class*="TotalBar-sc-"]`), never the instance hash, and expect it to break on a Mews
   release.

The overlay's five target selectors are all in tier 1, which is the right place to be. The
one structural risk they carry is not naming, it is scope: several ids repeat within a step
(`localizedCurrency` ×14, `tax-label` ×3 per card, `price-footer-button` ×4), so each read
needs a scoping ancestor as set out in §2 and §3.

---

## 7. Inline scripts and `dataLayer`

**None. There are no `<script>` tags of any kind in any of the five captures, inline or
external, and no `dataLayer` reference anywhere.**

Searches run across all five files, all returning zero:

| Search | Hits |
| --- | --- |
| `<script` (case-insensitive) | 0 |
| `<noscript` (case-insensitive) | 0 |
| `dataLayer` / `window.dataLayer` (case-insensitive) | 0 |
| `gtag` | 0 |
| `googletagmanager` / `gtm-` | 0 |
| `analytics` | 0 |

So there is no payload to quote. A caveat on interpreting this: the captures are
`document.body.outerHTML` of the iframe, and scripts a page loads in `<head>` would not
appear in a body capture; also, a script that executes and is later removed, or one
injected by a tag manager into `<head>`, leaves no body trace. What the captures do
establish is that **nothing in the Distributor's rendered body carries a `dataLayer` push,
and no analytics markup is embedded in the step DOM** — which is the practical question for
anything that wants to observe or hook the funnel from the DOM side.

The only non-Mews markup present in the body is passive: the two hidden tour-overlay
element sets (`apt-guide-overlay-*` plus the `#px-default-font-var` `<style>` block, all
five steps) and, on step 5, the Datatrans and reCAPTCHA nodes in §8. One `<style>` element
exists across the whole set:

```html
<style id="px-default-font-var" type="text/css">.apt-step-content, .px-close-button, .apt-badge-tippy, .apt-hotspot-dynamic, .apt-badge, .apt-vex { --px-default-font: "Helvetica"; }</style>
```

Note that "script" as a substring does match in these files (14 times in
`02-categories.html`, for example) — entirely inside the word "de**script**ion", in ids like
`rate-item-description` and `category-detail-description`. A naive substring grep will
mislead here; anchor on `<script`.

---

## 8. Nested iframes

Steps 1–4 contain **zero** iframes. Step 5 contains **four**, all third-party payment or
bot-protection frames, none of them Mews-owned.

### 8.1 Datatrans SecureFields (PCI card capture) — 2 iframes

The card number and CVV inputs are not Mews inputs; they are cross-origin Datatrans
SecureFields frames on `pay.datatrans.com`, mounted into Mews-rendered containers.

```html
<div data-test-id="field-pci-proxy-card-number" id="pci-proxy-card-number" class="PaymentInputContainer-sc-1148f98a-0 bTgLEz">
  <iframe id="securefields-h7opd1kcu--cardNumber" name="securefields-h7opd1kcu--cardNumber" src="https://pay.datatrans.com/upp/payment/SecureFields/paymentField?mode=TOKENIZE&amp;merchantId=3000013748&amp;fieldName=cardNumber&amp;formId=&amp;ariaLabel=Payment%20card%20number%2C%20Required&amp;inputType=tel&amp;version=2.0.0&amp;fieldNames=cardNumber%2Ccvv&amp;instanceId=h7opd1kcu" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" frameborder="0" scrolling="no" class="securefields-h7opd1kcu--cardNumber" style="width: 100%; height: 100%"></iframe>
</div>
```

```html
<div data-test-id="field-pci-proxy-cvv" id="pci-proxy-cvv" class="PaymentInputContainer-sc-1148f98a-0 bTgLEz">
  <iframe id="securefields-h7opd1kcu--cvv" name="securefields-h7opd1kcu--cvv" src="https://pay.datatrans.com/upp/payment/SecureFields/paymentField?mode=TOKENIZE&amp;merchantId=3000013748&amp;fieldName=cvv&amp;formId=260729164630839193&amp;ariaLabel=CVV%2C%20Required&amp;inputType=tel&amp;version=2.0.0&amp;fieldNames=cardNumber%2Ccvv&amp;instanceId=h7opd1kcu" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" frameborder="0" scrolling="no" class="securefields-h7opd1kcu--cvv" style="width: 100%; height: 100%"></iframe>
</div>
```

Parent chains:

```
cardNumber  -1 <div data-test-id="field-pci-proxy-card-number" id="pci-proxy-card-number" class="PaymentInputContainer-sc-1148f98a-0 bTgLEz">
            -2 <div data-mds-element="true" class="FieldInputWrapper-sc-22d84847-3 btEEks">
            -3 <div class="FieldContainer-sc-22d84847-0 cJhBJZ" data-test-field="number" data-mds-element="true">
            -4 <div data-mds-element="true" class="Stack-sc-261eb2-0 QKPfA">
            -5 <div data-mds-element="true" class="Stack-sc-261eb2-0 cVHJkl">

cvv         -1 <div data-test-id="field-pci-proxy-cvv" id="pci-proxy-cvv" class="PaymentInputContainer-sc-1148f98a-0 bTgLEz">
            -2 <div data-mds-element="true" class="FieldInputWrapper-sc-22d84847-3 btEEks">
            -3 <div class="FieldContainer-sc-22d84847-0 cJhBJZ" data-test-field="cvv" data-mds-element="true">
            -4 <div data-mds-element="true" class="Stack-sc-261eb2-0 coIfKl">
            -5 <div data-mds-element="true" class="Stack-sc-261eb2-0 QKPfA">
```

Both sit inside `<form id="payment-details" aria-label="Payment">`, alongside the fields
Mews *does* render in the parent document: `checkout-field-expiration` and
`checkout-field-holderName` are ordinary `<input>` elements. Merchant id `3000013748`,
SecureFields `version=2.0.0`, shared `instanceId=h7opd1kcu`.

### 8.2 Google reCAPTCHA Enterprise — 2 iframes

Both live at the very end of the document, outside `#distributor`, as direct descendants
of `<body>`. The badge frame:

```html
<div>
  <div class="grecaptcha-badge" data-style="bottomright" style="width: 256px; height: 60px; display: block; transition: right 0.3s; position: fixed; bottom: 14px; right: -186px; box-shadow: gray 0px 0px 5px; border-radius: 2px; overflow: hidden;">
    <div class="grecaptcha-logo">
      <iframe title="reCAPTCHA" width="256" height="60" role="presentation" name="a-b3uqhl8kyx2c" frameborder="0" scrolling="no" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-top-navigation allow-modals allow-popups-to-escape-sandbox allow-storage-access-by-user-activation" src="https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1&amp;k=6LdSDXgpAAAAAGnQNuPxGK7n0uUAi5OMwBpyLKbm&amp;co=aHR0cHM6Ly9hcHAubWV3cy5jb206NDQz&amp;hl=en&amp;v=A7KpaEASfhDcK0nXxgQEyyYv&amp;size=invisible&amp;anchor-ms=20000&amp;execute-ms=30000&amp;cb=pgdp60wtgnr9"></iframe>
    </div>
    <div class="grecaptcha-error"></div>
    <textarea id="g-recaptcha-response-100000" name="g-recaptcha-response" class="g-recaptcha-response" style="…display: none;"></textarea>
  </div>
  <iframe style="display: none;"></iframe>
</div>
```

The fourth iframe is the bare `<iframe style="display: none;">` sibling of the badge — the
reCAPTCHA challenge host, attribute-less in this capture.

The `co=` parameter decodes from base64 to `https://app.mews.com:443`, confirming the
Distributor iframe's own origin is `app.mews.com`. `size=invisible`, enterprise site key
`6LdSDXgpAAAAAGnQNuPxGK7n0uUAi5OMwBpyLKbm`, served from `recaptcha.net` rather than
`google.com`.

### 8.3 What this means for an overlay

The Distributor body itself is one document on `app.mews.com`, already inside the merchant
page's own iframe. Steps 1–4 are fully reachable from that one document. Step 5 is only
*mostly* reachable: the card number and CVV are cross-origin and cannot be read, written,
or observed — no `contentDocument` access, no `MutationObserver`, no autofill. Everything
an overlay needs on step 5 (the total, the settlement rule, the name/email/phone fields,
the terms checkbox, the confirm button) is in the parent document; only the two PCI inputs
are not.

