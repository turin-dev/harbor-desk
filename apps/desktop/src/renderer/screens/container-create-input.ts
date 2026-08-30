import type {
  ContainerCreateInput,
  EnvVar,
  PortMapping,
} from "@harbor/contracts";

export interface ContainerFormPort {
  containerPort: string;
  hostPort: string;
  protocol: "tcp" | "udp";
}

export interface ContainerFormEnv {
  name: string;
  value: string;
}

export interface ContainerFormLabel {
  key: string;
  value: string;
}

export interface ContainerFormState {
  image: string;
  name: string;
  command: string;
  portRows: ContainerFormPort[];
  envRows: ContainerFormEnv[];
  labelRows: ContainerFormLabel[];
  restartPolicy: string;
}

export type ContainerFormResult =
  { ok: true; input: ContainerCreateInput } | { ok: false; error: string };

export function buildContainerCreateInput(
  form: ContainerFormState,
): ContainerFormResult {
  const trimmedImage = form.image.trim();
  if (!trimmedImage) {
    return { ok: false, error: "An image reference is required." };
  }
  const ports: PortMapping[] = form.portRows
    .filter((row) => row.containerPort.trim().length > 0)
    .map((row) => ({
      containerPort: Number(row.containerPort),
      protocol: row.protocol,
      ...(row.hostPort.trim() ? { hostPort: Number(row.hostPort) } : {}),
    }));
  for (const port of ports) {
    if (
      !Number.isInteger(port.containerPort) ||
      port.containerPort < 1 ||
      port.containerPort > 65535
    ) {
      return {
        ok: false,
        error: "Container ports must be integers from 1 to 65535.",
      };
    }
    if (
      port.hostPort !== undefined &&
      (!Number.isInteger(port.hostPort) ||
        port.hostPort < 1 ||
        port.hostPort > 65535)
    ) {
      return {
        ok: false,
        error: "Host ports must be integers from 1 to 65535.",
      };
    }
  }
  const seenPorts = new Set<string>();
  for (const port of ports) {
    const key = port.containerPort + "/" + port.protocol;
    if (seenPorts.has(key)) {
      return {
        ok: false,
        error: "Container port " + key + " is mapped more than once.",
      };
    }
    seenPorts.add(key);
  }
  const env: EnvVar[] = form.envRows
    .map((row) => ({ name: row.name.trim(), value: row.value }))
    .filter((row) => row.name.length > 0);
  for (const row of env) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name)) {
      return {
        ok: false,
        error:
          "Environment name " + row.name + " is not a valid variable name.",
      };
    }
  }
  const labels: Record<string, string> = {};
  for (const row of form.labelRows) {
    const key = row.key.trim();
    if (key) labels[key] = row.value;
  }
  return {
    ok: true,
    input: {
      image: trimmedImage,
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
      ...(form.command.trim() ? { command: form.command.trim() } : {}),
      ...(ports.length > 0 ? { ports } : {}),
      ...(env.length > 0 ? { env } : {}),
      ...(form.restartPolicy
        ? {
            restartPolicy:
              form.restartPolicy as ContainerCreateInput["restartPolicy"],
          }
        : {}),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    },
  };
}
