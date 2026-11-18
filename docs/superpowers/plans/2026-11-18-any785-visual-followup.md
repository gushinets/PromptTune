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
