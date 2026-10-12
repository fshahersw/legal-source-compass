import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScenarioIntake } from "./ScenarioIntake";

describe("scenario intake entry", () => {
  it("offers labelled local entry without prefilled facts or an automatic calculation", () => {
    let applications = 0;
    const html = renderToStaticMarkup(
      createElement(ScenarioIntake, {
        onApply: () => {
          applications++;
        },
      }),
    );
    expect(html).toContain("Describe one claim");
    expect(html).toContain("Review extracted facts");
    expect(html).toContain("not sent to an AI service");
    expect(html).not.toContain("Apply checked facts");
    expect(html).not.toContain('type="date"');
    expect(applications).toBe(0);
  });
});
