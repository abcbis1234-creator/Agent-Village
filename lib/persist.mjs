// Fire-and-forget persistence for small synchronous model methods.
//
// Models such as WantBoard and Town mutate in-memory state and then ask the
// store to persist. Those methods must stay synchronous for their callers, but
// a rejected `save()` promise would otherwise surface as an unhandled
// rejection (and could take the process down). The mutation is already
// applied; a later save retries the same state, so a lost write is recoverable.

export function persist(store) {
  try {
    const pending = store?.save?.();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch {
    // A synchronous save failure is equally recoverable on the next write.
  }
}
