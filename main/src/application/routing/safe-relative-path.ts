/** A local path that cannot be normalized into an external URL by the router. */
export function isSafeRelativePath(path: string): boolean {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    !Array.from(path).some(character => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  );
}
