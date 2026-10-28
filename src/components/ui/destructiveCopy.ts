/**
 * Destructive confirm copy pattern (DESIGN_HANDOFF §5.10): names the object
 * and the consequence, and states irreversibility. Use inside Modal bodies,
 * e.g. destructiveConfirmCopy('Delete **Lab 201**', 'and its 14 staged images?')
 * → "Delete **Lab 201** and its 14 staged images? This cannot be undone."
 */
export function destructiveConfirmCopy(objectName: string, consequence: string): string {
  return `${objectName} ${consequence} This cannot be undone.`;
}
