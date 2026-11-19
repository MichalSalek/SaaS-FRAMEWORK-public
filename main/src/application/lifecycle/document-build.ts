/** Read the build that produced this document, including after client-side navigation. */
export function getDocumentBuildId(): string | null {
  try {
    const text = document.getElementById('__NEXT_DATA__')?.textContent;
    const data: unknown = text ? JSON.parse(text) : null;
    return typeof data === 'object' &&
      data !== null &&
      'buildId' in data &&
      typeof data.buildId === 'string' &&
      data.buildId.length > 0
      ? data.buildId
      : null;
  } catch {
    return null;
  }
}
