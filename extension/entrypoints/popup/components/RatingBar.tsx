import { useState } from "react";
import browser from "webextension-polyfill";
import { useT } from "@shared/i18n";
import { CWS_REVIEW_URL, FEEDBACK_URL } from "@shared/constants";

export function RatingBar() {
  const t = useT();
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);

  const handleRate = (star: number) => {
    if (star >= 4) {
      if (CWS_REVIEW_URL) {
        void browser.tabs.create({ url: CWS_REVIEW_URL });
      }
      return;
    }

    void browser.tabs.create({ url: FEEDBACK_URL });
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
