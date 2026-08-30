export interface ParsedBuildForm {
  tag: string;
  dockerfile?: string;
  buildArgs?: Record<string, string>;
}

export interface BuildInputIssue {
  field: "tag" | "dockerfile" | "buildArgs";
  message: string;
}

export interface BuildResultCopy {
  tone: "success" | "info" | "error";
  title: string;
  body: string;
}

/**
 * Human-readable copy for a finished build operation. Returns undefined
 * while the operation has not reached a terminal status yet.
 */
export function describeBuildResult(
  operation: { status?: string; message?: string } | undefined,
  tag: string,
): BuildResultCopy | undefined {
  if (!operation?.status) return undefined;
  if (operation.status === "succeeded") {
    return {
      tone: "success",
      title: "Build finished",
      body: `The image tagged ${tag} was built on the remote host.`,
    };
  }
  if (operation.status === "cancelled") {
    return {
      tone: "info",
      title: "Build cancelled",
      body: "The remote build was cancelled before it finished.",
    };
  }
  return {
    tone: "error",
    title: "Build failed",
    body: operation.message ?? "The remote build failed.",
  };
}

const TAG_PATTERN =
  /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?(@sha256:[a-f0-9]{64})?$/;
const ARG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validates the Builds form fields. The tag must look like an image
 * reference the Engine can tag the built image with; build args must be
 * KEY=VALUE lines with valid ARG names (an empty value is allowed and
 * sent as-is to the gateway, which skips blank values upstream).
 */
export function parseBuildForm(input: {
  tag: string;
  dockerfile?: string;
  buildArgsLines?: string;
}): { value?: ParsedBuildForm; issue?: BuildInputIssue } {
  const tag = input.tag.trim();
  if (!tag)
    return { issue: { field: "tag", message: "An image tag is required." } };
  if (tag.length > 512)
    return { issue: { field: "tag", message: "The image tag is too long." } };
  const lower = tag.includes("/") || tag.includes(":") ? tag : tag;
  if (!TAG_PATTERN.test(lower)) {
    return {
      issue: {
        field: "tag",
        message:
          "Use an image reference like app:dev, registry.example/app:1.0, or image@sha256:…",
      },
    };
  }
  const dockerfile = input.dockerfile?.trim();
  if (dockerfile) {
    if (dockerfile.length > 255) {
      return {
        issue: {
          field: "dockerfile",
          message: "The Dockerfile path is too long.",
        },
      };
    }
    if (dockerfile.includes("\\") || dockerfile.startsWith("/")) {
      return {
        issue: {
          field: "dockerfile",
          message: "Use a context-relative path with forward slashes.",
        },
      };
    }
  }
  const args: Record<string, string> = {};
  const lines = (input.buildArgsLines ?? "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      return {
        issue: {
          field: "buildArgs",
          message: `Each build arg needs a KEY=VALUE form: ${line}`,
        },
      };
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!ARG_NAME_PATTERN.test(key) || key.length > 255) {
      return {
        issue: {
          field: "buildArgs",
          message: `Invalid build arg name: ${key}`,
        },
      };
    }
    if (value.length > 255) {
      return {
        issue: {
          field: "buildArgs",
          message: `Build arg value is too long: ${key}`,
        },
      };
    }
    args[key] = value;
  }
  return {
    value: {
      tag,
      ...(dockerfile ? { dockerfile } : {}),
      ...(Object.keys(args).length ? { buildArgs: args } : {}),
    },
  };
}
