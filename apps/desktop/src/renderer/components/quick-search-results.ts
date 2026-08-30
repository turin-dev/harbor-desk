import type {
  ContainerSummary,
  ImageSummary,
  NetworkSummary,
  VolumeSummary,
} from "@harbor/contracts";

/**
 * Pure quick-search result building, kept framework-free for unit tests.
 */

export type SearchResult = {
  key: string;
  kind: "container" | "image" | "volume" | "network";
  label: string;
  secondary: string;
  path: string;
};

export function buildResults(
  query: string,
  resources: {
    containers: ContainerSummary[];
    images: ImageSummary[];
    volumes: VolumeSummary[];
    networks: NetworkSummary[];
  },
): SearchResult[] {
  const needle = query.trim().toLowerCase();
  const matches = (values: string[]) =>
    values.some((value) => value.toLowerCase().includes(needle));

  const results: SearchResult[] = [];
  for (const row of resources.containers) {
    if (!matches([row.name, row.image, row.status])) continue;
    results.push({
      key: `container-${row.id}`,
      kind: "container",
      label: row.name,
      secondary: `${row.image} \u00b7 ${row.status}`,
      path: "/containers",
    });
  }
  for (const row of resources.images) {
    const image = `${row.repository}:${row.tag}`;
    if (!matches([image, row.digest ?? row.id])) continue;
    results.push({
      key: `image-${row.id}-${row.tag}`,
      kind: "image",
      label: image,
      secondary: row.digest ?? row.id.slice(0, 18),
      path: "/images",
    });
  }
  for (const row of resources.volumes) {
    if (!matches([row.name, row.driver, row.mountpoint ?? ""])) continue;
    results.push({
      key: `volume-${row.name}`,
      kind: "volume",
      label: row.name,
      secondary: `${row.driver} \u00b7 ${row.scope ?? "unknown scope"}`,
      path: "/volumes",
    });
  }
  for (const row of resources.networks) {
    if (!matches([row.name, row.driver, row.scope])) continue;
    results.push({
      key: `network-${row.id}`,
      kind: "network",
      label: row.name,
      secondary: `${row.driver} \u00b7 ${row.scope}`,
      path: "/networks",
    });
  }
  return results.slice(0, 12);
}
