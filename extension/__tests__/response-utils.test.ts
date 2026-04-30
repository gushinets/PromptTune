import { describe, expect, it } from "vitest";
import {
  describeUnexpectedBackgroundResponse,
  extractImproveResponse,
  extractRateLimitResponse,
} from "@shared/response-utils";

describe("response utils", () => {
  it("extracts improve response from wrapped background messages", () => {
    const response = extractImproveResponse({
      type: "IMPROVE_RESULT",
      payload: {
        request_id: "r1",
        improved_text: "better prompt",
        changes: [
          "Clarified output format",
          "Added concrete context",
          "Specified success criteria",
        ],
      },
    });

    expect(response).toEqual({
      request_id: "r1",
      improved_text: "better prompt",
      changes: ["Clarified output format", "Added concrete context", "Specified success criteria"],
    });
  });

  it("extracts improve response from direct payloads and allows empty strings", () => {
    const response = extractImproveResponse({
      request_id: "r1",
      improved_text: "",
    });

    expect(response).toEqual({
      request_id: "r1",
      improved_text: "",
    });
  });

  it("normalizes change explanations and keeps at most five lines", () => {
    const response = extractImproveResponse({
      request_id: "r2",
      improved_text: "better prompt",
      changes: [" First line ", "Second line", "", "Third line", "Fourth line", "Fifth line"],
    });

    expect(response).toEqual({
      request_id: "r2",
      improved_text: "better prompt",
      changes: ["First line", "Second line", "Third line", "Fourth line", "Fifth line"],
    });
  });

  it("keeps one or two valid change lines", () => {
    const oneLine = extractImproveResponse({
      request_id: "r3",
      improved_text: "better prompt",
      changes: [" One line "],
    });

    const twoLines = extractImproveResponse({
      request_id: "r4",
      improved_text: "better prompt",
      changes: ["First line", " Second line "],
    });

    expect(oneLine).toEqual({
      request_id: "r3",
      improved_text: "better prompt",
      changes: ["One line"],
    });

    expect(twoLines).toEqual({
      request_id: "r4",
      improved_text: "better prompt",
      changes: ["First line", "Second line"],
    });
  });

  it("extracts rate limits from wrapped or direct responses", () => {
    const wrapped = extractRateLimitResponse({
      type: "LIMITS_RESULT",
      payload: {
        rate_limit: {
          per_minute_remaining: 9,
          per_day_remaining: 49,
          per_minute_total: 10,
          per_day_total: 50,
        },
      },
    });
    const direct = extractRateLimitResponse({
      per_minute_remaining: 9,
      per_day_remaining: 49,
      per_minute_total: 10,
      per_day_total: 50,
    });

    expect(wrapped).toEqual(direct);
  });

  it("describes malformed background responses", () => {
    expect(describeUnexpectedBackgroundResponse(undefined)).toContain("no response");
    expect(describeUnexpectedBackgroundResponse({ foo: 1, bar: 2 })).toContain("foo, bar");
  });
});
