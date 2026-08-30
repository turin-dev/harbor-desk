import type { HubSearchResult } from "@harbor/contracts";

export function normalizeHubQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function sortHubResults(rows: HubSearchResult[]): HubSearchResult[] {
  return [...rows].sort(
    (a, b) => b.starCount - a.starCount || b.pullCount - a.pullCount,
  );
}

export function formatHubMetric(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return "\u2014";
  const units = ["K", "M", "B"];
  let metric = value;
  let index = -1;
  while (metric >= 1000 && index < units.length - 1) {
    metric /= 1000;
    index += 1;
  }
  if (index < 0) return String(Math.round(metric));
  return metric.toFixed(1) + " " + units[index];
}

export function hubReference(row: HubSearchResult): string {
  return row.repository;
}
