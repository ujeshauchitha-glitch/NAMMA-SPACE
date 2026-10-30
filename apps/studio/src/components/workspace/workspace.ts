/** Workspace identity shared by the shell, tabs, and router (§5.3 / §6.1). */
export type WorkspaceId = 'capture' | 'viewer' | 'scan';

export type WorkspaceMeta = {
  id: WorkspaceId;
  /** Two-digit mono index shown on the tab (§5.3). */
  index: string;
  label: string;
};

export const WORKSPACES: readonly WorkspaceMeta[] = [
  { id: 'capture', index: '01', label: 'Capture Studio' },
  { id: 'viewer', index: '02', label: 'Spatial Viewer' },
  // The pairing relay only exists on the dev server, so hosted builds say so on the tab.
  { id: 'scan', index: '03', label: import.meta.env.DEV ? 'Live Scan' : 'Live Scan · dev only' },
] as const;

export const DEFAULT_WORKSPACE: WorkspaceId = 'viewer';

export function isWorkspaceId(value: string): value is WorkspaceId {
  return WORKSPACES.some((workspace) => workspace.id === value);
}
