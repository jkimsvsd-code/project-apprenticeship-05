/** In-memory history. Call record/undo/redo only after a candidate renders successfully. */
export class EditHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private group: symbol | undefined;

  constructor(
    private readonly equal: (a: T, b: T) => boolean,
    readonly limit = 50,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('이력 한도를 확인해 주세요.');
  }

  get undoCount() {
    return this.past.length;
  }
  get redoCount() {
    return this.future.length;
  }
  get undoTarget() {
    return this.past.at(-1);
  }
  get redoTarget() {
    return this.future.at(-1);
  }

  record(before: T, after: T, group?: symbol) {
    if (this.equal(before, after)) return;
    if (!group || this.group !== group || this.future.length) {
      this.past.push(before);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.group = group;
  }

  undo(current: T) {
    const target = this.past.pop();
    if (target === undefined) return undefined;
    this.future.push(current);
    this.group = undefined;
    return target;
  }

  redo(current: T) {
    const target = this.future.pop();
    if (target === undefined) return undefined;
    this.past.push(current);
    this.group = undefined;
    return target;
  }

  clear() {
    this.past = [];
    this.future = [];
    this.group = undefined;
  }
}
