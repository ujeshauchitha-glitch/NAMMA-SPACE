/** Raw `?pair=` value from the entry URL; validated downstream (T21). */
export function readPairToken(search: string): string | null {
  return new URLSearchParams(search).get('pair');
}
