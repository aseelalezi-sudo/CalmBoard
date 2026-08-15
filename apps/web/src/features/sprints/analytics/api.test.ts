import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSprintAnalytics,
  normalizeSprintAnalyticsOverview,
  normalizeSprintTimeline,
  normalizeVelocitySeries,
} from "./api";

describe("Sprint timeline API normalization", () => {
  it("turns an unavailable timeline into a safe empty chart", () => {
    assert.deepEqual(normalizeSprintTimeline({ availability: { timeline: false } }, "sprint-1"), {
      sprintId: "sprint-1",
      dataQuality: null,
      availability: { timeline: false },
      isFinalized: false,
      series: [],
    });
  });

  it("maps repository story-point fields to the browser contract", () => {
    const result = normalizeSprintTimeline(
      {
        availability: { timeline: true },
        isFinalized: true,
        series: [
          {
            date: "2026-08-13",
            remainingStoryPoints: 8,
            completedStoryPoints: 5,
            scopeStoryPoints: 13,
          },
        ],
      },
      "sprint-2",
    );

    assert.deepEqual(result, {
      sprintId: "sprint-2",
      dataQuality: "exact",
      availability: { timeline: true },
      isFinalized: true,
      series: [
        {
          date: "2026-08-13",
          remainingPoints: 8,
          completedPoints: 5,
          totalScopePoints: 13,
          idealRemainingPoints: null,
        },
      ],
    });
  });

  it("drops malformed points instead of crashing the report", () => {
    const result = normalizeSprintTimeline({ series: [{ date: "2026-08-13" }, null] }, "sprint-3");
    assert.deepEqual(result.series, []);
  });
});

describe("Sprint report API normalization", () => {
  it("turns missing overview fields into safe nullable metrics", () => {
    assert.deepEqual(normalizeSprintAnalyticsOverview({ completedSprints: "3" }), {
      averageVelocity: null,
      averageThroughput: null,
      completedSprints: 3,
      latestVelocity: null,
      latestSprintSummary: null,
    });
  });

  it("drops malformed velocity rows and normalizes invalid values", () => {
    assert.deepEqual(
      normalizeVelocitySeries({
        series: [{ sprintId: "s1", name: "السبرنت 1", completedAt: "not-a-date", completedStoryPoints: -3 }, null],
        averageStoryPoints: "8.5",
      }),
      {
        series: [
          {
            sprintId: "s1",
            name: "السبرنت 1",
            completedAt: null,
            completedStoryPoints: 0,
            completedTaskCount: 0,
          },
        ],
        averageStoryPoints: 8.5,
        sprintCount: 1,
      },
    );
  });

  it("bounds completion ratios and preserves signed scope changes", () => {
    const result = normalizeSprintAnalytics({
      sprintId: "s1",
      name: "السبرنت 1",
      completionRatio: 4,
      netScopeChange: { storyPoints: -2, taskCount: -1 },
    });
    assert.equal(result?.completionRatio, 1);
    assert.deepEqual(result?.netScopeChange, { storyPoints: -2, taskCount: -1 });
  });
});
