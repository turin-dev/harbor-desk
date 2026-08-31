import type { ExtensionSummary } from "@harbor/contracts";
import { HttpError } from "../errors.js";

export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  category?: string;
  homepageUrl?: string;
}

/**
 * Server-side extension catalog. In this build the catalog ships as an
 * administrator-approved list; the install state is gateway-owned so the
 * desktop client never executes or hosts extension code itself.
 */
export class ExtensionsService {
  private readonly installed = new Set<string>();

  constructor(readonly catalog: CatalogEntry[]) {}

  public list(): ExtensionSummary[] {
    return this.catalog.map((entry) => this.toSummary(entry));
  }

  public get(extensionId: string): ExtensionSummary {
    return this.toSummary(this.find(entryId(extensionId)));
  }

  public async install(extensionId: string): Promise<ExtensionSummary> {
    const entry = this.find(entryId(extensionId));
    this.installed.add(entry.id);
    return this.toSummary(entry);
  }

  public async uninstall(extensionId: string): Promise<ExtensionSummary> {
    const entry = this.find(entryId(extensionId));
    this.installed.delete(entry.id);
    return this.toSummary(entry);
  }

  public webUrl(extensionId: string): string {
    return (
      "/api/v1/extensions/" + encodeURIComponent(entryId(extensionId)) + "/web"
    );
  }

  private find(id: string): CatalogEntry {
    const entry = this.catalog.find((candidate) => candidate.id === id);
    if (!entry)
      throw new HttpError(
        404,
        "extension_not_found",
        "The extension was not found.",
      );
    return entry;
  }

  private toSummary(entry: CatalogEntry): ExtensionSummary {
    return {
      ...entry,
      status: this.installed.has(entry.id) ? "installed" : "available",
      approved: true,
      webUrl: this.webUrl(entry.id),
    };
  }
}

function entryId(raw: string): string {
  const value = raw.trim();
  if (!value)
    throw new HttpError(
      400,
      "invalid_extension_id",
      "The extension id is empty.",
    );
  return value;
}
