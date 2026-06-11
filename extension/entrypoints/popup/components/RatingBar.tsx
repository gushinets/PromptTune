import { useState } from "react";
import browser from "webextension-polyfill";
import { useT } from "@shared/i18n";

const REVIEWS_URL =
  "https://chromewebstore.google.com/detail/promptoptimizer/prompt-optimizer_ID/reviews";
const FEEDBACK_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSd7Q5SmtvSEuxBDvZRvtNMPojqH7k69olXajFSZGOO4-EZ7CQ/viewform?usp=dialog";

export function RatingBar() {
  const t = useT();
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);

  const handleRate = (star: number) => {
    void browser.tabs.create({ url: star >= 4 ? REVIEWS_URL : FEEDBACK_URL });
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
