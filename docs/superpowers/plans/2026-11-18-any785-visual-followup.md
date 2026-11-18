# ANY-785 visual follow-up implementation plan

**Goal:** Address the two acceptance findings using the attached HTML and approved Russian names.

**Architecture:** Retain React/WXT and the shared result/changes scroller. Size the result to its content and available viewport, reserving the action row and its feedback. Changes remain in the shared scroller without reducing the result height. Keep navigation/footer outside that scroller.

**Spec:** ANY-785 acceptance comments of November 10; user confirmed scope November 18.

**Constraints:** Popup 360 × 600; responsive sidepanel; Russian labels «Структура» and «Исследование»; unchanged request goal identifiers.

## Task 1: Result sizing and labels

- [x] Add failing tests: 304px result, long result, viewport resizing, approved labels.
- [x] Replace fixed 200px cap with measured available height, observing viewport and wrapping.
- [x] Apply approved Russian labels.
- [x] Run extension tests, lint, formatting, typecheck and production build with installed Node 22.
- [x] Visually verify popup and narrow/short/tall panel with long results and expanded changes.

**Review focus:** Short viewports scroll; tall panels use available height; expanded changes preserve output size; restored results remeasure; stored goal values stay compatible.

Validation: 318 extension tests; ESLint, TypeScript, Prettier and production build. Headless Chromium component harness: 360 × 600 popup and 320 × 420, 280 × 300, 480 × 900 panels; long output, reachable actions, expanded changes, unclipped Russian goals. Independent review found action feedback could fall below the viewport; regression reproduced and fixed by observing reserved action elements. Native installed-extension lifecycle and live provider generation were not exercised.

PR review follow-up: preserve the outer scroll offset across textarea measurement, reserve a stable scrollbar gutter, and reveal newly clipped action errors without moving already visible feedback. Tests now gate viewport deliveries on observer registration and give closed/open explanations measurable heights. Validation: 320 extension tests plus lint/type/format/build; Chromium component harness confirmed a visible error at the 120px field minimum, retained scrollTop=140 after resizing expanded explanations, and unchanged scrollTop=0 for an error that already fits.

Narrow-panel label follow-up: reproduced «Исследование» clipping in the real PromptForm at 280 × 300 after loading Geist (scrollWidth 77px vs clientWidth 71px). Goals use two columns at widths ≤350px; horizontal button padding is 3px, allowing Content labels to fit the original three-column 360px popup too. Chromium measured every Russian goal label in both modes at 280/300/320/360px after font loading; all now satisfy scrollWidth ≤ clientWidth. A 280 × 300 screenshot was inspected.

Reading/focus review follow-up: preserve the first visible expanded explanation’s viewport offset when final textarea height changes, in addition to restoring scrollTop after temporary measurement. If new feedback and the focused action cannot fit together, retain the visible action and show the existing ErrorToast in a portal above the scroller. Reserve 6px bottom padding for the 5px keyboard outline. New regression tests reproduced both failures before implementation. Chromium with the real ActionBar confirmed explanation offset ≈10px through panel heights 730→530→730→900→530, focused Copy remaining visible after clipboard failure at 280 × 378 with the exhausted-quota banner, and 6px outline clearance.

Independent follow-up review identified two new-path edge cases, both reproduced and fixed: preserve the outline clearance when revealing focus at a viewport edge, and synchronize toast text when feedback changes without changing height. Reserved action subtrees now observe text/child mutations alongside size changes. Chromium confirmed updated feedback text and ≈5px focus clearance; unit regressions cover both.

Toast accessibility review follow-up: dismiss the fallback when focus leaves the action row/toast, so keyboard navigation cannot focus header or tab controls behind the overlay. The fallback ErrorToast disables its duplicate live announcement; the original ActionBar alert remains the single live region, and the toast dismiss control remains accessible. Regression assertions reproduced both failures before implementation. Chromium at 280 × 378 with the exhausted-quota banner exposed exactly one alert in its accessibility tree; Shift+Tab reached Upgrade, Library, Optimizer and header controls without an overlay, and a repeated failure showed the toast again.

Pre-resize clamping follow-up: cache the visible explanation and relative offset while scrolling at a stable viewport size; ignore native clamping scroll events while viewport dimensions differ. On resize restore that cached reading position, adding only the trailing space needed when the new scroll maximum would otherwise make it unreachable. Clear that space when returning to the output or collapsing changes. The regression now includes growth beyond the original height and a clamp delivered before ResizeObserver. A Chromium comparison with b85a2e9 and 13 explanations reproduced Explanation 6 moving from ≈16px to ≈149px on growth; the fix retained ≈16px through heights 730→530→730→900→530→1000→730 and preserved a subsequent user-selected reading position. Spacer cleanup was also verified.

Independent review additionally identified the short-content case where scrollHeight floors at clientHeight and undercounts the required trailing space. A failing regression now models that native clamp; space is computed from the actual content bottom instead. Chromium confirmed a short output with two explanations retains ≈16px offset when growing from 330px to 900px. Final validation: 324 extension tests, lint, TypeScript, formatting and production build.

Existing-feedback resize follow-up: re-evaluate focus preservation and the fallback toast on viewport changes while an action has focus, even if the feedback node/text did not change. Leave unchanged feedback alone when focus is elsewhere. A regression reproduces a previously fitting error becoming clipped after shrinking, and verifies no scroll/toast changes while reading elsewhere. Chromium confirmed a real Copy failure fits at 360 × 600 and uses a fallback after shrinking to 280 × 378, retaining visible focus, one accessible alert, and unobscured keyboard navigation.
