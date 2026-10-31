import type { MemeLocal } from "./memes.ts";

type Dependencies = {
  read: () => MemeLocal;
  write: (state: MemeLocal) => void;
  send: (id: string, desired: boolean, token: string) => Promise<unknown>;
};

// Share in-flight ordering across screen unmount/remount in this JavaScript runtime.
const revisions = new Map<string, number>();
const tails = new Map<string, Promise<boolean>>();

/** Durable account queues plus per-item ordering prevent a merge from undoing removal. */
export function createMemeFavoriteSync({ read, write, send }: Dependencies) {
  let account: string | null = null;
  let token: string | null = null;
  let session = 0;
  const keyFor = (owner: string, id: string) => JSON.stringify([owner, id]);
  const current = (owner: string, epoch: number) =>
    owner === account && epoch === session && !!token;

  function setSession(nextAccount: string | null, nextToken: string | null) {
    if (nextAccount !== account) session++;
    account = nextAccount;
    token = nextToken;
  }

  function updateQueue(
    owner: string,
    update: (queue: Record<string, boolean>) => void,
  ) {
    const state = read();
    const queue = { ...state.favoriteQueues[owner] };
    update(queue);
    write({
      ...state,
      favoriteQueues: { ...state.favoriteQueues, [owner]: queue },
    });
  }

  function enqueue(owner: string, epoch: number, id: string, desired: boolean) {
    const key = keyFor(owner, id);
    const revision = revisions.get(key) || 0;
    const run = async () => {
      if (!current(owner, epoch)) return false;
      if (
        (revisions.get(key) || 0) !== revision ||
        read().favoriteQueues[owner]?.[id] !== desired
      )
        return false;
      try {
        await send(id, desired, token!);
        if (!current(owner, epoch) || (revisions.get(key) || 0) !== revision)
          return false;
        updateQueue(owner, (queue) => {
          delete queue[id];
        });
        return true;
      } catch {
        return false;
      }
    };
    const previous = tails.get(key);
    const task = previous ? previous.then(run) : run();
    tails.set(key, task);
    void task.finally(() => {
      if (tails.get(key) === task) tails.delete(key);
    });
    return task;
  }

  async function sync() {
    if (!account || !token) return false;
    const owner = account,
      epoch = session;
    // Bind guest entries before the first network request. A different login cannot claim them.
    const state = read();
    const queue = { ...state.favoriteQueues[owner] };
    for (const id of state.favorites) if (!(id in queue)) queue[id] = true;
    write({
      ...state,
      favorites: [],
      favoriteQueues: { ...state.favoriteQueues, [owner]: queue },
    });
    for (const [id, desired] of Object.entries(queue)) {
      if (!current(owner, epoch)) return false;
      await enqueue(owner, epoch, id, desired);
    }
    return current(owner, epoch);
  }

  async function setFavorite(id: string, desired: boolean) {
    if (!account || !token) return false;
    const owner = account,
      epoch = session,
      key = keyFor(owner, id);
    revisions.set(key, (revisions.get(key) || 0) + 1);
    updateQueue(owner, (queue) => {
      queue[id] = desired;
    });
    return enqueue(owner, epoch, id, desired);
  }
  return { setSession, sync, setFavorite, sessionVersion: () => session };
}
