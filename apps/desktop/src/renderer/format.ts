export function formatBytes(bytes: number | undefined): string {
  if (!bytes) return "\u2014";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return value.toFixed(index > 1 ? 1 : 0) + " " + units[index];
}

export function formatDate(value: string | undefined): string {
  if (!value) return "\u2014";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
