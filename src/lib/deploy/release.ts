/** Public deployment identity; reject malformed values rather than echoing arbitrary env text. */
export function releaseIdentity(commitValue?: string, branchValue?: string) {
  return {
    commit: commitValue && /^[0-9a-f]{40}$/i.test(commitValue) ? commitValue.toLowerCase() : null,
    branch: branchValue && /^[a-z0-9._/-]{1,100}$/i.test(branchValue) ? branchValue : null,
  };
}
