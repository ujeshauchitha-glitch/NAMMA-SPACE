/**
 * Single object-URL registry (cross-cutting lifecycle rule §3.3).
 *
 * Every `URL.createObjectURL` in the app goes through here so revocation is
 * auditable: URLs are tracked on create, revoked exactly once on revoke, and
 * `revokeAllObjectUrls` is the unmount/sweep path. `activeObjectUrlCount`
 * is the leak probe used by tests (and e2e via the exported sweep on tab exit).
 */

const activeUrls = new Set<string>();

export function createObjectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  activeUrls.add(url);
  return url;
}

export function revokeObjectUrl(url: string): void {
  if (url && activeUrls.delete(url)) URL.revokeObjectURL(url);
}

export function revokeAllObjectUrls(): void {
  for (const url of activeUrls) URL.revokeObjectURL(url);
  activeUrls.clear();
}

export function activeObjectUrlCount(): number {
  return activeUrls.size;
}
