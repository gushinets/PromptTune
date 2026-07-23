# Extension External Destinations

This document lists external destinations opened by the browser extension production bundle.

## Release URLs

| Destination | Env var | Default production behavior | Data/privacy note |
| --- | --- | --- | --- |
| Backend API | `VITE_API_BASE_URL` | `https://api.anytoolai.store` | Receives prompt improvement and usage/technical analytics payloads described by backend API docs and store disclosure. |
| Welcome page | `VITE_WELCOME_PAGE_URL` | `https://anytoolai-welcome.netlify.app/prompt-optimizer/` | Opened after install. No extension data is appended by the extension. |
| Feedback form | `VITE_FEEDBACK_URL` | Google Forms URL currently used in `extension/shared/constants.ts` | Remains enabled for production. The form must be owned by the PromptOptimizer/AnyTool product account, and the store privacy disclosure must state that feedback submitted through Google Forms is processed by Google Forms and may include user-entered text. |
| Chrome Web Store review page | `VITE_CWS_REVIEW_URL` | Disabled until configured. High ratings do not navigate until the final store URL is set. | Configure only after the final Chrome Web Store item URL is known. |
| Upgrade / Pro intent | None for the first release | Opens an in-extension "Pro soon" notice and tracks `upgrade_clicked`. | No email collection, waitlist form, paid checkout, or external upgrade URL in the first release. |

Only HTTPS URLs are accepted for release-facing optional URLs. Invalid or non-HTTPS `VITE_CWS_REVIEW_URL` values disable that destination instead of bundling placeholders.

## Release Checklist

- Verify `VITE_CWS_REVIEW_URL` contains the final Chrome Web Store extension ID before enabling review routing.
- Keep upgrade/pro monetization local-only for the first release: no external URL, no email waitlist, no paid checkout.
- After the RKN notification is submitted and the waitlist is ready, switch the Upgrade action to a product-owned waitlist form and update store privacy/data disclosure.
- Do not enable paid checkout until the RU payment portal is ready.
- Verify the Google Forms feedback URL is owned by the product account before release.
- Include Google Forms feedback collection in Chrome Web Store privacy/data disclosure.
- Run `npm run build` and `npm run zip` from `extension/`, then inspect the generated bundle for placeholder URLs.
