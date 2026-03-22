import { useState } from "react";
import browser from "webextension-polyfill";

// TODO: Replace with actual URLs
const CWS_URL = "https://chromewebstore.google.com/detail/prompttune/YOUR_EXTENSION_ID";
const FEEDBACK_URL = "https://docs.google.com/forms/d/e/YOUR_FORM_ID/viewform";

export function RatingBar() {
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);

  const handleRate = (star: number) => {
    const url = star >= 4 ? CWS_URL : FEEDBACK_URL;
    browser.tabs.create({ url });
  };

  return (
    <div className="rating-bar">
      <span className="rating-label">Rate us</span>
      <div
        className="rating-stars"
        onMouseLeave={() => setHoveredStar(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <span
            key={star}
            className={`rating-star${hoveredStar !== null && star <= hoveredStar ? " active" : ""}`}
            onMouseEnter={() => setHoveredStar(star)}
            onClick={() => handleRate(star)}
            role="button"
            aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
          >
            ★
          </span>
        ))}
      </div>
    </div>
  );
}
