# Extension External Destinations

This document lists external destinations opened by the browser extension production bundle.

## Release URLs

| Destination | Env var | Default production behavior | Data/privacy note |
| --- | --- | --- | --- |
| Backend API | `VITE_API_BASE_URL` | `https://api.anytoolai.store` | Receives prompt improvement and usage/technical analytics payloads described by backend API docs and store disclosure. |
| Welcome page | `VITE_WELCOME_PAGE_URL` | `https://anytoolai-welcome.netlify.app/prompt-optimizer/` | Opened after install. No extension data is appended by the extension. |
| Feedback form | `VITE_FEEDBACK_URL` | Google Forms URL currently used in `extension/shared/constants.ts` | Remains enabled for production. The form must be owned by the PromptOptimizer/AnyTool product account, and the store privacy disclosure must state that feedback submitted through Google Forms is processed by Google Forms and may include user-entered text. |
| Chrome Web Store review page | `VITE_CWS_REVIEW_URL` | Disabled until configured. High ratings fall back to the product feedback form. | Configure only after the final Chrome Web Store item URL is known. |
| Upgrade page | `VITE_UPGRADE_URL` | Disabled until configured. The upgrade button is hidden. | Configure only after the product-owned upgrade page is live. |

Only HTTPS URLs are accepted for release-facing optional URLs. Invalid or non-HTTPS `VITE_CWS_REVIEW_URL` and `VITE_UPGRADE_URL` values disable those destinations instead of bundling placeholders.

## Release Checklist

- Verify `VITE_CWS_REVIEW_URL` contains the final Chrome Web Store extension ID before enabling review routing.
- Verify `VITE_UPGRADE_URL` points to a product-owned upgrade page before enabling the upgrade CTA.
- Verify the Google Forms feedback URL is owned by the product account before release.
- Include Google Forms feedback collection in Chrome Web Store privacy/data disclosure.
- Run `npm run build` and `npm run zip` from `extension/`, then inspect the generated bundle for placeholder URLs.
