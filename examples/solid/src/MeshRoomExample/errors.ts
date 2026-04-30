export function isMediaError(error: unknown) {
  return (
    error instanceof DOMException &&
    [
      'AbortError',
      'NotAllowedError',
      'NotFoundError',
      'NotReadableError',
      'OverconstrainedError',
    ].includes(error.name)
  );
}
