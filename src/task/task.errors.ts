export class TaskNotFoundError extends Error {
  public constructor() {
    super('Task not found');
    this.name = 'TaskNotFoundError';
  }
}
