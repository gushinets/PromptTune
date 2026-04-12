import { useState } from "react";
import browser from "webextension-polyfill";
import { useT } from "@shared/i18n";

const CWS_URL = "https://chromewebstore.google.com/detail/prompttune/YOUR_EXTENSION_ID";
const FEEDBACK_URL = "https://docs.google.com/forms/d/e/YOUR_FORM_ID/viewform";

export function RatingBar() {
  const t = useT();
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);

  const handleRate = (star: number) => {
    browser.tabs.create({ url: star >= 4 ? CWS_URL : FEEDBACK_URL });
  };

  return (
    <div className="rating-bar">
      <span className="rating-label">{t.ratingLabel}</span>
      <div className="rating-stars" onMouseLeave={() => setHoveredStar(null)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <span
            key={star}
            className={`rating-star${hoveredStar !== null && star <= hoveredStar ? " active" : ""}`}
            onMouseEnter={() => setHoveredStar(star)}
            onClick={() => handleRate(star)}
            role="button"
            aria-label={t.ariaLabelRateStar(star)}
          >
            ★
          </span>
        ))}
      </div>
    </div>
  );
}
