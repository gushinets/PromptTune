# Extension External Destinations

This document lists external destinations opened by the browser extension production bundle.

## Release URLs

| Destination | Env var | Default production behavior | Data/privacy note |
| --- | --- | --- | --- |
| Backend API | `VITE_API_BASE_URL` | `https://api.anytoolai.store` | Receives prompt improvement, essential installation registration (installation ID and install timestamp, independent of analytics consent), quota/email verification, and usage/technical analytics payloads described by backend API docs and store disclosure. |
| Welcome page | `VITE_WELCOME_PAGE_URL` | `https://anytoolai-welcome.netlify.app/prompt-optimizer/` | Opened after install. No extension data is appended by the extension. |
| Feedback form | `VITE_FEEDBACK_URL` | Google Forms URL currently used in `extension/shared/constants.ts` | Remains enabled for production. The form must be owned by the PromptOptimizer/AnyTool product account, and the store privacy disclosure must state that feedback submitted through Google Forms is processed by Google Forms and may include user-entered text. |
| Chrome Web Store review page | `VITE_CWS_REVIEW_URL` | PromptOptimizer review page for extension ID `fbageijibmjblopdbgpdcpkojhnjjbpe` | Opens for ratings of 4 or 5. An HTTPS environment value can override the default URL. |
| Upgrade / Pro intent | None for the first release | Opens an in-extension "Pro soon" notice and tracks `upgrade_clicked`. | No email collection, waitlist form, paid checkout, or external upgrade URL in the first release. |

Only HTTPS URLs are accepted for release-facing URLs. Invalid or non-HTTPS `VITE_CWS_REVIEW_URL` values fall back to the default PromptOptimizer review page.

## Optional email bonus data

The email bonus sends the address and installation ID to the configured backend to verify ownership, award the one-time bonus, and prevent repeat claims. Firefox declares `personallyIdentifyingInfo` as optional. The email dialog provides a consent checkbox: on Firefox with native data consent it requests/removes that permission; on older supported versions it stores an explicit opt-in locally. Both requesting and confirming a code check current consent in the background before contacting the API. Turning consent off prevents further email-bonus requests; it does not remove the server's existing claim record used to prevent duplicate bonuses.

Private hotkey quota windows contain only quota information and a session-bound return target. They never mount the editor or restore/save regular drafts. Returning focuses the source tab and closes the quota window; private prompt text and generated results remain in the source page.

The installation timestamp is written to `storage.local`, with an additional journal attempted first in extension-owned IndexedDB. A valid local timestamp or confirmed registration remains usable when IndexedDB is unavailable. When the local timestamp is missing, the journal enables recovery across browser restarts independently of Firefox alarms and is removed after successful registration. Alarms schedule retries but are not the persistent record.

## Release Checklist

- Verify any `VITE_CWS_REVIEW_URL` override points to the intended Chrome Web Store review page.
- Keep upgrade/pro monetization local-only for the first release: no external URL, no email waitlist, no paid checkout.
- After the RKN notification is submitted and the waitlist is ready, switch the Upgrade action to a product-owned waitlist form and update store privacy/data disclosure.
- Do not enable paid checkout until the RU payment portal is ready.
- Verify the Google Forms feedback URL is owned by the product account before release.
- Include Google Forms feedback collection in Chrome Web Store privacy/data disclosure.
- Run `npm run build` and `npm run zip` from `extension/`, then inspect the generated bundle for placeholder URLs.
